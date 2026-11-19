/**
 * Attacks with automation: the options of the attacker (sneak attack, Ataque Poderoso, Poder Marcial...), PM paid,
 * the roll against the armor class of each target (with their conditions: prone, flat-footed...), threats and
 * criticals, what a hit brings (PM drained, a save against a condition) and the reactions of who was attacked.
 * The damage buttons of the card know the hits and the options chosen.
 */
import { SYSTEM, rollOptionsFor, isImmune, evaluate, resolveFormula, situation } from "./context.mjs";
import { askOptions, optionTag } from "./dialog.mjs";
import { conditionMods, attackVs, effectiveStatuses } from "./conditions.mjs";
import { adjustCost } from "./activation.mjs";
import { rollDamage, isPhysical } from "./damage.mjs";
import { reactionButtons } from "./reactions.mjs";
import { updateActor } from "./effects.mjs";

const { renderTemplate } = foundry.applications.handlebars;
const CARD = `systems/${SYSTEM}/templates/chat/roll-card.hbs`;
const L = key => game.i18n.localize(key);
const signed = n => { const v = Number(n) || 0; return v < 0 ? `−${Math.abs(v)}` : `+${v}`; };

/** The armor class of any actor, with its conditions (a helpless creature has CA 5 + size, p. 252). */
export function armorClassOf(actor) {
  if (!actor) return 10;
  if (actor.type === "character") return actor.system.ca?.total ?? 10;
  return actor.system.caTotal ?? actor.system.ca ?? 10;
}

/** The largest "guardAllies" penalty a bushi on the scene puts on attacks against this target (an ally of his). */
function guardPenalty(target) {
  const out = { value: 0, note: "" };
  if (!canvas?.ready || !target) return out;
  const targetToken = target.getActiveTokens?.()[0];
  if (!targetToken) return out;
  for (const token of canvas.tokens.placeables) {
    const guard = token.actor;
    if (!guard || guard === target) continue;
    const n = guard.system?.traits?.guardAllies ?? 0;
    if (!n || (token.document.disposition !== targetToken.document.disposition)) continue;
    if (n > out.value) Object.assign(out, { value: n, note: game.i18n.format("IJ.Auto.note.guard", { name: guard.name, n }) });
  }
  return out;
}

/** The actors of the user's targets (or the one given). */
function targetsOf(target) {
  if (target) return [target];
  return [...(game.user?.targets ?? [])].map(t => t.actor).filter(Boolean);
}

/**
 * Roll an attack.
 * @param {object} config
 * @param {Actor} config.actor
 * @param {Item|null} [config.weapon]
 * @param {boolean} [config.ranged]
 * @param {boolean} [config.unarmed]
 * @param {string} config.title
 * @param {string} [config.subtitle]
 * @param {number} config.bonus              Attack bonus before options
 * @param {Array} [config.parts]              Breakdown of the bonus
 * @param {number} [config.critRange]         Natural roll that threatens
 * @param {number} [config.critMult]
 * @param {object} [config.damage]            { formula, type } of a hit
 * @param {string} [config.kanji]
 * @param {Event} [config.event]
 * @param {Actor} [config.target]             Attack this one (a reaction), not the user's targets
 * @param {string} [config.reaction]          Name of the reaction that made this attack
 * @param {boolean} [config.touch]            Touch attack (jutsus)
 */
export async function attackRoll({ actor, weapon = null, ranged = false, unarmed = false, title, subtitle = "", bonus = 0, parts = [], critRange = 20, critMult = 2, damage = null, kanji = "刀", event = null, target = null, reaction = null, touch = false, extraFlags = {} }) {
  const targets = targetsOf(target);
  const ctx = { weapon, melee: !ranged, ranged, unarmed, target: targets[0] ?? null };
  const options = actor ? rollOptionsFor(actor, "attack", ctx) : [];

  // Options and situational modifier
  let picked = { selected: new Set(options.filter(o => o.locked || o.auto).map(o => o.id)), pm: {}, split: {}, bonus: 0 };
  const optional = options.filter(o => !o.locked);
  if ((event?.shiftKey || optional.length) && !event?.altKey) {
    picked = await askOptions(title, options, { pmLimit: actor?.pmLimit ?? Infinity });
    if (!picked) return null;
  }
  const chosenOpts = options.filter(o => picked.selected.has(o.id));

  // What the options add, and what they cost
  let attack = 0;
  let flatDamage = 0;
  const extraParts = [];
  let critRangeBonus = 0;
  let critMultBonus = 0;
  let ignoreRd = 0;
  let cost = 0;
  const optionParts = [];
  for (const o of chosenOpts) {
    let a = o.attack;
    let d = 0;
    if (o.pm && picked.pm[o.id]) {
      const n = picked.pm[o.id];
      cost += n;
      if (o.pm.split) { a += picked.split[o.id]?.attack ?? 0; d += picked.split[o.id]?.damage ?? 0; }
      else { a += n * o.pm.attack; d += n * o.pm.damage; }
      if (o.pm.cap !== null && o.pm.cap !== undefined) { a = Math.min(a, o.pm.cap); d = Math.min(d, o.pm.cap); }
    }
    cost += o.cost;
    attack += a;
    if (o.damage) {
      const n = Number(o.damage);
      if (Number.isFinite(n) && !o.damageType) flatDamage += n;
      else extraParts.push({ formula: o.damage, type: o.damageType || damage?.type || "", noCrit: o.noCrit || /d/i.test(o.damage), precision: o.precision, label: o.label });
    }
    flatDamage += d;
    critRangeBonus += o.critRange;
    critMultBonus += o.critMult;
    ignoreRd = Math.max(ignoreRd, o.ignoreRd);
    if (a) optionParts.push({ label: o.label, value: a });
  }
  cost = adjustCost(actor, cost, { kind: "power" });
  if (cost > 0 && actor) {
    if (cost > actor.pmLimit) return ui.notifications.warn(game.i18n.format("IJ.Auto.overLimit", { n: cost, limit: actor.pmLimit }));
    if (!(await actor.spendPm(cost))) return null;
  }

  // Conditions of a threat (a character's are already in its attack numbers)
  const extraBits = [];
  if (actor?.type === "npc") {
    const c = ranged ? (actor.system.attackMod?.ranged ?? 0) : (actor.system.attackMod?.melee ?? 0);
    if (c) extraBits.push({ label: L("IJ.Auto.conditions"), value: c });
    flatDamage += actor.system.attackMod?.damage ?? 0;
  }
  const situational = picked.bonus ? [{ label: L("IJ.Roll.situational"), value: picked.bonus }] : [];
  const allParts = [...parts, ...optionParts, ...extraBits, ...situational];
  const total = bonus + attack + extraBits.reduce((t, p) => t + p.value, 0) + picked.bonus;

  // An option that rolls two d20 and keeps the better
  const advantage = chosenOpts.some(o => o.best);
  const roll = await new Roll(`${advantage ? "2d20kh" : "1d20"} + ${total}`, actor?.getRollData?.() ?? {}).evaluate();
  const natural = roll.dice[0]?.total ?? 0;
  const threat = Math.max(2, critRange - critRangeBonus);
  const mult = critMult + critMultBonus + (actor?.system?.attributes?.critMult ?? 0);

  // Each target: hit, miss, critical
  const attackerStatuses = effectiveStatuses(actor);
  const results = [];
  for (const t of targets) {
    const vs = attackVs(t, { ranged });
    let ca = armorClassOf(t);
    let defense = "CA";
    const notes = [...vs.notes];
    // Touch attacks: the target resists with a Reflexos test (p. 230), unless an item lets it use the CA
    if (touch && !t.system?.traits?.touchUsesCa) {
      const ref = t.type === "npc" ? (t.system.saveTotals?.ref ?? t.system.saves?.ref ?? 0) : (t.system.saves?.ref?.total ?? 0);
      const refRoll = await new Roll(`1d20 + ${ref}`).evaluate();
      ca = refRoll.total;
      defense = L("IJ.Save.ref");
    }
    // Against an invisible attacker everyone is flat-footed (unless they can't be caught off guard)
    if (attackerStatuses.has("invisivel") && !effectiveStatuses(t).has("desprevenido") && !(t.system?.traits?.uncannyDodge > 0) && !t.system?.traits?.seeInvisible) {
      ca -= 4;
      notes.push(L("IJ.Condition.invisivel"));
    }
    // The target's defenses against this attacker (Honra Superior: +1 CA against lower Honor; +2 against monsters)
    for (const d of t.system?.traits?.defense ?? []) {
      if (d.when && !situation(d.when, t, actor)) continue;
      const v = Math.floor(evaluate(d.value ?? 0, d._data ?? {}));
      if (v) { ca += v; notes.push(`${d.label ?? d._itemName ?? ""} ${v > 0 ? "+" : ""}${v} CA`.trim()); }
    }
    // Alvo irresistível (bushi): attacks against the bushi's allies take a penalty while he can be seen
    const guard = guardPenalty(t);
    if (guard.value) notes.push(guard.note);
    const value = roll.total + vs.bonus - guard.value;
    let hit = (natural === 20) || ((natural !== 1) && (value >= ca));
    // Miss chance: a blind attacker or an invisible target (50%)
    let missRoll = null;
    const sees = actor?.system?.traits ?? {};
    const hidden = (effectiveStatuses(t).has("invisivel") && !sees.seeInvisible) || ((effectiveStatuses(t).has("incorporeo") || t.system?.traits?.incorporeal) && !sees.touchIncorporeal);
    const missChance = (attackerStatuses.has("cego") || hidden) ? 50 : (t.system?.traits?.missChance ?? 0);
    if (hit && missChance > 0) {
      missRoll = await new Roll("1d100").evaluate();
      if (missRoll.total <= missChance) { hit = false; notes.push(game.i18n.format("IJ.Auto.note.missChancePct", { n: missRoll.total, p: missChance })); }
    }
    const crit = hit && (natural >= threat) && !isImmune(t, "critico");
    results.push({
      uuid: t.uuid, name: t.name, ca, defense, value, hit, crit, notes: notes.join(", "),
      reactions: reactionButtons(t, "attacked", { attacker: actor?.uuid, total: roll.total, ranged })
    });
  }

  // What a hit brings: PM drained back to the attacker; a save against a condition
  const onHit = chosenOpts.filter(o => o.onHit).map(o => ({ ...o.onHit, label: o.label, data: o.data }));
  const anyHit = results.some(r => r.hit) || (!results.length);
  const hitLines = [];
  if (actor && results.some(r => r.hit)) {
    for (const h of onHit) {
      if (h.gainPm) {
        const n = Math.floor(evaluate(h.gainPm, h.data));
        const pm = actor.type === "npc" ? actor.system.pm : actor.system.attributes.pm;
        await updateActor(actor, { [actor.type === "npc" ? "system.pm.value" : "system.attributes.pm.value"]: Math.min(pm.max, pm.value + n) });
        hitLines.push(game.i18n.format("IJ.Auto.gainPm", { name: actor.name, n, what: h.label }));
      }
    }
  }
  if (actor && results.some(r => r.hit)) {
    const { applyCondition } = await import("./effects.mjs");
    for (const h of onHit) {
      if (h.save?.type || !h.conditions?.length) continue;
      for (const r of results.filter(x => x.hit)) {
        const doc = fromUuidSync(r.uuid);
        const t = doc?.actor ?? doc;
        for (const c of h.conditions) await applyCondition(t, c.id ?? c, { duration: c.duration ?? null, source: h.label });
      }
      hitLines.push(game.i18n.format("IJ.Auto.hitConditions", { what: h.label, list: h.conditions.map(c => game.i18n.localize(`IJ.Condition.${c.id ?? c}`)).join(", ") }));
    }
  }
  const saveButtons = [];
  for (const h of onHit) {
    if (!h.save?.type) continue;
    const dc = Math.floor(evaluate(h.save.dc ?? 15, h.data));
    saveButtons.push({
      ijAction: "save", save: h.save.type, dc, source: h.label, icon: "fa-solid fa-shield-halved",
      label: game.i18n.format("IJ.Jutsu.saveButton", { save: L(CONFIG.IJ.SAVES[h.save.type].label), dc })
    });
  }

  // Buttons: damage (normal, critical), the saves of a hit, the reactions of the targets
  const buttons = [];
  if (damage?.formula) {
    buttons.push({ ijAction: "attackDamage", label: L("IJ.Weapon.rollDamage"), icon: "fa-solid fa-burst", crit: false });
    buttons.push({ ijAction: "attackDamage", label: game.i18n.format("IJ.Weapon.rollCritical", { n: mult }), icon: "fa-solid fa-skull", crit: true, critical: true });
  }
  buttons.push(...saveButtons);
  if (chosenOpts.some(o => o.extraAttack) && actor) {
    buttons.push({ ijAction: "extraAttack", label: L("IJ.Auto.extraAttack"), icon: "fa-solid fa-repeat", actor: actor.uuid, item: weapon?.id ?? "" });
  }
  for (const r of results) buttons.push(...r.reactions.map(b => ({ ...b, label: `${b.label} · ${r.name}` })));

  const context = {
    title: reaction ? `${title} (${reaction})` : title,
    subtitle, kanji, kind: "attack",
    total: roll.total,
    natural,
    bonus: signed(total),
    parts: allParts.filter(p => p.value).map(p => ({ label: p.label, value: signed(p.value) })),
    crit: natural >= threat,
    critLabel: "IJ.Roll.threat",
    fumble: natural === 1,
    dice: await roll.render(),
    img: actor?.img,
    buttons,
    targets: results.map(r => ({ ...r, ca: r.ca, hitLabel: L(r.crit ? "IJ.Auto.critHit" : r.hit ? "IJ.Auto.hit" : "IJ.Auto.miss") })),
    options: chosenOpts.map(o => ({ label: o.label, tag: optionTag(o) })),
    lines: hitLines,
    touch
  };
  const content = await renderTemplate(CARD, context);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    flags: {
      [SYSTEM]: {
        kind: "attack",
        attack: {
          actor: actor?.uuid ?? null, weapon: weapon?.id ?? null, unarmed, ranged, total: roll.total, natural,
          damage: damage ? { formula: damage.formula, type: damage.type ?? "", flat: flatDamage } : null,
          extraParts, mult, ignoreRd: Number.isFinite(ignoreRd) ? ignoreRd : "all",
          targets: results.map(({ reactions, ...r }) => r),
          onHit: onHit.map(({ data, ...h }) => h)
        },
        ...extraFlags
      }
    }
  }, { messageMode: game.settings.get("core", "messageMode") });
}

/**
 * The damage of an attack card.
 * @param {ChatMessage} message
 * @param {object} [options]
 * @param {boolean} [options.critical]
 */
export async function attackDamage(message, { critical = false } = {}) {
  const atk = message.flags?.[SYSTEM]?.attack;
  if (!atk?.damage) return null;
  const actor = await fromUuid(atk.actor);
  const base = atk.damage.flat ? `${atk.damage.formula} + ${atk.damage.flat}` : atk.damage.formula;
  const parts = [{ formula: base, type: atk.damage.type, physical: isPhysical(atk.damage.type), label: "" }, ...(atk.extraParts ?? [])];
  // Normal damage goes to the plain hits, the critical to the critical hits (all hits when none was a critical)
  const hits = (atk.targets ?? []).filter(t => t.hit);
  const crits = hits.filter(t => t.crit);
  // Every target missed: the damage still goes to them if someone rolls it anyway (the GM decides)
  let targets = hits.length ? hits : (atk.targets ?? []);
  if (crits.length && hits.length > crits.length) targets = critical ? crits : hits.filter(t => !t.crit);
  else if (crits.length) targets = crits;
  const weapon = atk.weapon ? actor?.items.get(atk.weapon) : null;
  return rollDamage({
    actor,
    title: weapon?.name ?? message.flags[SYSTEM].title ?? L("IJ.Weapon.damage"),
    subtitle: critical ? game.i18n.format("IJ.Weapon.criticalX", { n: atk.mult }) : "",
    kanji: critical ? "斬" : "撃",
    parts,
    critical,
    mult: atk.mult,
    ignoreRd: atk.ignoreRd === "all" ? Infinity : atk.ignoreRd,
    link: { source: message.id, melee: !atk.ranged, targets: (atk.targets ?? []).length ? targets.map(t => t.uuid) : [] }
  });
}
