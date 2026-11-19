/**
 * What an effect can do to a creature beyond buffs and conditions: ability damage, negative levels, setting PV
 * ("drops to −1 PV"), instant death, dispelling magic, and the auras that follow their bearer.
 */
import { SYSTEM, evaluate, resolveFormula, hpOf } from "./context.mjs";
import { updateActor, createEffects, deleteEffects, effectData, applyCondition } from "./effects.mjs";

const L = key => game.i18n.localize(key);
const ABILITY_KEYS = ["for", "des", "con", "int", "sab", "car"];

/** A number now: a formula, or dice rolled. */
async function amountOf(formula, data) {
  const f = resolveFormula(formula, data);
  if (/\d*d\d/i.test(f)) return (await new Roll(f).evaluate()).total;
  return Math.floor(evaluate(f, data));
}

/** A short line in the chat about what happened to a creature. */
async function note(actor, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="imperiodejade ij-card ij-card--applied"><p>${foundry.utils.escapeHTML(text)}</p></div>`
  });
}

/* -------------------------------------------- */
/*  Ability damage                              */
/* -------------------------------------------- */

/**
 * Ability damage (p. 251): lost points come back one per day. Strength or Dexterity at 0 leave the creature prone and
 * paralyzed, Intelligence, Wisdom or Charisma at 0 unconscious, Constitution at 0 dead.
 * @param {Actor} actor
 * @param {{ability: string, formula: string|number}|Array} spec
 */
export async function applyAbilityDamage(actor, spec, data = {}) {
  if (actor.system?.traits?.immune?.includes("danoHabilidade")) {
    await note(actor, game.i18n.format("IJ.Auto.immuneTo", { name: actor.name, what: L("IJ.Auto.abilityDamageWord") }));
    return;
  }
  for (const s of [spec].flat()) {
    const key = s?.ability;
    if (!ABILITY_KEYS.includes(key)) continue;
    const n = Math.max(0, await amountOf(s.formula ?? s.value ?? 1, data));
    if (!n) continue;
    let left;
    if (actor.type === "character") {
      const a = actor.system.abilities[key];
      const damage = (a.damage ?? 0) + n;
      await updateActor(actor, { [`system.abilities.${key}.damage`]: damage });
      left = Math.max(0, a.value + a.racial + a.bonus - damage);
    } else {
      const score = actor.system.abilities?.[key];
      if (score === null || score === undefined) continue;
      const damage = (actor.system.abilityDamage?.[key] ?? 0) + n;
      await updateActor(actor, { [`system.abilityDamage.${key}`]: damage });
      left = Math.max(0, score - damage);
    }
    await note(actor, game.i18n.format("IJ.Auto.abilityDamage", { name: actor.name, n, ability: L(CONFIG.IJ.ABILITIES[key].label), left }));
    if (left > 0) continue;
    if (key === "con") await kill(actor);
    else if (["for", "des"].includes(key)) {
      await applyCondition(actor, "caido", { source: L(CONFIG.IJ.ABILITIES[key].label) });
      await applyCondition(actor, "paralisado", { source: L(CONFIG.IJ.ABILITIES[key].label) });
    } else await applyCondition(actor, "inconsciente", { source: L(CONFIG.IJ.ABILITIES[key].label) });
  }
}

/** A night of rest gives back 1 point of each damaged ability. */
export async function recoverAbilityDamage(actor) {
  const update = {};
  if (actor.type === "character") {
    for (const key of ABILITY_KEYS) {
      const d = actor.system.abilities[key]?.damage ?? 0;
      if (d > 0) update[`system.abilities.${key}.damage`] = d - 1;
    }
  } else {
    for (const key of ABILITY_KEYS) {
      const d = actor.system.abilityDamage?.[key] ?? 0;
      if (d > 0) update[`system.abilityDamage.${key}`] = d - 1;
    }
  }
  if (Object.keys(update).length) await actor.update(update);
}

/* -------------------------------------------- */
/*  Negative levels, PV and death               */
/* -------------------------------------------- */

/** Negative levels (p. 252): −1 on attacks, tests and saves each; each one also costs 2 PV and 2 PM right away. */
export async function applyNegativeLevels(actor, formula, data = {}) {
  const n = Math.max(0, await amountOf(formula, data));
  if (!n) return 0;
  if (actor.system?.traits?.immune?.includes("nivelNegativo")) {
    await note(actor, game.i18n.format("IJ.Auto.immuneTo", { name: actor.name, what: L("IJ.Auto.negativeLevel") }));
    return 0;
  }
  const isNpc = actor.type === "npc";
  const current = isNpc ? (actor.system.negativeLevels ?? 0) : (actor.system.attributes.negativeLevels ?? 0);
  const pm = isNpc ? actor.system.pm : actor.system.attributes.pm;
  await updateActor(actor, {
    [isNpc ? "system.negativeLevels" : "system.attributes.negativeLevels"]: current + n,
    [isNpc ? "system.pm.value" : "system.attributes.pm.value"]: Math.max(0, pm.value - (2 * n))
  });
  const { applyToActor } = await import("./damage.mjs");
  await applyToActor(actor, { amount: 2 * n });
  await note(actor, game.i18n.format("IJ.Auto.negativeLevels", { name: actor.name, n }));
  return n;
}

/** Set a creature's PV (Golpe Fantasma: drops to −1 PV). Falling below 0 runs the usual fall. */
export async function setPv(actor, value) {
  const { applyToActor } = await import("./damage.mjs");
  const hp = hpOf(actor);
  if (value < hp.value) await applyToActor(actor, { amount: hp.value - value + (actor.type === "npc" ? 0 : (actor.system.attributes.pv.temp ?? 0)) });
  else if (value > hp.value) await applyToActor(actor, { heal: value - hp.value });
}

/** Instant death: PV to the death threshold and the "dead" status. */
export async function kill(actor) {
  const base = actor.type === "npc" ? "system.pv" : "system.attributes.pv";
  const death = actor.type === "npc" ? 0 : (actor.system.attributes.pv.death ?? -Math.floor(hpOf(actor).max / 2));
  await updateActor(actor, { [`${base}.value`]: death, [`${base}.temp`]: 0 });
  if (!actor.statuses?.has("dead")) {
    await createEffects(actor, [{
      name: game.i18n.localize("EFFECT.StatusDead"), img: "icons/svg/skull.svg", statuses: ["dead"],
      showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS, flags: { [SYSTEM]: { fall: true } }
    }]);
  }
  await note(actor, game.i18n.format("IJ.Auto.killed", { name: actor.name }));
}

/* -------------------------------------------- */
/*  Dispel                                      */
/* -------------------------------------------- */

/** Whether an effect came from magic (a jutsu or a magic item). */
function isMagicEffect(effect) {
  if (effect.flags?.[SYSTEM]?.magic) return true;
  const origin = effect.origin ? fromUuidSync(effect.origin) : null;
  return (origin?.type === "jutsu") || !!origin?.system?.magic;
}

/** Remove the magic effects (buffs, debuffs and conditions of jutsus and magic items) from a creature. */
export async function dispel(actor) {
  const ids = actor.effects.filter(e => (e.flags?.[SYSTEM]?.temp || e.flags?.[SYSTEM]?.condition) && isMagicEffect(e)).map(e => e.id);
  if (ids.length) await deleteEffects(actor, ids);
  await note(actor, game.i18n.format("IJ.Auto.dispelled", { name: actor.name, n: ids.length }));
  return ids.length;
}

/* -------------------------------------------- */
/*  Auras                                       */
/* -------------------------------------------- */

let auraTimer = null;

/** Recompute every aura of the viewed scene (the active GM does it; batched). */
export function scheduleAuras() {
  if (!game.users.activeGM?.isSelf || !canvas?.ready) return;
  clearTimeout(auraTimer);
  auraTimer = setTimeout(() => syncAuras().catch(err => console.warn(`${SYSTEM} | auras`, err)), 250);
}

/**
 * Each active effect with `flags.imperiodejade.aura` puts a copy of its aura effect on every creature within the radius
 * that matches `who` (allies, enemies, any), and takes it away from those outside.
 */
export async function syncAuras() {
  const tokens = canvas.tokens.placeables.filter(t => t.actor);
  const sources = [];
  for (const t of tokens) {
    for (const e of t.actor.effects) {
      const aura = e.flags?.[SYSTEM]?.aura;
      if (aura && e.active) sources.push({ token: t, effect: e, aura });
    }
  }
  const live = new Set(sources.map(s => s.effect.uuid));
  for (const t of tokens) {
    const actor = t.actor;
    // Copies whose aura is gone
    const stale = actor.effects.filter(e => e.flags?.[SYSTEM]?.auraFrom && !live.has(e.flags[SYSTEM].auraFrom)).map(e => e.id);
    for (const s of sources) {
      const from = s.effect.uuid;
      const mine = actor.effects.filter(e => e.flags?.[SYSTEM]?.auraFrom === from);
      const has = mine[0];
      const self = t === s.token || actor === s.token.actor;
      const disp = t.document.disposition === s.token.document.disposition;
      const sideOk = self ? !!s.aura.includeSelf : (s.aura.who === "allies" ? disp : s.aura.who === "enemies" ? !disp : true);
      const inside = self || (canvas.grid.measurePath([s.token.center, t.center]).distance <= (s.aura.radius ?? 9));
      if (sideOk && inside && !has) {
        await createEffects(actor, [{
          ...effectData({ ...s.aura, name: s.aura.label || s.effect.name, img: s.effect.img, origin: s.effect.origin }, {}),
          duration: undefined,
          flags: { [SYSTEM]: { auraFrom: from, temp: true, traits: s.aura.traits ?? null, rollOptions: s.aura.rollOptions ?? null, turnStart: s.aura.turnStart ?? null } }
        }]);
        // The aura's conditions leave with it (tagged with the aura)
        for (const c of s.aura.conditions ?? []) await applyCondition(actor, c.id ?? c, { source: s.aura.label || s.effect.name, flags: { auraFrom: from } });
      } else if (!(sideOk && inside) && mine.length) stale.push(...mine.map(e => e.id));
    }
    if (stale.length) await deleteEffects(actor, [...new Set(stale)]);
  }
}
