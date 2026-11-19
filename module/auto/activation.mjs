/**
 * Using an ability, feat, item or jutsu with automation (`system.auto.activation`):
 *   pick the variant and the PM to spend → pay (PM, uses, Honor) → effects on the user → effects on the targets
 *   (or a save button that applies them to whoever fails) → the card, with buttons for attack, damage and save.
 *
 * Activation spec (all optional):
 *   cost, variable { min, max, label, costPer }, action, uses { max, per }, duration { value, unit },
 *   self { changes, traits, rollOptions, statuses, key, duration },
 *   tempPv, heal, healTargets, restore { pv, pm },
 *   targets { who: "allies"|"enemies"|"any", includeSelf, changes, traits, rollOptions, conditions, duration,
 *             save { type, dc }, variants: [{ when, ...overrides }] },
 *   save { type, dc, half, onFail { conditions, changes, traits }, onSuccess {...} },
 *   damage { formula, type, healing, magic }, attack { type, bonus },
 *   honorViolation: "leve"|"moderada"|"severa"|"extrema", note,
 *   options: [{ id, label, option, minLevel, minRank, ...any key above }]
 */
import { SYSTEM, dataFor, evaluate, evaluateInt, resolveFormula, inactiveReason, situation, chosen, norm, matches } from "./context.mjs";
import { askActivation } from "./dialog.mjs";
import { effectData, createEffects, deleteEffects, applyCondition, removeCondition, grantTempPv, usesLeft, spendUse, durationLabel, updateActor, forActor } from "./effects.mjs";
import { rollDamage } from "./damage.mjs";

const L = key => game.i18n.localize(key);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const ACTIONS = { livre: "livre", padrao: "padrão", movimento: "movimento", completa: "completa", reacao: "reação" };

/* -------------------------------------------- */
/*  The spec                                    */
/* -------------------------------------------- */

/** The variants an item offers right now (chosen on the item, level reached). */
export function availableOptions(item, data = dataFor(item)) {
  const act = item.system.auto?.activation;
  return (act?.options ?? []).filter(o => chosen(item, o.option) && (!o.minLevel || (data.classe ?? 1) >= o.minLevel)
    && (!o.minRank || (data.rank ?? 1) >= o.minRank) && (!o.honorMin || (item.actor?.system?.abilities?.hon?.total ?? 99) >= o.honorMin));
}

/** The activation of an item with a variant applied over it. */
export function specFor(item, optionId = null) {
  const act = foundry.utils.deepClone(item.system.auto?.activation ?? {});
  const options = act.options ?? [];
  delete act.options;
  const opt = optionId ? options.find(o => o.id === optionId) : null;
  if (!opt) return act;
  const { id, label, option, minLevel, minRank, honorMin, ...over } = foundry.utils.deepClone(opt);
  // A variant's targets/self/save replace the base ones key by key
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && act[k] && typeof act[k] === "object") act[k] = { ...act[k], ...v };
    else act[k] = v;
  }
  act.optionLabel = label;
  act.optionId = id;
  return act;
}

/** The PM cost after the actor's rules (Poder Salvador −1 in danger, Hora do Pagamento ×2). */
export function adjustCost(actor, cost, { kind = "power", ctx = {} } = {}) {
  if (!actor || !(cost > 0)) return Math.max(0, cost);
  let out = cost;
  let mult = 1;
  for (const rule of actor.system.traits?.costMods ?? []) {
    if (rule.kinds && !rule.kinds.includes(kind)) continue;
    if (rule.when && !situation(rule.when, actor)) continue;
    if (rule.filter && !matches(rule.filter, ctx)) continue;
    if (rule.multiply) mult = Math.max(mult, Number(rule.multiply) || 1);
    else out += evaluate(rule.value ?? 0, rule._data ?? {});
  }
  return Math.max(0, Math.floor(out * mult));
}

/* -------------------------------------------- */
/*  Using an item                               */
/* -------------------------------------------- */

/**
 * Use an item's activation. Returns the chat message (or null when cancelled).
 * @param {Item} item
 * @param {object} [options]
 * @param {Event} [options.event]
 */
export async function useItem(item, { event = null, choice = undefined, spent = undefined } = {}) {
  const actor = item.actor;
  const auto = item.system.auto ?? {};
  if (!auto.activation) return null;
  // A consumable gear (or one marked anywhere) works from the backpack
  const anywhere = !!(auto.activation.anywhere || auto.activation.consume);
  let why = actor ? inactiveReason(item) : "";
  if (anywhere && why === "unequipped") why = "";
  if (auto.activation.consume && ((item.system.quantity ?? 1) <= 0)) return ui.notifications.warn(game.i18n.format("IJ.Consumable.empty", { name: item.name }));
  if (why === "honor") return ui.notifications.warn(game.i18n.format("IJ.Power.honorTooLow", { name: item.name, n: Math.max(item.system.honorMin ?? 0, auto.requires?.honorMin ?? 0) }));
  if (why === "armor" || why === "shield") return ui.notifications.warn(game.i18n.format("IJ.Auto.needsNoArmor", { name: item.name }));
  if (why === "unequipped") return ui.notifications.warn(game.i18n.format("IJ.Auto.needsEquipped", { name: item.name }));

  let data = dataFor(item);
  const left = usesLeft(item, data);
  if (left === 0) return ui.notifications.warn(game.i18n.format("IJ.Auto.noUses", { name: item.name }));

  // Variant and variable PM
  const act = auto.activation;
  const opts = availableOptions(item, data);
  if ((act.options?.length) && !opts.length) return ui.notifications.warn(game.i18n.format("IJ.Auto.noOptions", { name: item.name }));
  let optionId = opts.length === 1 ? opts[0].id : null;
  const variable = act.variable ? {
    min: evaluateInt(act.variable.min ?? 1, data), max: Math.max(0, evaluateInt(act.variable.max ?? "@pmLimit", data)),
    label: act.variable.label ?? "PM"
  } : null;
  // Macros (and tests) can pass the variant and the PM; otherwise the dialog asks
  let spentValue = spent ?? (variable ? variable.min : 0);
  if (choice !== undefined) optionId = choice;
  else if ((opts.length > 1) || (variable && spent === undefined)) {
    const answer = await askActivation(item.name, opts.length > 1 ? opts.map(o => ({ id: o.id, label: o.label, hint: o.hint ?? "" })) : [], variable);
    if (!answer) return null;
    optionId = answer.choice ?? optionId;
    spentValue = answer.spent;
  }
  spent = variable ? Math.clamp(spentValue, variable.min, variable.max) : 0;
  const spec = specFor(item, optionId);
  data = dataFor(item, { spent });

  // Pay: PM (with the actor's cost rules, within the PM limit), uses, Honor
  // Without its own cost, the item's cost counts (not for a variable cost, which is all in the PM chosen)
  const base = evaluate(spec.cost ?? (spec.variable ? 0 : (item.system.cost ?? 0)), data) + (spec.variable ? spent * (spec.variable.costPer ?? 1) : 0);
  const cost = adjustCost(actor, base, { kind: "power", ctx: { item } });
  if (actor && cost > 0) {
    if (spec.variable && cost > actor.pmLimit) return ui.notifications.warn(game.i18n.format("IJ.Auto.overLimit", { n: cost, limit: actor.pmLimit }));
    if (!(await actor.spendPm(cost))) return null;
  }
  if (left !== null) await spendUse(item);
  if (spec.honorViolation && actor?.type === "character") await actor.honorViolation(spec.honorViolation);

  const results = await perform(item, spec, data, { cost, optionId, spent });
  // One unit used up (holy water, a bomb, a draught of saquê)
  if ((spec.consume || act.consume) && (item.type !== "consumable") && ("quantity" in item.system)) {
    await item.update({ "system.quantity": Math.max(0, (item.system.quantity ?? 1) - 1) });
  }
  return postCard(item, spec, data, { cost, optionId, spent, results, left: left === null ? null : left - 1 });
}

/** Whether an item's effects are magic (dispel removes them). */
const isMagic = item => (item?.type === "jutsu") || !!item?.system?.magic;

/** A number that may be rolled ("5d4" temporary PV, "1d4" rounds). */
export async function rollValue(value, data) {
  if ((value === null) || (value === undefined) || (value === "")) return 0;
  const formula = resolveFormula(value, data);
  if (/\d*d\d/i.test(formula)) return (await new Roll(formula).evaluate()).total;
  return evaluateInt(value, data);
}

/** A duration whose value is rolled now (1d4 rodadas → 3 rodadas). */
async function fixDuration(duration, data) {
  if (!duration || (typeof duration.value !== "string") || !/d\d/i.test(duration.value)) return duration;
  return { ...duration, value: await rollValue(duration.value, data) };
}

/** Descriptors of a jutsu that an immunity can stop ("sono", "medo", "encantamento"...). */
function descriptorTags(item) {
  if (item?.type !== "jutsu") return [];
  return String(item.system.descriptors ?? "").split(/[,;/]/).map(t => norm(t)).filter(Boolean);
}

/**
 * Everything that happens on use (also used by jutsus, which pay their own way).
 * @returns {Promise<{applied: string[]}>} Lines for the card
 */
export async function perform(item, spec, data, { optionId = null, spent = 0 } = {}) {
  const actor = item.actor;
  const lines = [];
  if (!actor) return { applied: lines };

  // On the user
  if (spec.self) {
    const self = spec.self;
    // Using it again replaces the effect it made before (Grito de Kiai twice doesn't stack)
    const old = sameSource(actor, item, spec.optionId);
    if (old.length) await deleteEffects(actor, old);
    const tempPv = spec.tempPv ? await rollValue(spec.tempPv, data) : 0;
    spec._tempPv = tempPv;
    const duration = await fixDuration(self.duration ?? spec.duration, data);
    if (self.changes?.length || self.traits || self.rollOptions?.length || self.statuses?.length || self.turnStart || self.key || tempPv
      || self.aura || self.reactions?.length || self.consumeOn || self.absorb) {
      await createEffects(actor, [effectData({
        ...self, changes: forActor(self.changes ?? [], actor), magic: isMagic(item),
        name: spec.optionLabel ? `${item.name}: ${spec.optionLabel}` : item.name, img: item.img, origin: item.uuid,
        duration, tempPv: (tempPv && duration) ? tempPv : 0, optionKey: spec.optionId ?? null
      }, data)]);
    }
    for (const id of self.removeConditions ?? []) await removeCondition(actor, id);
    for (const id of self.conditions ?? []) await applyCondition(actor, id.id ?? id, { duration: await fixDuration(id.duration ?? duration, data), origin: item.uuid, source: item.name, data });
    lines.push(game.i18n.format("IJ.Auto.appliedSelf", { name: actor.name }));
  }
  if (spec.tempPv) {
    const n = spec._tempPv ?? await rollValue(spec.tempPv, data);
    await grantTempPv(actor, n);
    lines.push(game.i18n.format("IJ.Auto.tempPv", { n }));
  }
  if (spec.restore) {
    const update = {};
    const isNpc = actor.type === "npc";
    const pv = isNpc ? actor.system.pv : actor.system.attributes.pv;
    const pm = isNpc ? actor.system.pm : actor.system.attributes.pm;
    if (spec.restore.pv) {
      const n = evaluateInt(spec.restore.pv, data);
      update[isNpc ? "system.pv.value" : "system.attributes.pv.value"] = Math.min(pv.max, pv.value + n);
      lines.push(game.i18n.format("IJ.Auto.restoredPv", { n: Math.min(pv.max, pv.value + n) - pv.value }));
    }
    if (spec.restore.pm) {
      const n = evaluateInt(spec.restore.pm, data);
      update[isNpc ? "system.pm.value" : "system.attributes.pm.value"] = Math.min(pm.max, pm.value + n);
      lines.push(game.i18n.format("IJ.Auto.restoredPm", { n: Math.min(pm.max, pm.value + n) - pm.value }));
    }
    if (Object.keys(update).length) await actor.update(update);
  }
  if (spec.heal && !spec.healTargets) {
    const { applyToActor } = await import("./damage.mjs");
    const roll = await new Roll(resolveFormula(spec.heal, data) || "0").evaluate();
    const r = await applyToActor(actor, { heal: roll.total });
    lines.push(game.i18n.format("IJ.Auto.healed", { name: actor.name, n: r.healed }));
  }

  // On the targets, right away when there is no save and no attack (with an attack, on the creatures it hits)
  if (spec.targets && !spec.targets.save && !spec.attack) {
    const n = await applyTargets(item, spec, data);
    if (n !== null) lines.push(game.i18n.format("IJ.Auto.appliedTargets", { n }));
  }
  return { applied: lines };
}

/** The temporary effects an item (and one of its variants) already put on an actor: using it again replaces them. */
function sameSource(actor, item, optionKey = null) {
  return actor.effects.filter(e => (e.origin === item.uuid) && e.flags?.[SYSTEM]?.temp
    && ((e.flags[SYSTEM].optionKey ?? null) === (optionKey ?? null))).map(e => e.id);
}

/** Actors the targets block reaches: the user's targets (filtered by side) and maybe the user. */
export function targetActors(actor, targets = {}) {
  const myToken = actor?.getActiveTokens?.()[0]?.document ?? null;
  const myDisp = myToken?.disposition ?? (actor?.type === "character" ? 1 : -1);
  const out = [];
  for (const token of game.user.targets ?? []) {
    const a = token.actor;
    if (!a) continue;
    // Your own token, marked on purpose: "a criatura tocada, que pode ser você"
    if (a === actor) { if (targets.who !== "enemies" && !out.includes(a)) out.push(a); continue; }
    const disp = token.document.disposition;
    if (targets.who === "allies" && disp !== myDisp) continue;
    if (targets.who === "enemies" && disp === myDisp) continue;
    out.push(a);
  }
  if (targets.includeSelf && actor && !out.includes(actor)) out.unshift(actor);
  return out;
}

/** Apply a targets block (changes, traits, conditions) to an actor. */
export async function applyTargetBlock(item, block, data, actor, source = item.name, { duration = null, optionKey = null } = {}) {
  // Variants by who the target is (Fortaleza da Honra: double for the honored); the ability's duration by default
  let spec = { ...block, duration: block.duration ?? duration };
  for (const variant of block.variants ?? []) {
    if (situation(variant.when, item.actor, actor)) spec = { ...spec, ...variant };
  }
  spec.duration = await fixDuration(spec.duration, data);
  for (const id of spec.removeConditions ?? []) await removeCondition(actor, id);
  if (spec.changes?.length || spec.traits || spec.rollOptions?.length || spec.statuses?.length || spec.turnStart
    || spec.reactions?.length || spec.consumeOn || spec.absorb) {
    const old = sameSource(actor, item, optionKey);
    if (old.length) await deleteEffects(actor, old);
    // A threat gets the same buff or debuff on its own fields
    const changes = forActor(spec.changes ?? [], actor);
    await createEffects(actor, [effectData({ ...spec, changes, name: source, img: item.img, origin: item.uuid, duration: spec.duration, optionKey, magic: isMagic(item) }, data)]);
  }
  for (const c of spec.conditions ?? []) {
    await applyCondition(actor, c.id ?? c, { duration: await fixDuration(c.duration ?? spec.duration, data), origin: item.uuid, source, data, tags: descriptorTags(item) });
  }
  if (spec.damage) {
    // Direct damage of an effect that hit (no roll of its own on the card)
    const { applyToActor } = await import("./damage.mjs");
    const roll = await new Roll(resolveFormula(spec.damage, data) || "0").evaluate();
    await applyToActor(actor, { amount: roll.total });
  }
  if (spec.pmLoss) {
    const pm = actor.type === "npc" ? actor.system.pm : actor.system.attributes.pm;
    await updateActor(actor, { [actor.type === "npc" ? "system.pm.value" : "system.attributes.pm.value"]: Math.max(0, pm.value - evaluateInt(spec.pmLoss, data)) });
  }
  await applyOutcomeExtras(actor, spec, data);
}

/** The heavier outcomes of a block: ability damage, negative levels, PV set, death, dispel. */
export async function applyOutcomeExtras(actor, spec, data = {}) {
  if (!spec) return;
  const extras = await import("./extras.mjs");
  if (spec.dispel) await extras.dispel(actor);
  if (spec.abilityDamage) await extras.applyAbilityDamage(actor, spec.abilityDamage, data);
  if (spec.negativeLevels) await extras.applyNegativeLevels(actor, spec.negativeLevels, data);
  if (spec.kill) await extras.kill(actor);
  else if ((spec.setPv !== undefined) && (spec.setPv !== null)) await extras.setPv(actor, Math.floor(evaluate(spec.setPv, data)));
}

/** Apply the spec's targets block to the current targets. Returns how many, or null when nobody is targeted. */
export async function applyTargets(item, spec, data) {
  const actors = targetActors(item.actor, spec.targets);
  if (!actors.length) return null;
  const label = spec.optionLabel ? `${item.name}: ${spec.optionLabel}` : item.name;
  for (const a of actors) await applyTargetBlock(item, spec.targets, data, a, label, { duration: spec.duration ?? null, optionKey: spec.optionId ?? null });
  return actors.length;
}

/* -------------------------------------------- */
/*  The card                                    */
/* -------------------------------------------- */

/** The DC of a save in a spec. */
export const saveDc = (save, data) => (save?.dc === undefined ? null : evaluateInt(save.dc, data));

/** Buttons the card needs. */
export function cardButtons(item, spec, data, { extra = 0 } = {}) {
  const actor = item.actor;
  const buttons = [];
  if (spec.attack && actor) {
    const label = spec.attack.weapon ? L("IJ.Auto.weaponStrike") : L(`IJ.Jutsu.attack.${spec.attack.type ?? "corpo"}`);
    buttons.push({ ijAction: "autoAttack", label, icon: "fa-solid fa-crosshairs", actor: actor.uuid, item: item.id });
  }
  if (spec.damage?.formula && actor && !spec.attack?.weapon && (spec.damage.button !== false)) {
    const formula = resolveFormula(spec.damage.formula, data);
    const label = spec.damage.healing ? game.i18n.format("IJ.Jutsu.healButton", { f: formula })
      : game.i18n.format("IJ.Jutsu.damageButton", { f: formula, type: spec.damage.type ?? "" });
    buttons.push({ ijAction: "autoDamage", label, icon: spec.damage.healing ? "fa-solid fa-heart" : "fa-solid fa-burst", actor: actor.uuid, item: item.id });
    if (spec.damage.alt) {
      buttons.push({ ijAction: "autoDamage", alt: "1", label: `${spec.damage.alt.label ?? ""}: ${formula}`, icon: "fa-solid fa-burst", actor: actor.uuid, item: item.id });
    }
  }
  const save = spec.save ?? spec.targets?.save;
  if (save?.type) {
    const dc = saveDc(save, data);
    buttons.push({
      ijAction: "save", save: save.type, dc, source: item.name, icon: "fa-solid fa-shield-halved",
      label: game.i18n.format("IJ.Jutsu.saveButton", { save: L(CONFIG.IJ.SAVES[save.type].label), dc })
    });
  }
  // A second (third...) save of another type, each with its own outcome
  (spec.extraSaves ?? []).forEach((s, i) => {
    if (!s?.type) return;
    const dc = saveDc({ dc: s.dc ?? save?.dc ?? data.dc ?? 15 }, data);
    buttons.push({
      ijAction: "save", save: s.type, dc, source: s.label ?? item.name, index: i + 1, icon: "fa-solid fa-shield-halved",
      label: `${s.label ? `${s.label}: ` : ""}${game.i18n.format("IJ.Jutsu.saveButton", { save: L(CONFIG.IJ.SAVES[s.type].label), dc })}`
    });
  });
  if (spec.targets && !spec.targets.save) {
    buttons.push({ ijAction: "autoTargets", label: L("IJ.Auto.applyTargets"), icon: "fa-solid fa-bullseye", actor: actor?.uuid, item: item.id });
  }
  if (spec.heal && spec.healTargets) {
    buttons.push({ ijAction: "autoHeal", label: game.i18n.format("IJ.Jutsu.healButton", { f: resolveFormula(spec.heal, data) }), icon: "fa-solid fa-heart", actor: actor?.uuid, item: item.id });
  }
  return buttons;
}

/** The healing button of a card (heal on the targets): a healing card the player applies to them. */
export async function onHeal(message) {
  const src = await sourceOf(message);
  if (!src) return ui.notifications.warn(L("IJ.Chat.itemGone"));
  const { actor, item, spec, data } = src;
  return rollDamage({
    actor, title: item.name, subtitle: L("IJ.Chat.healing"), kanji: item.type === "jutsu" ? "術" : "能",
    parts: [{ formula: resolveFormula(spec.heal, data), noCrit: true }],
    healing: true, magic: item.type === "jutsu" || !!spec.magic, link: { source: message.id }
  });
}

/** Post the card of a use. */
export async function postCard(item, spec, data, { cost = 0, optionId = null, spent = 0, results = { applied: [] }, left = null, kanji = "能", kind = "power", subtitle = null, tags = null, extraBody = "", extraButtons = [], flags = {} } = {}) {
  const actor = item.actor;
  const sys = item.system;
  const { infoCard } = await import("../dice/rolls.mjs");
  const allTags = tags ?? [
    cost ? `${cost} PM` : "",
    ACTIONS[norm(spec.action ?? sys.action)] ?? spec.action ?? sys.action ?? "",
    spec.duration ? durationLabel(spec.duration, data) : "",
    left !== null ? game.i18n.format("IJ.Auto.usesLeft", { n: left }) : "",
    sys.honorMin ? game.i18n.format("IJ.Power.honorTag", { n: sys.honorMin }) : ""
  ].filter(Boolean);
  const applied = results.applied?.length ? `<ul class="ij-card-applied">${results.applied.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  const note = spec.note ? `<p class="ij-card-note">${esc(spec.note)}</p>` : "";
  const body = (spec.optionLabel ? `<p class="ij-card-option"><strong>${esc(spec.optionLabel)}</strong></p>` : "")
    + applied + note + extraBody + await item.enrichedDescription();
  return infoCard({
    actor, kind, kanji,
    title: item.name,
    subtitle: subtitle ?? (item.type === "feat" ? L(CONFIG.IJ.FEAT_CATEGORIES[sys.category] ?? "") : (sys.originName || L(CONFIG.IJ.ABILITY_SOURCES?.[sys.origin] ?? ""))),
    tags: allTags,
    buttons: [...cardButtons(item, spec, data), ...extraButtons],
    body,
    flags: { source: { actor: actor?.uuid ?? null, item: item.id, option: optionId, spent }, ...flags }
  });
}

/* -------------------------------------------- */
/*  Card buttons                                */
/* -------------------------------------------- */

/** The item, spec and data a card was made with. */
export async function sourceOf(message) {
  const src = message?.flags?.[SYSTEM]?.source;
  if (!src?.actor) return null;
  const actor = await fromUuid(src.actor);
  const item = actor?.items.get(src.item);
  if (!item) return null;
  const spec = (item.type === "jutsu" && message.flags[SYSTEM].jutsuSpec) ? message.flags[SYSTEM].jutsuSpec : specFor(item, src.option);
  const data = dataFor(item, { spent: src.spent ?? 0, ...(message.flags[SYSTEM].jutsuData ?? {}) });
  return { actor, item, spec, data };
}

/** "Aplicar aos alvos" of a card. */
export async function onApplyTargets(message) {
  const src = await sourceOf(message);
  if (!src) return ui.notifications.warn(L("IJ.Chat.itemGone"));
  const n = await applyTargets(src.item, src.spec, src.data);
  if (n === null) return ui.notifications.warn(L("IJ.Auto.noTargets"));
  ui.notifications.info(game.i18n.format("IJ.Auto.appliedTargets", { n }));
}

/** A save rolled from a card: apply what failing (or passing) brings. */
export async function onSaveResult(message, actor, success, index = 0) {
  const src = await sourceOf(message);
  if (!src) return;
  const { item, spec, data } = src;
  // An extra save of the card: its own outcome only
  if (index > 0) {
    const extra = spec.extraSaves?.[index - 1];
    const out = success ? extra?.onSuccess : extra?.onFail;
    if (out) await applyTargetBlock(item, out, data, actor, extra.label ?? item.name, { duration: spec.duration ?? null, optionKey: `${spec.optionId ?? ""}x${index}` });
    return;
  }
  const label = spec.optionLabel ? `${item.name}: ${spec.optionLabel}` : item.name;
  const opts = { duration: spec.duration ?? null, optionKey: spec.optionId ?? null };
  if (spec.targets?.save && !success) await applyTargetBlock(item, spec.targets, data, actor, label, opts);
  const outcome = success ? spec.save?.onSuccess : spec.save?.onFail;
  if (outcome) await applyTargetBlock(item, outcome, data, actor, label, opts);
}

/**
 * A save asked by a hit (Ataque Atordoante: Fortitude or stunned): failing applies the option's onHit outcome.
 * @param {ChatMessage} attackMsg  The attack card
 */
export async function onHitSave(attackMsg, actor, success) {
  const atk = attackMsg.flags?.[SYSTEM]?.attack;
  // Only creatures the attack actually hit
  const hit = (atk?.targets ?? []).find(t => t.uuid === actor.uuid);
  if (atk?.targets?.length && !hit?.hit) return;
  for (const h of atk?.onHit ?? []) {
    if (!h.save?.type) continue;
    if (h.critOnly && atk?.targets?.length && !hit?.crit) continue;
    const outcome = success ? h.onSuccess : (h.onFail ?? { conditions: h.conditions ?? [], duration: h.duration });
    if (!outcome) continue;
    for (const c of outcome.conditions ?? []) {
      await applyCondition(actor, c.id ?? c, { duration: c.duration ?? outcome.duration ?? null, source: h.label });
    }
    if (outcome.changes?.length || outcome.traits) {
      await createEffects(actor, [effectData({ ...outcome, name: h.label, duration: outcome.duration })]);
    }
    await applyOutcomeExtras(actor, outcome, {});
    // Damage of the outcome (Mortal: +5d6 de vácuo for who passes)
    if (outcome.damage) {
      const { computeDamage, applyToActor, isPhysical } = await import("./damage.mjs");
      const formula = typeof outcome.damage === "string" ? outcome.damage : outcome.damage.formula;
      const type = typeof outcome.damage === "string" ? "" : (outcome.damage.type ?? "");
      const roll = await new Roll(formula).evaluate();
      const result = await computeDamage(actor, { parts: [{ amount: roll.total, single: roll.total, type, physical: isPhysical(type) }], magic: true });
      await applyToActor(actor, { amount: result.amount });
    }
  }
}

/** The damage button of a card (also the jutsus'). */
export async function onDamage(message, { alt = false } = {}) {
  const src = await sourceOf(message);
  if (!src) return ui.notifications.warn(L("IJ.Chat.itemGone"));
  const { actor, item, spec, data } = src;
  const dmg = spec.damage;
  const type = alt ? (dmg.alt?.type ?? dmg.type) : dmg.type;
  const formula = resolveFormula(message.flags[SYSTEM].damageFormula ?? dmg.formula, data);
  const save = spec.save ?? spec.targets?.save;
  // An attack rolled from this card decides who is hit (and a save can halve or cancel)
  const attackMsg = game.messages.contents.findLast(m => m.flags?.[SYSTEM]?.touchOf === message.id);
  const hits = attackMsg?.flags[SYSTEM].attack?.targets?.filter(t => t.hit).map(t => t.uuid) ?? [];
  return rollDamage({
    actor,
    title: item.name,
    subtitle: dmg.healing ? L("IJ.Chat.healing") : (type ?? ""),
    kanji: item.type === "jutsu" ? "術" : "能",
    parts: [{ formula, type, noCrit: true }, ...(dmg.extra ?? []).map(p => ({ formula: resolveFormula(p.formula, data), type: p.type ?? "", noCrit: true, label: p.label ?? "" }))],
    healing: !!dmg.healing && !(alt && dmg.alt?.harm),
    magic: dmg.magic ?? (item.type === "jutsu"),
    ignoreRd: (dmg.ignoreRd === "all") ? Infinity : (dmg.ignoreRd ?? message.flags[SYSTEM].ignoreRd ?? 0),
    maximize: !!message.flags[SYSTEM].maximize,
    link: { source: message.id, save: save?.type ?? null, half: !!save?.half, negate: !!save?.negate, targets: hits, perTarget: dmg.perTarget ?? null }
  });
}
