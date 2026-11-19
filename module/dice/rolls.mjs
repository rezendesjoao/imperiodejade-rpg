import { SYSTEM_ID } from "../config.mjs";
import { askOptions } from "../auto/dialog.mjs";
import { adjustCost } from "../auto/activation.mjs";

const { renderTemplate } = foundry.applications.handlebars;
const CARD = `systems/${SYSTEM_ID}/templates/chat/roll-card.hbs`;

/** "+3", "−2", "+0" */
export function signed(n) {
  const v = Number(n) || 0;
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}

/** A formula term for a flat bonus: "+ 3", "- 2" or "" for zero. */
function bonusTerm(n) {
  const v = Number(n) || 0;
  if (!v) return "";
  return v < 0 ? ` - ${Math.abs(v)}` : ` + ${v}`;
}

/**
 * Ask for a situational modifier (p. 225: favorable +2, unfavorable −2, or any number).
 * @returns {Promise<number|null>} The modifier, or null if the dialog was closed.
 */
export async function askModifier(title) {
  const answer = await askOptions(title, []);
  return answer ? answer.bonus : null;
}

/**
 * Roll 1d20 + bonus and post the themed chat card.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {string} options.title         Card title ("Teste de Atletismo")
 * @param {string} [options.subtitle]    A line under the title ("Treinada · Destreza")
 * @param {number} options.bonus         Total bonus added to the d20
 * @param {Array<{label: string, value: number}>} [options.parts]  Breakdown shown under the total
 * @param {string} [options.kanji]       Watermark of the card
 * @param {number} [options.critRange]   Natural roll that threatens a critical (attacks)
 * @param {string} [options.kind]        "check" | "save" | "attack" | "initiative"
 * @param {object} [options.buttons]     Extra buttons [{action, label, icon, data}]
 * @param {Event} [options.event]        The click: Shift asks for a situational modifier, Alt skips the options
 * @param {number|null} [options.dc]     A DC to beat: the card says success or failure
 * @param {object[]} [options.options]   Roll options (auto/context.mjs rollOptionsFor): the dialog offers them
 * @param {number} [options.bestOf]      Another bonus rolled alongside; the better result stands (Mente Sobre a Matéria)
 * @param {boolean} [options.autoSuccess] Passes no matter the roll (Autoperfeição)
 * @param {Function} [options.after]     (context) => extra buttons, called once the result is known
 */
export async function d20Roll({ actor, title, subtitle = "", bonus = 0, parts = [], kanji = "", critRange = 20, kind = "check", buttons = [], event = null, flags = {}, dc = null, options = [], bestOf = null, bestLabel = "", autoSuccess = false, after = null }) {
  // The options an actor has for this roll (and the situational modifier)
  let picked = { selected: new Set(options.filter(o => o.locked || o.auto).map(o => o.id)), pm: {}, split: {}, bonus: 0 };
  const optional = options.filter(o => !o.locked);
  if ((event?.shiftKey || optional.length) && !event?.altKey) {
    picked = await askOptions(title, options, { pmLimit: actor?.pmLimit ?? Infinity });
    if (!picked) return null;
  }
  const chosen = options.filter(o => picked.selected.has(o.id));
  let cost = 0;
  const optionParts = [];
  for (const o of chosen) {
    cost += o.cost + (picked.pm[o.id] ?? 0);
    const v = o.value + ((o.pm && picked.pm[o.id]) ? picked.pm[o.id] * (o.pm.attack || o.pm.damage || 0) : 0);
    if (v) optionParts.push({ label: o.label, value: v });
  }
  cost = adjustCost(actor, cost, { kind: "power" });
  if (cost > 0 && actor && !(await actor.spendPm(cost))) return null;

  const situational = picked.bonus;
  const total = bonus + situational + optionParts.reduce((t, p) => t + p.value, 0);
  // An option that rolls two d20 and keeps the better (Ataque Zen, Língua de Prata)
  const advantage = chosen.find(o => o.best);
  if (advantage && (bestOf === null || bestOf === undefined)) {
    bestOf = total - situational;
    bestLabel = advantage.label;
  }
  const roll = await new Roll(`1d20${bonusTerm(total)}`, actor?.getRollData?.() ?? {}).evaluate();
  const rolls = [roll];
  let shown = roll;
  let bestNote = "";
  // Roll another bonus too and keep the better result
  if (bestOf !== null && bestOf !== undefined) {
    const other = await new Roll(`1d20${bonusTerm(bestOf + situational)}`, actor?.getRollData?.() ?? {}).evaluate();
    rolls.push(other);
    if (other.total > roll.total) shown = other;
    bestNote = `${bestLabel}: ${other.total} (${signed(bestOf + situational)})`;
  }
  const natural = shown.dice[0]?.total ?? 0;
  const allParts = [...parts, ...optionParts, ...(situational ? [{ label: game.i18n.localize("IJ.Roll.situational"), value: situational }] : [])];
  // Against a DC: natural 20 always succeeds and natural 1 always fails on saves (p. 78)
  let success = (dc === null) ? null : ((kind === "save") && (natural === 20)) ? true
    : ((kind === "save") && (natural === 1)) ? false : shown.total >= dc;
  if (autoSuccess && dc !== null) success = true;
  const context = {
    title, subtitle, kanji, kind,
    total: shown.total,
    natural,
    bonus: signed(total),
    parts: allParts.filter(p => p.value).map(p => ({ label: p.label, value: signed(p.value) })),
    crit: natural >= critRange,
    critLabel: kind === "attack" ? "IJ.Roll.threat" : "IJ.Roll.natural20",
    fumble: natural === 1,
    dice: (await Promise.all(rolls.map(r => r.render()))).join(""),
    img: actor?.img,
    buttons: [...buttons],
    dc,
    success,
    lines: [bestNote, autoSuccess && dc !== null ? game.i18n.localize("IJ.Auto.autoSuccess") : "", cost ? `${cost} PM` : ""].filter(Boolean)
  };
  if (after) context.buttons.push(...(after({ total: shown.total, natural, success, dc }) ?? []));
  const content = await renderTemplate(CARD, context);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls,
    flags: { [SYSTEM_ID]: { kind, actor: actor?.uuid ?? null, total: shown.total, success, dc, ...flags } }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

/**
 * Roll damage (or healing) and post the card with the buttons that apply it.
 * Kept for macros: a single part, physical or not.
 */
export async function damageRoll({ actor, title, subtitle = "", formula, multiplier = 1, damageType = "", physical = true, kanji = "", healing = false }) {
  const { rollDamage } = await import("../auto/damage.mjs");
  return rollDamage({
    actor, title, subtitle, kanji,
    parts: [{ formula, type: damageType, physical }],
    critical: multiplier > 1, mult: multiplier, healing
  });
}

/** A card without a roll (abilities, jutsus, Honor). */
export async function infoCard({ actor, title, subtitle = "", kanji = "", body = "", tags = [], buttons = [], kind = "info", flags = {} }) {
  const content = await renderTemplate(CARD, { title, subtitle, kanji, body, tags, buttons, kind, img: actor?.img, info: true });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { [SYSTEM_ID]: { kind, ...flags } }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

/* -------------------------------------------- */
/*  Chat card buttons                           */
/* -------------------------------------------- */

/** The actors of the user's targets, else the controlled tokens, else the user's character. */
export function targetActors() {
  const targets = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
  if (targets.length) return targets;
  const controlled = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
  if (controlled.length) return controlled;
  return game.user.character ? [game.user.character] : [];
}

/**
 * Apply damage to an actor (macros and older cards): temporary PV go first, physical damage is reduced by RD.
 * @param {Actor} actor
 * @param {number} amount        Positive damage, or negative for healing
 * @param {object} [options]
 * @param {boolean} [options.physical=true]
 */
export async function applyDamage(actor, amount, { physical = true } = {}) {
  const { computeDamage, applyToActor } = await import("../auto/damage.mjs");
  if (amount < 0) return applyToActor(actor, { heal: -amount });
  const card = { parts: [{ amount, single: amount, type: physical ? "" : "energia", physical }] };
  const result = await computeDamage(actor, card);
  const applied = await applyToActor(actor, { amount: result.amount });
  return { damage: applied.damage, reduced: amount - result.amount };
}

async function onCardButton(event, message) {
  const button = event.target.closest("[data-ij-action]");
  if (!button) return;
  event.preventDefault();
  const { ijAction } = button.dataset;
  const auto = await import("../auto/index.mjs");

  switch (ijAction) {
    // Damage cards: to the hits of the attack / the targets / the selected tokens
    case "applyCard": return auto.applyCard(message, { half: null });
    case "applyHalf": return auto.applyCard(message, { half: true });
    case "applyFull": return auto.applyCard(message, { half: false });
    case "apply": {
      // Older cards without parts
      const amount = Number(button.dataset.amount) || 0;
      const physical = button.dataset.physical === "true";
      for (const actor of targetActors()) await applyDamage(actor, amount, { physical });
      return;
    }
    case "attackDamage": return auto.attackDamage(message, { critical: button.dataset.crit === "true" });
    case "autoTargets": return auto.onApplyTargets(message);
    case "autoDamage": return auto.onDamage(message, { alt: button.dataset.alt === "1" });
    case "autoHeal": return auto.onHeal(message);
    case "reaction": return auto.useReaction(button, message);
    case "extraAttack": {
      // The same attack again (the automatic options apply; costs were paid on the first one)
      const attacker = await fromUuid(button.dataset.actor);
      if (!attacker?.isOwner) return ui.notifications.warn(game.i18n.localize("IJ.Chat.notOwner"));
      const weapon = button.dataset.item ? attacker.items.get(button.dataset.item) : null;
      const extra = game.i18n.localize("IJ.Auto.extraAttack");
      return weapon ? weapon.rollAttack({ event: { altKey: true }, reaction: extra }) : attacker.rollPlainAttack("melee", { event: { altKey: true } });
    }
    case "endScene": return auto.endScene();
    case "save": {
      // Each targeted/selected token (or the user's character) rolls against the DC; failing applies what the card says
      const actors = targetActors().filter(a => a.isOwner);
      if (!actors.length) return ui.notifications.warn(game.i18n.localize("IJ.Chat.noTargetSave"));
      const dc = Number(button.dataset.dc) || null;
      const sourceActor = message.speaker?.actor ? game.actors.get(message.speaker.actor) : null;
      for (const actor of actors) {
        await actor.rollSave(button.dataset.save, { dc, source: button.dataset.source ?? "", sourceId: message.id, sourceActor });
      }
      return;
    }
  }

  // Item buttons (attacks of jutsus and abilities)
  const actor = await fromUuid(button.dataset.actor);
  const item = actor?.items.get(button.dataset.item);
  if (!item) return ui.notifications.warn(game.i18n.localize("IJ.Chat.itemGone"));
  if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("IJ.Chat.notOwner"));
  if (ijAction === "autoAttack") return item.rollAutoAttack({ message });
  if (ijAction === "damage") return item.rollDamage({ critical: button.dataset.crit === "true" });
  if (ijAction === "jutsuDamage") return auto.onDamage(message);
  if (ijAction === "jutsuAttack") return item.rollAutoAttack({ message });
}

/** Bind the card buttons when a message is rendered. */
export function registerChatListeners() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!html.querySelector?.(".ij-card")) return;
    html.addEventListener("click", event => onCardButton(event, message));
  });
}
