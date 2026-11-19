/**
 * Changing other people's actors: effects, conditions, PV and PM. A player can only change what they own, so what
 * touches someone else's actor goes to the active GM through the system socket.
 */
import { SYSTEM, evaluate, resolveFormula } from "./context.mjs";
import { blocks, conditionEffectData } from "./conditions.mjs";

const CHANNEL = `system.${SYSTEM}`;

/* -------------------------------------------- */
/*  Socket                                      */
/* -------------------------------------------- */

const HANDLERS = {
  async createEffects({ uuid, effects }) {
    const actor = await fromUuid(uuid);
    if (actor) await actor.createEmbeddedDocuments("ActiveEffect", effects);
  },
  async deleteEffects({ uuid, ids }) {
    const actor = await fromUuid(uuid);
    if (actor) await actor.deleteEmbeddedDocuments("ActiveEffect", ids.filter(id => actor.effects.has(id)));
  },
  async update({ uuid, update }) {
    const doc = await fromUuid(uuid);
    if (doc) await doc.update(update);
  },
  async updateEffect({ uuid, id, update }) {
    const actor = await fromUuid(uuid);
    const effect = actor?.effects.get(id);
    if (effect) await effect.update(update);
  }
};

/** Listen for the requests players send to the active GM. */
export function registerSocket() {
  game.socket.on(CHANNEL, async message => {
    if (!game.users.activeGM?.isSelf) return;
    const handler = HANDLERS[message?.action];
    if (handler) await handler(message.payload ?? {});
  });
}

/** Do it here when this user owns the document; otherwise ask the active GM. */
async function run(doc, action, payload) {
  if (doc.isOwner) return HANDLERS[action]({ uuid: doc.uuid, ...payload });
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("IJ.Auto.noGM"));
    return null;
  }
  game.socket.emit(CHANNEL, { action, payload: { uuid: doc.uuid, ...payload } });
  return true;
}

/** Update an effect of any actor (an absorb pool that shrinks), through the GM when needed. */
export const updateEffect = (actor, id, update) => run(actor, "updateEffect", { id, update });

/** Update any actor (PV, PM...), through the GM when needed. */
export const updateActor = (actor, update) => run(actor, "update", { update });

/** Create effects on any actor, through the GM when needed. */
export const createEffects = (actor, effects) => (effects?.length ? run(actor, "createEffects", { effects }) : null);

/** Delete effects from any actor, through the GM when needed. */
export const deleteEffects = (actor, ids) => (ids?.length ? run(actor, "deleteEffects", { ids }) : null);

/* -------------------------------------------- */
/*  Durations                                   */
/* -------------------------------------------- */

/**
 * Foundry duration data from the book's units. "rodada" lasts until the start of the turn of whoever was acting when
 * it was made; "cena" until the end of the combat (or the GM ends the scene); time units use the world clock.
 * @param {{value?: number|string, unit: string}|null} duration
 * @param {object} [data]  Roll data for a formula value
 */
export function durationData(duration, data = {}) {
  if (!duration?.unit) return undefined;
  const value = Math.max(1, Math.floor(evaluate(duration.value ?? 1, data, 1)));
  switch (duration.unit) {
    case "rodada": return { value, units: "rounds", expiry: "turnStart" };
    case "turno": return { value: 0, units: "rounds", expiry: "turnEnd" };
    case "cena": return { value: null, units: "seconds", expiry: "combatEnd" };
    case "minuto": return { value, units: "minutes", expiry: null };
    case "hora": return { value, units: "hours", expiry: null };
    case "dia": return { value, units: "days", expiry: null };
    default: return undefined;
  }
}

/** "1 rodada", "uma cena", "10 minutos" for the cards. */
export function durationLabel(duration, data = {}) {
  if (!duration?.unit) return "";
  const n = Math.max(1, Math.floor(evaluate(duration.value ?? 1, data, 1)));
  const key = (n > 1 && duration.unit !== "cena") ? `IJ.Duration.${duration.unit}Plural` : `IJ.Duration.${duration.unit}`;
  return game.i18n.format(key, { n });
}

/* -------------------------------------------- */
/*  Effects                                     */
/* -------------------------------------------- */

/**
 * Turn the automation's change list into active effect changes, with every formula already resolved to a number
 * (a buff keeps the value it had when it was made).
 * @param {Array<{key: string, value: *, mode?: string}>} changes
 * @param {object} data
 */
export function resolveChanges(changes = [], data = {}) {
  return changes.filter(c => c?.key).map(c => {
    const override = c.mode === "override";
    const numeric = typeof c.value !== "boolean" && !(typeof c.value === "string" && /^[a-z]+$/i.test(c.value));
    return {
      key: c.key,
      type: override ? "override" : "add",
      value: numeric ? evaluate(c.value, data) : c.value,
      phase: "initial",
      priority: null
    };
  });
}

/**
 * A threat's stat block has its own fields: the character fields an effect names become the threat's bonuses
 * (CA, saves, attack, damage); what a threat doesn't have (skills, movement) is left out.
 */
const NPC_KEYS = [
  [/^system\.attributes\.ca\.bonus$/, "system.bonus.ca"],
  [/^system\.attributes\.mods\.saves$/, "system.bonus.saves"],
  [/^system\.saves\.(fort|ref|von)\.bonus$/, "system.bonus.saves"],
  [/^system\.attributes\.mods\.attack$/, "system.bonus.attack"],
  [/^system\.attributes\.attack\.(melee|ranged)$/, "system.bonus.attack"],
  [/^system\.attributes\.attack\.damage$/, "system.bonus.damage"],
  [/^system\.attributes\.rd$/, "system.rdValue"],
  [/^system\.attributes\.negativeLevels$/, "system.negativeLevels"]
];
export function forActor(changes = [], actor) {
  if (actor?.type !== "npc") return changes;
  const seen = new Set();
  return changes.map(c => {
    const hit = NPC_KEYS.find(([re]) => re.test(c.key));
    if (!hit) return null;
    // Two character fields that are one field on a threat (melee and ranged attack; the three saves) count once
    const merged = /attack\.(melee|ranged)|saves\.(fort|ref|von)\.bonus/.test(c.key);
    if (merged && seen.has(hit[1])) return null;
    if (merged) seen.add(hit[1]);
    return { ...c, key: hit[1] };
  }).filter(Boolean);
}

/**
 * Build a temporary effect.
 * @param {object} spec
 * @param {string} spec.name
 * @param {string} [spec.img]
 * @param {Array} [spec.changes]       Automation changes (resolved here)
 * @param {object} [spec.traits]       Traits while the effect lasts (resistances, immunities...)
 * @param {Array} [spec.rollOptions]   Roll options while the effect lasts (resolved here)
 * @param {object} [spec.duration]     { value, unit }
 * @param {string} [spec.origin]       Uuid of the source item
 * @param {string} [spec.key]          A tag other rules can look for ("resolucao")
 * @param {object} [data]              Roll data of the source
 */
export function effectData(spec, data = {}) {
  const traits = spec.traits ? resolveTraitNumbers(spec.traits, data) : null;
  const rollOptions = (spec.rollOptions ?? []).map(o => resolveOptionNumbers(o, data));
  return {
    name: spec.name,
    img: spec.img || "icons/svg/aura.svg",
    origin: spec.origin ?? null,
    duration: durationData(spec.duration, data),
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    description: spec.description ?? "",
    system: { changes: resolveChanges(spec.changes, data) },
    statuses: spec.statuses ?? [],
    flags: {
      [SYSTEM]: {
        key: spec.key ?? null,
        optionKey: spec.optionKey ?? null,
        scene: spec.duration?.unit === "cena",
        temp: true,
        ...(traits ? { traits } : {}),
        ...(rollOptions.length ? { rollOptions } : {}),
        ...(spec.tempPv ? { tempPv: spec.tempPv } : {}),
        ...(spec.turnStart ? { turnStart: resolveTurnStart(spec.turnStart, data) } : {}),
        // An aura carried by this effect (copied onto whoever is within its radius), with its numbers fixed now
        ...(spec.aura ? { aura: resolveAura(spec.aura, data) } : {}),
        // Reactions while the effect lasts; it ends after the next roll of a kind; a pool of damage it absorbs
        ...(spec.reactions?.length ? { reactions: spec.reactions } : {}),
        ...(spec.consumeOn ? { consumeOn: spec.consumeOn } : {}),
        ...(spec.absorb ? { absorb: Math.floor(evaluate(spec.absorb, data)) } : {}),
        ...(spec.magic ? { magic: true } : {})
      }
    }
  };
}

/** An aura's spec with the source's numbers fixed (changes, traits, roll options, turn start). */
function resolveAura(aura, data) {
  return {
    radius: evaluate(aura.radius ?? 9, data),
    who: aura.who ?? "allies",
    includeSelf: !!aura.includeSelf,
    label: aura.label ?? "",
    changes: resolveChanges(aura.changes ?? [], data).map(c => ({ key: c.key, value: c.value, mode: c.type })),
    traits: aura.traits ? resolveTraitNumbers(aura.traits, data) : null,
    rollOptions: (aura.rollOptions ?? []).map(o => resolveOptionNumbers(o, data)),
    turnStart: aura.turnStart ? resolveTurnStart(aura.turnStart, data) : null,
    conditions: aura.conditions ?? []
  };
}

/** What an effect does at the start of each turn of its bearer, with the source's numbers fixed. */
function resolveTurnStart(ts, data) {
  return {
    damage: ts.damage ? resolveFormula(ts.damage, data) : "",
    type: ts.type ?? "",
    ignoreRd: ts.ignoreRd === "all" ? "all" : Math.floor(evaluate(ts.ignoreRd ?? 0, data)),
    heal: ts.heal ? resolveFormula(ts.heal, data) : "",
    save: ts.save?.type ? { type: ts.save.type, dc: Math.floor(evaluate(ts.save.dc ?? (data.dc ?? 15), data)) } : null,
    half: !!ts.half, negate: !!ts.negate, endOnSave: !!ts.endOnSave,
    conditions: ts.conditions ?? [],
    abilityDamage: ts.abilityDamage ? [ts.abilityDamage].flat().map(a => ({ ability: a.ability, formula: resolveFormula(a.formula ?? a.value ?? 1, data) })) : null
  };
}

function resolveTraitNumbers(traits, data) {
  const out = {};
  for (const [k, v] of Object.entries(traits)) {
    if (Array.isArray(v)) out[k] = v;
    else if (v && typeof v === "object") out[k] = Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, evaluate(vv, data)]));
    else if (typeof v === "boolean") out[k] = v;
    else out[k] = evaluate(v, data);
  }
  return out;
}

function resolveOptionNumbers(opt, data) {
  const out = { ...opt };
  for (const k of ["value", "attack", "ca", "critRange", "critMult", "ignoreRd"]) {
    if (out[k] !== undefined && out[k] !== "all") out[k] = evaluate(out[k], data);
  }
  if (out.damage) {
    // Dice stay dice; @references, rank and level of the source are fixed now (Dedo-duro grows with the yakuza)
    out.damage = resolveFormula(out.damage, data);
  }
  return out;
}

/**
 * Put a condition on an actor unless it is immune; through the GM when the actor isn't ours.
 * @returns {Promise<boolean>} Whether the condition was applied
 */
export async function applyCondition(actor, id, { duration = null, origin = null, source = "", data = {}, tags = [], flags = null } = {}) {
  if (!actor) return false;
  // A duration in dice is rolled now (1d4 rodadas atordoado)
  if ((typeof duration?.value === "string") && /\d*d\d/i.test(duration.value)) {
    duration = { ...duration, value: (await new Roll(resolveFormula(duration.value, data)).evaluate()).total };
  }
  if (blocks(actor, id, tags)) {
    ui.notifications.info(game.i18n.format("IJ.Auto.immuneTo", { name: actor.name, what: game.i18n.localize(`IJ.Condition.${id}`) }));
    return false;
  }
  // Same condition from the same source: refresh instead of stacking
  const old = actor.effects.filter(e => e.statuses.has(id) && (e.flags?.[SYSTEM]?.source === source)).map(e => e.id);
  if (old.length) await deleteEffects(actor, old);
  const effect = conditionEffectData(id, { duration, origin, source, durationData: durationData(duration, data) });
  if (flags) Object.assign(effect.flags[SYSTEM], flags);
  await createEffects(actor, [effect]);
  return true;
}

/** Remove a condition (all its effects) from an actor. */
export async function removeCondition(actor, id) {
  const ids = actor?.effects.filter(e => e.statuses.has(id)).map(e => e.id) ?? [];
  return deleteEffects(actor, ids);
}

/** Temporary PV don't stack: the larger amount stays (p. 77). */
export async function grantTempPv(actor, amount) {
  if (!actor || !(amount > 0)) return;
  const base = actor.type === "npc" ? "system.pv" : "system.attributes.pv";
  const current = foundry.utils.getProperty(actor, `${base}.temp`) ?? 0;
  if (amount <= current) return;
  await updateActor(actor, { [`${base}.temp`]: amount });
}

/* -------------------------------------------- */
/*  Uses                                        */
/* -------------------------------------------- */

/** How many uses an item has left (null = no limit). */
export function usesLeft(item, data = {}) {
  const uses = item.system.auto?.activation?.uses ?? item.system.auto?.uses;
  if (!uses) return null;
  const max = Math.max(0, Math.floor(evaluate(uses.max ?? 1, data, 1)));
  return Math.max(0, max - (item.system.spent ?? 0));
}

/** Spend one use. */
export const spendUse = item => item.update({ "system.spent": (item.system.spent ?? 0) + 1 });

/**
 * Give back the uses of a period: "rodada", "cena", "dia" (a rest restores day and scene uses), "sessao".
 * @param {Actor} actor
 * @param {string[]} periods
 */
export async function resetUses(actor, periods) {
  const updates = [];
  for (const item of actor?.items ?? []) {
    const per = item.system.auto?.activation?.uses?.per ?? item.system.auto?.uses?.per;
    if (per && periods.includes(per) && (item.system.spent ?? 0) > 0) updates.push({ _id: item.id, "system.spent": 0 });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/**
 * End the scene (GM): effects that last a scene end and the uses per scene come back, for every character and every
 * token on the current scene.
 */
export async function endScene() {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("IJ.Auto.gmOnly"));
  const actors = new Set(game.actors.filter(a => ["character", "npc"].includes(a.type)));
  for (const token of canvas?.scene?.tokens ?? []) if (token.actor && !token.actorLink) actors.add(token.actor);
  for (const actor of actors) {
    const ids = actor.effects.filter(e => e.flags?.[SYSTEM]?.scene).map(e => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    await resetUses(actor, ["cena", "rodada"]);
    // Honra Absoluta (samurai): the Reserve of Strength comes back every scene
    if (actor.type === "character" && actor.system.traits?.reservePerScene && actor.system.honor.reserveUsed) {
      await actor.update({ "system.honor.reserveUsed": false });
    }
  }
  ui.notifications.info(game.i18n.localize("IJ.Auto.sceneEnded"));
}
