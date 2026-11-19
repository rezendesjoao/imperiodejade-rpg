/**
 * The automation engine of Império de Jade: what the abilities, feats, items and jutsus of the book do by themselves.
 * See docs/automacao.md for the data each item carries (`system.auto`).
 */
import { SYSTEM, collectTraits, rollOptionsFor, matches, situation, dataFor, rankOf, evaluate, hpOf } from "./context.mjs";
import { registerConditions, conditionMods, CONDITIONS, effectiveStatuses } from "./conditions.mjs";
import { registerSocket, applyCondition, removeCondition, resetUses, endScene, updateActor, deleteEffects } from "./effects.mjs";
import { useItem, onApplyTargets, onDamage, onHeal, onSaveResult, sourceOf } from "./activation.mjs";
import { attackRoll, attackDamage } from "./attack.mjs";
import { applyCard, rollDamage, applyToActor } from "./damage.mjs";
import { useReaction } from "./reactions.mjs";
import { syncActor, migrateWorld, registerMigrationSetting } from "./migration.mjs";
import { scheduleAuras, syncAuras, applyAbilityDamage, applyNegativeLevels, kill, dispel, endZones, placeZone, contractDisease, diseaseDay, cure, DISEASES } from "./extras.mjs";

export {
  collectTraits, rollOptionsFor, matches, situation, dataFor, rankOf, conditionMods, effectiveStatuses, CONDITIONS,
  applyCondition, removeCondition, resetUses, endScene, useItem, onApplyTargets, onDamage, onHeal, onSaveResult, sourceOf,
  attackRoll, attackDamage, applyCard, rollDamage, applyToActor, useReaction, syncActor, migrateWorld,
  syncAuras, applyAbilityDamage, applyNegativeLevels, kill, dispel, placeZone, contractDisease, diseaseDay, cure, DISEASES
};

/** Called at init. */
export function registerAutomation() {
  registerConditions();
  registerMigrationSetting();
}

/** Called at ready (the socket needs the game). */
export function readyAutomation() {
  registerSocket();
  // Items copied before this version get the automation of the compendium
  migrateWorld();
  Hooks.on("updateCombat", onCombatUpdate);
  // Initiative rolled in the tracker spends the effects of "the next test" (who rolled it does it)
  Hooks.on("updateCombatant", async (combatant, change, options, userId) => {
    if (!("initiative" in change) || (change.initiative === null) || (userId !== game.user.id)) return;
    const actor = combatant.actor;
    if (!actor) return;
    const { consumes } = await import("./effects.mjs");
    const used = actor.effects.filter(e => consumes(e, ["check", "skill", "initiative"]) && e.active).map(e => e.id);
    if (used.length) await deleteEffects(actor, used);
  });
  Hooks.on("deleteCombat", onCombatDelete);
  // Effects tied to a condition end with it (blind while grabbed); effects that end when the bearer moves
  Hooks.on("deleteActiveEffect", effect => { if (game.users.activeGM?.isSelf) endLinked(effect); });
  // (a moment later: removing a status while the token is being placed breaks its drawing)
  Hooks.on("updateToken", (token, changed) => { if ((("x" in changed) || ("y" in changed)) && game.users.activeGM?.isSelf) setTimeout(() => endOnMove(token), 150); });
  Hooks.on("preUpdateActor", stashPv);
  Hooks.on("updateActor", onActorUpdate);
  Hooks.on("deleteActiveEffect", onEffectDeleted);
  // Auras: whoever enters or leaves the radius gets or loses the copy
  Hooks.on("updateToken", (token, changed) => { if (("x" in changed) || ("y" in changed)) scheduleAuras(); });
  Hooks.on("createToken", () => scheduleAuras());
  Hooks.on("deleteToken", () => scheduleAuras());
  Hooks.on("createActiveEffect", effect => { if (effect.flags?.[SYSTEM]?.aura) scheduleAuras(); });
  Hooks.on("deleteActiveEffect", effect => { if (effect.flags?.[SYSTEM]?.aura) scheduleAuras(); });
  Hooks.on("canvasReady", () => scheduleAuras());
  // Areas: placed, moved or removed regions of jutsus; the user's effect of an area takes it along when it ends
  for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) Hooks.on(hook, region => { if (region.flags?.[SYSTEM]?.zone) scheduleAuras(); });
  Hooks.on("deleteActiveEffect", effect => { if (game.users.activeGM?.isSelf && effect.flags?.[SYSTEM]?.zoneMarker) endZones(effect); });
}

/* -------------------------------------------- */
/*  Turns and rounds                            */
/* -------------------------------------------- */

/** A new turn (and maybe a new round): the conditions of the turn's start; uses per round come back. */
async function onCombatUpdate(combat, changed) {
  if (!game.users.activeGM?.isSelf) return;
  if (!("turn" in changed) && !("round" in changed)) return;
  if ("round" in changed) {
    for (const c of combat.combatants) if (c.actor) await resetUses(c.actor, ["rodada"]);
  }
  const actor = combat.combatant?.actor;
  if (!actor) return;
  const statuses = effectiveStatuses(actor);
  // Cura acelerada: PV back at the start of each turn
  // Cura acelerada: stopped by effects (an empty kappa bowl); a regenerating titan doesn't heal what criticals did
  const fast = actor.system.traits?.noFastHealing ? 0 : (actor.system.traits?.fastHealing ?? 0);
  const cap = hpOf(actor).max - (actor.flags?.[SYSTEM]?.critDamage ?? 0);
  if (fast > 0 && hpOf(actor).value < cap && !statuses.has("dead")) {
    const r = await applyToActor(actor, { heal: Math.min(fast, cap - hpOf(actor).value) });
    if (r.healed) await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="imperiodejade ij-card ij-card--applied"><p>${foundry.utils.escapeHTML(game.i18n.format("IJ.Auto.fastHealing", { name: actor.name, n: r.healed }))}</p></div>`
    });
  }
  if (statuses.has("sangrando")) await bleed(actor);
  if (statuses.has("confuso")) await confusion(actor);
  // Effects that act at the start of the bearer's turn (ongoing damage, regeneration, a save to end it)
  for (const effect of [...actor.effects]) {
    const ts = effect.flags?.[SYSTEM]?.turnStart;
    if (ts && effect.active) await turnStartEffect(actor, effect, ts);
  }
}

/** Effects tied to a condition the actor no longer has end with it. */
async function endLinked(effect) {
  const actor = effect.parent;
  if (!(actor instanceof Actor) || !effect.statuses?.size) return;
  const still = new Set(actor.effects.filter(e => (e.id !== effect.id) && e.active).flatMap(e => [...e.statuses]));
  const gone = [...effect.statuses].filter(s => !still.has(s));
  if (!gone.length) return;
  const ids = actor.effects.filter(e => (e.id !== effect.id) && gone.includes(e.flags?.[SYSTEM]?.endWith)).map(e => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/** A token moved: its effects that end on movement go (Invisibilidade Ninja). */
async function endOnMove(token) {
  const actor = token.actor;
  if (!actor) return;
  const { consumes } = await import("./effects.mjs");
  const ids = actor.effects.filter(e => consumes(e, "move") && e.active).map(e => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/** One effect's start-of-turn work. */
async function turnStartEffect(actor, effect, ts) {
  // Passed it before: immune for now (Gralhar Aterrador)
  const { immuneTo, grantImmunity } = await import("./effects.mjs");
  if (immuneTo(actor, effect.name)) return;
  let success = null;
  if (ts.save?.type) {
    const msg = await actor.rollSave(ts.save.type, { dc: ts.save.dc, source: effect.name });
    success = msg?.flags?.[SYSTEM]?.success ?? null;
    if (success && ts.immuneFor) await grantImmunity(actor, effect.name, ts.immuneFor);
    // Failing by 5 or more: the harder conditions instead
    const total = msg?.flags?.[SYSTEM]?.total ?? null;
    if ((success === false) && ts.conditionsBy5?.length && (total !== null) && (total <= ts.save.dc - 5)) ts = { ...ts, conditions: ts.conditionsBy5 };
    if (success && ts.endOnSave) return actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
  }
  const lines = [];
  if (ts.damage) {
    const roll = await new Roll(ts.damage).evaluate();
    let amount = roll.total;
    if (success && ts.negate) amount = 0;
    else if (success && ts.half) amount = Math.floor(amount / 2);
    const { computeDamage } = await import("./damage.mjs");
    const result = await computeDamage(actor, { parts: [{ amount, single: amount, type: ts.type, physical: !ts.type || /corte|perfur|esmag/i.test(ts.type) }], magic: true, ignoreRd: ts.ignoreRd ?? 0 });
    const applied = await applyToActor(actor, { amount: result.amount });
    lines.push(game.i18n.format("IJ.Chat.damagedNote", { name: actor.name, n: applied.damage }) + (result.notes.length ? ` (${result.notes.join("; ")})` : ""));
  }
  if (ts.heal) {
    const roll = await new Roll(ts.heal).evaluate();
    const r = await applyToActor(actor, { heal: roll.total });
    lines.push(game.i18n.format("IJ.Chat.healedNote", { name: actor.name, n: r.healed }));
  }
  for (const c of (success ? [] : ts.conditions ?? [])) await applyCondition(actor, c, { duration: c.duration ?? null, source: effect.name });
  if (ts.abilityDamage && !success) {
    const { applyAbilityDamage } = await import("./extras.mjs");
    await applyAbilityDamage(actor, ts.abilityDamage);
  }
  if (lines.length) await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="imperiodejade ij-card ij-card--applied"><p><strong>${foundry.utils.escapeHTML(effect.name)}</strong>: ${foundry.utils.escapeHTML(lines.join(" · "))}</p></div>`
  });
}

/** Bleeding (p. 252): a Constitution test (DC 15) stabilizes; failing costs 1d4 PV. */
async function bleed(actor) {
  const con = actor.type === "npc" ? (actor.system.mods?.con ?? 0) : (actor.system.abilities?.con?.mod ?? 0);
  const roll = await new Roll(`1d20 + ${con}`).evaluate();
  const ok = roll.total >= 15;
  let lost = 0;
  if (ok) await removeCondition(actor, "sangrando");
  else {
    const dmg = await new Roll("1d4").evaluate();
    lost = dmg.total;
    await applyToActor(actor, { amount: lost });
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
    content: `<div class="imperiodejade ij-card ij-card--applied"><p><strong>${game.i18n.localize("IJ.Condition.sangrando")}</strong>: ${roll.total} (CD 15) · ${
      ok ? game.i18n.localize("IJ.Auto.stabilized") : game.i18n.format("IJ.Auto.bled", { n: lost })}</p></div>`
  });
}

/** Confused (p. 251): 1d6 at the start of the turn says what the creature does. */
async function confusion(actor) {
  const roll = await new Roll("1d6").evaluate();
  const n = roll.total;
  const key = n === 1 ? "move" : (n <= 3 ? "nothing" : (n <= 5 ? "attack" : "normal"));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
    content: `<div class="imperiodejade ij-card ij-card--applied"><p><strong>${game.i18n.localize("IJ.Condition.confuso")}</strong> (${n}): ${game.i18n.localize(`IJ.Auto.confusion.${key}`)}</p></div>`
  });
}

/** The combat ended: effects that last a scene end for the combatants; uses per scene come back. */
async function onCombatDelete(combat) {
  if (!game.users.activeGM?.isSelf) return;
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!actor) continue;
    const ids = actor.effects.filter(e => e.flags?.[SYSTEM]?.scene).map(e => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    await resetUses(actor, ["cena", "rodada"]);
  }
}

/* -------------------------------------------- */
/*  Falling creatures                           */
/* -------------------------------------------- */

function stashPv(actor, changed, options) {
  const path = actor.type === "npc" ? "system.pv.value" : "system.attributes.pv.value";
  if (foundry.utils.getProperty(changed, path) === undefined) return;
  options.ijPvBefore = hpOf(actor).value;
}

/** A creature dropped to 0 PV or less: those who feed on it (Devorador de Almas) gain PM. */
async function onActorUpdate(actor, changed, options, userId) {
  if (userId !== game.user.id) return;
  const before = options.ijPvBefore;
  if (before === undefined) return;
  const after = hpOf(actor).value;
  if (!(before > 0 && after <= 0)) return;
  const fallen = actor.getActiveTokens()[0];
  if (!fallen || !canvas?.ready) return;
  for (const token of canvas.tokens.placeables) {
    const other = token.actor;
    if (!other || other === actor) continue;
    for (const trigger of other.system?.traits?.triggers ?? []) {
      if (trigger.on !== "creatureDown") continue;
      const range = Number(trigger.range ?? 9);
      const distance = canvas.grid.measurePath([fallen.center, token.center]).distance;
      if (distance > range) continue;
      const n = Math.floor(evaluate(trigger.gainPm ?? 0, trigger._data));
      if (!n) continue;
      const pm = other.type === "npc" ? other.system.pm : other.system.attributes.pm;
      await updateActor(other, { [other.type === "npc" ? "system.pm.value" : "system.attributes.pm.value"]: Math.min(pm.max, pm.value + n) });
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: other }),
        content: `<div class="imperiodejade ij-card ij-card--applied"><p>${foundry.utils.escapeHTML(game.i18n.format("IJ.Auto.gainPm", { name: other.name, n, what: trigger._itemName ?? "" }))}</p></div>`
      });
    }
  }
}

/* -------------------------------------------- */
/*  Effects that end                            */
/* -------------------------------------------- */

/** Temporary PV of an effect go away with it (Resolução: they vanish when it ends). */
async function onEffectDeleted(effect, options, userId) {
  const granted = effect.flags?.[SYSTEM]?.tempPv;
  if (!granted) return;
  // Whoever deleted it (the GM for expired effects)
  if (userId !== game.user.id) return;
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  const base = actor.type === "npc" ? "system.pv" : "system.attributes.pv";
  const temp = foundry.utils.getProperty(actor, `${base}.temp`) ?? 0;
  if (temp > 0) await updateActor(actor, { [`${base}.temp`]: Math.max(0, temp - granted) });
}
