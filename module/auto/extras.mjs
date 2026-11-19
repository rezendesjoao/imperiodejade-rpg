/**
 * What an effect can do to a creature beyond buffs and conditions: ability damage, negative levels, setting PV
 * ("drops to −1 PV"), instant death, dispelling magic, and the auras that follow their bearer.
 */
import { SYSTEM, evaluate, resolveFormula, hpOf, norm } from "./context.mjs";
import { updateActor, createEffects, deleteEffects, effectData, applyCondition, createRegion, deleteRegion, resolveAura, forActor, updateEffect } from "./effects.mjs";

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
/** Heal ability damage: { "ability": "for" | "all", "value": 2 | "all" } (Integridade Corporal, Revitalização). */
export async function healAbilityDamage(actor, spec, data = {}) {
  const update = {};
  for (const s of [spec].flat()) {
    const keys = (s.ability === "all" || !s.ability) ? ABILITY_KEYS : [s.ability].flat();
    for (const key of keys) {
      const d = (actor.type === "character") ? (actor.system.abilities[key]?.damage ?? 0) : (actor.system.abilityDamage?.[key] ?? 0);
      if (!d) continue;
      const n = (s.value === "all" || s.value === undefined) ? d : Math.max(0, await amountOf(s.value, data));
      update[(actor.type === "character") ? `system.abilities.${key}.damage` : `system.abilityDamage.${key}`] = Math.max(0, d - n);
    }
  }
  if (Object.keys(update).length) await updateActor(actor, update);
}

/** Remove negative levels (Círculo de Luz): a number or "all". */
export async function removeNegativeLevels(actor, value = "all", data = {}) {
  const isNpc = actor.type === "npc";
  const current = isNpc ? (actor.system.negativeLevels ?? 0) : (actor.system.attributes.negativeLevels ?? 0);
  if (!current) return;
  const n = (value === "all") ? current : Math.max(0, await amountOf(value, data));
  await updateActor(actor, { [isNpc ? "system.negativeLevels" : "system.attributes.negativeLevels"]: Math.max(0, current - n) });
}

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
      if (!aura || !e.active) continue;
      sources.push({
        from: e.uuid, spec: aura, name: aura.label || e.name, img: e.img, origin: e.origin,
        isSelf: tok => (tok === t) || (tok.actor === t.actor),
        sameSide: tok => tok.document.disposition === t.document.disposition,
        inside: tok => (tok === t) || (canvas.grid.measurePath([t.center, tok.center]).distance <= (aura.radius ?? 9))
      });
    }
  }
  // Areas placed on the scene (a jutsu's mist, darkness, mandala): who stands inside gets the effect
  for (const region of canvas.scene?.regions ?? []) {
    const zone = region.flags?.[SYSTEM]?.zone;
    if (!zone) continue;
    // The area ends with the effect that keeps it
    if (zone.effect && !fromUuidSync(zone.effect)) { await deleteRegion(region); continue; }
    sources.push({
      from: region.uuid, spec: zone, name: zone.label || region.name, img: zone.img || "icons/svg/aura.svg", origin: zone.origin ?? null,
      isSelf: tok => tok.actor?.uuid === zone.actor,
      sameSide: tok => tok.document.disposition === zone.disposition,
      inside: tok => region.testPoint({ x: tok.center.x, y: tok.center.y, elevation: tok.document.elevation ?? 0 })
    });
  }
  const live = new Set(sources.map(s => s.from));
  for (const t of tokens) {
    const actor = t.actor;
    // Copies whose aura or area is gone
    const stale = actor.effects.filter(e => e.flags?.[SYSTEM]?.auraFrom && !live.has(e.flags[SYSTEM].auraFrom)).map(e => e.id);
    for (const s of sources) {
      const mine = actor.effects.filter(e => e.flags?.[SYSTEM]?.auraFrom === s.from);
      const self = s.isSelf(t);
      // who: allies, enemies, any, or self (only the user: a mandala around you)
      const sideOk = (s.spec.who === "self") ? self
        : self ? !!s.spec.includeSelf : (s.spec.who === "allies" ? s.sameSide(t) : s.spec.who === "enemies" ? !s.sameSide(t) : true);
      const inside = s.inside(t);
      if (sideOk && inside && !mine.length) {
        // A threat gets the numbers on its own fields
        const changes = forActor((s.spec.changes ?? []).map(c => ({ key: c.key, value: c.value, mode: c.mode })), actor);
        await createEffects(actor, [{
          ...effectData({ ...s.spec, changes, name: s.name, img: s.img, origin: s.origin }, {}),
          duration: undefined,
          flags: { [SYSTEM]: { auraFrom: s.from, temp: true, traits: s.spec.traits ?? null, rollOptions: s.spec.rollOptions ?? null, turnStart: s.spec.turnStart ?? null } }
        }]);
        // The conditions leave with it (tagged with the source)
        for (const c of s.spec.conditions ?? []) await applyCondition(actor, c, { source: s.name, flags: { auraFrom: s.from } });
      } else if (!(sideOk && inside) && mine.length) stale.push(...mine.map(e => e.id));
    }
    if (stale.length) await deleteEffects(actor, [...new Set(stale)]);
  }
}

/* -------------------------------------------- */
/*  Areas                                       */
/* -------------------------------------------- */

/** Wait for a click on the map (Esc or a minute without a click cancels). */
function pickPoint() {
  return new Promise(resolve => {
    const view = canvas.app?.view;
    if (!view) return resolve(null);
    let timer = null;
    const done = point => {
      view.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
      resolve(point);
    };
    const onDown = () => { const p = canvas.mousePosition; done(p ? { x: p.x, y: p.y } : null); };
    const onKey = ev => { if (ev.key === "Escape") done(null); };
    view.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    timer = setTimeout(() => done(null), 60000);
  });
}

/**
 * Place an area: a circle on the scene (on the first target, on the user, or where the player clicks) whose effect goes
 * to who stands inside, for as long as the user's effect of the area lasts.
 */
export async function placeZone(item, spec, data, duration = null) {
  const actor = item.actor;
  const scene = canvas?.scene;
  if (!actor || !scene || !canvas.ready) return null;
  const zone = resolveAura(spec.zone, data);
  const myToken = actor.getActiveTokens?.()[0] ?? null;
  const target = [...(game.user?.targets ?? [])][0] ?? null;
  let center = null;
  if (spec.zone.at === "self") center = myToken?.center ?? null;
  else if (target) center = target.center;
  else {
    ui.notifications.info(game.i18n.localize("IJ.Auto.zonePick"));
    center = await pickPoint();
  }
  center ??= myToken?.center ?? null;
  if (!center) return null;
  const label = zone.label || (spec.optionLabel ? `${item.name}: ${spec.optionLabel}` : item.name);
  // The user's effect keeps the area: when it ends, the area goes
  const created = await createEffects(actor, [{
    ...effectData({ name: `${L("IJ.Auto.zoneEffect")}: ${label}`, img: item.img, origin: item.uuid, duration, key: spec.zone.key ?? null }, data),
  }].map(e => { e.flags[SYSTEM].zoneMarker = true; return e; }));
  const effect = Array.isArray(created) ? created[0] : null;
  const radius = (zone.radius / (scene.grid.distance || 1.5)) * scene.grid.size;
  await createRegion(scene, {
    name: label,
    color: game.user?.color?.css ?? "#3f8f6b",
    shapes: [{ type: "circle", x: center.x, y: center.y, radius }],
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    flags: { [SYSTEM]: { zone: {
      ...zone, label, img: item.img, origin: item.uuid, actor: actor.uuid, effect: effect?.uuid ?? null,
      disposition: myToken?.document.disposition ?? (actor.type === "character" ? 1 : -1)
    } } }
  });
  return label;
}

/** The user's effect of an area ended: the area leaves the scenes. */
export async function endZones(effect) {
  for (const scene of game.scenes) {
    for (const region of scene.regions) {
      if (region.flags?.[SYSTEM]?.zone?.effect === effect.uuid) await region.delete();
    }
  }
}

/* -------------------------------------------- */
/*  Diseases                                    */
/* -------------------------------------------- */

/** The diseases of the book (p. 247): the save's DC, what each failed day does, successes in a row to heal. */
export const DISEASES = {
  "calafrios diabolicos": { name: "Calafrios diabólicos", dc: 16, damage: [{ ability: "for", formula: "1d4" }], cure: 3 },
  "enjoo cegante": { name: "Enjoo cegante", dc: 18, damage: [{ ability: "for", formula: "1d4" }] },
  "febre demoniaca": { name: "Febre demoníaca", dc: 20, damage: [{ ability: "con", formula: "1d6" }] },
  "febre do esgoto": { name: "Febre do esgoto", dc: 14, damage: [{ ability: "des", formula: "1d3" }, { ability: "con", formula: "1d3" }] },
  "febre do riso": { name: "Febre do riso", dc: 18, damage: [{ ability: "sab", formula: "1d6" }] },
  "febre escarlate": { name: "Febre escarlate", dc: 17, damage: [{ ability: "for", formula: "1d6" }] },
  "febre mental": { name: "Febre mental", dc: 14, damage: [{ ability: "int", formula: "1d4" }] },
  "maldicao pegajosa": { name: "Maldição pegajosa", dc: 16, damage: [{ ability: "con", formula: "1d4" }] },
  "tremores": { name: "Tremores", dc: 15, damage: [{ ability: "des", formula: "1d8" }] }
};

/** Catch a disease (a failed save against it): its first effect now, then a save each day. */
export async function contractDisease(actor, which) {
  const d = (typeof which === "string") ? DISEASES[norm(which)] : (which ? { cure: 2, ...which } : null);
  if (!actor || !d) return;
  if (actor.system?.traits?.immune?.includes("doenca")) {
    await note(actor, game.i18n.format("IJ.Auto.immuneTo", { name: actor.name, what: d.name }));
    return;
  }
  if (actor.effects.some(e => e.flags?.[SYSTEM]?.disease?.name === d.name)) return;
  await createEffects(actor, [{
    name: `${L("IJ.Auto.diseaseName")}: ${d.name}`, img: "icons/svg/biohazard.svg", showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [SYSTEM]: { temp: true, disease: { name: d.name, dc: d.dc, damage: d.damage, cure: d.cure ?? 2, streak: 0 } } }
  }]);
  await applyAbilityDamage(actor, d.damage);
  await note(actor, game.i18n.format("IJ.Auto.diseaseContracted", { name: actor.name, what: d.name }));
}

/** A day passed (a night of rest): each disease asks its save; two in a row heal it, a failure does its harm. */
export async function diseaseDay(actor) {
  for (const effect of actor.effects.filter(e => e.flags?.[SYSTEM]?.disease)) {
    const d = effect.flags[SYSTEM].disease;
    const msg = await actor.rollSave("fort", { dc: d.dc, source: d.name });
    if (msg?.flags?.[SYSTEM]?.success) {
      const streak = (d.streak ?? 0) + 1;
      if (streak >= (d.cure ?? 2)) {
        await deleteEffects(actor, [effect.id]);
        await note(actor, game.i18n.format("IJ.Auto.diseaseCured", { name: actor.name, what: d.name }));
      } else await updateEffect(actor, effect.id, { [`flags.${SYSTEM}.disease.streak`]: streak });
    } else {
      await updateEffect(actor, effect.id, { [`flags.${SYSTEM}.disease.streak`]: 0 });
      await applyAbilityDamage(actor, d.damage);
    }
  }
}

/** Purificação, Integridade Corporal: the diseases and/or lasting poisons go. */
export async function cure(actor, kinds = ["disease", "poison"]) {
  const list = [kinds].flat();
  const ids = actor.effects.filter(e => (list.includes("disease") && e.flags?.[SYSTEM]?.disease) || (list.includes("poison") && e.flags?.[SYSTEM]?.poison)).map(e => e.id);
  if (ids.length) await deleteEffects(actor, ids);
  await note(actor, game.i18n.format("IJ.Auto.cured", { name: actor.name, n: ids.length }));
  return ids.length;
}
