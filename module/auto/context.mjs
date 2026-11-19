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
  // An effect can free the "no armor" abilities (Libertação de Nozomi); read on the effects to avoid gathering traits here
  const armorFree = actor.effects?.some(e => e.flags?.[SYSTEM]?.traits?.armorFree && !e.disabled);
  if ((sys.noArmor || req.noArmor) && wearsArmor(actor) && !armorFree) return "armor";
  if (req.noShield && wearsShield(actor)) return "shield";
  if (req.lightArmor && !armorFree && actor.items.some(i => (i.type === "armor") && i.system.equipped && ["media", "pesada"].includes(i.system.category))) return "armor";
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
    // Reactions that exist while an effect lasts (Contra-Ataque Relâmpago)
    for (const r of effect.flags?.[SYSTEM]?.reactions ?? []) (traits.reactions ??= []).push({ ...r, _data: effect.parent?.getRollData?.() ?? {}, _item: null, _itemName: effect.name, _effect: effect.id });
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

/** The kits of the equipment and the skills that suffer without them (always: every test of the skill). */
const KITS = [
  { id: "artesao", name: "Kit de artesão", skills: ["oficio"], always: true },
  { id: "disfarces", name: "Kit de disfarces", skills: ["enganacao"], always: false },
  { id: "ladrao", name: "Kit de ladrão", skills: ["ladinagem"], always: false },
  { id: "medicamentos", name: "Kit de medicamentos", skills: ["cura"], always: true }
];

/** An option with every field at its neutral value (for options the engine makes itself). */
export const PLAIN_OPTION = {
  value: 0, attack: 0, damage: "", damageType: "", noCrit: false, precision: false, ca: 0, critRange: 0, critMult: 0, ignoreRd: 0,
  cost: 0, pm: null, onHit: null, onCrit: null, defense: false, note: "", reroll: false, best: null, extraAttack: false,
  autoCrit: false, touch: false, noMissChance: false, ignoreCritImmunity: false, nonlethal: false, ranged: false,
  weaponDice: "", weaponType: "", damageMult: 0, damageSteps: 0, take10: false, auto: true, locked: false, selfEffect: null, data: {}
};

/** The weapon damage one step larger (the table of damage by size, p. 142). */
const DAMAGE_STEP = {
  "1d2": "1d3", "1d3": "1d4", "1d4": "1d6", "1d6": "1d8", "1d8": "2d6", "2d4": "2d6", "1d10": "2d8", "1d12": "3d6", "3d4": "3d6",
  "2d6": "3d6", "3d6": "4d6", "4d6": "6d6", "6d6": "8d6", "8d6": "12d6", "12d6": "16d6",
  "2d8": "3d8", "3d8": "4d8", "4d8": "6d8", "6d8": "8d8", "8d8": "12d8", "12d8": "16d8", "2d10": "4d8"
};
/** "1d6" two steps up → "2d6". */
export function stepDice(dice, steps = 1) {
  let d = String(dice).trim().toLowerCase();
  if (/^d/.test(d)) d = `1${d}`;
  for (let i = 0; i < steps; i++) d = DAMAGE_STEP[d] ?? d;
  return d;
}

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

/** The Honor that effects against the dishonored see (Traje das sombras eternas: +2). */
export function honorVs(actor) {
  const h = honorOf(actor);
  return (h === null) ? null : h + (actor?.system?.traits?.honorShift ?? 0);
}

/** Whether two creatures are on the same side (their tokens' disposition; characters against threats otherwise). */
function sameSideAs(actor, target) {
  if (!actor || !target) return null;
  if (actor === target) return true;
  const a = actor.getActiveTokens?.()[0]?.document?.disposition;
  const b = target.getActiveTokens?.()[0]?.document?.disposition;
  if ((a !== undefined) && (b !== undefined)) return a === b;
  return (actor.type === "character") === (target.type === "character");
}

/** A creature's level (a threat's from its stat block). */
export function levelOf(actor) {
  if (!actor) return 0;
  return (actor.type === "npc") ? (actor.system.level ?? 0) : (actor.system.level ?? actor.system.attributes?.level ?? 0);
}

/** A creature's ND ("1/2" → 0.5); a character's is its level. */
export function ndOf(actor) {
  if (!actor) return 0;
  if (actor.type !== "npc") return levelOf(actor);
  const t = String(actor.system.nd ?? "").trim();
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : levelOf(actor);
}

/** Whether two tokens touch (adjacent squares or overlapping). */
function adjacent(a, b) {
  const A = a.bounds, B = b.bounds, gap = canvas.grid.size * 0.5;
  const dx = Math.max(0, Math.max(A.left, B.left) - Math.min(A.right, B.right));
  const dy = Math.max(0, Math.max(A.top, B.top) - Math.min(A.bottom, B.bottom));
  return (dx < gap) && (dy < gap);
}

/** Whether the segment between two points crosses opposite sides (or corners) of a rectangle. */
function crossesOpposite(p, q, r) {
  const sides = new Set();
  const dx = q.x - p.x, dy = q.y - p.y;
  const eps = 0.5;
  if (dy !== 0) {
    for (const [y, side] of [[r.top, "top"], [r.bottom, "bottom"]]) {
      const t = (y - p.y) / dy;
      const x = p.x + (dx * t);
      if ((t >= 0) && (t <= 1) && (x >= r.left - eps) && (x <= r.right + eps)) sides.add(side);
    }
  }
  if (dx !== 0) {
    for (const [x, side] of [[r.left, "left"], [r.right, "right"]]) {
      const t = (x - p.x) / dx;
      const y = p.y + (dy * t);
      if ((t >= 0) && (t <= 1) && (y >= r.top - eps) && (y <= r.bottom + eps)) sides.add(side);
    }
  }
  return (sides.has("top") && sides.has("bottom")) || (sides.has("left") && sides.has("right"));
}

/**
 * Whether the attacker flanks the target: both touch it and an able ally of the attacker stands on the opposite side.
 * Creatures that can't be flanked (Sem Flanco, esquiva sobrenatural aprimorada) never are.
 */
export function isFlanked(attacker, target) {
  if (!canvas?.ready || !attacker || !target) return false;
  const traits = target.system?.traits ?? {};
  if (traits.noFlank || ((traits.uncannyDodge ?? 0) >= 2)) return false;
  const at = attacker.getActiveTokens?.()[0];
  const tt = target.getActiveTokens?.()[0];
  if (!at || !tt || !adjacent(at, tt)) return false;
  const out = ["dead", "inconsciente", "paralisado", "indefeso", "atordoado", "pasmo", "fascinado"];
  return canvas.tokens.placeables.some(ally => {
    if (!ally.actor || (ally === at) || (ally === tt) || (ally.document.disposition !== at.document.disposition)) return false;
    if (out.some(s => ally.actor.statuses?.has(s))) return false;
    return adjacent(ally, tt) && crossesOpposite(at.center, ally.center, tt.bounds);
  });
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
  vsDishonored: (actor, target) => { const h = honorVs(target); return h !== null && h <= 9; },
  vsSordid: (actor, target) => { const h = honorVs(target); return h !== null && h <= 5; },
  vsInhuman: (actor, target) => { const h = honorVs(target); return h !== null && h <= 0; },
  vsHonored: (actor, target) => { const h = honorOf(target); return h !== null && h >= 16; },
  vsAlly: (actor, target) => sameSideAs(actor, target) === true,
  vsEnemy: (actor, target) => sameSideAs(actor, target) === false,
  vsLevelBelowMine: (actor, target) => !!target && !!actor && (levelOf(target) < levelOf(actor)),
  vsNdBelowLevel: (actor, target) => !!target && !!actor && (ndOf(target) < levelOf(actor)),
  flanking: (actor, target) => isFlanked(actor, target),
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
  // "a|b": any of them; "a&b": all of them; "vsLevelMax:5" / "vsLevelMin:6": the opponent's level
  return String(key).split("|").some(alt => alt.split("&").every(part => {
    const k = part.trim();
    const honor = /^vsHonor(Max|Min):(-?\d+)$/.exec(k);
    if (honor) {
      // The Honor shift (Traje das sombras eternas) only counts against effects that catch the dishonored
      const h = honor[1] === "Max" ? honorVs(target) : honorOf(target);
      if (h === null) return false;
      return honor[1] === "Max" ? h <= Number(honor[2]) : h >= Number(honor[2]);
    }
    // The opponent's level against a number or a formula of yours ("vsLevelMax:@level + @abilities.car.mod")
    const level = /^vsLevel(Max|Min):(.+)$/.exec(k);
    if (level) {
      if (!target) return false;
      const lv = levelOf(target);
      const limit = /^\d+$/.test(level[2].trim()) ? Number(level[2]) : Math.floor(evaluate(level[2], actor?.getRollData?.() ?? {}));
      return level[1] === "Max" ? lv <= limit : lv >= limit;
    }
    // A condition of the opponent ("vsStatus:enjoado") or of yourself ("selfStatus:caido")
    const status = /^(vs|self)Status:(\w+)$/.exec(k);
    if (status) {
      const who = status[1] === "vs" ? target : actor;
      return !!who?.statuses?.has(status[2]);
    }
    const test = SITUATIONS[k];
    return test ? !!test(actor, target) : false;
  }));
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
  if (filter.maneuvers && !filter.maneuvers.includes(ctx.maneuver)) return false;
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
  if (filter.jutsuExact) {
    // The jutsu by its whole name ("Localização" doesn't take "Localização Perfeita")
    const names = [filter.jutsuExact].flat().map(norm);
    if (!names.includes(norm(ctx.item?.name))) return false;
  }
  if (filter.itemName) {
    // The power (or item) in use, by name: a cost rule for one ability (Elmo do kiai: Grito de Kiai)
    const names = [filter.itemName].flat().flatMap(n => String(n).split("|")).map(norm).filter(Boolean);
    const own = norm(ctx.item?.name);
    if (!own || !names.some(n => own.includes(n))) return false;
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
  // Without the kit a skill asks for: −5 (on by itself when every test needs it, offered when only some do)
  if ((kind === "skill") && (actor?.type === "character")) {
    for (const kit of KITS) {
      if (!kit.skills.includes(ctx.skill)) continue;
      if (actor.items.some(i => norm(i.name) === norm(kit.name))) continue;
      out.push({ ...PLAIN_OPTION, id: `kit.${kit.id}`, label: game.i18n.format("IJ.Auto.noKit", { name: kit.name }), value: -5, auto: kit.always, data: {} });
    }
  }
  const target = ctx.target === undefined ? firstTarget() : ctx.target;
  const push = (opt, item, data, source) => {
    if (![opt.for ?? "attack"].flat().includes(kind)) return;
    if ((kind === "maneuver") && !opt.both && (!!ctx.defending !== !!opt.defense)) return;
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
      onCrit: opt.onCrit ?? null,
      defense: !!opt.defense,
      note: opt.note ?? "",
      reroll: !!opt.reroll,
      best: opt.best ?? null,
      extraAttack: !!opt.extraAttack,
      autoCrit: !!opt.autoCrit,
      touch: !!opt.touch,
      noMissChance: !!opt.noMissChance,
      ignoreCritImmunity: !!opt.ignoreCritImmunity,
      nonlethal: !!opt.nonlethal,
      ranged: !!opt.ranged,
      weaponDice: opt.weaponDice ?? "",
      weaponType: opt.weaponType ?? "",
      damageMult: Number(opt.damageMult) || 0,
      damageSteps: evaluate(opt.damageSteps ?? 0, data),
      take10: !!opt.take10,
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
