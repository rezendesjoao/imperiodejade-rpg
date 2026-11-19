/**
 * Who has what: the rank and class level of an ability, whether an item's automation is active (equipped, Honor,
 * armor), the traits an actor gathers from its items and effects, and the roll options that apply to a roll.
 */
import { evaluate, evaluateInt, resolveFormula } from "./formula.mjs";

export const SYSTEM = "imperiodejade";

export const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

/* -------------------------------------------- */
/*  Rank and level                              */
/* -------------------------------------------- */

/** The class item that gave a class ability (matched by the ability's originName). */
export function originClass(item) {
  const actor = item?.actor;
  if (!actor || (item.type !== "power") || (item.system.origin !== "classe")) return null;
  const name = norm(item.system.originName);
  return actor.items.find(i => (i.type === "class") && (norm(i.name) === name)) ?? null;
}

/** Class level for an ability (its class), else the character level (or the threat's level). */
export function classLevelOf(item) {
  const actor = item?.actor;
  if (!actor) return 1;
  const cls = originClass(item);
  if (cls) return cls.system.levels;
  if (actor.type === "npc") return actor.system.level ?? 1;
  return actor.system.level ?? actor.system.attributes?.level ?? 1;
}

/** How many of the ability's levels ("1, 7, 13, 19") the class has reached; 1 for everything else. */
export function rankOf(item) {
  const cls = originClass(item);
  const text = item?.system?.levels;
  if (!cls || !text) return 1;
  const levels = String(text).split(/[^0-9]+/).map(Number).filter(n => n > 0);
  return Math.max(1, levels.filter(l => l <= cls.system.levels).length);
}

/** Roll data for an item's formulas: the actor's data plus @rank, @classe and `extra`. */
export function dataFor(item, extra = {}) {
  const actor = item?.actor ?? null;
  const data = Object.create(actor?.getRollData?.() ?? {});
  data.rank = rankOf(item);
  data.classe = classLevelOf(item);
  return Object.assign(data, extra);
}

/* -------------------------------------------- */
/*  Is the automation of an item on?            */
/* -------------------------------------------- */

const EQUIPPABLE = ["weapon", "armor", "gear"];

/** Body armor (not a shield) worn by the actor. */
export const wearsArmor = actor => actor?.items.some(i => (i.type === "armor") && i.system.equipped && (i.system.category !== "escudo"));
export const wearsShield = actor => actor?.items.some(i => (i.type === "armor") && i.system.equipped && (i.system.category === "escudo"));

/** The actor's Honor score (characters: total; threats: the stat block, null when it has none). */
export function honorOf(actor) {
  if (!actor) return null;
  if (actor.type === "character") return actor.system.abilities?.hon?.total ?? null;
  const v = actor.system.abilities?.hon;
  return (v === null || v === undefined) ? null : v;
}

/**
 * Why an item's automation is off right now, or "" when it is on: not equipped, Honor below the minimum, armor where
 * the ability asks for none.
 */
export function inactiveReason(item) {
  const actor = item?.actor;
  if (!actor) return "noActor";
  const sys = item.system;
  if (EQUIPPABLE.includes(item.type) && (sys.equipped === false)) return "unequipped";
  const req = sys.auto?.requires ?? {};
  const honorMin = Math.max(sys.honorMin ?? 0, req.honorMin ?? 0);
  if (honorMin && (actor.type === "character") && ((honorOf(actor) ?? 0) < honorMin)) return "honor";
  if ((sys.noArmor || req.noArmor) && wearsArmor(actor)) return "armor";
  if (req.noShield && wearsShield(actor)) return "shield";
  if (req.lightArmor && actor.items.some(i => (i.type === "armor") && i.system.equipped && ["media", "pesada"].includes(i.system.category))) return "armor";
  // Only while wearing armor of a category (Foco em Armadura: the category chosen on the feat)
  if (req.armorChosen || req.armorCategory) {
    const worn = actor.items.find(i => (i.type === "armor") && i.system.equipped && (i.system.category !== "escudo"))?.system.category ?? null;
    const wanted = req.armorChosen ? (sys.choices ?? []) : [req.armorCategory].flat();
    if (!worn || !wanted.includes(worn)) return "armorType";
  }
  return "";
}

export const isActive = item => !inactiveReason(item);

/** Items of the actor whose automation is on. */
export const activeItems = actor => (actor?.items ?? []).filter(i => i.system?.auto && isActive(i));

/** Whether an option is unlocked by the choices made on its item (no `option` means always). */
export function chosen(item, optionId) {
  if (!optionId) return true;
  return (item.system.choices ?? []).includes(optionId);
}

/* -------------------------------------------- */
/*  Traits                                      */
/* -------------------------------------------- */

/** Traits whose numbers add up (capped) instead of taking the highest. */
const SUM_TRAITS = { fortification: 100, saveBonus: Infinity };

/** Merge one trait source into the accumulated traits. */
function mergeTraits(target, source, data, item = null) {
  for (const [key, raw] of Object.entries(source ?? {})) {
    if (raw === null || raw === undefined) continue;
    if (Array.isArray(raw)) {
      // Lists: immunities (strings) or rule entries (objects with formulas resolved later)
      target[key] ??= [];
      for (const entry of raw) {
        if (typeof entry === "string") { if (!target[key].includes(entry)) target[key].push(entry); }
        else target[key].push({ ...entry, _data: data, _item: item?.id ?? null, _itemName: item?.name ?? "" });
      }
    } else if (typeof raw === "object") {
      // Maps: resistances by type (the highest of each)
      target[key] ??= {};
      for (const [k, v] of Object.entries(raw)) {
        // A word stays a word (saveBest: { fort: "von" }); numbers keep the highest
        if ((typeof v === "string") && /^[a-z]+$/i.test(v.trim()) && !Number.isFinite(Number(v))) {
          target[key][k] = v.trim();
          continue;
        }
        const n = (typeof v === "boolean") ? (v ? 1 : 0) : evaluate(v, data);
        target[key][k] = Math.max(target[key][k] ?? 0, n);
      }
    } else if (typeof raw === "boolean") {
      target[key] = target[key] || raw;
    } else if ((typeof raw === "string") && (/\b(dice|dlvl)\(/.test(raw) || /^\s*\d*d\d+\s*$/i.test(raw))) {
      // A die (the unarmed damage): resolved for this item, the larger one stays
      target[key] = pickLarger(target[key], resolveFormula(raw, data));
    } else if ((typeof raw === "string") && /^[a-z]/i.test(raw) && !/[@(]/.test(raw) && !Number.isFinite(Number(raw))) {
      // Plain words
      target[key] = raw;
    } else {
      const n = evaluate(raw, data);
      if (key in SUM_TRAITS) target[key] = Math.min(SUM_TRAITS[key], (target[key] ?? 0) + n);
      else target[key] = Math.max(target[key] ?? 0, n);
    }
  }
}

/** The larger of two dice expressions ("1d8" vs "2d6"), by average. */
function pickLarger(a, b) {
  if (!a) return b;
  const avg = f => {
    const m = /^(\d+)d(\d+)$/i.exec(String(f).trim());
    return m ? Number(m[1]) * ((Number(m[2]) + 1) / 2) : 0;
  };
  return avg(b) > avg(a) ? b : a;
}

/**
 * Everything the actor's active items and effects say about it (immunities, resistances, evasion...).
 * Items: `system.auto.traits` (with formulas); effects: `flags.imperiodejade.traits` (numbers).
 */
export function collectTraits(actor) {
  const traits = {};
  const rules = (list, item, data) => (list ?? []).filter(r => !r.option || chosen(item, r.option))
    .map(r => ({ ...r, _data: data, _item: item.id, _itemName: item.name }));
  for (const item of activeItems(actor)) {
    const auto = item.system.auto;
    const data = dataFor(item);
    if (auto.traits) mergeTraits(traits, auto.traits, data, item);
    // Reactions and triggers keep their item (name, uses) and data (formulas)
    if (auto.reactions?.length) (traits.reactions ??= []).push(...rules(auto.reactions, item, data));
    if (auto.triggers?.length) (traits.triggers ??= []).push(...rules(auto.triggers, item, data));
    // Traits that come with an option chosen on the item
    for (const opt of auto.choice?.options ?? []) {
      if (!chosen(item, opt.id)) continue;
      if (opt.traits) mergeTraits(traits, opt.traits, data, item);
      if (opt.reactions?.length) (traits.reactions ??= []).push(...rules(opt.reactions, item, data));
      if (opt.triggers?.length) (traits.triggers ??= []).push(...rules(opt.triggers, item, data));
    }
  }
  for (const effect of actor?.appliedEffects ?? []) {
    const t = effect.flags?.[SYSTEM]?.traits;
    if (t) mergeTraits(traits, t, effect.parent?.getRollData?.() ?? {});
  }
  traits.immune ??= [];
  traits.resist ??= {};
  return traits;
}

/** Whether the actor is immune to something ("medo", "critico", "fogo"...). */
export function isImmune(actor, what) {
  if (!actor || !what) return false;
  const list = actor.system?.traits?.immune ?? collectTraits(actor).immune;
  return [what].flat().some(w => list.includes(w));
}

/* -------------------------------------------- */
/*  Situations a rule can ask about             */
/* -------------------------------------------- */

/** The first targeted token's actor (the roll's opponent), if any. */
export function firstTarget() {
  const token = game.user?.targets?.first?.() ?? [...(game.user?.targets ?? [])][0];
  return token?.actor ?? null;
}

/** Current and maximum PV of any actor. */
export function hpOf(actor) {
  if (!actor) return { value: 0, max: 0 };
  const pv = actor.type === "npc" ? actor.system.pv : actor.system.attributes?.pv;
  return { value: pv?.value ?? 0, max: pv?.max ?? 0 };
}

/** Conditions that lower the armor class directly ("em perigo" of the hanyô, p. 33). */
const CA_CONDITIONS = ["agarrado", "atordoado", "cego", "desprevenido", "indefeso", "inconsciente", "lento", "paralisado", "enredado", "exausto", "fatigado"];

/**
 * Situations an automatic option can test. Each one gets the actor and the opponent (or null).
 * Unknown keys are false, so the option stays a manual choice.
 */
export const SITUATIONS = {
  hpHalf: actor => { const hp = hpOf(actor); return hp.max > 0 && hp.value <= Math.floor(hp.max / 2); },
  hp10: actor => hpOf(actor).value <= 10,
  hp20: actor => hpOf(actor).value <= 20,
  inDanger: actor => SITUATIONS.hpHalf(actor) || CA_CONDITIONS.some(c => actor?.statuses?.has(c)),
  vsMonster: (actor, target) => target?.type === "npc" && target.system.creatureType === "monstro",
  vsYoukai: (actor, target) => target?.type === "npc" && target.system.creatureType === "youkai",
  vsAnimal: (actor, target) => target?.type === "npc" && target.system.creatureType === "animal",
  vsConstruct: (actor, target) => target?.type === "npc" && target.system.creatureType === "construto",
  vsHumanoid: (actor, target) => (target?.type === "character") || (target?.system?.creatureType === "humanoide"),
  vsLowerHonor: (actor, target) => {
    const mine = honorOf(actor);
    const theirs = honorOf(target);
    return (mine !== null) && (theirs !== null) && (theirs < mine);
  },
  vsDishonored: (actor, target) => { const h = honorOf(target); return h !== null && h <= 9; },
  vsSordid: (actor, target) => { const h = honorOf(target); return h !== null && h <= 5; },
  vsInhuman: (actor, target) => { const h = honorOf(target); return h !== null && h <= 0; },
  vsHonored: (actor, target) => { const h = honorOf(target); return h !== null && h >= 16; },
  vsFlatFooted: (actor, target) => !!target && ["desprevenido", "atordoado", "agarrado", "cego", "indefeso", "inconsciente", "paralisado", "surpreendido"].some(s => target.statuses?.has(s)),
  vsProne: (actor, target) => !!target?.statuses?.has("caido"),
  inCombat: actor => !!game.combat?.started && !!actor && game.combat.combatants.some(c => c.actor === actor),
  outOfCombat: actor => !SITUATIONS.inCombat(actor),
  noArmor: actor => !wearsArmor(actor),
  resolve: actor => !!actor?.effects?.some(e => e.flags?.[SYSTEM]?.key === "resolucao" && e.active)
};

/** Test a situation key ("vsMonster", "hpHalf|inDanger" = any of them). */
export function situation(key, actor, target = firstTarget()) {
  if (!key) return true;
  return String(key).split("|").some(k => {
    const test = SITUATIONS[k.trim()];
    return test ? !!test(actor, target) : false;
  });
}

/* -------------------------------------------- */
/*  Filters                                     */
/* -------------------------------------------- */

const MONK_WEAPONS = ["desarmado", "bo", "kama", "nunchaku", "sai", "shuriken", "tonfa", "kusarigama", "bastao", "bordao"];
const NINJA_WEAPONS = ["desarmado", "ninja to", "ninjato", "kunai", "shuriken", "kusarigama", "fukiya", "tessen", "kama", "neko te", "shobo", "kaginawa", "makibishi", "metsubushi", "manriki", "zarabatana"];

/**
 * Does a roll context match an option's filter?
 * ctx: { weapon (Item|null), melee, ranged, unarmed, skill, save, ability, chakra, descriptors, jutsu, item }
 * filter: { melee, ranged, unarmed, weapon: "katana|wakizashi" (names), weaponCategory, light, monk, ninja,
 *           chosenWeapon (the item's choiceText), skills: [...], saves: [...], abilities: [...], chakra, descriptor }
 */
export function matches(filter, ctx, item = null) {
  if (!filter) return true;
  const weaponName = norm(ctx.weapon?.name ?? (ctx.unarmed ? "desarmado" : ""));
  if (filter.melee && !ctx.melee) return false;
  if (filter.ranged && !ctx.ranged) return false;
  if (filter.unarmed && !ctx.unarmed) return false;
  if (filter.weapon) {
    const names = String(filter.weapon).split("|").map(norm);
    if (!names.some(n => n && weaponName.includes(n))) return false;
  }
  if (filter.chosenWeapon) {
    const pick = norm(item?.system?.choiceText);
    if (!pick || !weaponName || !(weaponName.includes(pick) || pick.includes(weaponName))) return false;
  }
  if (filter.chosenWeaponOf) {
    // The weapon chosen on another ability of the actor (the kensei's Arma eleita)
    const owner = item?.actor ?? ctx.actor ?? null;
    const source = owner?.items.find(i => norm(i.name) === norm(filter.chosenWeaponOf));
    const pick = norm(source?.system?.choiceText);
    const isUnarmedPick = /desarmad/.test(pick) || (source?.system?.choices ?? []).includes("desarmado");
    if (isUnarmedPick ? !ctx.unarmed : (!pick || !(weaponName.includes(pick) || (weaponName && pick.includes(weaponName))))) return false;
  }
  if (filter.weaponCategory && (ctx.weapon?.system?.category !== filter.weaponCategory)) return false;
  if (filter.light && !(ctx.unarmed || ctx.weapon?.system?.grip === "leve")) return false;
  if (filter.twoHanded && (ctx.weapon?.system?.grip !== "duasMaos")) return false;
  if (filter.monk && !MONK_WEAPONS.some(n => weaponName.includes(n))) return false;
  if (filter.ninja && !NINJA_WEAPONS.some(n => weaponName.includes(n))) return false;
  if (filter.skills && !filter.skills.includes(ctx.skill)) return false;
  if (filter.saves && !filter.saves.includes(ctx.save)) return false;
  if (filter.abilities && !filter.abilities.includes(ctx.ability)) return false;
  if (filter.chakra && ![filter.chakra].flat().includes(ctx.chakra)) return false;
  if (filter.descriptor) {
    const wanted = [filter.descriptor].flat().map(norm);
    const have = norm(ctx.descriptors ?? "");
    if (!wanted.some(w => have.includes(w))) return false;
  }
  if (filter.jutsu) {
    const names = [filter.jutsu].flat().map(norm);
    const jn = norm(ctx.item?.name);
    if (!names.some(n => jn.includes(n))) return false;
  }
  if (filter.chosenJutsu) {
    const pick = norm(item?.system?.choiceText);
    if (!pick || !norm(ctx.item?.name).includes(pick)) return false;
  }
  return true;
}

/* -------------------------------------------- */
/*  Roll options                                */
/* -------------------------------------------- */

/**
 * The roll options of an actor for one kind of roll ("attack", "save", "skill", "ability", "initiative").
 * Sources: active items (`system.auto.rollOptions`, and those of chosen options), the weapon itself, and active
 * effects (`flags.imperiodejade.rollOptions`, resolved when the effect was made).
 * @returns {Array<object>} Options with numbers resolved; `auto` says whether the situation already applies.
 */
export function rollOptionsFor(actor, kind, ctx = {}) {
  const out = [];
  const target = ctx.target === undefined ? firstTarget() : ctx.target;
  const push = (opt, item, data, source) => {
    if (![opt.for ?? "attack"].flat().includes(kind)) return;
    if (!matches(opt.filter, ctx, item)) return;
    if (opt.option && item && !chosen(item, opt.option)) return;
    if (opt.minRank && ((data.rank ?? 1) < opt.minRank)) return;
    if (opt.minLevel && ((data.classe ?? 1) < opt.minLevel)) return;
    const auto = opt.when ? situation(opt.when, actor, target) : !opt.optional;
    // An automatic option whose situation isn't met is offered off (so the player can still turn it on), unless strict
    if (opt.when && !auto && opt.strict) return;
    out.push({
      id: `${source}.${opt.id ?? out.length}`,
      label: opt.label ?? item?.name ?? "",
      itemName: item?.name ?? "",
      itemId: item?.id ?? null,
      value: evaluate(opt.value ?? 0, data),
      attack: evaluate(opt.attack ?? 0, data),
      damage: opt.damage ? resolveFormula(opt.damage, data) : "",
      damageType: opt.type ?? "",
      noCrit: !!opt.noCrit,
      precision: !!opt.precision,
      ca: evaluate(opt.ca ?? 0, data),
      critRange: evaluate(opt.critRange ?? 0, data),
      critMult: evaluate(opt.critMult ?? 0, data),
      ignoreRd: (opt.ignoreRd === "all") ? Infinity : evaluate(opt.ignoreRd ?? 0, data),
      cost: evaluate(opt.cost ?? 0, data),
      pm: opt.pm ? {
        max: evaluate(opt.pm.max ?? "@pmLimit", data),
        attack: evaluate(opt.pm.attack ?? 0, data),
        damage: evaluate(opt.pm.damage ?? 0, data),
        split: !!opt.pm.split,
        each: evaluate(opt.pm.each ?? 0, data),
        cap: opt.pm.cap ? evaluate(opt.pm.cap, data) : null
      } : null,
      onHit: opt.onHit ?? null,
      note: opt.note ?? "",
      reroll: !!opt.reroll,
      best: opt.best ?? null,
      extraAttack: !!opt.extraAttack,
      auto,
      locked: !!opt.locked && auto,
      selfEffect: opt.selfEffect ?? null,
      data
    });
  };
  for (const item of activeItems(actor)) {
    const auto = item.system.auto;
    if (!auto.rollOptions?.length && !auto.choice) continue;
    // A weapon's own options only count for attacks with it
    if ((item.type === "weapon") && (kind === "attack") && (ctx.weapon?.id !== item.id)) continue;
    const data = dataFor(item);
    for (const opt of auto.rollOptions ?? []) push(opt, item, data, item.id);
    for (const choiceOpt of auto.choice?.options ?? []) {
      if (!chosen(item, choiceOpt.id)) continue;
      for (const opt of choiceOpt.rollOptions ?? []) push(opt, item, data, `${item.id}.${choiceOpt.id}`);
    }
  }
  for (const effect of actor?.appliedEffects ?? []) {
    for (const opt of effect.flags?.[SYSTEM]?.rollOptions ?? []) push(opt, null, actor.getRollData?.() ?? {}, effect.id);
  }
  return out;
}

/** The rule entries (reactions, triggers, jutsu rules...) of a trait list, with their formulas' data. */
export function ruleEntries(actor, key) {
  return (actor?.system?.traits?.[key] ?? collectTraits(actor)[key] ?? []).filter(e => e && typeof e === "object");
}

export { evaluate, evaluateInt, resolveFormula };
