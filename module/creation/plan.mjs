/**
 * A character as the creation wizard plans it: the items it will receive (the race, the class and all they grant with
 * the choices made, the feats, jutsus and gear picked), its own data (abilities, skills, details, money), the Honor
 * violations of its creation and a preview actor in memory (never saved), whose prepared data gives the very numbers
 * of the sheet. createCharacter() writes the plan on the real actor in one go.
 */
import { CASTES, SKILLS, SYSTEM_ID } from "../config.mjs";
import { norm, rankOf } from "../auto/context.mjs";
import { classGrantEntries, grantData, itemGrantEntries } from "../documents/grants.mjs";
import { loadDocuments } from "./catalog.mjs";
import {
  CASTE_MONEY, CLASS_WEAPON_PICKS, EXOTIC_FEAT, GEN_KEYS, JUTSU_SOURCES, DEVOTION_NAMES, NAME_ALLOWANCES, SKILL_VIOLATIONS,
  WEAPON_TRAINING_VIOLATION, applyViolations, jutsuSeverity, splitMoney
} from "./rules.mjs";

const L = key => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/** Flags: on an item, what the wizard gave it for ({kind, pool}); on the actor, the draft it was made from. */
export const CREATION_FLAG = "creation";
/** The rolls of the abilities, kept on the actor as they are made (a closed window can't roll again). */
export const ROLLS_FLAG = "creationRolls";

const flagsOf = data => data?.flags?.[SYSTEM_ID] ?? {};
const normText = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Item data of a compendium document, ready to be embedded. */
function fromCompendium(doc) {
  const data = game.items.fromCompendium(doc, { clearFolder: true, keepId: false });
  delete data._id;
  return data;
}

/* -------------------------------------------- */
/*  The draft                                   */
/* -------------------------------------------- */

/** An empty draft. */
export function emptyDraft(actor) {
  const ten = Object.fromEntries(GEN_KEYS.map(k => [k, 10]));
  return {
    race: null,
    raceAbilities: [],
    class: null,
    choices: {},
    ancestral: null,
    method: null,
    points: { ...ten },
    free: { ...ten },
    assign: {},
    skills: [],
    specialties: [],
    feats: [],
    jutsus: [],
    // The benefit of the 1st level (p. 44): a feat, or +1 in a basic ability
    levelBonus: { kind: "feat", ability: null },
    caste: null,
    cart: [],
    kitOffered: false,
    name: actor?.name ?? "",
    img: actor?.img ?? "",
    details: { gender: "", age: "", height: "", weight: "", clan: "", title: "", languages: [] },
    bio: { appearance: "", personality: "", history: "" }
  };
}

/**
 * The draft as it is kept on the actor. The choices are keyed by compendium uuids, whose dots the database would
 * read as nested keys: they are kept as a list.
 */
export function draftToFlag(draft) {
  const copy = foundry.utils.deepClone(draft);
  copy.choices = Object.entries(draft.choices ?? {}).map(([uuid, made]) => ({ uuid, choices: [...(made.choices ?? [])], text: made.text ?? "" }));
  return copy;
}

/** The draft kept on an actor, back as a draft. */
export function draftFromFlag(saved) {
  if (!saved || (typeof saved !== "object")) return null;
  const draft = foundry.utils.deepClone(saved);
  draft.choices = Array.isArray(saved.choices)
    ? Object.fromEntries(saved.choices.filter(c => c?.uuid).map(c => [c.uuid, { choices: c.choices ?? [], text: c.text ?? "" }]))
    : {};
  return draft;
}

/** The scores generated (before the race and the class): an unassigned roll is null. */
export function baseScores(draft, rolls = []) {
  const out = {};
  for (const k of GEN_KEYS) {
    if (draft.method === "free") out[k] = Math.clamp(Number(draft.free?.[k]) || 10, 3, 18);
    else if (draft.method === "roll") {
      const i = draft.assign?.[k];
      out[k] = ((i !== null) && (i !== undefined) && (rolls[i] !== undefined)) ? rolls[i] : null;
    }
    else out[k] = Math.clamp(Number(draft.points?.[k]) || 10, 8, 18);
  }
  return out;
}

/* -------------------------------------------- */
/*  Choices of the race and the class           */
/* -------------------------------------------- */

/** How many options a choice asks at the 1st level ("@rank": one per level of its table reached). */
export function choiceCount(choice, levels = []) {
  const c = choice?.count;
  if (typeof c === "number") return Math.max(1, c);
  if ((typeof c === "string") && c.includes("@rank")) return Math.max(1, levels.filter(l => l <= 1).length);
  return Math.max(1, Number(c) || 1);
}

/** The options a choice offers at creation (the repetitions of later levels left out). */
export const creationOptions = choice => (choice?.options ?? []).filter(o => !/^rep\d+$/.test(o.id));

/** Choices made by the wizard itself: the kensei's unarmed damage follows the arma eleita. */
const AUTO_CHOICES = {
  "kensei|dano desarmado": (draft, cls) => {
    const eleita = cls.features.find(f => f.view?.key === "arma eleita");
    const picked = draft.choices[eleita?.uuid]?.choices ?? [];
    return { choices: [picked.includes("desarmado") ? "desarmado" : "outra"] };
  }
};

/** Whether a feature's choice is made by the wizard (and not shown). */
export const autoChoice = (cls, feature) => !!AUTO_CHOICES[`${cls?.key}|${feature?.key}`];

/**
 * The choices the race step asks: the race's abilities with a choice (the henge's natural attack, the mashin's element).
 * @returns {{uuid, name, img, label, count, options, text, kind}[]}
 */
export function raceChoices(race) {
  return (race?.features ?? []).filter(f => f.choice && (creationOptions(f.choice).length || f.choice.text)).map(f => ({
    uuid: f.uuid, name: f.name, img: f.img, kind: "feature",
    label: f.choice.label ?? f.name, count: choiceCount(f.choice, f.levels), options: creationOptions(f.choice), text: f.choice.text ?? ""
  }));
}

/**
 * The choices the class step asks at the 1st level: its abilities with a choice (the kensei's arma eleita, the
 * shugenja's religion, the onimusha's path), the exotic weapons of the ninja and the monk, and which ancestral sword of
 * the samurai gets its first +1.
 */
export function classChoices(cls, catalog) {
  if (!cls) return [];
  const out = [];
  for (const f of cls.features) {
    const view = f.view;
    if ((f.level !== 1) || !view?.choice || autoChoice(cls, view)) continue;
    const options = creationOptions(view.choice);
    if (!options.length && !view.choice.text) continue;
    out.push({ uuid: f.uuid, name: view.name, img: view.img, kind: "feature", label: view.choice.label ?? view.name,
      count: choiceCount(view.choice, view.levels), options, text: view.choice.text ?? "", key: view.key });
  }
  const picks = CLASS_WEAPON_PICKS[cls.key];
  const exotic = cls.startingFeatList.find(f => norm(catalog.byUuid.get(f.uuid)?.name ?? "") === norm(EXOTIC_FEAT));
  if (picks && exotic) {
    const feat = catalog.byUuid.get(exotic.uuid);
    const options = picks.options.map(id => feat?.choice?.options?.find(o => o.id === id)).filter(Boolean);
    out.push({ uuid: exotic.uuid, name: feat?.name ?? EXOTIC_FEAT, img: feat?.img, kind: "weapons",
      label: L("IJ.Wizard.Class.exoticPick"), count: picks.count, options, text: "" });
  }
  if (cls.features.some(f => (f.level === 1) && (f.view?.key === "espadas ancestrais"))) {
    out.push({ uuid: "ancestral", name: cls.features.find(f => f.view?.key === "espadas ancestrais").view.name, kind: "ancestral",
      img: cls.features.find(f => f.view?.key === "espadas ancestrais").view.img, label: L("IJ.Wizard.Class.ancestral"), count: 1,
      options: [{ id: "katana", label: "Katana" }, { id: "wakizashi", label: "Wakizashi" }], text: "" });
  }
  return out;
}

/** Whether a choice of the race or class step is complete in the draft. */
export function choiceDone(choice, draft) {
  if (choice.kind === "ancestral") return !!draft.ancestral;
  const made = draft.choices[choice.uuid] ?? {};
  const picks = (made.choices ?? []).filter(id => choice.options.some(o => o.id === id));
  if (choice.options.length && (picks.length < Math.min(choice.count, choice.options.length))) return false;
  // A text (the arma eleita) only when an option that needs it is chosen: the unarmed strike fills it by itself
  if (choice.text && !String(made.text ?? "").trim()) return false;
  return true;
}

/** The choices the wizard writes on granted items: what the player made, plus the automatic ones. */
function resolvedChoices(draft, cls) {
  const out = foundry.utils.deepClone(draft.choices ?? {});
  for (const f of cls?.features ?? []) {
    const fn = AUTO_CHOICES[`${cls.key}|${f.view?.key}`];
    if (fn) out[f.uuid] = fn(draft, cls);
  }
  return out;
}

/* -------------------------------------------- */
/*  The plan                                    */
/* -------------------------------------------- */

/**
 * Plan the character of a draft.
 * @param {object} draft
 * @param {object} options
 * @param {object} options.catalog       module/creation/catalog.mjs
 * @param {number[]} [options.rolls]     The rolled values (method "roll")
 * @param {Actor} [options.actor]        The actor being made
 * @param {boolean} [options.violations] Apply the fixed Honor damage of the creation's violations
 * @returns {Promise<object>}
 */
export async function planCharacter(draft, { catalog, rolls = [], actor = null, violations = true } = {}) {
  const race = catalog.byUuid.get(draft.race) ?? null;
  const cls = catalog.byUuid.get(draft.class) ?? null;
  const items = [];
  const add = data => {
    data._id = foundry.utils.randomID();
    items.push(data);
    return data;
  };
  const docs = await loadDocuments([race?.uuid, cls?.uuid]);

  // What a source already has among the planned items (grants.mjs#alreadyHas, over the plan)
  const hasFor = source => ({ inline, uuid, name, type, choiceText, entry }) => {
    if (inline) return items.some(i => (flagsOf(i).grantedBy === source._id) && (flagsOf(i).sourceUuid === inline));
    const same = items.filter(i => (flagsOf(i).sourceUuid === uuid) || (i._stats?.compendiumSource === uuid) || ((i.name === name) && (i.type === type)));
    if (!same.length) return false;
    if (!choiceText) return true;
    if (same.some(i => normText(i.system?.choiceText) === normText(choiceText))) return true;
    // A copy still without its choice (the kensei's starting Foco em Arma) takes this one, and follows it from now on
    const blank = same.find(i => !i.system?.choiceText);
    if (!blank) return false;
    blank.system.choiceText = choiceText;
    if (entry.choiceText === "@choice") {
      foundry.utils.setProperty(blank, `flags.${SYSTEM_ID}.grantedBy`, source._id);
      foundry.utils.setProperty(blank, `flags.${SYSTEM_ID}.copyChoice`, true);
    }
    return true;
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

  // The race and the class, and all they grant at the 1st level, with the choices of their steps
  let raceData = null;
  let classData = null;
  if (race && docs.get(race.uuid)) {
    raceData = add(fromCompendium(docs.get(race.uuid)));
    raceData.system.chosen = race.choice.count ? draft.raceAbilities.slice(0, race.choice.count) : [];
    enqueue(raceData, raceData.system.features ?? []);
  }
  if (cls && docs.get(cls.uuid)) {
    classData = add(fromCompendium(docs.get(cls.uuid)));
    classData.system.levels = 1;
    classData.system.primary = true;
    enqueue(classData, classGrantEntries(classData));
  }
  const chosen = resolvedChoices(draft, cls);
  await drain(d => {
    const set = chosen[flagsOf(d).sourceUuid];
    if (!set) return;
    if (set.choices) d.system.choices = [...set.choices];
    if ((set.text !== undefined) && d.system.auto?.choice?.text) d.system.choiceText = String(set.text ?? "").trim();
  });

  // The feats picked, each with its own choice
  const featDocs = await loadDocuments(draft.feats.map(f => f.uuid));
  for (const pick of draft.feats) {
    const doc = featDocs.get(pick.uuid);
    if (!doc) continue;
    const d = add(fromCompendium(doc));
    if (pick.choices?.length) d.system.choices = [...pick.choices];
    if (pick.text) d.system.choiceText = String(pick.text).trim();
    foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.${CREATION_FLAG}`, { kind: "feat", pool: pick.pool });
    enqueue(d, itemGrantEntries(d));
  }
  await drain();

  // The jutsus learned
  const jutsuDocs = await loadDocuments(draft.jutsus.map(j => j.uuid));
  for (const pick of draft.jutsus) {
    const doc = jutsuDocs.get(pick.uuid);
    if (!doc || items.some(i => (i.type === "jutsu") && (i._stats?.compendiumSource === pick.uuid))) continue;
    const d = add(fromCompendium(doc));
    foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.${CREATION_FLAG}`, { kind: "jutsu", pool: pick.pool });
  }

  // Class gifts: the kensei's masterwork weapon, the samurai's ancestral swords
  await classGifts({ draft, catalog, items, add });

  // The gear bought (the same piece twice is one item with its quantity); the first armor and shield are worn
  const money = moneyOf(draft, catalog);
  const counts = new Map();
  for (const uuid of draft.cart) counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
  const gearDocs = await loadDocuments([...counts.keys()]);
  let body = false;
  let shield = false;
  for (const [uuid, n] of counts) {
    const doc = gearDocs.get(uuid);
    if (!doc) continue;
    const d = add(fromCompendium(doc));
    if ("quantity" in (d.system ?? {})) d.system.quantity = Math.max(1, Number(doc.system.quantity) || 1) * n;
    if (d.type === "armor") {
      const isShield = d.system.category === "escudo";
      d.system.equipped = isShield ? !shield : !body;
      if (isShield) shield = true;
      else body = true;
    }
    foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.${CREATION_FLAG}`, { kind: "bought" });
  }
  weaponChoices(items);

  // The actor's own data
  const base = baseScores(draft, rolls);
  const honorBase = base.hon ?? 10;
  const honorBefore = honorBase + (race?.honor ?? 0) + (cls?.honor ?? 0);
  const found = creationViolations({ draft, race, cls, catalog, items });
  const honor = violations ? applyViolations(honorBefore, found) : { honor: honorBefore, list: found.map(v => ({ ...v, damage: 0 })), damage: 0 };
  const abilities = {};
  const plusOne = (draft.levelBonus?.kind === "ability") ? draft.levelBonus.ability : null;
  for (const k of GEN_KEYS) {
    const value = (k === "hon") ? Math.max(0, honorBase - honor.damage) : ((base[k] ?? 10) + ((k === plusOne) ? 1 : 0));
    abilities[k] = { value, bonus: 0, damage: 0 };
  }
  const skills = {};
  for (const [key, cfg] of Object.entries(SKILLS)) skills[key] = { trained: draft.skills.includes(key), ability: cfg.ability, bonus: 0 };
  const specialties = {};
  for (const s of draft.specialties) specialties[s.id] = { skill: s.skill, label: s.label, trained: true, bonus: 0 };
  const religion = religionOf(items);
  const details = {
    caste: draft.caste ?? "",
    religion,
    clan: draft.details.clan ?? "",
    gender: draft.details.gender ?? "",
    age: String(draft.details.age ?? ""),
    height: draft.details.height ?? "",
    weight: draft.details.weight ?? "",
    title: draft.details.title ?? "",
    languages: (draft.details.languages ?? []).join(", "),
    sentai: actor?._source?.system?.details?.sentai ?? "",
    player: actor?._source?.system?.details?.player || (game.user.isGM ? "" : game.user.name)
  };
  const paragraphs = text => String(text ?? "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${foundry.utils.escapeHTML(p).replace(/\n/g, "<br>")}</p>`).join("");
  const system = {
    abilities,
    skills,
    specialties,
    details,
    currency: splitMoney(money.left),
    biography: {
      appearance: paragraphs(draft.bio.appearance),
      personality: paragraphs(draft.bio.personality),
      history: paragraphs(draft.bio.history),
      notes: actor?._source?.system?.biography?.notes ?? ""
    }
  };

  // The preview: the actor in memory, prepared as the sheet prepares it
  const preview = new Actor.implementation(foundry.utils.deepClone({
    name: draft.name || actor?.name || "—", type: "character", img: draft.img || actor?.img, system, items
  }));

  return {
    race, cls, items, system, preview, base, money,
    honor: { base: honorBase, race: race?.honor ?? 0, cls: cls?.honor ?? 0, before: honorBefore, final: honor.honor, damage: honor.damage, list: honor.list },
    raceItem: raceData, classItem: classData
  };
}

/** A weapon that comes as a masterwork piece (its locked "Obra-prima" +1 on the attack). */
export const isMasterwork = data => (data.system?.auto?.rollOptions ?? []).some(o => o.id === "obraPrima");

/** Where an ancestral sword's magic bonus is kept (the level-up wizard adds to it at the samurai's odd levels). */
export const ANCESTRAL_FLAG = "ancestral";

/**
 * Give an ancestral sword its magic bonus: the name says it ("Katana Ancestral +2"), the damage takes it all and the
 * attack the part above the masterwork's +1 (an enhancement takes its place: they don't add up).
 * @param {object} data    The weapon's data (changed in place)
 * @param {string} base    Its name without "Ancestral" and the bonus
 * @param {number} bonus
 * @returns {object}       The changed fields
 */
export function setAncestral(data, base, bonus) {
  const plain = String(base).replace(/\s+Ancestral(\s*\+\d+)?$/i, "");
  const masterwork = isMasterwork(data);
  // The bonus it has (a sword named "+2" by hand counts as +2)
  const flag = data.flags?.[SYSTEM_ID]?.[ANCESTRAL_FLAG];
  const before = Number(flag ?? /\+(\d+)\s*$/.exec(String(data.name ?? ""))?.[1] ?? 0) || 0;
  const changes = {
    name: F(bonus ? "IJ.Wizard.Gear.ancestralPlus" : "IJ.Wizard.Gear.ancestral", { name: plain, n: bonus }),
    "system.attackBonus": (Number(data.system?.attackBonus) || 0) - (masterwork ? Math.max(0, before - 1) : before) + (masterwork ? Math.max(0, bonus - 1) : bonus),
    "system.damageBonus": (Number(data.system?.damageBonus) || 0) - before + bonus,
    [`flags.${SYSTEM_ID}.${ANCESTRAL_FLAG}`]: bonus
  };
  for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(data, path, value);
  return changes;
}

/** The kensei's masterwork weapon of the arma eleita, and the names and first +1 of the samurai's ancestral swords. */
async function classGifts({ draft, catalog, items, add }) {
  const eleita = items.find(i => (i.type === "power") && (norm(i.name) === "arma eleita"));
  if (eleita && (eleita.system.choices ?? []).includes("arma") && eleita.system.choiceText) {
    const wanted = norm(eleita.system.choiceText);
    const weapon = catalog.wares.find(w => (w.type === "weapon") && (w.key === wanted))
      ?? catalog.wares.find(w => (w.type === "weapon") && (w.key.includes(wanted) || wanted.includes(w.key)) && (w.key !== "ataque desarmado"));
    const doc = weapon ? (await loadDocuments([weapon.uuid])).get(weapon.uuid) : null;
    if (doc) {
      const d = add(fromCompendium(doc));
      // A katana, a wakizashi, a tanto or a nodachi already is a masterwork weapon (its +1 is in its automation)
      if (!isMasterwork(d)) {
        d.name = F("IJ.Wizard.Gear.masterwork", { name: doc.name });
        d.system.attackBonus = (Number(d.system.attackBonus) || 0) + 1;
      }
      d.system.equipped = true;
      foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.grantedBy`, eleita._id);
      foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.grantedOption`, "arma");
      foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.sourceUuid`, weapon.uuid);
      foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.${CREATION_FLAG}`, { kind: "gift" });
    }
  }
  const swords = items.find(i => (i.type === "power") && (norm(i.name) === "espadas ancestrais"));
  if (swords) {
    for (const d of items.filter(i => (i.type === "weapon") && (flagsOf(i).grantedBy === swords._id))) {
      const which = norm(d.name).includes("wakizashi") ? "wakizashi" : "katana";
      setAncestral(d, d.name, (draft.ancestral === which) ? 1 : 0);
      d.system.equipped = true;
    }
  }
}

/**
 * The choices of the weapons that ask how they are used, made by what the character knows: Acuidade com Arma or not,
 * and the katana in two hands as a martial weapon (p. 147) when the character uses martial weapons but not this one as
 * an exotic weapon.
 */
function weaponChoices(items) {
  const feats = items.filter(i => i.type === "feat");
  const finesse = feats.some(i => norm(i.name) === "acuidade com arma");
  const martial = feats.some(i => norm(i.name) === "usar armas marciais");
  const exotic = new Set(feats.filter(i => norm(i.name) === norm(EXOTIC_FEAT)).flatMap(i => i.system.choices ?? []));
  for (const weapon of items.filter(i => i.type === "weapon")) {
    const options = (weapon.system.auto?.choice?.options ?? []).map(o => o.id);
    if (!options.length || (weapon.system.choices ?? []).length) continue;
    const picks = [];
    if (options.includes("acuidade") && options.includes("sem")) picks.push(finesse ? "acuidade" : "sem");
    if (options.includes("duasMaos") && options.includes("umaMao")) {
      const id = norm(weapon.name).split(" ")[0];
      picks.push((martial && !exotic.has(id)) ? "duasMaos" : "umaMao");
    }
    if (picks.length) weapon.system.choices = picks;
  }
}

/** The religion a devotion feat gives (Devoto de Lin-Wu → "Lin-Wu"). */
function religionOf(items) {
  const devotion = items.find(i => (i.type === "feat") && /^devoto (de |da |do )/.test(norm(i.name)));
  return devotion ? devotion.name.replace(/^Devot[oa]\s+(de|da|do)\s+/i, "") : "";
}

/* -------------------------------------------- */
/*  Money                                       */
/* -------------------------------------------- */

/** The money of a draft, in copper: the caste's budget, what the cart costs, what is left. */
export function moneyOf(draft, catalog) {
  const budget = (CASTE_MONEY[draft.caste] ?? 0) * 100;
  const spent = draft.cart.reduce((t, uuid) => t + (catalog.byUuid.get(uuid)?.price ?? 0), 0);
  return { budget, spent, left: budget - spent, pct: budget ? Math.clamp(Math.round(((budget - spent) / budget) * 100), 0, 100) : 0 };
}

/* -------------------------------------------- */
/*  Honor violations of the creation            */
/* -------------------------------------------- */

/** The weapons of the options chosen on a copy of Usar Arma Exótica. */
function exoticWeapons(itemData, catalog) {
  const options = itemData.system?.auto?.choice?.options ?? [];
  const out = [];
  for (const id of itemData.system?.choices ?? []) {
    const names = options.find(o => o.id === id)?.traits?.exotic ?? [id];
    const weapon = catalog.wares.find(w => (w.type === "weapon") && names.some(n => w.key.includes(norm(n))));
    if (weapon) out.push(weapon);
  }
  return out;
}

/**
 * The Honor violations a creation commits (p. 82-84): skills out of the class's list, Ladinagem, Enganação and
 * Furtividade; Tormenta feats (but the kaijin's own); weapons of dishonor learned; basic jutsus of darkness,
 * enchantment or illusion.
 * @returns {{label: string, severity: string}[]}
 */
export function creationViolations({ draft, cls, catalog, items }) {
  const list = [];
  const classSkills = new Set(cls?.classSkills ?? []);
  const skillName = key => L(SKILLS[key]?.label ?? key);
  for (const key of draft.skills) {
    if (cls && !classSkills.has(key)) list.push({ label: F("IJ.Wizard.Violation.outOfClass", { name: skillName(key) }), severity: "leve" });
    if (SKILL_VIOLATIONS[key]) list.push({ label: F("IJ.Wizard.Violation.skill", { name: skillName(key) }), severity: SKILL_VIOLATIONS[key] });
  }
  for (const s of draft.specialties) {
    if (cls && !classSkills.has(s.skill)) list.push({ label: F("IJ.Wizard.Violation.outOfClass", { name: `${skillName(s.skill)} (${s.label})` }), severity: "leve" });
  }
  for (const pick of draft.feats) {
    const feat = catalog.byUuid.get(pick.uuid);
    if ((feat?.category === "tormenta") && (pick.pool !== "tormenta")) list.push({ label: F("IJ.Wizard.Violation.tormenta", { name: feat.name }), severity: "severa" });
  }
  for (const d of items.filter(i => (i.type === "feat") && (norm(i.name) === norm(EXOTIC_FEAT)))) {
    for (const weapon of exoticWeapons(d, catalog)) {
      if (weapon.dishonorable) list.push({ label: F("IJ.Wizard.Violation.weapon", { name: weapon.name }), severity: WEAPON_TRAINING_VIOLATION });
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
/*  What the preview says                       */
/* -------------------------------------------- */

/** The modifiers of the preview's abilities. */
export const modsOf = preview => Object.fromEntries(Object.entries(preview.system.abilities).map(([k, a]) => [k, a.mod]));

/**
 * The trained skills a 1st-level character picks (p. 97): the class's number plus Intelligence (at least one), among
 * the class skills; a human's two extra may come from any list.
 */
export function skillSlots(plan) {
  const { race, cls, preview } = plan;
  const int = preview.system.abilities.int.mod;
  const bonus = race?.bonusSkills ?? 0;
  const total = cls ? Math.max(1, (cls.skills ?? 0) + int + bonus) : 0;
  return { total, any: Math.min(bonus, total), classSkills: new Set(cls?.classSkills ?? []), always: new Set(preview.system.traits?.trainedSkills ?? []) };
}

/** What the prerequisites of a feat are checked against: the preview (a feat already in it doesn't count for itself). */
export function featContext(preview) {
  const sys = preview.system;
  const abilities = Object.fromEntries(Object.entries(sys.abilities).map(([k, a]) => [k, a.total]));
  const always = sys.traits?.trainedSkills ?? [];
  const trained = new Set();
  for (const [k, s] of Object.entries(sys.skills)) if (s.trained || always.includes(k)) trained.add(k);
  for (const s of Object.values(sys.specialties ?? {})) {
    if (!s.trained) continue;
    trained.add(s.skill);
    trained.add(`${s.skill}:${norm(s.label)}`);
  }
  const feats = new Map();
  for (const i of preview.items.filter(i => i.type === "feat")) feats.set(norm(i.name), (feats.get(norm(i.name)) ?? 0) + 1);
  const powers = new Map();
  for (const i of preview.items.filter(i => i.type === "power")) powers.set(norm(i.name), Math.max(powers.get(norm(i.name)) ?? 0, rankOf(i)));
  const classes = Object.fromEntries(preview.items.filter(i => i.type === "class").map(i => [norm(i.name), i.system.levels]));
  return {
    abilities, bba: sys.bba, level: sys.level, trained, powers, classes,
    race: norm(preview.items.find(i => i.type === "race")?.name ?? ""),
    featCounts: feats,
    tormenta: sys.tormenta ?? 0
  };
}

/** The checks of a feat for a character, leaving the feat itself (when chosen) out of what it already has. */
export function whoFor(ctx, feat, picked = false) {
  const feats = new Set();
  for (const [name, n] of ctx.featCounts) if ((n - ((picked && (name === feat.key)) ? 1 : 0)) > 0) feats.add(name);
  return { ...ctx, feats, tormenta: ctx.tormenta - ((picked && (feat.category === "tormenta")) ? 1 : 0) };
}

/**
 * The jutsu "pools" of a 1st-level character: who teaches jutsus (the class's apprentice ability, the hanyô's chakra,
 * Conhecimento de Jutsus), how many, and which.
 * @returns {{id, key, name, img, count, chakras, names}[]}
 */
export function jutsuPools(plan) {
  const { preview } = plan;
  const mods = modsOf(preview);
  const open = Object.entries(preview.system.chakras).filter(([, c]) => c.open).map(([k]) => k);
  const devotion = preview.items.filter(i => i.type === "feat").flatMap(i => DEVOTION_NAMES[norm(i.name)] ?? []);
  // Words in a jutsu's name the character's abilities let Conhecimento de Jutsus teach without the chakra (the
  // kensei's strikes, the monk's katas, the samurai's kiai): a warrior with no open chakra still has what to learn
  const allowed = preview.items.contents.flatMap(i => NAME_ALLOWANCES[norm(i.name)] ?? []);
  const seen = new Map();
  const pools = [];
  for (const item of preview.items) {
    const key = norm(item.name);
    const src = JUTSU_SOURCES[key];
    if (!src || !["power", "feat"].includes(item.type)) continue;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    pools.push({
      id: `${key}:${n}`, key, name: item.name, img: item.img, count: src.count(mods),
      chakras: src.chakras ?? open, anyChakra: !src.chakras,
      names: [...new Set([...src.names, ...devotion, ...(src.chakras ? [] : allowed)])]
    });
  }
  return pools;
}

/** Whether a pool takes a jutsu: basic, of its chakras, or with a word in its name the class lets in. */
export function poolTakes(pool, jutsu) {
  if (jutsu.grade !== "basico") return false;
  if (pool.chakras.includes(jutsu.chakra)) return true;
  return pool.names.some(word => jutsu.key.includes(word));
}

/* -------------------------------------------- */
/*  Creating the character                      */
/* -------------------------------------------- */

/**
 * Write the plan on the actor: what an earlier creation gave leaves (the race, the class, all they granted and what the
 * wizard gave), then the actor's data, then every item at once (nothing granted twice: the grants are in the plan),
 * and the PV and PM full.
 */
export async function createCharacter(actor, plan, draft) {
  // An earlier creation (a 1st-level character made again): the race, the class, what they granted, what the wizard gave
  const stale = new Set(actor.items.filter(i => ["race", "class"].includes(i.type) || flagsOf(i)[CREATION_FLAG]).map(i => i.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of actor.items) {
      if (!stale.has(i.id) && stale.has(flagsOf(i).grantedBy)) {
        stale.add(i.id);
        grew = true;
      }
    }
  }
  if (stale.size) await actor.deleteEmbeddedDocuments("Item", [...stale], { ijCreation: true });

  const name = (draft.name ?? "").trim() || actor.name;
  const record = {
    version: game.system.version,
    date: Date.now(),
    user: game.user.id,
    draft: draftToFlag(draft),
    violations: plan.honor.list.filter(v => v.damage).map(v => ({ label: v.label, severity: v.severity, damage: v.damage }))
  };
  const replace = foundry.data.operators?.ForcedReplacement;
  const update = {
    name,
    img: draft.img || actor.img,
    "system.abilities": plan.system.abilities,
    "system.skills": plan.system.skills,
    "system.details": plan.system.details,
    "system.currency": plan.system.currency,
    "system.biography": plan.system.biography,
    "system.attributes.level": 1,
    "system.attributes.xp": 0,
    "prototypeToken.name": name,
    // The record of this creation replaces the one of an earlier creation whole
    [`flags.${SYSTEM_ID}.${CREATION_FLAG}`]: replace ? replace.create(record) : record
  };
  // The specialties are replaced whole
  for (const id of Object.keys(actor._source.system.specialties ?? {})) {
    if (!(id in plan.system.specialties)) update[`system.specialties.${id}`] = new foundry.data.operators.ForcedDeletion();
  }
  for (const [id, s] of Object.entries(plan.system.specialties)) update[`system.specialties.${id}`] = s;
  // The token takes the portrait while it still has the default one (or the old portrait)
  const token = actor.prototypeToken?.texture?.src ?? "";
  if (draft.img && (!token || (token === actor.img) || /mystery-man/.test(token))) update["prototypeToken.texture.src"] = draft.img;
  await actor.update(update, { ijCreation: true });

  // Every item at once, with the ids the grants point at
  const items = foundry.utils.deepClone(plan.items);
  await actor.createEmbeddedDocuments("Item", items, { keepId: true, ijCreation: true });

  // Full PV and PM
  await actor.update({
    "system.attributes.pv.value": actor.system.attributes.pv.max,
    "system.attributes.pv.temp": 0,
    "system.attributes.pv.nonlethal": 0,
    "system.attributes.pm.value": actor.system.attributes.pm.max
  });
  return actor;
}

/** The caste's label. */
export const casteLabel = key => (key ? L(CASTES[key] ?? "") : "—");
