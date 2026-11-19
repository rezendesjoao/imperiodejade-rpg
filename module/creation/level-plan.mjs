/**
 * A level gained, as the level-up wizard plans it (p. 44-45): the class that grows (or the new one, a multiclass),
 * what it grants at the new level with the choices made, the choices that grow with the level on what the character
 * already has (paths, effects, chakras), the feat or +1 of the level, the class's feats and jutsus of that level, the
 * skills a higher Intelligence brings, the Honor (+1 for staying in the first class, the violations of the level) and
 * a preview actor in memory with all of it. Nothing changes on the actor until applyLevelUp() writes the plan at once.
 */
import { BBA_PROGRESSIONS, SKILLS, SYSTEM_ID, abilityMod } from "../config.mjs";
import { classLevelOf, dataFor, norm } from "../auto/context.mjs";
import { evaluate } from "../auto/formula.mjs";
import { classGrantEntries, grantData, itemGrantEntries } from "../documents/grants.mjs";
import { loadDocuments } from "./catalog.mjs";
import { ANCESTRAL_FLAG, setAncestral } from "./plan.mjs";
import {
  CASTER_GRADES, DEVOTION_NAMES, EXOTIC_FEAT, FEAT_JUTSUS, GRADE_ORDER, JUTSU_SOURCES, LEVEL_FEATS, LEVEL_JUTSUS,
  NAME_ALLOWANCES, SKILL_VIOLATIONS, WEAPON_TRAINING_VIOLATION, applyViolations, jutsuSeverity, multiclassSeverity
} from "./rules.mjs";

const L = key => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/** On an item: the level that gave it ({level, kind, pool}). On the actor: the record of the levels gained. */
export const LEVEL_FLAG = "levelUp";
export const LEVEL_LOG = "levelLog";

const flagsOf = data => data?.flags?.[SYSTEM_ID] ?? {};
const normText = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function fromCompendium(doc) {
  const data = game.items.fromCompendium(doc, { clearFolder: true, keepId: false });
  delete data._id;
  return data;
}

/* -------------------------------------------- */
/*  The character and its classes               */
/* -------------------------------------------- */

/** The classes of an actor, the first one first. */
export const classesOf = actor => actor.items.filter(i => i.type === "class").sort((a, b) => a.sort - b.sort);

/** The class chosen at the 1st level (the flagged one, or the first). */
export const primaryClass = actor => {
  const classes = classesOf(actor);
  return classes.find(c => c.system.primary) ?? classes[0] ?? null;
};

/** A character that can gain a level here: one with classes, below the 20th level, that the user owns. */
export function canLevel(actor) {
  return (actor?.type === "character") && actor.isOwner && !actor.pack && (classesOf(actor).length > 0) && ((actor.system.level ?? 1) < 20);
}

/** The catalog's view of a class item (by its compendium entry or its name). */
export function classView(catalog, item) {
  return catalog.classes.find(c => c.uuid === item._stats?.compendiumSource) ?? catalog.classes.find(c => c.key === norm(item.name)) ?? null;
}

/** An empty level-up: a level more in the first class, the feat of the level. */
export function emptyLevelDraft(actor) {
  return {
    classId: primaryClass(actor)?.id ?? null,
    classUuid: null,
    bonus: { kind: "feat", ability: null },
    choices: {},
    ancestral: null,
    multiclass: { kind: "feat", feat: null, skill: null, choices: [], text: "" },
    feats: [],
    jutsus: [],
    skills: [],
    specialties: []
  };
}

const bbaAt = (bba, level) => BBA_PROGRESSIONS[bba]?.calc(level) ?? 0;

/**
 * The classes a level can go to: those the character has (one more level) and the others (a first level, with the
 * violation it is, p. 45).
 */
export function classOptions(actor, catalog) {
  const owned = classesOf(actor);
  const primary = primaryClass(actor);
  return catalog.classes.map(cls => {
    const item = owned.find(i => (i._stats?.compendiumSource === cls.uuid) || (norm(i.name) === cls.key)) ?? null;
    const next = (item?.system.levels ?? 0) + 1;
    return {
      cls, item, next, isNew: !item, primary: !!item && (item.id === primary?.id),
      violation: (!item && primary) ? multiclassSeverity(primary.system.honor ?? 0, cls.honor) : null,
      features: cls.features.filter(f => f.level === next).map(f => f.view ?? { name: f.name, img: cls.img, text: "", html: "" }),
      pv: cls.pv.perLevel,
      pm: cls.pm.perLevel,
      bba: bbaAt(cls.bba, next) - bbaAt(cls.bba, next - 1),
      honor: (!!item && (item.id === primary?.id)) ? 1 : 0
    };
  });
}

/* -------------------------------------------- */
/*  Choices the wizard makes by itself          */
/* -------------------------------------------- */

/**
 * The choices that follow another one: the samurai's improved style and mastery follow the style of the 2nd level, the
 * kensei's arma querida, arma indestrutível and dano desarmado follow the arma eleita.
 */
function autoChoice(data, items) {
  const key = norm(data.name);
  const picks = name => items.find(i => (i.type === "power") && (norm(i.name) === name))?.system?.choices ?? [];
  if (["estilo de combate aprimorado", "dominio do estilo de combate"].includes(key)) {
    const style = picks("estilo de combate");
    return style.length ? { choices: [...style] } : null;
  }
  if (["arma querida", "arma indestrutivel"].includes(key)) return { choices: [picks("arma eleita").includes("desarmado") ? "desarmado" : "arma"] };
  if ((key === "dano desarmado") && (norm(data.system?.originName) === "kensei")) return { choices: [picks("arma eleita").includes("desarmado") ? "desarmado" : "outra"] };
  return null;
}

/** Whether a choice of an item is made by the wizard (and not asked). */
export const isAutoChoice = (data, items) => !!autoChoice(data, items);

/* -------------------------------------------- */
/*  The plan                                    */
/* -------------------------------------------- */

/**
 * Plan a level of an actor.
 * @param {Actor} actor
 * @param {object} draft                 emptyLevelDraft(), filled by the wizard
 * @param {object} options
 * @param {object} options.catalog
 * @param {boolean} [options.violations] Apply the fixed Honor damage of the level's violations
 */
export async function planLevelUp(actor, draft, { catalog, violations = true } = {}) {
  const base = actor.toObject();
  const items = base.items;
  const oldIds = new Set(items.map(i => i._id));
  const newItems = [];
  const updates = new Map();
  const add = data => {
    data._id = foundry.utils.randomID();
    newItems.push(data);
    items.push(data);
    return data;
  };
  const touch = (id, changes) => {
    const item = items.find(i => i._id === id);
    if (!item) return;
    for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(item, path, value);
    updates.set(id, Object.assign(updates.get(id) ?? { _id: id }, changes));
  };
  const primary = primaryClass(actor);
  const level = (actor.system.level ?? 1) + 1;

  // The class: a level more in one the character has, or the first level of a new one
  let clsData = draft.classId ? items.find(i => (i._id === draft.classId) && (i.type === "class")) : null;
  let cls = null;
  let classLevel = 1;
  const isNew = !clsData;
  if (clsData) {
    cls = catalog.classes.find(c => c.uuid === clsData._stats?.compendiumSource) ?? catalog.classes.find(c => c.key === norm(clsData.name)) ?? null;
    classLevel = clsData.system.levels + 1;
    touch(clsData._id, { "system.levels": classLevel });
  } else {
    cls = catalog.byUuid.get(draft.classUuid) ?? null;
    const doc = cls ? (await loadDocuments([cls.uuid])).get(cls.uuid) : null;
    if (!doc) throw new Error(L("IJ.Level.noClass"));
    clsData = add(fromCompendium(doc));
    clsData.system.levels = 1;
    clsData.system.primary = false;
  }

  // What a source already has among the actor's items and the planned ones (grants.mjs#alreadyHas)
  const hasFor = source => ({ inline, uuid, name, type, choiceText }) => {
    if (inline) return items.some(i => (flagsOf(i).grantedBy === source._id) && (flagsOf(i).sourceUuid === inline));
    const same = items.filter(i => (flagsOf(i).sourceUuid === uuid) || (i._stats?.compendiumSource === uuid) || ((i.name === name) && (i.type === type)));
    if (!same.length) return false;
    return choiceText ? same.some(i => normText(i.system?.choiceText) === normText(choiceText)) : true;
  };
  const queue = [];
  const enqueue = (source, entries) => {
    if (entries?.length) queue.push({ source, entries });
  };
  const drain = async onEach => {
    while (queue.length) {
      const { source, entries } = queue.shift();
      const data = await grantData({ id: source._id, name: source.name, system: source.system }, entries, { has: hasFor(source), load: loadDocuments });
      for (const d of data) {
        onEach?.(d);
        add(d);
        enqueue(d, itemGrantEntries(d));
      }
    }
  };
  const applyChoice = d => {
    const choice = d.system?.auto?.choice;
    if (!choice) return;
    const set = autoChoice(d, items) ?? draft.choices[`uuid:${flagsOf(d).sourceUuid}`];
    if (!set) return;
    if (set.choices) d.system.choices = [...set.choices];
    if ((set.text !== undefined) && choice.text) d.system.choiceText = String(set.text ?? "").trim();
  };

  // What the class grants at this level
  enqueue(clsData, classGrantEntries(clsData, { fromLevel: classLevel - 1 }));
  await drain(applyChoice);

  // Choices that grow with the level on what the character has: the new picks, and what they grant
  for (const item of items.filter(i => oldIds.has(i._id))) {
    const set = draft.choices[`id:${item._id}`];
    const choice = item.system?.auto?.choice;
    if (!set || !choice) continue;
    const prior = item.system.choices ?? [];
    const merged = [...prior, ...(set.choices ?? []).filter(c => !prior.includes(c))];
    const changes = {};
    if (merged.length !== prior.length) changes["system.choices"] = merged;
    if ((set.text !== undefined) && choice.text && !item.system.choiceText) changes["system.choiceText"] = String(set.text ?? "").trim();
    if (!Object.keys(changes).length) continue;
    touch(item._id, changes);
    const added = (choice.options ?? []).filter(o => merged.includes(o.id) && !prior.includes(o.id));
    enqueue(item, added.flatMap(o => (o.grants ?? []).map(g => ({ ...g, option: o.id }))));
  }
  await drain(applyChoice);

  // The feats of the level (the feat of the level, the class's feats) and the starting feat of a new class
  const multiclassFeat = (isNew && (draft.multiclass?.kind === "feat")) ? draft.multiclass.feat : null;
  const featDocs = await loadDocuments([...draft.feats.map(f => f.uuid), multiclassFeat]);
  const picked = [...draft.feats];
  if (multiclassFeat) picked.push({ uuid: multiclassFeat, pool: "multiclass", choices: draft.multiclass.choices ?? [], text: draft.multiclass.text ?? "" });
  for (const pick of picked) {
    const doc = featDocs.get(pick.uuid);
    if (!doc) continue;
    const d = add(fromCompendium(doc));
    if (pick.choices?.length) d.system.choices = [...pick.choices];
    if (pick.text) d.system.choiceText = String(pick.text).trim();
    foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.${LEVEL_FLAG}`, { level, kind: "feat", pool: pick.pool });
    enqueue(d, itemGrantEntries(d));
  }
  await drain(applyChoice);

  // The jutsus learned
  const jutsuDocs = await loadDocuments(draft.jutsus.map(j => j.uuid));
  for (const pick of draft.jutsus) {
    const doc = jutsuDocs.get(pick.uuid);
    if (!doc || items.some(i => (i.type === "jutsu") && ((i._stats?.compendiumSource === pick.uuid) || (i.name === doc.name)))) continue;
    const d = add(fromCompendium(doc));
    foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.${LEVEL_FLAG}`, { level, kind: "jutsu", pool: pick.pool });
  }

  // The samurai's ancestral swords: a +1 more at each odd level
  const ancestral = ancestralSwords(items);
  if (ancestral && draft.ancestral && (cls?.key === "samurai") && (classLevel % 2 === 1)) {
    const sword = ancestral[draft.ancestral];
    if (sword) {
      const current = Number(flagsOf(sword)[ANCESTRAL_FLAG] ?? /\+(\d+)\s*$/.exec(sword.name)?.[1] ?? 0) || 0;
      touch(sword._id, setAncestral(foundry.utils.deepClone(sword), sword.name, current + 1));
    }
  }

  // The actor: +1 in an ability, the new skills, the chakra grades of the casters, Honor
  const actorUpdate = {};
  const system = base.system;
  const ability = (draft.bonus?.kind === "ability") ? draft.bonus.ability : null;
  if (ability && system.abilities[ability]) {
    system.abilities[ability].value += 1;
    actorUpdate[`system.abilities.${ability}.value`] = system.abilities[ability].value;
  }
  const skills = [...draft.skills];
  if (isNew && (draft.multiclass?.kind === "skill") && draft.multiclass.skill) skills.push(draft.multiclass.skill);
  for (const key of skills) {
    if (!system.skills[key]) continue;
    system.skills[key].trained = true;
    actorUpdate[`system.skills.${key}.trained`] = true;
  }
  for (const s of draft.specialties) {
    system.specialties[s.id] = { skill: s.skill, label: s.label, trained: true, bonus: 0 };
    actorUpdate[`system.specialties.${s.id}`] = system.specialties[s.id];
  }
  for (const d of newItems.filter(i => i.type === "power")) {
    const [chakra, grade] = CASTER_GRADES[norm(d.name)] ?? [];
    if (!chakra) continue;
    if (GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(system.chakras[chakra].grade)) {
      system.chakras[chakra].grade = grade;
      actorUpdate[`system.chakras.${chakra}.grade`] = grade;
    }
  }
  const honorBefore = actor.system.abilities.hon.total;
  const gain = (!isNew && primary && (clsData._id === primary.id)) ? 1 : 0;
  const found = levelViolations({ draft, actor, cls, isNew, primary, items, newItems, catalog, skills });
  const honor = violations ? applyViolations(honorBefore + gain, found) : { honor: honorBefore + gain, list: found.map(v => ({ ...v, damage: 0 })), damage: 0 };
  if (gain || honor.damage) {
    system.abilities.hon.value = Math.max(0, system.abilities.hon.value + gain - honor.damage);
    actorUpdate["system.abilities.hon.value"] = system.abilities.hon.value;
  }

  // The preview: the actor in memory at the new level, prepared as the sheet prepares it (not the real actor's id)
  const previewData = foundry.utils.deepClone(base);
  delete previewData._id;
  const preview = new Actor.implementation(previewData);

  return {
    level, classLevel, cls, clsData, isNew, primary, items, newItems, updates: [...updates.values()], actorUpdate, preview,
    honor: { before: honorBefore, gain, final: honor.honor, damage: honor.damage, list: honor.list }
  };
}

/** The samurai's ancestral swords among the items ({katana, wakizashi}), or null. */
export function ancestralSwords(items) {
  const swords = items.find(i => (i.type === "power") && (norm(i.name) === "espadas ancestrais"));
  if (!swords) return null;
  const granted = items.filter(i => (i.type === "weapon") && (flagsOf(i).grantedBy === swords._id));
  const out = {
    katana: granted.find(i => norm(i.name).includes("katana")) ?? null,
    wakizashi: granted.find(i => norm(i.name).includes("wakizashi")) ?? null
  };
  return (out.katana || out.wakizashi) ? out : null;
}

/* -------------------------------------------- */
/*  What the level asks                         */
/* -------------------------------------------- */

/**
 * Everything the level asks, from the plan: the choices to make (new abilities, choices grown with the level, the
 * ancestral sword, the first level of a new class), the feat pools, the jutsu pools and the new skills.
 */
export function levelRequirements(plan, draft, actor, catalog) {
  const { preview, cls, classLevel, isNew, items } = plan;
  const oldIds = new Set(actor.items.map(i => i.id));
  const choices = [];
  for (const item of preview.items) {
    if (!["power", "feat"].includes(item.type)) continue;
    // A feat picked in the wizard asks its choice in its own slot
    if (item.flags?.[SYSTEM_ID]?.[LEVEL_FLAG]) continue;
    const choice = item.system.auto?.choice;
    if (!choice || isAutoChoice(item, items)) continue;
    const old = oldIds.has(item.id) ? actor.items.get(item.id) : null;
    const prior = old ? (old.system.choices ?? []) : [];
    const required = Math.max(1, Math.floor(evaluate(choice.count ?? 1, dataFor(item), 1)));
    const level = classLevelOf(item);
    const secrets = norm(item.name) === "segredos dos chacras";
    const allOpen = Object.values(actor.system.chakras).every(c => c.open);
    const options = (choice.options ?? []).filter(o => {
      // A repetition only at its own level (the onimusha's paths)
      const m = /^rep(\d+)$/.exec(o.id);
      if (m) return Number(m[1]) === level;
      // The wu-jen opens a closed chakra; the medium grades only once all are open
      if (secrets && /^[a-z]{3}$/.test(o.id)) return !actor.system.chakras[o.id]?.open || prior.includes(o.id);
      if (secrets && /Mediano$/.test(o.id)) return allOpen || prior.includes(o.id);
      return true;
    });
    const needPicks = options.length ? Math.max(0, Math.min(required, options.length) - prior.length) : 0;
    const needText = !!choice.text && !String(old?.system.choiceText ?? "").trim();
    if (!needPicks && !(needText && !old)) continue;
    // A choice already behind (made by hand before) is asked too: what is missing
    const key = old ? `id:${item.id}` : `uuid:${item.flags?.[SYSTEM_ID]?.sourceUuid ?? item._stats?.compendiumSource}`;
    const made = draft.choices[key] ?? {};
    choices.push({
      key, name: item.name, img: item.img, label: choice.label ?? item.name, origin: item.system.originName ?? "",
      count: needPicks, prior, text: (!old && choice.text) ? choice.text : "", textValue: made.text ?? "",
      options: options.map(o => ({ id: o.id, label: o.label ?? o.id, hint: o.hint ?? "" })),
      picks: (made.choices ?? []).filter(c => !prior.includes(c))
    });
  }

  // The ancestral sword that gets the +1 (odd levels of the samurai)
  const swords = ancestralSwords(items);
  const ancestral = (swords && (cls?.key === "samurai") && (classLevel % 2 === 1) && (classLevel > 1)) ? swords : null;

  // The first level in a new class: a trained skill or a starting feat of its list (p. 45)
  let multiclass = null;
  if (isNew && cls) {
    const owned = new Set(actor.items.filter(i => i.type === "feat").map(i => norm(i.name)));
    multiclass = {
      feats: cls.startingFeatList.map(f => catalog.byUuid.get(f.uuid)).filter(f => f && (!owned.has(f.key) || f.repeatable))
        .filter((f, i, all) => all.findIndex(x => x.uuid === f.uuid) === i),
      skills: cls.classSkills.filter(k => !actor.system.skills[k]?.trained && !SKILLS[k]?.specialty)
    };
  }

  return { choices, ancestral, multiclass, featPools: featPools(plan, draft, actor), jutsuPools: jutsuPools(plan, draft, actor), skills: skillSlots(plan, draft, actor) };
}

/** Whether a choice of the level is complete in the draft. */
export function levelChoiceDone(req, draft) {
  const made = draft.choices[req.key] ?? {};
  const picks = (made.choices ?? []).filter(c => !req.prior.includes(c) && req.options.some(o => o.id === c));
  if (picks.length < req.count) return false;
  if (req.text && !String(made.text ?? "").trim()) return false;
  return true;
}

/** The religion of the character's devotion (normalized), for the granted powers. */
function devotionOf(items) {
  const devotion = items.find(i => (i.type === "feat") && /^devoto (de |da |do )/.test(norm(i.name)));
  return devotion ? norm(devotion.name.replace(/^Devot[oa]\s+(de|da|do)\s+/i, "")) : "";
}

/**
 * The feats of the level (p. 44 and the class tables): the feat of the level (unless it became +1 in an ability) and
 * those the class's abilities give at this level (technique, granted powers, chaotic studies, spiritual lessons).
 */
function featPools(plan, draft) {
  const { preview, cls, classLevel, items } = plan;
  const pools = [];
  if (draft.bonus?.kind !== "ability") pools.push({ id: "level", count: 1, accepts: () => true });
  for (const item of preview.items.filter(i => i.type === "power")) {
    const key = `${norm(item.system.originName)}|${norm(item.name)}`;
    const rule = LEVEL_FEATS[key];
    if (!rule || (norm(item.system.originName) !== cls?.key)) continue;
    const levels = String(item.system.levels ?? "").split(/[^0-9]+/).map(Number).filter(n => n > 0);
    if (!levels.includes(classLevel)) continue;
    const deity = (rule.powers === "own") ? devotionOf(items) : (rule.powers ?? null);
    pools.push({
      id: key, name: item.name, img: item.img, count: 1,
      accepts: f => (rule.categories ?? []).includes(f.category) || (!!deity && (f.category === "poder") && (norm(f.deity) === deity))
    });
  }
  return pools;
}

/** The grade a character executes in each open chakra (index in GRADE_ORDER; −1 closed). */
function gradesOf(preview) {
  return Object.fromEntries(Object.entries(preview.system.chakras).map(([k, c]) => [k, c.open ? GRADE_ORDER.indexOf(c.grade) : -1]));
}

/**
 * The jutsus of the level: the casters' Conhecimento de Jutsus at their even levels, the apprentice ability of a new
 * caster class, the feats picked (Abrir Chacra, the chakra grades, Conhecimento de Jutsus) and the chakras the wu-jen's
 * Segredos dos Chacras opens now.
 */
function jutsuPools(plan, draft, actor) {
  const { preview, cls, classLevel, newItems, items } = plan;
  const grades = gradesOf(preview);
  const top = Math.max(-1, ...Object.values(grades));
  const names = preview.items.contents.flatMap(i => [...(NAME_ALLOWANCES[norm(i.name)] ?? []), ...(DEVOTION_NAMES[norm(i.name)] ?? [])]);
  const pools = [];
  const push = pool => pools.push({ names: [], ...pool, id: `${pool.key}:${pools.filter(p => p.key === pool.key).length + 1}` });
  // The class's ability of this level
  for (const item of preview.items.filter(i => i.type === "power")) {
    const key = `${norm(item.system.originName)}|${norm(item.name)}`;
    const rule = LEVEL_JUTSUS[key];
    if (!rule || (norm(item.system.originName) !== cls?.key)) continue;
    const levels = String(item.system.levels ?? "").split(/[^0-9]+/).map(Number).filter(n => n > 0);
    if (!levels.includes(classLevel)) continue;
    push({ key, name: item.name, img: item.img, count: rule.count, any: classLevel >= rule.anyGradeFrom, grade: (classLevel >= rule.anyGradeFrom) ? null : "basico", names });
  }
  // A new caster class: its apprentice ability
  const mods = Object.fromEntries(Object.entries(preview.system.abilities).map(([k, a]) => [k, a.mod]));
  for (const d of newItems) {
    const src = JUTSU_SOURCES[norm(d.name)];
    // (the casters' Conhecimento de Jutsus of a level is above)
    if (!src || (d.type !== "power") || LEVEL_JUTSUS[`${norm(d.system?.originName)}|${norm(d.name)}`]) continue;
    push({ key: norm(d.name), name: d.name, img: d.img, count: src.count(mods), chakras: src.chakras, grade: "basico", names: [...src.names, ...names] });
  }
  // The feats picked now
  for (const d of newItems.filter(i => i.type === "feat")) {
    const rule = FEAT_JUTSUS[norm(d.name)];
    if (!rule) continue;
    const chakra = rule.chosenChakra ? (d.system.choices ?? [])[0] : null;
    if (rule.chosenChakra && !chakra) continue;
    push({ key: norm(d.name), name: d.name, img: d.img, count: rule.count, chakras: chakra ? [chakra] : null, grade: rule.grade, any: !rule.grade, names: rule.grade ? [] : names });
  }
  // The chakras the wu-jen opens (or raises) now
  const secrets = items.find(i => (i.type === "power") && (norm(i.name) === "segredos dos chacras"));
  if (secrets) {
    const before = actor.items.get(secrets._id)?.system.choices ?? [];
    for (const id of (secrets.system.choices ?? []).filter(c => !before.includes(c))) {
      const m = /^(for|des|con|int|sab|car)(Mediano)?$/.exec(id);
      if (!m) continue;
      push({ key: `segredos ${id}`, name: secrets.name, img: secrets.img, count: 1, chakras: [m[1]], grade: m[2] ? "mediano" : "basico" });
    }
  }
  return pools.map(p => ({ ...p, grades, top }));
}

/** Whether a jutsu pool of the level takes a jutsu. */
export function levelPoolTakes(pool, jutsu) {
  const g = GRADE_ORDER.indexOf(jutsu.grade);
  const named = (pool.names ?? []).some(w => jutsu.key.includes(w));
  if (pool.grade) {
    if (jutsu.grade !== pool.grade) return false;
    if (pool.chakras) return pool.chakras.includes(jutsu.chakra) || named;
    return (pool.grades[jutsu.chakra] >= g) || named;
  }
  // Any grade the character executes: in the jutsu's chakra, or (a name its abilities allow) in its best chakra
  if (pool.chakras && !pool.chakras.includes(jutsu.chakra) && !named) return false;
  return (pool.grades[jutsu.chakra] >= g) || (named && (pool.top >= g));
}

/**
 * The skills a higher Intelligence brings (p. 99): one for each +1 of the modifier, only from a lasting increase (the
 * +1 of the level), among the skills of the character's classes.
 */
function skillSlots(plan, draft, actor) {
  const ability = (draft.bonus?.kind === "ability") ? draft.bonus.ability : null;
  let count = 0;
  if (ability === "int") {
    const a = actor.system.abilities.int;
    const before = (a.value ?? 10) + (a.racial ?? 0);
    count = Math.max(0, abilityMod(before + 1) - abilityMod(before));
  }
  const classSkills = new Set(plan.items.filter(i => i.type === "class").flatMap(i => i.system.classSkills ?? []));
  return { count, classSkills, trained: new Set(Object.entries(actor.system.skills).filter(([, s]) => s.trained).map(([k]) => k)) };
}

/* -------------------------------------------- */
/*  Honor violations of the level               */
/* -------------------------------------------- */

/**
 * The violations of a level (p. 45, 82-84): the first level in another class, skills out of the classes' lists and
 * the dishonorable ones, Tormenta feats, dishonorable weapons learned, jutsus of darkness, enchantment or illusion.
 */
function levelViolations({ draft, actor, cls, isNew, primary, items, newItems, catalog, skills }) {
  const list = [];
  if (isNew && primary && cls) {
    list.push({ label: F("IJ.Level.Violation.multiclass", { name: cls.name }), severity: multiclassSeverity(primary.system.honor ?? 0, cls.honor) });
  }
  const classSkills = new Set(items.filter(i => i.type === "class").flatMap(i => i.system.classSkills ?? []));
  const skillName = key => L(SKILLS[key]?.label ?? key);
  for (const key of skills) {
    if (!classSkills.has(key)) list.push({ label: F("IJ.Wizard.Violation.outOfClass", { name: skillName(key) }), severity: "leve" });
    if (SKILL_VIOLATIONS[key]) list.push({ label: F("IJ.Wizard.Violation.skill", { name: skillName(key) }), severity: SKILL_VIOLATIONS[key] });
  }
  for (const s of draft.specialties) {
    if (!classSkills.has(s.skill)) list.push({ label: F("IJ.Wizard.Violation.outOfClass", { name: `${skillName(s.skill)} (${s.label})` }), severity: "leve" });
  }
  for (const d of newItems.filter(i => i.type === "feat")) {
    const view = catalog.byUuid.get(d._stats?.compendiumSource);
    if (view?.category === "tormenta") list.push({ label: F("IJ.Wizard.Violation.tormenta", { name: d.name }), severity: "severa" });
  }
  // Exotic weapons learned now (a new copy, or new options on one the character has)
  const before = new Map(actor.items.filter(i => (i.type === "feat") && (norm(i.name) === norm(EXOTIC_FEAT))).map(i => [i.id, i.system.choices ?? []]));
  for (const d of items.filter(i => (i.type === "feat") && (norm(i.name) === norm(EXOTIC_FEAT)))) {
    const prior = before.get(d._id) ?? [];
    const options = d.system?.auto?.choice?.options ?? [];
    for (const id of (d.system.choices ?? []).filter(c => !prior.includes(c))) {
      const exotic = options.find(o => o.id === id)?.traits?.exotic ?? [id];
      const weapon = catalog.wares.find(w => (w.type === "weapon") && exotic.some(n => w.key.includes(norm(n))));
      if (weapon?.dishonorable) list.push({ label: F("IJ.Wizard.Violation.weapon", { name: weapon.name }), severity: WEAPON_TRAINING_VIOLATION });
    }
  }
  for (const pick of draft.jutsus) {
    const jutsu = catalog.byUuid.get(pick.uuid);
    const severity = jutsu ? jutsuSeverity(jutsu.descriptors, jutsu.grade) : null;
    if (severity) list.push({ label: F("IJ.Wizard.Violation.jutsu", { name: jutsu.name }), severity });
  }
  return list;
}

/* -------------------------------------------- */
/*  Applying                                    */
/* -------------------------------------------- */

/**
 * Write the plan on the actor: the class's level and the choices on what it has (without the automatic grants: they
 * are in the plan), the new items, the actor's changes; the PV and PM it gained come in full.
 * @returns {Promise<{pv: number, pm: number}>}   What the PV and PM maxima grew
 */
export async function applyLevelUp(actor, plan) {
  const pvBefore = actor.system.attributes.pv.max;
  const pmBefore = actor.system.attributes.pm.max;
  if (plan.updates.length) await actor.updateEmbeddedDocuments("Item", foundry.utils.deepClone(plan.updates), { ijLevelUp: true });
  if (plan.newItems.length) await actor.createEmbeddedDocuments("Item", foundry.utils.deepClone(plan.newItems), { keepId: true, ijCreation: true });
  const log = [...(actor.getFlag(SYSTEM_ID, LEVEL_LOG) ?? [])];
  log.push({
    level: plan.level, class: plan.clsData.name, classLevel: plan.classLevel, date: Date.now(), user: game.user.id,
    items: plan.newItems.map(i => i._id), violations: plan.honor.list.filter(v => v.damage).map(v => ({ label: v.label, damage: v.damage }))
  });
  await actor.update({ ...plan.actorUpdate, [`flags.${SYSTEM_ID}.${LEVEL_LOG}`]: log }, { ijLevelUp: true });
  const pv = Math.max(0, actor.system.attributes.pv.max - pvBefore);
  const pm = Math.max(0, actor.system.attributes.pm.max - pmBefore);
  if (pv || pm) {
    await actor.update({
      "system.attributes.pv.value": actor.system.attributes.pv.value + pv,
      "system.attributes.pm.value": actor.system.attributes.pm.value + pm
    });
  }
  return { pv, pm };
}
