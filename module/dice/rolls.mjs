import { SYSTEM_ID } from "../config.mjs";

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
  const content = `<div class="ij-dialog-mod">
    <p>${game.i18n.localize("IJ.Roll.situationalHint")}</p>
    <label>${game.i18n.localize("IJ.Roll.otherBonus")} <input type="number" name="bonus" value="0" step="1" autofocus></label>
  </div>`;
  const read = (button, dialog, base) => base + (Number(dialog.element.querySelector("input[name=bonus]")?.value) || 0);
  return foundry.applications.api.DialogV2.wait({
    window: { title, icon: "fa-solid fa-dice-d20" },
    classes: ["imperiodejade", "ij-dialog"],
    content,
    rejectClose: false,
    buttons: [
      { action: "bad", label: game.i18n.localize("IJ.Roll.unfavorable"), icon: "fa-solid fa-arrow-down", callback: (e, b, d) => read(b, d, -2) },
      { action: "normal", label: game.i18n.localize("IJ.Roll.normal"), icon: "fa-solid fa-dice-d20", default: true, callback: (e, b, d) => read(b, d, 0) },
      { action: "good", label: game.i18n.localize("IJ.Roll.favorable"), icon: "fa-solid fa-arrow-up", callback: (e, b, d) => read(b, d, 2) }
    ]
  });
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
 * @param {Event} [options.event]        The click: Shift asks for a situational modifier
 */
export async function d20Roll({ actor, title, subtitle = "", bonus = 0, parts = [], kanji = "", critRange = 20, kind = "check", buttons = [], event = null, flags = {} }) {
  let situational = 0;
  if (event?.shiftKey) {
    const mod = await askModifier(title);
    if (mod === null) return null;
    situational = mod;
  }
  const total = bonus + situational;
  const roll = await new Roll(`1d20${bonusTerm(total)}`, actor?.getRollData?.() ?? {}).evaluate();
  const natural = roll.dice[0]?.total ?? 0;
  const allParts = situational ? [...parts, { label: game.i18n.localize("IJ.Roll.situational"), value: situational }] : parts;
  const context = {
    title, subtitle, kanji, kind,
    total: roll.total,
    natural,
    bonus: signed(total),
    parts: allParts.filter(p => p.value).map(p => ({ label: p.label, value: signed(p.value) })),
    crit: natural >= critRange,
    critLabel: kind === "attack" ? "IJ.Roll.threat" : "IJ.Roll.natural20",
    fumble: natural === 1,
    dice: await roll.render(),
    img: actor?.img,
    buttons
  };
  const content = await renderTemplate(CARD, context);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    flags: { [SYSTEM_ID]: { kind, ...flags } }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

/**
 * Roll damage (or healing) and post the card with the buttons that apply it to the controlled tokens.
 * A critical multiplies the whole result (dice and modifiers, p. 141).
 */
export async function damageRoll({ actor, title, subtitle = "", formula, multiplier = 1, damageType = "", physical = true, kanji = "", healing = false }) {
  const expr = multiplier > 1 ? `(${formula}) * ${multiplier}` : formula;
  const roll = await new Roll(expr, actor?.getRollData?.() ?? {}).evaluate();
  const context = {
    title, subtitle, kanji,
    kind: healing ? "healing" : "damage",
    total: roll.total,
    critical: multiplier > 1,
    multiplier,
    damageType,
    dice: await roll.render(),
    img: actor?.img,
    apply: true,
    healing,
    amount: roll.total,
    physical
  };
  const content = await renderTemplate(CARD, context);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    flags: { [SYSTEM_ID]: { kind: context.kind, amount: roll.total, physical } }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

/** A card without a roll (abilities, jutsus, Honor). */
export async function infoCard({ actor, title, subtitle = "", kanji = "", body = "", tags = [], buttons = [], kind = "info" }) {
  const content = await renderTemplate(CARD, { title, subtitle, kanji, body, tags, buttons, kind, img: actor?.img, info: true });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { [SYSTEM_ID]: { kind } }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

/* -------------------------------------------- */
/*  Chat card buttons                           */
/* -------------------------------------------- */

/** The actors of the controlled tokens (or the user's character), for "apply damage". */
function targetActors() {
  const tokens = canvas?.tokens?.controlled ?? [];
  const actors = tokens.map(t => t.actor).filter(Boolean);
  if (!actors.length && game.user.character) actors.push(game.user.character);
  return actors;
}

/**
 * Apply damage to an actor: temporary PV go first, physical damage is reduced by the damage reduction (p. 227).
 * @param {Actor} actor
 * @param {number} amount        Positive damage, or negative for healing
 * @param {object} [options]
 * @param {boolean} [options.physical=true]  Whether damage reduction applies
 */
export async function applyDamage(actor, amount, { physical = true } = {}) {
  if (actor.type !== "character") return;
  const pv = actor.system.attributes.pv;
  if (amount < 0) {
    const value = Math.min(pv.max, pv.value - amount);
    await actor.update({ "system.attributes.pv.value": value });
    return { healed: value - pv.value };
  }
  const rd = physical ? (actor.system.rd ?? 0) : 0;
  let damage = Math.max(0, amount - rd);
  const fromTemp = Math.min(pv.temp, damage);
  damage -= fromTemp;
  await actor.update({
    "system.attributes.pv.temp": pv.temp - fromTemp,
    "system.attributes.pv.value": pv.value - damage
  });
  return { damage: damage + fromTemp, reduced: Math.min(rd, amount) };
}

async function onCardButton(event, message) {
  const button = event.target.closest("[data-ij-action]");
  if (!button) return;
  event.preventDefault();
  const { ijAction } = button.dataset;

  if (ijAction === "apply") {
    const amount = Number(button.dataset.amount) || 0;
    const physical = button.dataset.physical === "true";
    const actors = targetActors();
    if (!actors.length) return ui.notifications.warn(game.i18n.localize("IJ.Chat.noTarget"));
    for (const actor of actors) {
      if (!actor.isOwner) continue;
      const result = await applyDamage(actor, amount, { physical });
      if (!result) continue;
      const key = amount < 0 ? "IJ.Chat.healedNote" : "IJ.Chat.damagedNote";
      ui.notifications.info(game.i18n.format(key, { name: actor.name, n: Math.abs(result.healed ?? result.damage ?? 0) }));
    }
    return;
  }

  // Item buttons (damage of an attack)
  const actor = await fromUuid(button.dataset.actor);
  const item = actor?.items.get(button.dataset.item);
  if (!item) return ui.notifications.warn(game.i18n.localize("IJ.Chat.itemGone"));
  if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("IJ.Chat.notOwner"));
  if (ijAction === "damage") return item.rollDamage({ critical: button.dataset.crit === "true" });
}

/** Bind the card buttons when a message is rendered. */
export function registerChatListeners() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!html.querySelector?.(".ij-card")) return;
    html.addEventListener("click", event => onCardButton(event, message));
  });
}
