/**
 * The conditions of the book (chapter 6): status effects on the token HUD, what each one does to the numbers, the
 * conditions they bring along (a blind character is also flat-footed) and the immunities that stop them.
 *
 * The status effect is only a marker; the numbers come from `conditionMods`, read by the data models when they
 * prepare the actor (characters) or by the rolls (threats, whose stat block is fixed).
 */
import { SYSTEM, isImmune } from "./context.mjs";

const svg = name => `icons/svg/${name}.svg`;

/**
 * mods: attack (all), attackMelee, attackRanged, damage, ca, ref, saves, skills (all), physSkills (Str/Dex skills),
 *       dexSkills, abilityTests, perception, initiative, movement (m)
 * vs:   what attackers get against someone with the condition (melee/ranged)
 * immunity: words an immunity trait can name to block it ("medo", "atordoamento"...)
 */
export const CONDITIONS = {
  abalado: { img: svg("terror"), mods: { attack: -2, abilityTests: -2, skills: -2, saves: -2 }, immunity: ["medo"] },
  agarrado: { img: svg("net"), implies: ["desprevenido"], mods: { attack: -2 }, noMove: true },
  apavorado: { img: svg("terror"), mods: { attack: -2, abilityTests: -2, skills: -2, saves: -2 }, immunity: ["medo"], supersedes: ["abalado"] },
  atordoado: { img: svg("daze"), implies: ["desprevenido"], noActions: true, immunity: ["atordoamento"] },
  caido: { img: svg("falling"), mods: { attackMelee: -4, movement: -6 }, vs: { melee: 4, ranged: -4 } },
  cego: { img: svg("blind"), implies: ["desprevenido"], mods: { ca: -4, movement: -9, physSkills: -4 }, miss: 50 },
  confuso: { img: svg("stoned"), turnStart: "confusion", immunity: ["encantamento"] },
  desprevenido: { img: svg("cowled"), mods: { ca: -4, ref: -4 } },
  enjoado: { img: svg("biohazard"), oneAction: true, immunity: ["enjoo"] },
  enredado: { img: svg("net"), mods: { attackMelee: -2, attackRanged: -4, ca: -2, ref: -2, dexSkills: -2, movement: -6 }, immunity: ["movimento"] },
  exausto: { img: svg("downgrade"), mods: { attack: -3, damage: -3, ca: -3, ref: -3, physSkills: -3, movement: -9 }, immunity: ["fadiga"], supersedes: ["fatigado"] },
  fascinado: { img: svg("eye"), mods: { perception: -4 }, noActions: true, immunity: ["encantamento"] },
  fatigado: { img: svg("down"), mods: { attack: -1, damage: -1, ca: -1, ref: -1, physSkills: -1 }, immunity: ["fadiga"] },
  inconsciente: { img: svg("unconscious"), implies: ["indefeso"], noActions: true },
  incorporeo: { img: svg("aura") },
  indefeso: { img: svg("padlock"), caOverride: true, noRef: true },
  inerte: { img: svg("statue") },
  invisivel: { img: svg("invisible") },
  lento: { img: svg("degen"), mods: { attack: -2, ca: -2, ref: -2 }, movementCap: 3, oneAction: true },
  ofuscado: { img: svg("light"), mods: { attack: -1 } },
  paralisado: { img: svg("paralysis"), implies: ["indefeso"], noActions: true, immunity: ["paralisia", "movimento"] },
  pasmo: { img: svg("daze"), noActions: true, immunity: ["atordoamento", "encantamento"] },
  sangrando: { img: svg("blood"), turnStart: "bleed" },
  surdo: { img: svg("deaf"), mods: { initiative: -4, perception: -4 } },
  surpreendido: { img: svg("hazard"), implies: ["desprevenido"], noActions: true }
};

/** Conditions that only exist through others (shown as their own status too, so the HUD tells the whole story). */
const ORDER = Object.keys(CONDITIONS);

/** Put the book's conditions on the token HUD (and keep "dead" for the defeated). */
export function registerConditions() {
  const dead = CONFIG.statusEffects.find?.(s => s.id === "dead") ?? { id: "dead", name: "EFFECT.StatusDead", img: svg("skull") };
  CONFIG.statusEffects = [
    dead,
    ...ORDER.map(id => ({ id, name: `IJ.Condition.${id}`, img: CONDITIONS[id].img, description: `IJ.ConditionDesc.${id}` }))
  ];
  CONFIG.specialStatusEffects.INVISIBLE = "invisivel";
  CONFIG.specialStatusEffects.BLIND = "cego";
  // Temporary effects that run out are deleted (by the active GM), not left behind as expired
  CONFIG.ActiveEffect.expiryAction = "delete";
}

/** The actor's conditions, with the ones they bring along (blind → flat-footed...). */
export function effectiveStatuses(actor) {
  const out = new Set();
  const add = id => {
    if (out.has(id)) return;
    out.add(id);
    for (const other of CONDITIONS[id]?.implies ?? []) add(other);
  };
  for (const id of actor?.statuses ?? []) add(id);
  // Paralyzed or unconscious creatures are helpless; 0 PV or less leaves a character unconscious (handled by status)
  return out;
}

/** The sum of the condition penalties on an actor (`supersedes` keeps the worse of two of the same kind). */
export function conditionMods(actor) {
  const all = effectiveStatuses(actor);
  // apavorado already carries abalado's penalties and exausto replaces fatigado: the weaker one doesn't add up
  const statuses = new Set(all);
  for (const id of all) for (const s of CONDITIONS[id]?.supersedes ?? []) statuses.delete(s);
  const mods = {
    attack: 0, attackMelee: 0, attackRanged: 0, damage: 0, ca: 0, ref: 0, saves: 0, skills: 0, physSkills: 0,
    dexSkills: 0, abilityTests: 0, perception: 0, initiative: 0, movement: 0, movementCap: null,
    noActions: false, oneAction: false, noMove: false, caOverride: false, noRef: false, miss: 0, statuses: all
  };
  for (const id of statuses) {
    const c = CONDITIONS[id];
    if (!c) continue;
    for (const [k, v] of Object.entries(c.mods ?? {})) mods[k] += v;
    if (c.movementCap !== undefined) mods.movementCap = Math.min(mods.movementCap ?? Infinity, c.movementCap);
    if (c.noActions) mods.noActions = true;
    if (c.oneAction) mods.oneAction = true;
    if (c.noMove) mods.noMove = true;
    if (c.caOverride) mods.caOverride = true;
    if (c.noRef) mods.noRef = true;
    if (c.miss) mods.miss = Math.max(mods.miss, c.miss);
  }
  // Negative levels: −1 on attacks, tests and saves each (p. 252)
  const neg = (actor?.type === "npc" ? actor.system.negativeLevels : actor?.system?.attributes?.negativeLevels) ?? 0;
  if (neg > 0) {
    mods.attack -= neg;
    mods.abilityTests -= neg;
    mods.skills -= neg;
    mods.saves -= neg;
  }
  return mods;
}

/** What an attacker gets against a target with conditions (prone: +4 melee, −4 ranged). */
export function attackVs(target, { ranged = false } = {}) {
  let bonus = 0;
  const notes = [];
  for (const id of effectiveStatuses(target)) {
    const vs = CONDITIONS[id]?.vs;
    if (!vs) continue;
    const v = ranged ? (vs.ranged ?? 0) : (vs.melee ?? 0);
    if (v) {
      bonus += v;
      notes.push(`${game.i18n.localize(`IJ.Condition.${id}`)} ${v > 0 ? "+" : ""}${v}`);
    }
  }
  return { bonus, notes };
}

/** Whether a condition can't take hold of the actor (immunity trait or the condition's own immunity words). */
export function blocks(actor, id, tags = []) {
  const c = CONDITIONS[id];
  if (!c) return false;
  // The descriptors of what caused it count too (Sono de Mizuha: immune to sleep stays awake)
  return isImmune(actor, [id, ...(c.immunity ?? []), ...tags]);
}

/**
 * The data of the active effect that puts a condition on an actor.
 * @param {string} id
 * @param {object} [options]
 * @param {object} [options.duration]  { value, unit } (see effects.mjs durationData)
 * @param {string} [options.origin]    Uuid of what caused it
 * @param {string} [options.source]    Name shown in the effect (the jutsu or ability)
 */
export function conditionEffectData(id, { duration = null, origin = null, source = "", durationData = null } = {}) {
  const c = CONDITIONS[id];
  const name = game.i18n.localize(`IJ.Condition.${id}`);
  return {
    name: source ? `${name} (${source})` : name,
    img: c?.img ?? svg("hazard"),
    statuses: [id],
    origin,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    duration: durationData ?? undefined,
    description: game.i18n.localize(`IJ.ConditionDesc.${id}`),
    flags: { [SYSTEM]: { condition: id, source, scene: duration?.unit === "cena" } }
  };
}
