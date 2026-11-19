/**
 * Damage and healing: rolling the parts of a hit (the weapon's damage, extra dice of energy or of a sneak attack) and
 * applying them to each target with its damage reduction, energy resistances, immunities, fortification (chance to
 * ignore the extra damage of criticals and sneak attacks), evasion, temporary PV and the reactions of who falls.
 */
import { SYSTEM, norm, isImmune, hpOf, evaluate } from "./context.mjs";
import { updateActor, applyCondition, createEffects } from "./effects.mjs";

const { renderTemplate } = foundry.applications.handlebars;
const CARD = `systems/${SYSTEM}/templates/chat/roll-card.hbs`;
const L = key => game.i18n.localize(key);

/** Energy descriptors of the book (normalized). */
export const ENERGIES = ["acido", "eletricidade", "fogo", "frio", "vento", "luz", "trevas", "vacuo", "sonico"];

/** Is a damage type physical (cut, pierce, bludgeon) and so reduced by RD? */
export function isPhysical(type) {
  const t = norm(type);
  if (!t) return true;
  if (["c", "p", "e", "cp", "pe"].includes(t)) return true;
  return /corte|perfur|esmag|fisico|impacto/.test(t);
}

/** The energy a type names ("dano de fogo" → "fogo"), or null for physical damage. */
export function energyOf(type) {
  const t = norm(type);
  return ENERGIES.find(e => t.includes(e)) ?? null;
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Roll the damage of a hit, part by part, and post the card.
 * @param {object} config
 * @param {Actor} config.actor
 * @param {string} config.title
 * @param {string} [config.subtitle]
 * @param {Array<{formula: string, type?: string, label?: string, noCrit?: boolean, precision?: boolean}>} config.parts
 * @param {boolean} [config.critical]   A critical multiplies the parts that can be multiplied (dice and bonuses)
 * @param {number} [config.mult]
 * @param {boolean} [config.healing]
 * @param {boolean} [config.magic]      Magical healing or energy (mashin and the cura elemental)
 * @param {number} [config.ignoreRd]    Points of RD (and resistance, when Infinity) the hit ignores
 * @param {object} [config.link]        { source: message id, save: "ref", half: true, attacker: uuid, melee: bool, targets: [uuid] }
 */
export async function rollDamage({ actor, title, subtitle = "", kanji = "撃", parts = [], critical = false, mult = 2, healing = false, magic = false, ignoreRd = 0, maximize = false, link = {} }) {
  const rolled = [];
  const renders = [];
  const rollData = actor?.getRollData?.() ?? {};
  for (const part of parts) {
    if (!part?.formula || part.formula === "0") continue;
    const multiply = critical && !part.noCrit && (mult > 1);
    // Jutsu Maximizado: every die at its maximum (the parts of the jutsu only)
    const roll = await new Roll(multiply ? `(${part.formula}) * ${mult}` : String(part.formula), rollData).evaluate({ maximize: maximize && !part.noMax });
    renders.push(await roll.render());
    rolled.push({
      label: part.label ?? "",
      type: part.type ?? "",
      physical: part.physical ?? isPhysical(part.type),
      precision: !!part.precision,
      crit: multiply,
      amount: Math.max(0, roll.total),
      single: multiply ? Math.floor(roll.total / mult) : Math.max(0, roll.total),
      roll
    });
  }
  const total = rolled.reduce((t, p) => t + p.amount, 0);
  const breakdown = rolled.length > 1 ? rolled.map(p => `${p.amount} ${p.label || typeLabel(p.type)}`.trim()).join(" + ") : "";
  const context = {
    title, subtitle, kanji,
    kind: healing ? "healing" : "damage",
    total,
    critical,
    multiplier: mult,
    dice: renders.join(""),
    breakdown,
    img: actor?.img,
    apply: true,
    healing,
    amount: total,
    physical: rolled.some(p => p.physical),
    half: !!link.half,
    autoApply: true
  };
  const content = await renderTemplate(CARD, context);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: rolled.map(p => p.roll),
    flags: {
      [SYSTEM]: {
        kind: context.kind,
        amount: total,
        physical: context.physical,
        damage: {
          parts: rolled.map(({ roll, ...p }) => p),
          critical, mult, healing, magic,
          ignoreRd: Number.isFinite(ignoreRd) ? ignoreRd : "all",
          attacker: actor?.uuid ?? null,
          ...link
        }
      }
    }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

function typeLabel(type) {
  if (!type) return "";
  if (["C", "P", "E", "CP", "PE"].includes(type)) return L(CONFIG.IJ.DAMAGE_TYPES[type]);
  return type;
}

/* -------------------------------------------- */
/*  Applying                                    */
/* -------------------------------------------- */

/** The latest save an actor rolled against a source card (or null). */
export function saveAgainst(actor, sourceId, type = null) {
  if (!sourceId || !actor) return null;
  const messages = game.messages.contents;
  for (let i = messages.length - 1; i >= 0; i--) {
    const f = messages[i].flags?.[SYSTEM];
    // The save of the damage's type (a second save of the same card doesn't halve the damage)
    if ((f?.kind === "save") && (f.source === sourceId) && (f.actor === actor.uuid) && (!type || !f.save || f.save === type)) return f;
  }
  return null;
}

/**
 * How much of a damage card reaches a target, and why.
 * @param {Actor} target
 * @param {object} card          flags.imperiodejade.damage of the card
 * @param {object} [options]
 * @param {boolean} [options.half]   The target passed the save that halves (manual button)
 * @returns {Promise<{amount: number, heal: number, notes: string[]}>}
 */
export async function computeDamage(target, card, { half = null } = {}) {
  const traits = target.system.traits ?? {};
  const notes = [];
  let parts = (card.parts ?? []).map(p => ({ ...p }));

  // Criticals and sneak attacks: immunity, or fortification's chance to ignore the extra damage
  const hasExtra = card.critical || parts.some(p => p.precision);
  if (hasExtra) {
    let negated = false;
    if (isImmune(target, ["critico", "furtivo"])) {
      negated = true;
      notes.push(L("IJ.Auto.note.critImmune"));
    } else if ((traits.fortification ?? 0) > 0) {
      const roll = await new Roll("1d100").evaluate();
      negated = roll.total <= traits.fortification;
      notes.push(game.i18n.format(negated ? "IJ.Auto.note.fortified" : "IJ.Auto.note.notFortified", { n: roll.total, p: traits.fortification }));
    }
    if (negated) parts = parts.map(p => (p.crit ? { ...p, amount: p.single } : p)).filter(p => !p.precision);
  }

  // Healing
  if (card.healing) {
    let heal = parts.reduce((t, p) => t + p.amount, 0);
    if (card.magic && traits.noHeal) {
      notes.push(L("IJ.Auto.note.noHeal"));
      heal = 0;
    }
    return { amount: 0, heal, notes };
  }

  const ignoreAll = card.ignoreRd === "all";
  const ignoreRd = ignoreAll ? Infinity : (Number(card.ignoreRd) || 0);
  let physical = 0;
  let bypassed = 0;
  let energy = 0;
  let healFromEnergy = 0;
  const bypass = target.system.rdBypass;
  for (const p of parts) {
    if (p.physical) {
      // RD 10/esmagamento: bludgeoning damage goes through
      if (bypass && String(p.type ?? "").includes(bypass)) bypassed += p.amount;
      else physical += p.amount;
      continue;
    }
    const kind = energyOf(p.type);
    if (kind && isImmune(target, kind) && !ignoreAll) {
      // Cura elemental (mashin): magical energy of its element heals half
      if (card.magic && (traits.healFrom ?? []).includes(kind)) healFromEnergy += Math.floor(p.amount / 2);
      notes.push(game.i18n.format("IJ.Auto.note.immune", { what: kind }));
      continue;
    }
    const resist = (kind && !ignoreAll) ? Math.max(traits.resist?.[kind] ?? 0, traits.resist?.energia ?? 0) : 0;
    if (resist) notes.push(game.i18n.format("IJ.Auto.note.resist", { what: kind, n: resist }));
    let dealt = Math.max(0, p.amount - resist);
    // Vulnerability to an energy: double damage (p. 273)
    if (kind && (traits.vulnerable ?? []).includes(kind)) {
      dealt *= 2;
      notes.push(game.i18n.format("IJ.Auto.note.vulnerable", { what: kind }));
    }
    energy += dealt;
  }
  const rd = Math.max(0, (target.system.rd ?? 0) - ignoreRd);
  if (physical && rd) notes.push(game.i18n.format("IJ.Auto.note.rd", { n: Math.min(rd, physical) }));
  let amount = Math.max(0, physical - rd) + bypassed + energy;
  // Damage that changes with who is hit (double against the dishonored...)
  if (card.perTarget?.length) {
    const attacker = card.attacker ? fromUuidSync(card.attacker) : null;
    const { situation } = await import("./context.mjs");
    for (const rule of card.perTarget) {
      if (!situation(rule.when, attacker, target)) continue;
      const mult = Number(rule.mult);
      amount = Math.floor(amount * (Number.isFinite(mult) ? mult : 1));
      notes.push(rule.label ?? `×${rule.mult}`);
    }
  }

  // Saves that halve: the target's save against the source card (or the manual "half" button); evasion
  if (card.half || card.negate || (half !== null)) {
    let success = half;
    if (success === null) {
      const save = saveAgainst(target, card.source, card.save ?? null);
      success = save ? !!save.success : false;
    }
    const evasion = (card.save === "ref") ? (traits.evasion ?? 0) : 0;
    if (success) {
      amount = (evasion || card.negate) ? 0 : Math.floor(amount / 2);
      notes.push(L(card.negate ? "IJ.Auto.note.negated" : evasion ? "IJ.Auto.note.evasion" : "IJ.Auto.note.halved"));
    } else if (evasion >= 2 && !card.negate) {
      amount = Math.floor(amount / 2);
      notes.push(L("IJ.Auto.note.evasionImproved"));
    }
  }
  return { amount, heal: healFromEnergy, notes };
}

/**
 * Apply damage (or healing) to an actor: temporary PV first, then PV. Falling to 0 PV or less leaves a character
 * unconscious and bleeding (p. 77) and a threat defeated; the target's reactions for that moment are offered.
 * @returns {Promise<{damage: number, healed: number}>}
 */
export async function applyToActor(actor, { amount = 0, heal = 0, source = "", card = null } = {}) {
  if (!["character", "npc"].includes(actor?.type)) return { damage: 0, healed: 0 };
  const base = actor.type === "npc" ? "system.pv" : "system.attributes.pv";
  const pv = foundry.utils.getProperty(actor, base);
  if (heal > 0 && !(amount > 0)) {
    const value = Math.min(pv.max, pv.value + heal);
    await updateActor(actor, { [`${base}.value`]: value });
    // Back on his feet: no longer unconscious nor bleeding
    if (pv.value <= 0 && value > 0) await clearDying(actor);
    return { damage: 0, healed: value - pv.value };
  }
  let damage = Math.max(0, amount);
  // Effects that absorb damage first (a barrier of 100 points), then those that end when hit
  for (const effect of actor.effects.filter(e => (e.flags?.[SYSTEM]?.absorb ?? 0) > 0 && e.active)) {
    if (!damage) break;
    const pool = effect.flags[SYSTEM].absorb;
    const taken = Math.min(pool, damage);
    damage -= taken;
    const { deleteEffects } = await import("./effects.mjs");
    if (pool - taken <= 0) await deleteEffects(actor, [effect.id]);
    else {
      const { updateEffect } = await import("./effects.mjs");
      await updateEffect(actor, effect.id, { [`flags.${SYSTEM}.absorb`]: pool - taken });
    }
  }
  if (damage > 0) {
    const ending = actor.effects.filter(e => e.flags?.[SYSTEM]?.consumeOn === "damageTaken" && e.active).map(e => e.id);
    if (ending.length) { const { deleteEffects } = await import("./effects.mjs"); await deleteEffects(actor, ending); }
  }
  const fromTemp = Math.min(pv.temp ?? 0, damage);
  const toPv = damage - fromTemp;
  const before = pv.value;
  const after = before - toPv;
  await updateActor(actor, { [`${base}.temp`]: (pv.temp ?? 0) - fromTemp, [`${base}.value`]: after });
  if ((before > 0) && (after <= 0)) await onFall(actor, { damage, source, card });
  return { damage, healed: 0 };
}

/** Remove the conditions of falling. */
async function clearDying(actor) {
  const ids = actor.effects.filter(e => e.flags?.[SYSTEM]?.fall).map(e => e.id);
  if (ids.length) {
    const { deleteEffects } = await import("./effects.mjs");
    await deleteEffects(actor, ids);
  }
}

/** Falling to 0 PV or less. */
async function onFall(actor, { damage, source, card }) {
  const traits = actor.system.traits ?? {};
  const fall = [];
  if (actor.type === "character") {
    // Nem morto (bushi): in resolução, still standing
    const standing = traits.nemMorto && actor.effects.some(e => e.flags?.[SYSTEM]?.key === "resolucao" && e.active);
    if (!standing) {
      for (const id of ["inconsciente", "sangrando"]) {
        fall.push({
          name: game.i18n.localize(`IJ.Condition.${id}`), img: CONFIG.statusEffects.find(s => s.id === id)?.img,
          statuses: [id], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS, flags: { [SYSTEM]: { condition: id, fall: true } }
        });
      }
    }
  } else {
    fall.push({ name: game.i18n.localize("EFFECT.StatusDead"), img: "icons/svg/skull.svg", statuses: ["dead"], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS, flags: { [SYSTEM]: { fall: true } } });
  }
  if (fall.length) await createEffects(actor, fall);
  // Reactions of the moment (Duro de Matar, Demônio ninja, Determinação Honrada...)
  const { offerReactions } = await import("./reactions.mjs");
  await offerReactions(actor, "dropToZero", { damage, source });
  // Allies who answer a fallen friend (Vingança of the yakuza): against whoever dropped him
  const fallenToken = actor.getActiveTokens?.()[0];
  if (fallenToken && canvas?.ready) {
    for (const token of canvas.tokens.placeables) {
      const ally = token.actor;
      if (!ally || ally === actor || token.document.disposition !== fallenToken.document.disposition) continue;
      if ((ally.system?.traits?.reactions ?? []).some(r => r.on === "allyDown")) {
        await offerReactions(ally, "allyDown", { attacker: card?.attacker ?? null, fallen: actor.uuid, name: actor.name });
      }
    }
  }
  Hooks.callAll("imperiodejade.fell", actor, { damage, source, card });
}

/** Who a damage card goes to: the hits of its attack, else the user's targets, else the controlled tokens. */
export function cardTargets(message) {
  const card = message?.flags?.[SYSTEM]?.damage;
  const byUuid = uuids => uuids.map(u => fromUuidSync(u)).map(d => d?.actor ?? d).filter(a => a?.system);
  if (card?.targets?.length) return byUuid(card.targets);
  const targets = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
  if (targets.length) return targets;
  const controlled = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
  if (controlled.length) return controlled;
  return game.user.character ? [game.user.character] : [];
}

/**
 * The "apply" button of a damage card.
 * @param {ChatMessage} message
 * @param {object} [options]
 * @param {boolean|null} [options.half]  true = they passed the save (half), null = look for their saves
 */
export async function applyCard(message, { half = null } = {}) {
  const card = message.flags?.[SYSTEM]?.damage;
  if (!card) return;
  const actors = cardTargets(message);
  if (!actors.length) return ui.notifications.warn(L("IJ.Chat.noTarget"));
  const lines = [];
  for (const actor of actors) {
    const result = await computeDamage(actor, card, { half });
    const applied = await applyToActor(actor, { amount: result.amount, heal: result.heal, source: message.id, card });
    lines.push({ name: actor.name, damage: applied.damage, healed: applied.healed, notes: result.notes });
    // Retaliation: Sangue Ácido, armaduras gélidas (melee hits that dealt damage)
    if (card.melee && card.attacker && (applied.damage > 0)) await retaliate(actor, await fromUuid(card.attacker));
  }
  await postApplied(message, lines, card);
}

/** A short card saying what each target took. */
async function postApplied(message, lines, card) {
  const body = lines.map(l => {
    const what = l.healed ? game.i18n.format("IJ.Chat.healedNote", { name: l.name, n: l.healed })
      : game.i18n.format("IJ.Chat.damagedNote", { name: l.name, n: l.damage });
    return `<li>${foundry.utils.escapeHTML(what)}${l.notes.length ? ` <span class="ij-note">(${foundry.utils.escapeHTML(l.notes.join("; "))})</span>` : ""}</li>`;
  }).join("");
  return ChatMessage.create({
    speaker: message.speaker,
    content: `<div class="imperiodejade ij-card ij-card--applied"><ul class="ij-applied">${body}</ul></div>`,
    flags: { [SYSTEM]: { kind: "applied" } }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

/** The target's retaliation traits hit the attacker. */
async function retaliate(target, attacker) {
  if (!attacker) return;
  for (const entry of target.system.traits?.retaliate ?? []) {
    const formula = foundry.dice.Roll.defaultImplementation.replaceFormulaData(String(entry.formula ?? "1d4"), entry._data ?? target.getRollData(), { missing: "0" });
    const roll = await new Roll(formula).evaluate();
    const part = { amount: roll.total, single: roll.total, type: entry.type ?? "", physical: isPhysical(entry.type) };
    const result = await computeDamage(attacker, { parts: [part], magic: true });
    await applyToActor(attacker, { amount: result.amount });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: target }),
      content: `<div class="imperiodejade ij-card ij-card--applied"><p>${foundry.utils.escapeHTML(game.i18n.format("IJ.Auto.retaliation", {
        name: entry.label ?? target.name, target: attacker.name, n: result.amount, type: entry.type ?? "" }))}</p></div>`,
      rolls: [roll]
    });
  }
}
