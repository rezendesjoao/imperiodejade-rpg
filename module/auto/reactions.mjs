/**
 * Reactions: abilities used in answer to something (a failed save, falling to 0 PV, being attacked, an Honor
 * violation). The moment posts its buttons; only the owner of the reacting actor can use them.
 *
 * A reaction entry (system.auto.reactions of an item):
 *   { on: "saveFailed" | "saveRolled" | "dropToZero" | "attacked" | "honorDamage",
 *     label, cost (PM), effect: "reroll" | "addBonus" | "negateDamage" | "stayUp" | "counterattack" |
 *     "opposedAttack" | "opposedSkill" | "reduceHonor" | "honorTest",
 *     value (formula), saves: ["fort", ...], melee / ranged (for "attacked"), skill, dc, note }
 */
import { SYSTEM, evaluate } from "./context.mjs";
import { updateActor } from "./effects.mjs";

const L = key => game.i18n.localize(key);

/** The reactions an actor has for a moment (filtered by what happened). */
export function reactionsFor(actor, on, payload = {}) {
  return (actor?.system?.traits?.reactions ?? []).filter(r => {
    if (r.on !== on) return false;
    if (r.saves && payload.save && !r.saves.includes(payload.save)) return false;
    if (r.melee && payload.ranged) return false;
    if (r.ranged && !payload.ranged) return false;
    if (r.severities && payload.severity && !r.severities.includes(payload.severity)) return false;
    return true;
  });
}

/** The chat buttons of the reactions of a moment (to go on an existing card). */
export function reactionButtons(actor, on, payload = {}) {
  return reactionsFor(actor, on, payload).map((r, i) => ({
    ijAction: "reaction",
    label: r.cost ? `${r.label ?? r._itemName} (${evaluate(r.cost, r._data)} PM)` : (r.label ?? r._itemName),
    icon: "fa-solid fa-bolt",
    actor: actor.uuid,
    on,
    index: i,
    payload: JSON.stringify(payload)
  }));
}

/** Post a card with the reactions of a moment (when nothing else is on screen for it). */
export async function offerReactions(actor, on, payload = {}) {
  const buttons = reactionButtons(actor, on, payload);
  if (!buttons.length) return null;
  const { infoCard } = await import("../dice/rolls.mjs");
  return infoCard({
    actor, kind: "reaction", kanji: "応",
    title: L(`IJ.Reaction.${on}`),
    subtitle: actor.name,
    body: `<p>${game.i18n.format(`IJ.Reaction.${on}Hint`, { name: actor.name, n: payload.damage ?? 0 })}</p>`,
    buttons
  });
}

/**
 * Use a reaction from its chat button.
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function useReaction(button, message) {
  const actor = await fromUuid(button.dataset.actor);
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(L("IJ.Chat.notOwner"));
  const on = button.dataset.on;
  const payload = JSON.parse(button.dataset.payload || "{}");
  const reaction = reactionsFor(actor, on, payload)[Number(button.dataset.index) || 0];
  if (!reaction) return;
  const cost = Math.max(0, Math.floor(evaluate(reaction.cost ?? 0, reaction._data)));
  if (cost && !(await actor.spendPm(cost))) return;
  const name = reaction.label ?? reaction._itemName;
  // A reaction that spends the effect that gave it
  if (reaction.endEffect && reaction._effect && actor.effects.has(reaction._effect)) await actor.deleteEmbeddedDocuments("ActiveEffect", [reaction._effect]);
  const { infoCard } = await import("../dice/rolls.mjs");
  const note = text => infoCard({ actor, kind: "reaction", kanji: "応", title: name, subtitle: cost ? `${cost} PM` : "", body: `<p>${text}</p>` });

  switch (reaction.effect) {
    case "reroll":
      // Roll the same save again; the new result stands
      return actor.rollSave(payload.save, { dc: payload.dc ?? null, source: payload.source ?? "", sourceId: payload.sourceId ?? null, reroll: name });
    case "addBonus": {
      const bonus = Math.floor(evaluate(reaction.value ?? 0, reaction._data));
      const total = (payload.total ?? 0) + bonus;
      const success = (payload.dc === null || payload.dc === undefined) ? null : total >= payload.dc;
      // Record the new result for the damage that halves
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="imperiodejade ij-card ij-card--applied"><p><strong>${foundry.utils.escapeHTML(name)}</strong>: ${payload.total} + ${bonus} = ${total}${
          success === null ? "" : ` · ${L(success ? "IJ.Roll.success" : "IJ.Roll.failure")}`}</p></div>`,
        flags: { [SYSTEM]: { kind: "save", source: payload.sourceId ?? null, actor: actor.uuid, success, total, save: payload.save } }
      });
      return;
    }
    case "negateDamage": {
      // Ignore the damage that dropped the actor: PV back, out of the fall
      const base = actor.type === "npc" ? "system.pv" : "system.attributes.pv";
      const pv = foundry.utils.getProperty(actor, base);
      await updateActor(actor, { [`${base}.value`]: Math.min(pv.max, pv.value + (payload.damage ?? 0)) });
      const ids = actor.effects.filter(e => e.flags?.[SYSTEM]?.fall).map(e => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
      return note(game.i18n.format("IJ.Reaction.negated", { name: actor.name, n: payload.damage ?? 0 }));
    }
    case "stayUp": {
      // Conscious at 0 PV or less (still bleeding)
      const ids = actor.effects.filter(e => e.flags?.[SYSTEM]?.fall && e.statuses.has("inconsciente")).map(e => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
      return note(game.i18n.format("IJ.Reaction.stayUp", { name: actor.name }));
    }
    case "counterattack": {
      const attacker = payload.attacker ? await fromUuid(payload.attacker) : null;
      const weapon = actor.items.find(i => (i.type === "weapon") && i.system.equipped && (i.system.kind === "corpo"));
      if (!weapon) return actor.rollPlainAttack("melee", { target: attacker });
      return weapon.rollAttack({ target: attacker, reaction: name });
    }
    case "opposedAttack": {
      const weapon = actor.items.find(i => (i.type === "weapon") && i.system.equipped && (i.system.kind === "corpo"));
      const bonus = weapon ? weapon.system.attackTotal : (actor.system.attack?.melee ?? 0);
      const roll = await new Roll(`1d20 + ${bonus}`).evaluate();
      const avoided = reaction.tieWins ? (roll.total >= (payload.total ?? 0)) : (roll.total > (payload.total ?? 0));
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<div class="imperiodejade ij-card ij-card--applied"><p><strong>${foundry.utils.escapeHTML(name)}</strong>: ${roll.total} × ${payload.total ?? "?"} · ${
          L(avoided ? "IJ.Reaction.avoided" : "IJ.Reaction.notAvoided")}</p></div>`
      });
    }
    case "opposedSkill": {
      const skill = actor.system.skills?.[reaction.skill];
      const roll = await new Roll(`1d20 + ${skill?.total ?? 0}`).evaluate();
      const avoided = reaction.tieWins ? (roll.total >= (payload.total ?? 0)) : (roll.total > (payload.total ?? 0));
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<div class="imperiodejade ij-card ij-card--applied"><p><strong>${foundry.utils.escapeHTML(name)}</strong>: ${roll.total} × ${payload.total ?? "?"} · ${
          L(avoided ? "IJ.Reaction.avoided" : "IJ.Reaction.notAvoided")}</p></div>`
      });
    }
    case "reduceHonor": {
      const back = Math.min(Math.max(0, (payload.loss ?? 0) - 1), Math.floor(evaluate(reaction.value ?? 1, reaction._data)));
      if (back > 0) await actor.update({ "system.abilities.hon.value": actor.system.abilities.hon.value + back });
      return note(game.i18n.format("IJ.Reaction.honorBack", { n: back }));
    }
    case "honorTest": {
      const skill = actor.system.skills?.[reaction.skill ?? "diplomacia"];
      const roll = await new Roll(`1d20 + ${skill?.total ?? 0}`).evaluate();
      const ok = roll.total >= (reaction.dc ?? 15);
      if (ok && payload.loss) await actor.update({ "system.abilities.hon.value": actor.system.abilities.hon.value + payload.loss });
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<div class="imperiodejade ij-card ij-card--applied"><p><strong>${foundry.utils.escapeHTML(name)}</strong>: ${roll.total} (CD ${reaction.dc ?? 15}) · ${
          ok ? game.i18n.format("IJ.Reaction.honorBack", { n: payload.loss ?? 0 }) : L("IJ.Roll.failure")}</p></div>`
      });
    }
    default:
      return note(reaction.note ?? "");
  }
}
