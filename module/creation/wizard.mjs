/**
 * The creation wizard: a character of the 1st level made step by step in one window, and written on the sheet at
 * once at the end. The steps follow the eight of the book (p. 17), with the race and the class first so the numbers
 * show while the scores are spread (as the book itself advises, p. 27):
 *
 *   1. Race        the eight races as cards; the page of the one under the pointer (or chosen) shows its numbers, its
 *                  abilities and the choices it asks (the human's and mashin's +2, the henge's attack...).
 *   2. Class       the ten classes; the page shows PV, PM, BBA, skills, Honor, the starting feats, the abilities of the
 *                  1st level with their choices (arma eleita, religion, path, exotic weapons, ancestral sword) and the
 *                  class table.
 *   3. Abilities   the seven scores (Honor included) by points (24), by rolls (4d6, seven times, kept on the actor and
 *                  shown in the chat) or typed, with the race's and class's adjustments, the modifiers and the numbers
 *                  of play; the scores suggested for the class in one click.
 *   4. Skills      the trained skills: the class's number + Int among its list (the human's two from any list), the
 *                  specialties of Atuação, Conhecimento and Ofício, and the violations some of them are.
 *   5. Feats       the feat of the 1st level, the human's two, the kensei's and monk's technique and the kaijin's two
 *                  Tormenta feats, each checked against its prerequisites; a feat with a choice asks it right there.
 *   6. Jutsus      what the apprentice abilities, the hanyô's chakra and Conhecimento de Jutsus teach.
 *   7. Gear        the caste (and its money) and the shop, with the kit recommended for the class.
 *   8. Summary     the character's page: portrait, name, details, languages, texts, and everything it will have.
 *
 * Beside every step, the character as it stands: a preview actor in memory (module/creation/plan.mjs) prepared like
 * the sheet, so every number is the sheet's own. Nothing changes on the actor until "Criar personagem".
 */
import { ABILITIES, CASTES, CHAKRAS, SKILLS, SPECIALTIES, SYSTEM_ID, abilityMod, honorTier } from "../config.mjs";
import { norm } from "../auto/context.mjs";
import { SHOP_FILTERS, loadCatalog } from "./catalog.mjs";
import { choiceLists, featPickView, featRows, jutsuRows, tipHtml } from "./views.mjs";
import {
  CREATION_FLAG, ROLLS_FLAG, baseScores, casteLabel, choiceDone, classChoices, createCharacter, draftFromFlag, emptyDraft,
  featContext, jutsuPools, modsOf, moneyOf, planCharacter, poolTakes, raceChoices, skillSlots, whoFor
} from "./plan.mjs";
import {
  AGE_DICE, CASTE_MONEY, CLASS_KITS, CLASS_WEAPON_PICKS, FIXED_DAMAGE, FREE, GEN_KEYS, LANGUAGES, METHOD_SETTING,
  POINT_BUY, RACE_LANGUAGES, ROLL, SKILL_VIOLATIONS, assignRolls, casteFit, checkPrerequisites, ignoreThreshold, ignoresViolation, jutsuSeverity,
  moneyLabel, pointCost, pointsSpent, prerequisitesFail, rerollAllowed, signed, suggestedCaste, suggestedScores
} from "./rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const DIR = `systems/${SYSTEM_ID}/templates/creation`;

const L = key => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);
const W = key => L(`IJ.Wizard.${key}`);
const WF = (key, data) => F(`IJ.Wizard.${key}`, data);
const setting = key => {
  try {
    return game.settings.get(SYSTEM_ID, key);
  } catch {
    return undefined;
  }
};

/** The steps, in order. */
export const STEPS = [
  { id: "race", kanji: "族", icon: "fa-solid fa-people-group" },
  { id: "class", kanji: "道", icon: "fa-solid fa-torii-gate" },
  { id: "abilities", kanji: "力", icon: "fa-solid fa-dice-d20" },
  { id: "skills", kanji: "技", icon: "fa-solid fa-scroll" },
  { id: "feats", kanji: "才", icon: "fa-solid fa-star" },
  { id: "jutsus", kanji: "術", icon: "fa-solid fa-hand-sparkles" },
  { id: "gear", kanji: "具", icon: "fa-solid fa-sack" },
  { id: "summary", kanji: "名", icon: "fa-solid fa-feather-pointed" }
];

/** The templates of the steps (loaded at init, used as partials by step.hbs). */
export const STEP_TEMPLATES = [...STEPS.map(s => `${DIR}/${s.id}.hbs`), `${DIR}/choice.hbs`, `${DIR}/bonus.hbs`];

const ABBR = k => L(ABILITIES[k].abbr);
const LABEL = k => L(ABILITIES[k].label);
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

/** The feat pools of a character: the feat of the 1st level, the human's two, the technique, the kaijin's Tormenta. */
function featPools(plan, draft) {
  const { race, cls } = plan;
  const pools = [{ id: "base", count: (cls && (draft?.levelBonus?.kind !== "ability")) ? 1 : 0, accepts: () => true }];
  if (race?.bonusFeats) pools.push({ id: "race", count: race.bonusFeats, accepts: () => true });
  if (cls?.features.some(f => (f.level === 1) && (f.view?.key === "tecnica de luta"))) pools.push({ id: "technique", count: 1, accepts: f => f.category === "combate" });
  if (race?.features.some(f => f.key === "talentos da tormenta")) pools.push({ id: "tormenta", count: 2, accepts: f => f.category === "tormenta" });
  return pools.filter(p => p.count > 0);
}

/** The pools tried first for a feat: the narrow ones (Tormenta, technique) before the open ones. */
const POOL_ORDER = ["tormenta", "technique", "base", "race"];

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

export class CreationWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  /** One window per character. */
  static idFor(actor) {
    return `ij-creation-${actor.id}`;
  }

  /**
   * Open the wizard of a character (or bring it to the front).
   * @param {Actor} actor
   * @param {object} [options]
   * @param {string} [options.step]   The step to open on
   */
  static open(actor, { step } = {}) {
    if (!CreationWizard.canCreate(actor)) {
      ui.notifications.warn(W("notAllowed"));
      return null;
    }
    const existing = foundry.applications.instances.get(this.idFor(actor));
    if (existing) {
      if (step) existing.step = step;
      return existing.render({ force: true });
    }
    return new this(actor, { step }).render({ force: true });
  }

  /** A character that can be made (or made again) here: a character of the 1st level the user owns. */
  static canCreate(actor) {
    return (actor?.type === "character") && actor.isOwner && !actor.pack && ((actor.system.level ?? 1) <= 1);
  }

  /** A blank character: no race and no class yet. */
  static isBlank(actor) {
    return (actor?.type === "character") && !actor.items.some(i => ["race", "class"].includes(i.type));
  }

  constructor(actor, { step = null, ...options } = {}) {
    const width = Math.min(1260, window.innerWidth - 40);
    const height = Math.min(880, window.innerHeight - 40);
    super({
      ...options,
      id: CreationWizard.idFor(actor),
      position: { width, height, left: Math.max(0, (window.innerWidth - width) / 2), top: Math.max(0, (window.innerHeight - height) / 2) }
    });
    this.actor = actor;
    this.draft = this.#initialDraft();
    this.step = step ?? "race";
  }

  static DEFAULT_OPTIONS = {
    classes: ["imperiodejade", "ij-wizard"],
    tag: "div",
    window: { icon: "fa-solid fa-feather-pointed", resizable: true },
    actions: {
      step: CreationWizard.#onStep,
      next: CreationWizard.#onNext,
      back: CreationWizard.#onBack,
      pick: CreationWizard.#onPick,
      raceAbility: CreationWizard.#onRaceAbility,
      option: CreationWizard.#onOption,
      method: CreationWizard.#onMethod,
      levelBonus: CreationWizard.#onLevelBonus,
      point: CreationWizard.#onPoint,
      suggest: CreationWizard.#onSuggest,
      resetScores: CreationWizard.#onResetScores,
      roll: CreationWizard.#onRoll,
      autoAssign: CreationWizard.#onAutoAssign,
      resetRolls: CreationWizard.#onResetRolls,
      skill: CreationWizard.#onSkill,
      specialty: CreationWizard.#onSpecialty,
      specialtyRemove: CreationWizard.#onSpecialtyRemove,
      featAdd: CreationWizard.#onFeatAdd,
      featRemove: CreationWizard.#onFeatRemove,
      featOption: CreationWizard.#onFeatOption,
      expand: CreationWizard.#onExpand,
      filter: CreationWizard.#onFilter,
      jutsuAdd: CreationWizard.#onJutsuAdd,
      jutsuRemove: CreationWizard.#onJutsuRemove,
      caste: CreationWizard.#onCaste,
      buy: CreationWizard.#onBuy,
      sell: CreationWizard.#onSell,
      kit: CreationWizard.#onKit,
      emptyCart: CreationWizard.#onEmptyCart,
      portrait: CreationWizard.#onPortrait,
      rollAge: CreationWizard.#onRollAge,
      language: CreationWizard.#onLanguage,
      create: CreationWizard.#onCreate
    }
  };

  static PARTS = {
    head: { template: `${DIR}/head.hbs` },
    rail: { template: `${DIR}/rail.hbs` },
    step: { template: `${DIR}/step.hbs`, scrollable: [".wz-grid", ".wz-detail", ".wz-scroll", ".wz-list", ".wz-shop-list", ".wz-side"] },
    foot: { template: `${DIR}/foot.hbs` }
  };

  /** The catalog (module/creation/catalog.mjs). */
  #catalog = null;
  /** The latest plan, and the number of the latest planning (an older one finishing late is dropped). */
  #plan = null;
  #planSeq = 0;
  /** Filters of the lists, applied in the page without drawing it again. */
  #filters = { feats: "", featQuery: "", jutsus: "", jutsuQuery: "", shop: "", shopQuery: "" };
  /** Rows whose text is open. */
  #expanded = new Set();
  /** Being created. */
  #creating = false;

  /** @override */
  get title() {
    return WF("title", { name: this.draft?.name || this.actor.name });
  }

  /* -------------------------------------------- */
  /*  The draft                                   */
  /* -------------------------------------------- */

  /** The draft to start from: the one this character was made from (a 1st-level character made again), else empty. */
  #initialDraft() {
    const saved = draftFromFlag(this.actor.getFlag(SYSTEM_ID, CREATION_FLAG)?.draft);
    const draft = Object.assign(emptyDraft(this.actor), saved ?? {});
    draft.details = { ...emptyDraft(this.actor).details, ...(saved?.details ?? {}) };
    draft.bio = { ...emptyDraft(this.actor).bio, ...(saved?.bio ?? {}) };
    draft.name = this.actor.name;
    draft.img = this.actor.img;
    if (!draft.method || !this.#methods().includes(draft.method)) draft.method = this.#methods()[0];
    return draft;
  }

  /** The generation methods this user may use (the GM's setting; the GM may use any). */
  #methods() {
    if (game.user.isGM) return ["points", "roll", "free"];
    return METHOD_SETTING[setting("creationMethods")] ?? METHOD_SETTING.choose;
  }

  /** The rolls kept on the actor: the last set rolled, how many sets, who rolled. */
  #rolls() {
    const flag = this.actor.getFlag(SYSTEM_ID, ROLLS_FLAG) ?? {};
    const sets = Array.isArray(flag.sets) ? flag.sets : [];
    const last = sets.at(-1) ?? null;
    return { values: last?.values ?? [], sets: sets.length, last };
  }

  #race(plan = this.#plan) {
    return plan?.race ?? null;
  }

  #cls(plan = this.#plan) {
    return plan?.cls ?? null;
  }

  /** Plan the draft (the latest planning wins). */
  async #replan() {
    const seq = ++this.#planSeq;
    const plan = await planCharacter(this.draft, {
      catalog: this.#catalog, rolls: this.#rolls().values, actor: this.actor, violations: setting("creationViolations") !== false
    });
    plan.derived = this.#derive(plan);
    if (seq === this.#planSeq) this.#plan = plan;
    return plan;
  }

  /** What the plan says beyond its numbers: skill slots, feat checks and pools, jutsu pools. */
  #derive(plan) {
    const slots = skillSlots(plan);
    const ctx = featContext(plan.preview);
    const pools = featPools(plan, this.draft);
    const jutsu = jutsuPools(plan);
    return { slots, ctx, pools, jutsu };
  }

  /* -------------------------------------------- */
  /*  Steps                                       */
  /* -------------------------------------------- */

  /** Whether each step is done. */
  #done(plan = this.#plan) {
    const d = this.draft;
    const race = this.#race(plan);
    const cls = this.#cls(plan);
    const scores = baseScores(d, this.#rolls().values);
    return {
      race: !!race && (!race.choice.count || (d.raceAbilities.length === race.choice.count))
        && raceChoices(race).every(c => choiceDone(c, d)),
      class: !!cls && classChoices(cls, this.#catalog).every(c => choiceDone(c, d)),
      abilities: this.#abilitiesOk(scores),
      skills: !!cls && (this.#skillState(plan).problem === null),
      feats: !!cls && (this.#featState(plan).problem === null),
      jutsus: !!cls && (this.#jutsuState(plan).problem === null),
      gear: !!d.caste && (moneyOf(d, this.#catalog).left >= 0),
      summary: !!String(d.name ?? "").trim()
    };
  }

  /** The scores are complete for the method. */
  #abilitiesOk(scores) {
    const d = this.draft;
    if ((d.levelBonus?.kind === "ability") && !d.levelBonus.ability) return false;
    return this.#abilitiesComplete(scores);
  }

  /** The seven scores are complete for the method (the benefit of the level apart). */
  #abilitiesComplete(scores = baseScores(this.draft, this.#rolls().values)) {
    const d = this.draft;
    if (!this.#methods().includes(d.method)) return false;
    if (d.method === "points") return pointsSpent(d.points) === POINT_BUY.budget;
    if (d.method === "roll") {
      const used = GEN_KEYS.map(k => d.assign?.[k]).filter(i => (i !== null) && (i !== undefined));
      return (this.#rolls().values.length === ROLL.count) && (used.length === GEN_KEYS.length) && (new Set(used).size === used.length);
    }
    return GEN_KEYS.every(k => (scores[k] >= FREE.min) && (scores[k] <= FREE.max));
  }

  /** The skills picked and what is still wrong with them (null: nothing). */
  #skillState(plan = this.#plan) {
    const d = this.draft;
    const slots = plan.derived.slots;
    const skills = d.skills.filter(k => !slots.always.has(k));
    const outside = skills.filter(k => !slots.classSkills.has(k)).length + d.specialties.filter(s => !slots.classSkills.has(s.skill)).length;
    const count = skills.length + d.specialties.length;
    let problem = null;
    if (count < slots.total) problem = WF("Hint.skills", { n: slots.total - count });
    else if (count > slots.total) problem = WF("Hint.skillsOver", { n: count - slots.total });
    else if (outside > slots.any) problem = WF("Hint.skillsOutside", { n: slots.any });
    else if (d.specialties.some(s => !String(s.label ?? "").trim())) problem = W("Hint.specialty");
    return { count, outside, problem };
  }

  /** The feats picked, checked, and what is still wrong with them. */
  #featState(plan = this.#plan) {
    const { ctx, pools } = plan.derived;
    const picks = this.draft.feats.map(pick => {
      const feat = this.#catalog.byUuid.get(pick.uuid);
      const pool = pools.find(p => p.id === pick.pool);
      if (!feat) return { pick, feat: null, problems: [W("Feats.missing")] };
      const problems = [];
      if (!pool || !pool.accepts(feat)) problems.push(W("Feats.badPool"));
      const results = checkPrerequisites(feat.checks, whoFor(ctx, feat, true));
      for (const r of results) if (r.ok === false) problems.push(WF("Feats.unmet", { text: r.text }));
      if (feat.honorMin && ((ctx.abilities.hon ?? 0) < feat.honorMin)) problems.push(WF("Feats.honor", { n: feat.honorMin }));
      if (!feat.repeatable && ((ctx.featCounts.get(feat.key) ?? 0) > 1)) problems.push(W("Feats.twice"));
      if (feat.perChoice && this.#sameChoice(plan, pick)) problems.push(W("Feats.sameChoice"));
      if (feat.choice) {
        const options = feat.choice.options ?? [];
        if (options.length && !(pick.choices ?? []).length) problems.push(W("Feats.choose"));
        if (feat.choice.text && !String(pick.text ?? "").trim()) problems.push(W("Feats.chooseText"));
      }
      return { pick, feat, pool, results, problems };
    });
    const full = pools.every(p => picks.filter(x => x.pick.pool === p.id).length >= p.count);
    const over = pools.some(p => picks.filter(x => x.pick.pool === p.id).length > p.count);
    // A pool asks for what it can teach: with fewer jutsus within reach than slots (Conhecimento de Jutsus on a
    // character with no open chakra), the slots nothing can fill don't hold the step
    const reach = p => Math.min(p.count, this.#catalog.jutsus.filter(j => poolTakes(p, j)).length);
    const open = pools.reduce((t, p) => t + Math.max(0, reach(p) - picks.filter(x => x.pick.pool === p.id).length), 0);
    let problem = null;
    if (picks.some(x => x.problems.length)) problem = W("Hint.featsInvalid");
    else if (over) problem = W("Hint.featsOver");
    else if (!full) problem = WF("Hint.feats", { n: open });
    return { picks, problem, open };
  }

  /**
   * Whether a picked feat made for one weapon, skill or descriptor repeats a choice another copy already has (one the
   * race or class gives, or another pick).
   */
  #sameChoice(plan, pick) {
    const mine = { choices: pick.choices ?? [], text: norm(pick.text ?? "") };
    if (!mine.choices.length && !mine.text) return false;
    const others = plan.items.filter(i => (i._stats?.compendiumSource === pick.uuid) && !i.flags?.[SYSTEM_ID]?.[CREATION_FLAG])
      .map(i => ({ choices: i.system.choices ?? [], text: norm(i.system.choiceText ?? "") }));
    for (const other of this.draft.feats) {
      if ((other.key !== pick.key) && (other.uuid === pick.uuid)) others.push({ choices: other.choices ?? [], text: norm(other.text ?? "") });
    }
    return others.some(o => (mine.text && (o.text === mine.text)) || mine.choices.some(c => o.choices.includes(c)));
  }

  /** The options of a picked feat that another copy already has (one the race or class gives, or another pick). */
  #takenFor(plan, pick) {
    const taken = new Set(plan.items.filter(i => (i._stats?.compendiumSource === pick.uuid) && !i.flags?.[SYSTEM_ID]?.[CREATION_FLAG]).flatMap(i => i.system.choices ?? []));
    for (const other of this.draft.feats) if ((other.key !== pick.key) && (other.uuid === pick.uuid)) for (const c of other.choices ?? []) taken.add(c);
    return taken;
  }

  /** The jutsus picked, and what is still wrong with them. */
  #jutsuState(plan = this.#plan) {
    const pools = plan.derived.jutsu;
    const picks = this.draft.jutsus.map(pick => {
      const jutsu = this.#catalog.byUuid.get(pick.uuid);
      const pool = pools.find(p => p.id === pick.pool);
      return { pick, jutsu, pool, ok: !!jutsu && !!pool && poolTakes(pool, jutsu) };
    });
    const open = pools.reduce((t, p) => t + Math.max(0, p.count - picks.filter(x => x.pick.pool === p.id).length), 0);
    const over = pools.some(p => picks.filter(x => x.pick.pool === p.id).length > p.count);
    let problem = null;
    if (picks.some(x => !x.ok)) problem = W("Hint.jutsusInvalid");
    else if (over) problem = W("Hint.jutsusOver");
    else if (open) problem = WF("Hint.jutsus", { n: open });
    return { picks, pools, open, problem };
  }

  /** A step can be opened when every step before it is done. */
  #reachable(id, done = this.#done()) {
    const index = STEPS.findIndex(s => s.id === id);
    return STEPS.slice(0, index).every(s => done[s.id]);
  }

  /** Go to a step (one that can be opened). */
  async goTo(id) {
    if (!STEPS.some(s => s.id === id)) return;
    if (this.#plan && !this.#reachable(id)) return;
    this.step = id;
    this.#enterStep(id);
    return this.render({ parts: ["head", "rail", "step", "foot"] });
  }

  /** What a step sets up the first time it opens: the gear step proposes the caste and the class's kit. */
  #enterStep(id) {
    if (id !== "gear") return;
    const d = this.draft;
    const plan = this.#plan;
    if (!d.caste) d.caste = suggestedCaste({ race: plan?.race?.name, className: plan?.cls?.name, honor: plan?.honor.final ?? 10 });
    if (!d.kitOffered && !d.cart.length) {
      d.kitOffered = true;
      d.cart = this.#kitCart();
    }
  }

  /** Draw again the parts that show the draft. */
  #refresh() {
    return this.render({ parts: ["head", "rail", "step", "foot"] });
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    this.#catalog ??= await loadCatalog();
    const plan = await this.#replan();
    const done = this.#done(plan);
    if (!this.#reachable(this.step, done)) this.step = STEPS.find(s => !done[s.id])?.id ?? "race";
    const index = STEPS.findIndex(s => s.id === this.step);
    return {
      plan,
      done,
      stepId: this.step,
      steps: STEPS.map((s, i) => ({
        ...s, n: i + 1, label: W(`Step.${s.id}`), done: done[s.id] && this.#reachable(s.id, done),
        current: s.id === this.step, reachable: this.#reachable(s.id, done)
      })),
      first: index === 0,
      last: index === STEPS.length - 1,
      next: STEPS[index + 1] ? W(`Step.${STEPS[index + 1].id}`) : "",
      complete: done[this.step],
      allDone: STEPS.every(s => done[s.id])
    };
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    switch (partId) {
      case "head": return Object.assign(context, this.#headContext(context));
      case "rail": return Object.assign(context, this.#railContext(context.plan));
      case "step": return Object.assign(context, await this.#stepContext(context.plan));
      case "foot": return Object.assign(context, this.#footContext(context));
    }
    return context;
  }

  #headContext() {
    const step = STEPS.find(s => s.id === this.step);
    return {
      kanji: step.kanji,
      eyebrow: WF("stepOf", { n: STEPS.indexOf(step) + 1, total: STEPS.length }),
      heading: W(`Heading.${this.step}`),
      lead: W(`Lead.${this.step}`)
    };
  }

  /** The character as it stands, beside every step. */
  #railContext(plan) {
    const d = this.draft;
    const sys = plan.preview.system;
    const race = plan.race;
    const cls = plan.cls;
    const money = moneyOf(d, this.#catalog);
    const tier = honorTier(sys.abilities.hon.total);
    const line = (step, icon, label, value) => ({ step, icon, label, ...value });
    const feats = this.draft.feats.length;
    const jutsus = this.draft.jutsus.length;
    return {
      portrait: d.img || this.actor.img,
      name: d.name || this.actor.name,
      subtitle: [race?.name, cls?.name].filter(Boolean).join(" · ") || W("Rail.empty"),
      lines: [
        line("race", "fa-solid fa-people-group", W("Step.race"), race ? { name: race.name, img: race.img } : {}),
        line("class", "fa-solid fa-torii-gate", W("Step.class"), cls ? { name: cls.name, img: cls.img } : {}),
        line("feats", "fa-solid fa-star", W("Step.feats"), feats ? { name: WF("Rail.feats", { n: feats }) } : {}),
        line("jutsus", "fa-solid fa-hand-sparkles", W("Step.jutsus"), jutsus ? { name: WF("Rail.jutsus", { n: jutsus }) } : {}),
        line("gear", "fa-solid fa-coins", W("Rail.caste"), d.caste ? { name: casteLabel(d.caste), note: moneyLabel(Math.max(0, money.left)) } : {})
      ],
      ready: !!cls,
      abilities: GEN_KEYS.map(k => ({
        key: k, abbr: ABBR(k), total: sys.abilities[k].total, mod: signed(sys.abilities[k].mod), honor: k === "hon",
        tip: `${LABEL(k)} ${sys.abilities[k].total}`
      })),
      numbers: [
        { icon: "fa-solid fa-heart", label: L("IJ.PV.abbr"), value: sys.attributes.pv.max },
        { icon: "fa-solid fa-droplet", label: L("IJ.PM.abbr"), value: sys.attributes.pm.max },
        { icon: "fa-solid fa-shield-halved", label: L("IJ.CA.abbr"), value: sys.ca.total },
        { icon: "fa-solid fa-hand-fist", label: L("IJ.BBA.abbr"), value: signed(sys.bba) }
      ],
      saves: ["fort", "ref", "von"].map(k => ({ label: L(`IJ.Save.${k}`), value: signed(sys.saves[k].total) })),
      honor: { total: sys.abilities.hon.total, tier: L(tier.label), key: tier.key }
    };
  }

  #footContext(context) {
    const index = STEPS.findIndex(s => s.id === this.step);
    return {
      hint: context.done[this.step] ? W(`Done.${this.step}`) : this.#hint(context.plan),
      backLabel: index > 0 ? W(`Step.${STEPS[index - 1].id}`) : ""
    };
  }

  /** What the step still asks for. */
  #hint(plan) {
    const d = this.draft;
    const race = plan.race;
    const cls = plan.cls;
    switch (this.step) {
      case "race":
        if (!race) return W("Hint.race");
        if (race.choice.count && (d.raceAbilities.length < race.choice.count)) return WF("Hint.raceAbilities", { n: race.choice.count - d.raceAbilities.length, value: race.choice.value });
        return WF("Hint.choices", { name: race.name });
      case "class": return cls ? WF("Hint.choices", { name: cls.name }) : W("Hint.class");
      case "abilities": {
        if ((d.levelBonus?.kind === "ability") && !d.levelBonus.ability && this.#abilitiesComplete()) return W("Hint.bonusAbility");
        if (d.method === "points") return WF("Hint.points", { n: POINT_BUY.budget - pointsSpent(d.points) });
        if (d.method === "roll") return this.#rolls().values.length ? W("Hint.assign") : W("Hint.roll");
        return W("Hint.free");
      }
      case "skills": return this.#skillState(plan).problem ?? "";
      case "feats": return this.#featState(plan).problem ?? "";
      case "jutsus": return this.#jutsuState(plan).problem ?? "";
      case "gear": return d.caste ? WF("Hint.gearOver", { n: moneyLabel(-moneyOf(d, this.#catalog).left) }) : W("Hint.caste");
      case "summary": return W("Hint.summary");
    }
    return "";
  }

  /** The data of the open step. */
  async #stepContext(plan) {
    const step = { step: this.step, partial: `${DIR}/${this.step}.hbs` };
    switch (this.step) {
      case "race": return { ...step, ...this.#raceStep(plan) };
      case "class": return { ...step, ...this.#classStep(plan) };
      case "abilities": return { ...step, ...this.#abilitiesStep(plan) };
      case "skills": return { ...step, ...this.#skillsStep(plan) };
      case "feats": return { ...step, ...this.#featsStep(plan) };
      case "jutsus": return { ...step, ...this.#jutsusStep(plan) };
      case "gear": return { ...step, ...this.#gearStep(plan) };
      case "summary": return { ...step, ...this.#summaryStep(plan) };
    }
    return step;
  }

  /** A choice of the race or class step, with what the draft made of it. */
  #choiceView(choice, { active = true } = {}) {
    const d = this.draft;
    const made = (choice.kind === "ancestral") ? { choices: d.ancestral ? [d.ancestral] : [] } : (d.choices[choice.uuid] ?? {});
    const picks = made.choices ?? [];
    const full = picks.length >= choice.count;
    const isEleita = norm(choice.name) === "arma eleita";
    return {
      ...choice,
      active,
      eleita: isEleita,
      listId: String(choice.uuid).replace(/[^a-zA-Z0-9]/g, ""),
      multi: choice.count > 1,
      done: choiceDone(choice, d),
      picked: picks.length,
      text: choice.text,
      textValue: made.text ?? "",
      // The arma eleita asks its weapon only when a weapon is chosen (the unarmed strike fills it)
      showText: !!choice.text && !(isEleita && picks.includes("desarmado")),
      weapons: (choice.text && /arma/i.test(choice.text)) ? this.#catalog.weaponNames.filter(n => norm(n) !== "ataque desarmado") : null,
      options: choice.options.map(o => ({
        id: o.id, label: o.label ?? o.id, hint: o.hint ?? "", on: picks.includes(o.id),
        disabled: !active || (!picks.includes(o.id) && full && (choice.count > 1))
      }))
    };
  }

  #raceStep(plan) {
    const d = this.draft;
    const chosen = d.race;
    const races = this.#catalog.races.map(race => {
      const selected = race.uuid === chosen;
      const picks = selected ? d.raceAbilities : [];
      return {
        ...race,
        selected,
        honorLabel: race.honor ? `${ABBR("hon")} ${signed(race.honor)}` : "",
        modsLabel: race.choice.count ? WF("Race.choiceShort", { n: race.choice.count, value: race.choice.value }) : race.mods.map(m => m.label).join(" · "),
        extras: [
          race.bonusSkills ? WF("Race.bonusSkills", { n: race.bonusSkills }) : null,
          race.bonusFeats ? WF("Race.bonusFeats", { n: race.bonusFeats }) : null
        ].filter(Boolean),
        abilityPick: race.choice.count ? ["for", "des", "con", "int", "sab", "car"].map(k => ({
          key: k, abbr: ABBR(k), label: LABEL(k), on: picks.includes(k),
          disabled: !selected || (!picks.includes(k) && (picks.length >= race.choice.count))
        })) : null,
        features: race.features.map(f => ({ ...f, tip: tipHtml({ name: f.name, img: f.img, html: f.html }) })),
        choices: raceChoices(race).map(c => this.#choiceView(c, { active: selected }))
      };
    });
    return { races, selectedKey: chosen ?? "" };
  }

  #classStep(plan) {
    const d = this.draft;
    const chosen = d.class;
    const classes = this.#catalog.classes.map(cls => {
      const selected = cls.uuid === chosen;
      const level1 = cls.features.filter(f => f.level === 1).map(f => f.view ?? { name: f.name, img: cls.img, text: "", html: "" });
      return {
        ...cls,
        selected,
        honorLabel: signed(cls.honor),
        pvLabel: WF("Class.pv", { n: cls.pv.initial, per: cls.pv.perLevel }),
        pmLabel: WF("Class.pm", { n: cls.pm.initial, per: cls.pm.perLevel }),
        skillsLabel: WF("Class.skills", { n: cls.skills }),
        classSkills: cls.classSkills.map(k => L(SKILLS[k]?.label ?? k)).join(", "),
        startingFeats: cls.startingFeatList.map(f => {
          const view = this.#catalog.byUuid.get(f.uuid);
          return { name: view?.name ?? f.name, img: view?.img, tip: view ? tipHtml({ name: view.name, img: view.img, meta: view.categoryLabel, html: view.html }) : "" };
        }).filter((f, i, all) => all.findIndex(x => x.name === f.name) === i),
        level1: level1.map(f => ({ ...f, honor: f.honorMin ? WF("Class.honorReq", { n: f.honorMin }) : "", tip: tipHtml({ name: f.name, img: f.img, html: f.html }) })),
        honorReq: Math.max(0, ...level1.map(f => f.honorMin ?? 0)),
        table: cls.table.map(t => ({ ...t, bba: signed(t.bba) })),
        choices: selected ? classChoices(cls, this.#catalog).map(c => this.#choiceView(c)) : classChoices(cls, this.#catalog).map(c => this.#choiceView(c, { active: false }))
      };
    });
    return { classes, selectedKey: chosen ?? "" };
  }

  #abilitiesStep(plan) {
    const d = this.draft;
    const sys = plan.preview.system;
    const race = plan.race;
    const cls = plan.cls;
    const rolls = this.#rolls();
    const scores = baseScores(d, rolls.values);
    const spent = pointsSpent(d.points);
    const left = POINT_BUY.budget - spent;
    const used = new Map();
    for (const k of GEN_KEYS) {
      const i = d.assign?.[k];
      if ((i !== null) && (i !== undefined)) used.set(i, k);
    }
    const suggestion = cls ? suggestedScores(cls.name) : null;
    const rows = GEN_KEYS.map(k => {
      const raceMod = (k === "hon") ? (race?.honor ?? 0) : ((race?.abilityMods?.[k] ?? 0) + (d.raceAbilities.includes(k) ? (race?.choice.value ?? 0) : 0));
      const clsMod = (k === "hon") ? (cls?.honor ?? 0) : 0;
      const a = sys.abilities[k];
      const base = scores[k];
      const point = d.points[k] ?? 10;
      return {
        key: k, kanji: ABILITIES[k].kanji, label: LABEL(k), abbr: ABBR(k), hint: W(`Abilities.hint.${k}`),
        base: base ?? "—", empty: base === null,
        plusOne: (d.levelBonus?.kind === "ability") && (d.levelBonus.ability === k),
        raceMod: raceMod ? signed(raceMod) : "", clsMod: clsMod ? signed(clsMod) : "",
        violations: (k === "hon") && plan.honor.damage ? `−${plan.honor.damage}` : "",
        total: a.total, mod: signed(a.mod), negative: a.mod < 0, honor: k === "hon",
        // Points
        point, cost: pointCost(point),
        canUp: (point < POINT_BUY.max) && ((pointCost(point + 1) - pointCost(point)) <= left),
        canDown: point > POINT_BUY.min,
        nextCost: point < POINT_BUY.max ? pointCost(point + 1) - pointCost(point) : null,
        // Rolls
        rollOptions: rolls.values.map((v, i) => ({ i, v, selected: d.assign?.[k] === i, taken: used.has(i) && (used.get(i) !== k) })),
        // Typed
        free: d.free[k] ?? 10,
        suggested: suggestion?.[k] ?? null
      };
    });
    const tier = honorTier(sys.abilities.hon.total);
    const reqs = (cls?.features ?? []).filter(f => (f.level === 1) && f.view?.honorMin).map(f => ({ name: f.view.name, n: f.view.honorMin, ok: sys.abilities.hon.total >= f.view.honorMin }));
    const values = rolls.values;
    return {
      methods: this.#methods().map(id => ({ id, label: W(`Abilities.method.${id}`), hint: W(`Abilities.methodHint.${id}`), active: d.method === id })),
      method: d.method,
      isPoints: d.method === "points",
      isRoll: d.method === "roll",
      isFree: d.method === "free",
      points: { spent, left, budget: POINT_BUY.budget, gems: Array.from({ length: POINT_BUY.budget }, (_, i) => ({ on: i < spent })), over: left < 0 },
      costTable: Object.entries(POINT_BUY.cost).map(([score, cost]) => ({ score, cost })),
      rows,
      roll: {
        values: values.map((v, i) => ({ v, i, mod: signed(abilityMod(v)), used: used.has(i), key: used.has(i) ? ABBR(used.get(i)) : "" })),
        has: values.length === ROLL.count,
        sets: rolls.sets,
        canReroll: rerollAllowed(values),
        mods: signed(values.reduce((t, v) => t + abilityMod(v), 0)),
        high: values.length ? Math.max(...values) : 0,
        gm: game.user.isGM && rolls.sets > 0
      },
      suggest: suggestion ? {
        title: WF("Abilities.suggest", { name: cls.name }),
        parts: GEN_KEYS.map(k => ({ abbr: ABBR(k), n: suggestion[k] })),
        applied: GEN_KEYS.every(k => (d.method === "points") ? (d.points[k] === suggestion[k]) : false),
        available: d.method === "points" || (d.method === "roll" && values.length === ROLL.count)
      } : null,
      levelBonus: {
        eyebrow: W("Bonus.eyebrow1"),
        note: W("Bonus.note1"),
        feat: d.levelBonus?.kind !== "ability",
        ability: d.levelBonus?.kind === "ability",
        done: (d.levelBonus?.kind !== "ability") || !!d.levelBonus.ability,
        abilities: ["for", "des", "con", "int", "sab", "car"].map(k => ({ key: k, abbr: ABBR(k), label: LABEL(k), on: (d.levelBonus?.kind === "ability") && (d.levelBonus.ability === k) }))
      },
      honor: {
        base: plan.honor.base, race: signed(plan.honor.race), cls: signed(plan.honor.cls), before: plan.honor.before,
        damage: plan.honor.damage, total: sys.abilities.hon.total, tier: L(tier.label), tierKey: tier.key,
        violations: plan.honor.list, reqs
      },
      numbers: this.#numbers(plan)
    };
  }

  /** The numbers of play, from the preview. */
  #numbers(plan) {
    const sys = plan.preview.system;
    const tile = (icon, label, value, tip = "") => ({ icon, label, value, tip });
    return [
      tile("fa-solid fa-heart", L("IJ.PV.label"), sys.attributes.pv.max),
      tile("fa-solid fa-droplet", L("IJ.PM.long"), sys.attributes.pm.max),
      tile("fa-solid fa-shield-halved", L("IJ.CA.label"), sys.ca.total),
      tile("fa-solid fa-hand-fist", L("IJ.BBA.abbr"), signed(sys.bba)),
      tile("fa-solid fa-khanda", L("IJ.Attack.melee"), signed(sys.attack.melee)),
      tile("fa-solid fa-bow-arrow", L("IJ.Attack.ranged"), signed(sys.attack.ranged)),
      tile("fa-solid fa-person-running", L("IJ.Skill.iniciativa"), signed(sys.initiative)),
      ...["fort", "ref", "von"].map(k => tile("fa-solid fa-shield", L(`IJ.Save.${k}`), signed(sys.saves[k].total)))
    ];
  }

  /** The tag of a violation: its severity and damage, or that the character's Honor (or the GM) ignores it. */
  #violationTag(plan, severity) {
    if (!severity) return null;
    const off = setting("creationViolations") === false;
    const ignored = off || ignoresViolation(plan.honor.before, severity);
    return { label: L(`IJ.Honor.violation.${severity}`), damage: FIXED_DAMAGE[severity], ignored };
  }

  #skillsStep(plan) {
    const d = this.draft;
    const sys = plan.preview.system;
    const { slots } = plan.derived;
    const state = this.#skillState(plan);
    const cls = plan.cls;
    const full = state.count >= slots.total;
    const outsideFull = state.outside >= slots.any;
    const rows = Object.entries(SKILLS).map(([key, cfg]) => {
      const inClass = slots.classSkills.has(key);
      const always = slots.always.has(key);
      const picked = d.skills.includes(key);
      const mod = sys.abilities[cfg.ability]?.mod ?? 0;
      const specs = d.specialties.filter(s => s.skill === key);
      let reason = "";
      if (always) reason = W("Skills.always");
      else if (!inClass && !slots.any) reason = W("Skills.notClass");
      else if (!picked && full) reason = W("Skills.full");
      else if (!picked && !inClass && outsideFull) reason = W("Skills.outsideFull");
      return {
        key, label: L(cfg.label), ability: ABBR(cfg.ability), inClass, always, picked: picked || always,
        multi: !!cfg.specialty, trainedOnly: !!cfg.trainedOnly, armor: !!cfg.armor,
        trainedTotal: signed(1 + 3 + mod + (sys.skills[key]?.bonus ?? 0)),
        untrainedTotal: cfg.trainedOnly ? "—" : signed(mod + (sys.skills[key]?.bonus ?? 0)),
        disabled: !!reason && !picked,
        reason,
        violation: always ? null : this.#violationTag(plan, SKILL_VIOLATIONS[key]),
        outside: !inClass,
        specialties: specs.map(s => ({ ...s, empty: !String(s.label ?? "").trim() })),
        suggestions: cfg.specialty ? (SPECIALTIES[key] ?? []).filter(n => !specs.some(s => norm(s.label) === norm(n))).map(n => ({ name: n, disabled: (!inClass && (!slots.any || outsideFull)) || full })) : null,
        specDisabled: full || (!inClass && (!slots.any || outsideFull))
      };
    });
    return {
      className: cls?.name ?? "",
      slots: { total: slots.total, count: state.count, left: Math.max(0, slots.total - state.count), any: slots.any, outside: state.outside,
        pips: Array.from({ length: slots.total }, (_, i) => ({ on: i < state.count })) },
      int: signed(sys.abilities.int.mod),
      classRows: rows.filter(r => r.inClass),
      otherRows: rows.filter(r => !r.inClass),
      humanNote: slots.any ? WF("Skills.humanNote", { n: slots.any }) : "",
      threshold: ignoreThreshold("leve")
    };
  }

  #featsStep(plan) {
    const { ctx, pools } = plan.derived;
    const state = this.#featState(plan);
    const picksIn = id => state.picks.filter(x => x.pick.pool === id);
    const plannedFeats = plan.items.filter(i => (i.type === "feat") && !i.flags?.[SYSTEM_ID]?.[CREATION_FLAG]);
    const granted = plannedFeats.map(i => {
      const view = this.#catalog.byUuid.get(i._stats?.compendiumSource) ?? null;
      const choice = i.system.choiceText ? ` (${i.system.choiceText})` : "";
      return { name: `${i.name}${choice}`, img: i.img, tip: tipHtml({ name: i.name, img: i.img, meta: view?.categoryLabel ?? "", html: view?.html ?? "" }) };
    });
    const tormentaOpen = pools.some(p => (p.id === "tormenta") && (picksIn("tormenta").length < p.count));
    const poolViews = pools.map(p => ({
      id: p.id,
      label: W(`Feats.pool.${p.id}`),
      hint: W(`Feats.poolHint.${p.id}`),
      count: p.count,
      picks: picksIn(p.id).map(x => featPickView(x, this.#catalog, this.#takenFor(plan, x.pick))),
      empty: Array.from({ length: Math.max(0, p.count - picksIn(p.id).length) }, () => ({}))
    }));
    const hasRoom = feat => pools.some(p => p.accepts(feat) && (picksIn(p.id).length < p.count));
    const { feats, filters } = featRows({
      catalog: this.#catalog, ctx, hasRoom, expanded: this.#expanded, active: this.#filters.feats,
      violation: feat => (((feat.category === "tormenta") && !tormentaOpen) ? this.#violationTag(plan, "severa") : null)
    });
    return { pools: poolViews, granted, feats, filters, query: this.#filters.featQuery, ...choiceLists(this.#catalog) };
  }

  #jutsusStep(plan) {
    const state = this.#jutsuState(plan);
    const pools = state.pools;
    const pickedUuids = new Set(this.draft.jutsus.map(j => j.uuid));
    const owned = new Set(plan.items.filter(i => (i.type === "jutsu") && !i.flags?.[SYSTEM_ID]?.[CREATION_FLAG]).map(i => i._stats?.compendiumSource));
    const roomFor = jutsu => pools.some(p => poolTakes(p, jutsu) && (state.picks.filter(x => x.pick.pool === p.id).length < p.count));
    const { jutsus, filters } = jutsuRows({
      jutsus: this.#catalog.jutsus.filter(j => pools.some(p => poolTakes(p, j))), owned, picked: pickedUuids, roomFor,
      violation: j => this.#violationTag(plan, jutsuSeverity(j.descriptors, j.grade)), expanded: this.#expanded, active: this.#filters.jutsus
    });
    const describe = p => {
      const chak = p.anyChakra ? W("Jutsus.anyChakra") : p.chakras.map(c => L(CHAKRAS[c]?.label ?? c)).join(", ");
      return WF("Jutsus.poolRule", { n: p.count, chakras: chak }) + (p.names.length ? ` ${WF("Jutsus.poolNames", { names: p.names.map(n => `“${n}”`).join(", ") })}` : "");
    };
    return {
      none: !pools.length,
      pools: pools.map(p => {
        const picks = state.picks.filter(x => x.pick.pool === p.id);
        return {
          id: p.id, name: p.name, img: p.img, count: p.count, rule: describe(p),
          picks: picks.map(x => ({ uuid: x.pick.uuid, name: x.jutsu?.name ?? "—", img: x.jutsu?.img, kanji: x.jutsu?.kanji, ok: x.ok,
            tip: x.jutsu ? tipHtml({ name: x.jutsu.name, img: x.jutsu.img, meta: `${x.jutsu.chakraLabel} · ${x.jutsu.gradeLabel}`, html: x.jutsu.html }) : "" })),
          empty: Array.from({ length: Math.max(0, p.count - picks.length) }, () => ({}))
        };
      }),
      jutsus,
      filters,
      query: this.#filters.jutsuQuery
    };
  }

  /** The kit recommended for the class: its pieces in order while the money lasts, then the weapons the class picked. */
  #kitCart() {
    const plan = this.#plan;
    const cls = plan?.cls;
    if (!cls) return [];
    const names = [...(CLASS_KITS[cls.key] ?? [])];
    const picks = CLASS_WEAPON_PICKS[cls.key];
    if (picks) {
      const chosen = this.draft.choices[classChoices(cls, this.#catalog).find(c => c.kind === "weapons")?.uuid]?.choices ?? [];
      const feat = this.#catalog.featByName.get("usar arma exotica");
      for (const id of chosen) {
        const exotic = feat?.choice?.options?.find(o => o.id === id)?.traits?.exotic ?? [id];
        const ware = this.#catalog.shop.find(w => (w.type === "weapon") && exotic.some(n => w.key.includes(norm(n))) && (w.price <= 3000));
        if (ware) names.push(ware.name);
      }
    }
    let left = (CASTE_MONEY[this.draft.caste] ?? 0) * 100;
    const cart = [];
    for (const name of names) {
      const ware = this.#catalog.shop.find(w => w.key === norm(name));
      if (!ware || (ware.price > left)) continue;
      cart.push(ware.uuid);
      left -= ware.price;
    }
    return cart;
  }

  /** Can the character use a weapon or armor (its proficiencies in the preview)? */
  #proficient(ware, traits) {
    const prof = traits?.proficiency;
    if (!prof) return true;
    if (ware.type === "weapon") {
      if (prof.includes(ware.weapon.category)) return true;
      return (traits.exotic ?? []).some(n => n && ware.key.includes(norm(n)));
    }
    if (ware.type === "armor") return prof.includes(ware.armor.category);
    return true;
  }

  #gearStep(plan) {
    const d = this.draft;
    const sys = plan.preview.system;
    const money = moneyOf(d, this.#catalog);
    const race = plan.race;
    const honor = plan.honor.final;
    const castes = Object.keys(CASTES).map(id => {
      const fit = casteFit(id, { race: race?.name, honor });
      return { id, label: L(CASTES[id]), money: WF("Gear.money", { n: CASTE_MONEY[id] }), active: d.caste === id, ok: fit.ok, note: fit.note ? L(fit.note) : "", kanji: { daizenshi: "貴", shimin: "民", nainin: "浪" }[id] };
    });
    const counts = new Map();
    for (const uuid of d.cart) counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
    const traits = sys.traits ?? {};
    const filter = this.#filters.shop;
    const query = norm(this.#filters.shopQuery);
    const wares = this.#catalog.shop.map(w => {
      const proficient = this.#proficient(w, traits);
      const canBuy = w.price <= money.left;
      return {
        ...w, count: counts.get(w.uuid) ?? 0, canBuy, reason: canBuy ? "" : W("Gear.noMoney"),
        noProf: !proficient, hidden: (filter && (w.filter !== filter)) || (query && !w.search.includes(query)),
        tip: tipHtml({ name: w.name, img: w.img, meta: [w.folder, w.line].filter(Boolean).join(" · "), html: w.html })
      };
    });
    const cart = [...counts.entries()].map(([uuid, n]) => {
      const w = this.#catalog.byUuid.get(uuid);
      return w ? { uuid, name: w.name, img: w.img, count: n, priceLabel: moneyLabel(w.price * n), noProf: !this.#proficient(w, traits), dishonorable: w.dishonorable } : null;
    }).filter(Boolean);
    // What the class gives (the samurai's daisho, the kensei's masterwork weapon)
    const gifts = plan.items.filter(i => ["weapon", "armor", "gear"].includes(i.type) && !i.flags?.[SYSTEM_ID]?.[CREATION_FLAG]?.kind?.startsWith("bought"))
      .map(i => ({ name: i.name, img: i.img }));
    const cls = plan.cls;
    const kitNames = cls ? (CLASS_KITS[cls.key] ?? []) : [];
    const kitWares = kitNames.map(n => this.#catalog.shop.find(w => w.key === norm(n))).filter(Boolean);
    const kitCart = this.#kitCart();
    const kit = cls ? {
      className: cls.name, img: cls.img,
      pieces: kitWares.map(w => ({ name: w.name, img: w.img, priceLabel: w.price ? moneyLabel(w.price) : W("Gear.free") })),
      cost: moneyLabel(kitWares.reduce((t, w) => t + w.price, 0)),
      taken: kitCart.length && ([...d.cart].sort().join("|") === [...kitCart].sort().join("|")),
      note: W(`Gear.kit.${cls.key.replace(/\s+/g, "")}`)
    } : null;
    const armor = plan.preview.items.find(i => (i.type === "armor") && i.system.equipped && (i.system.category !== "escudo"));
    const shield = plan.preview.items.find(i => (i.type === "armor") && i.system.equipped && (i.system.category === "escudo"));
    const weapons = plan.preview.items.filter(i => (i.type === "weapon") && i.system.equipped);
    const weight = plan.preview.items.reduce((t, i) => t + ((i.system.weight ?? 0) * (i.system.quantity ?? 0)), 0);
    return {
      castes,
      money: { budget: moneyLabel(money.budget), spent: moneyLabel(money.spent), left: moneyLabel(Math.max(0, money.left)), over: money.left < 0, pct: money.pct },
      kit,
      cart,
      gifts,
      hasCart: d.cart.length > 0,
      worn: {
        armor: armor ? { name: armor.name, img: armor.img } : null,
        shield: shield ? { name: shield.name, img: shield.img } : null,
        weapons: weapons.map(w => ({ name: w.name, img: w.img, attack: signed(w.system.attackTotal), damage: w.system.damageFormula, crit: w.system.critLabel }))
      },
      numbers: { ca: sys.ca.total, penalty: sys.armor.penalty, maxDex: sys.armor.maxDex ?? "—", weight: Math.round(weight * 10) / 10 },
      filters: [{ id: "", icon: "fa-solid fa-border-all", label: W("Gear.all"), count: wares.length },
        ...SHOP_FILTERS.map(f => ({ ...f, label: L(f.label), count: wares.filter(w => w.filter === f.id).length })).filter(f => f.count)]
        .map(f => ({ ...f, active: f.id === filter })),
      wares,
      query: this.#filters.shopQuery
    };
  }

  #summaryStep(plan) {
    const d = this.draft;
    const preview = plan.preview;
    const sys = preview.system;
    const race = plan.race;
    const cls = plan.cls;
    const tier = honorTier(sys.abilities.hon.total);
    const intMod = Math.max(0, sys.abilities.int.mod);
    const racial = RACE_LANGUAGES[race?.key] ?? [];
    const extras = (d.details.languages ?? []).filter(l => (l !== "Ningo") && !racial.includes(l));
    const items = preview.items;
    const byType = type => items.filter(i => i.type === type);
    const skills = [];
    for (const [key, cfg] of Object.entries(SKILLS)) {
      const s = sys.skills[key];
      if (s.trained || (sys.traits?.trainedSkills ?? []).includes(key)) skills.push({ label: L(cfg.label), total: signed(s.total) });
    }
    for (const s of Object.values(sys.specialties)) if (s.trained) skills.push({ label: `${L(SKILLS[s.skill].label)} (${s.label})`, total: signed(s.total) });
    const ageDice = AGE_DICE[cls?.key] ?? "1d6";
    return {
      name: d.name,
      img: d.img || this.actor.img,
      identity: [race?.name, cls ? `${cls.name} 1` : null, d.caste ? casteLabel(d.caste) : null].filter(Boolean),
      hero: [
        { icon: "fa-solid fa-heart", label: L("IJ.PV.abbr"), value: sys.attributes.pv.max },
        { icon: "fa-solid fa-droplet", label: L("IJ.PM.abbr"), value: sys.attributes.pm.max },
        { icon: "fa-solid fa-shield-halved", label: L("IJ.CA.abbr"), value: sys.ca.total },
        { icon: "fa-solid fa-yin-yang", label: L("IJ.Ability.hon"), value: sys.abilities.hon.total }
      ],
      tier: L(tier.label),
      tierKey: tier.key,
      abilities: GEN_KEYS.map(k => ({ key: k, kanji: ABILITIES[k].kanji, abbr: ABBR(k), label: LABEL(k), total: sys.abilities[k].total, mod: signed(sys.abilities[k].mod) })),
      numbers: this.#numbers(plan).concat([
        { icon: "fa-solid fa-eye", label: L("IJ.Skill.percepcao"), value: signed(sys.skills.percepcao.total) },
        { icon: "fa-solid fa-shoe-prints", label: L("IJ.Movement.label"), value: `${sys.movement} m` },
        { icon: "fa-solid fa-gauge", label: W("Summary.pmLimit"), value: sys.attributes.pm.limit }
      ]),
      skills,
      powers: byType("power").map(i => ({ name: i.name, img: i.img, origin: i.system.originName })),
      feats: byType("feat").map(i => ({ name: i.system.choiceText ? `${i.name} (${i.system.choiceText})` : i.name, img: i.img })),
      jutsus: byType("jutsu").map(i => ({ name: i.name, img: i.img, kanji: CHAKRAS[i.system.chakra]?.kanji ?? "" })),
      gear: [...byType("weapon"), ...byType("armor"), ...byType("gear"), ...byType("consumable")].map(i => ({
        name: (i.system.quantity ?? 1) > 1 ? `${i.name} ×${i.system.quantity}` : i.name, img: i.img, equipped: !!i.system.equipped && (i.type !== "gear")
      })),
      money: moneyLabel(Math.max(0, moneyOf(d, this.#catalog).left)),
      violations: plan.honor.list.map(v => ({ ...v, severityLabel: L(`IJ.Honor.violation.${v.severity}`), ignored: !v.damage })),
      honorLine: WF("Summary.honorLine", { base: plan.honor.base, race: signed(plan.honor.race), cls: signed(plan.honor.cls), final: sys.abilities.hon.total }),
      details: d.details,
      religion: plan.system.details.religion,
      bio: d.bio,
      ageDice: `15 + ${ageDice}`,
      languages: {
        fixed: ["Ningo", ...racial],
        max: intMod,
        picked: extras.length,
        options: LANGUAGES.filter(l => (l !== "Ningo") && !racial.includes(l)).map(l => ({
          name: l, on: extras.includes(l), disabled: !extras.includes(l) && (extras.length >= intMod)
        }))
      },
      rebuild: !CreationWizard.isBlank(this.actor)
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override A step opened anew starts at its top. */
  _syncPartState(partId, newElement, priorElement, state) {
    if ((partId === "step") && (priorElement?.className !== newElement?.className)) state.scrollPositions = [];
    super._syncPartState(partId, newElement, priorElement, state);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const step = root.querySelector(".wz-step");
    if (!step) return;
    this.#activateCards(step);
    this.#activateInputs(step);
    this.#applyFilters(step);
    // Enter or space on a card chooses it (as a click), and never reaches the core's keys (space pauses the game)
    step.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key)) return;
      if (event.target.closest?.("input, textarea, select")) return;
      if (event.target.closest?.("button, [data-action][tabindex]")) event.stopPropagation();
      const card = event.target.closest?.("[data-action][tabindex]");
      if (!card || (card !== event.target)) return;
      event.preventDefault();
      card.click();
    });
  }

  /** Cards and their pages: the page of the card under the pointer, else of the one chosen. */
  #activateCards(step) {
    const pages = [...step.querySelectorAll(".wz-page[data-key]")];
    if (!pages.length) return;
    const chosen = step.dataset.selected || "";
    const show = key => {
      const target = key || chosen || "";
      let found = false;
      for (const page of pages) {
        const on = page.dataset.key === target;
        if (on && page.hidden) page.animate?.([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 140, easing: "ease-out" });
        page.hidden = !on;
        found ||= on;
      }
      const guide = step.querySelector(".wz-page.wz-guide");
      if (guide) guide.hidden = found;
      step.querySelector(".wz-detail")?.classList.toggle("preview", !!key && (key !== chosen));
    };
    const grid = step.querySelector(".wz-grid");
    grid?.addEventListener("pointerover", event => {
      const card = event.target.closest?.(".wz-card[data-key]");
      if (card) show(card.dataset.key);
    });
    grid?.addEventListener("pointerleave", () => show(null));
    grid?.addEventListener("focusin", event => {
      const card = event.target.closest?.(".wz-card[data-key]");
      if (card) show(card.dataset.key);
    });
    show(null);
  }

  /** The fields of the steps: what changes the plan draws again; names and texts only change the draft. */
  #activateInputs(step) {
    const d = this.draft;
    for (const input of step.querySelectorAll("[data-field]")) {
      const field = input.dataset.field;
      const live = ["name", "detail", "bio", "query"].includes(field);
      input.addEventListener(live ? "input" : "change", event => this.#onField(event, input, field));
    }
    // The language chips and the portrait need nothing more; the summary's name changes the rail and the title
    const nameInput = step.querySelector("[data-field='name']");
    nameInput?.addEventListener("input", () => {
      const rail = this.element.querySelector(".wz-rail-name");
      if (rail) rail.textContent = nameInput.value || this.actor.name;
      const create = this.element.querySelector(".wz-create");
      if (create) create.disabled = !nameInput.value.trim() || !STEPS.slice(0, -1).every(s => this.#done()[s.id]);
      this.window?.title && (this.window.title.textContent = this.title);
      d.name = nameInput.value;
    });
  }

  /** A field changed. */
  #onField(event, input, field) {
    const d = this.draft;
    const value = input.type === "checkbox" ? input.checked : input.value;
    switch (field) {
      case "choiceText": {
        const uuid = input.dataset.uuid;
        d.choices[uuid] = { ...(d.choices[uuid] ?? {}), text: String(value ?? "").trim() };
        return this.#refresh();
      }
      case "featText": {
        const pick = d.feats.find(f => f.key === input.dataset.key);
        if (pick) pick.text = String(value ?? "").trim();
        return this.#refresh();
      }
      case "featSelect": {
        const pick = d.feats.find(f => f.key === input.dataset.key);
        if (pick) pick.choices = value ? [value] : [];
        return this.#refresh();
      }
      case "free": {
        d.free[input.dataset.key] = Math.clamp(Number(value) || 10, FREE.min, FREE.max);
        return this.#refresh();
      }
      case "assign": {
        const key = input.dataset.key;
        const i = (value === "") ? null : Number(value);
        // A roll goes to one ability: the one that had it gives it up
        for (const k of GEN_KEYS) if ((k !== key) && (d.assign[k] === i)) d.assign[k] = null;
        d.assign[key] = i;
        return this.#refresh();
      }
      case "specialtyLabel": {
        const spec = d.specialties.find(s => s.id === input.dataset.id);
        if (spec) spec.label = String(value ?? "").trim();
        return this.#refresh();
      }
      case "name": {
        d.name = value;
        return;
      }
      case "detail": {
        d.details[input.dataset.key] = value;
        return;
      }
      case "bio": {
        d.bio[input.dataset.key] = value;
        return;
      }
      case "query": {
        this.#filters[input.dataset.key] = value;
        this.#applyFilters(this.element.querySelector(".wz-step"));
        return;
      }
    }
  }

  /** Show the rows of the filter and of the text searched, without drawing again. */
  #applyFilters(step) {
    if (!step) return;
    const apply = (selector, filterKey, queryKey, matches) => {
      const filter = this.#filters[filterKey];
      const query = norm(this.#filters[queryKey]);
      let shown = 0;
      for (const row of step.querySelectorAll(selector)) {
        const on = matches(row, filter) && (!query || (row.dataset.search ?? "").includes(query));
        row.hidden = !on;
        if (on) shown += 1;
      }
      const empty = step.querySelector(`${selector.split(" ")[0]}-empty, .wz-empty[data-for="${filterKey}"]`);
      if (empty) empty.hidden = shown > 0;
      for (const chip of step.querySelectorAll(`[data-action='filter'][data-list='${filterKey}']`)) chip.classList.toggle("active", (chip.dataset.filter ?? "") === filter);
    };
    apply(".wz-feat", "feats", "featQuery", (row, f) => !f || ((f === "available") ? row.dataset.available === "true" : row.dataset.category === f));
    apply(".wz-jutsu", "jutsus", "jutsuQuery", (row, f) => !f || (row.dataset.chakra === f));
    apply(".wz-ware", "shop", "shopQuery", (row, f) => !f || (row.dataset.filter === f));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onStep(event, target) {
    return this.goTo(target.dataset.step);
  }

  static #onNext() {
    const index = STEPS.findIndex(s => s.id === this.step);
    if (!this.#done()[this.step]) return;
    if (STEPS[index + 1]) return this.goTo(STEPS[index + 1].id);
  }

  static #onBack() {
    const index = STEPS.findIndex(s => s.id === this.step);
    if (index > 0) return this.goTo(STEPS[index - 1].id);
  }

  /** Choose a race or a class (a card). */
  static #onPick(event, target) {
    const { kind, key } = target.closest("[data-kind]").dataset;
    const d = this.draft;
    if ((kind === "race") && (d.race !== key)) {
      d.race = key;
      d.raceAbilities = [];
      // The choices of the old race's abilities go
      for (const f of this.#catalog.races.flatMap(r => r.features)) delete d.choices[f.uuid];
      // A race with a single option chooses it at once
      const race = this.#catalog.byUuid.get(key);
      for (const c of raceChoices(race)) if ((c.options.length === 1) && !c.text) d.choices[c.uuid] = { choices: [c.options[0].id] };
      this.#fixRaceDependents();
    }
    else if ((kind === "class") && (d.class !== key)) {
      d.class = key;
      d.ancestral = null;
      for (const f of this.#catalog.classes.flatMap(c => c.features)) delete d.choices[f.uuid];
      for (const f of this.#catalog.classes.flatMap(c => c.startingFeatList)) delete d.choices[f.uuid];
      // The class's skills and its kit change: the picks that no longer fit go
      const cls = this.#catalog.byUuid.get(key);
      d.feats = d.feats.filter(f => f.pool !== "technique");
      d.jutsus = [];
      d.kitOffered = false;
      d.cart = [];
      if (cls) {
        const own = new Set(cls.classSkills);
        const race = this.#catalog.byUuid.get(d.race);
        const any = race?.bonusSkills ?? 0;
        let outside = 0;
        d.skills = d.skills.filter(k => own.has(k) || (outside++ < any));
        d.specialties = d.specialties.filter(s => own.has(s.skill) || (outside++ < any));
      }
    }
    else return;
    return this.#refresh();
  }

  /** A new race: what depended on the old one (its Tormenta pool, its extra feats and skills) is checked again. */
  #fixRaceDependents() {
    const d = this.draft;
    const race = this.#catalog.byUuid.get(d.race);
    if (!race?.features.some(f => f.key === "talentos da tormenta")) d.feats = d.feats.filter(f => f.pool !== "tormenta");
    if (!race?.bonusFeats) d.feats = d.feats.filter(f => f.pool !== "race");
    d.jutsus = d.jutsus.filter(j => !j.pool.startsWith("brincar com os sentimentos"));
  }

  /** The human's and mashin's +2 in two abilities. */
  static #onRaceAbility(event, target) {
    const race = this.#catalog.byUuid.get(this.draft.race);
    if (!race?.choice.count) return;
    const key = target.dataset.ability;
    const list = this.draft.raceAbilities;
    if (list.includes(key)) list.splice(list.indexOf(key), 1);
    else if (list.length < race.choice.count) list.push(key);
    else return;
    return this.#refresh();
  }

  /** An option of a choice of the race or class step. */
  static #onOption(event, target) {
    const box = target.closest("[data-choice]");
    const { choice: uuid, kind, count } = box.dataset;
    const id = target.dataset.option;
    const d = this.draft;
    if (kind === "ancestral") {
      d.ancestral = id;
      return this.#refresh();
    }
    const made = d.choices[uuid] ?? { choices: [], text: "" };
    let picks = [...(made.choices ?? [])];
    const max = Number(count) || 1;
    if (picks.includes(id)) picks = picks.filter(x => x !== id);
    else if (max === 1) picks = [id];
    else if (picks.length < max) picks.push(id);
    else return;
    // The arma eleita: the unarmed strike writes its own name; a weapon asks for its name
    let text = made.text ?? "";
    if (box.dataset.eleita === "true") {
      if (picks.includes("desarmado")) text = "desarmado";
      else if (text === "desarmado") text = "";
    }
    d.choices[uuid] = { choices: picks, text };
    return this.#refresh();
  }

  /** The generation method. */
  static #onMethod(event, target) {
    const method = target.dataset.method;
    if (!this.#methods().includes(method) || (this.draft.method === method)) return;
    this.draft.method = method;
    return this.#refresh();
  }

  /** The benefit of the 1st level: a feat, or +1 in an ability (data-kind, data-ability). */
  static #onLevelBonus(event, target) {
    const { kind, ability } = target.dataset;
    const bonus = this.draft.levelBonus ?? { kind: "feat", ability: null };
    if (kind) {
      bonus.kind = kind;
      // The feat of the 1st level leaves with a +1
      if (kind === "ability") this.draft.feats = this.draft.feats.filter(f => f.pool !== "base");
    }
    if (ability) bonus.ability = (bonus.ability === ability) ? null : ability;
    this.draft.levelBonus = bonus;
    return this.#refresh();
  }

  /** One point more or less in the point buy. */
  static #onPoint(event, target) {
    const key = target.dataset.key;
    const delta = Number(target.dataset.delta) || 0;
    const points = this.draft.points;
    const next = (points[key] ?? 10) + delta;
    if ((next < POINT_BUY.min) || (next > POINT_BUY.max)) return;
    const after = { ...points, [key]: next };
    if ((delta > 0) && (pointsSpent(after) > POINT_BUY.budget)) return;
    points[key] = next;
    return this.#refresh();
  }

  /** The scores suggested for the class (points), or the rolls spread by the class's priorities. */
  static #onSuggest() {
    const cls = this.#cls();
    if (!cls) return;
    if (this.draft.method === "points") this.draft.points = suggestedScores(cls.name);
    else if (this.draft.method === "roll") this.draft.assign = assignRolls(this.#rolls().values, cls.name);
    else return;
    return this.#refresh();
  }

  static #onResetScores() {
    const ten = Object.fromEntries(GEN_KEYS.map(k => [k, 10]));
    if (this.draft.method === "points") this.draft.points = ten;
    else if (this.draft.method === "free") this.draft.free = ten;
    else this.draft.assign = {};
    return this.#refresh();
  }

  /** Roll the seven scores (or again, when the book allows it): kept on the actor and shown in the chat. */
  static async #onRoll(event, target) {
    const rolls = this.#rolls();
    if (rolls.values.length && !rerollAllowed(rolls.values) && !game.user.isGM) return;
    if (target) target.disabled = true;
    try {
      const results = [];
      for (let i = 0; i < ROLL.count; i++) results.push(await new Roll(ROLL.formula).evaluate());
      const values = results.map(r => r.total);
      const flag = this.actor.getFlag(SYSTEM_ID, ROLLS_FLAG) ?? {};
      const sets = [...(Array.isArray(flag.sets) ? flag.sets : []), { values, at: Date.now(), user: game.user.id }];
      await this.actor.setFlag(SYSTEM_ID, ROLLS_FLAG, { sets });
      this.draft.assign = {};
      const content = await foundry.applications.handlebars.renderTemplate(`${DIR}/roll-card.hbs`, {
        name: this.actor.name, again: sets.length > 1,
        values: values.map(v => ({ v, mod: signed(abilityMod(v)) })),
        mods: signed(values.reduce((t, v) => t + abilityMod(v), 0)),
        reroll: rerollAllowed(values)
      });
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content, rolls: results });
    }
    catch (err) {
      console.error(`${SYSTEM_ID} | rolagem de habilidades`, err);
      ui.notifications.error(err.message);
    }
    return this.#refresh();
  }

  /** The rolls spread by the class's priorities. */
  static #onAutoAssign() {
    const cls = this.#cls();
    const values = this.#rolls().values;
    if (!values.length) return;
    this.draft.assign = assignRolls(values, cls?.name ?? "");
    return this.#refresh();
  }

  /** The GM lets the player roll anew. */
  static async #onResetRolls() {
    if (!game.user.isGM) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: W("Abilities.resetRolls") },
      content: `<p>${WF("Abilities.resetRollsConfirm", { name: escape(this.actor.name) })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    await this.actor.unsetFlag(SYSTEM_ID, ROLLS_FLAG);
    this.draft.assign = {};
    return this.#refresh();
  }

  /** Train or untrain a skill. */
  static #onSkill(event, target) {
    const key = target.closest("[data-skill]").dataset.skill;
    const d = this.draft;
    if (d.skills.includes(key)) d.skills = d.skills.filter(k => k !== key);
    else {
      const plan = this.#plan;
      const { slots } = plan.derived;
      const state = this.#skillState(plan);
      if (state.count >= slots.total) return ui.notifications.warn(W("Skills.full"));
      if (!slots.classSkills.has(key) && (state.outside >= slots.any)) return ui.notifications.warn(slots.any ? W("Skills.outsideFull") : W("Skills.notClass"));
      d.skills.push(key);
    }
    return this.#refresh();
  }

  /** A specialty of Atuação, Conhecimento or Ofício (a suggested one, or a blank to type). */
  static #onSpecialty(event, target) {
    const skill = target.closest("[data-skill]").dataset.skill;
    const plan = this.#plan;
    const { slots } = plan.derived;
    const state = this.#skillState(plan);
    if (state.count >= slots.total) return ui.notifications.warn(W("Skills.full"));
    if (!slots.classSkills.has(skill) && (state.outside >= slots.any)) return ui.notifications.warn(slots.any ? W("Skills.outsideFull") : W("Skills.notClass"));
    this.draft.specialties.push({ id: foundry.utils.randomID(), skill, label: target.dataset.name ?? "" });
    return this.#refresh();
  }

  static #onSpecialtyRemove(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    this.draft.specialties = this.draft.specialties.filter(s => s.id !== id);
    return this.#refresh();
  }

  /** A feat to the first pool with room that takes it (the narrow pools first). */
  static #onFeatAdd(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const feat = this.#catalog.byUuid.get(uuid);
    const plan = this.#plan;
    if (!feat || !plan) return;
    const pools = plan.derived.pools;
    const inPool = id => this.draft.feats.filter(f => f.pool === id).length;
    const pool = POOL_ORDER.map(id => pools.find(p => p.id === id)).find(p => p && p.accepts(feat) && (inPool(p.id) < p.count));
    if (!pool) return ui.notifications.warn(W("Feats.full"));
    const choice = feat.choice;
    const options = choice?.options ?? [];
    this.draft.feats.push({ key: foundry.utils.randomID(), uuid, pool: pool.id, choices: (options.length === 1) ? [options[0].id] : [], text: "" });
    return this.#refresh();
  }

  static #onFeatRemove(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    this.draft.feats = this.draft.feats.filter(f => f.key !== key);
    return this.#refresh();
  }

  /** An option of the choice of a picked feat. */
  static #onFeatOption(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    const pick = this.draft.feats.find(f => f.key === key);
    const feat = pick && this.#catalog.byUuid.get(pick.uuid);
    if (!feat?.choice) return;
    const id = target.dataset.option;
    const max = Math.max(1, Number(feat.choice.count) || 1);
    let picks = [...(pick.choices ?? [])];
    if (picks.includes(id)) picks = picks.filter(x => x !== id);
    else if (max === 1) picks = [id];
    else if (picks.length < max) picks.push(id);
    else return;
    pick.choices = picks;
    return this.#refresh();
  }

  /** Open or close the text of a row. */
  static #onExpand(event, target) {
    if (event.target.closest("button, input, select, a[data-action]:not([data-action='expand'])")) return;
    const row = target.closest("[data-uuid]");
    const uuid = row?.dataset.uuid;
    if (!uuid) return;
    if (this.#expanded.has(uuid)) this.#expanded.delete(uuid);
    else this.#expanded.add(uuid);
    row.classList.toggle("expanded", this.#expanded.has(uuid));
  }

  /** A filter chip of a list. */
  static #onFilter(event, target) {
    const list = target.dataset.list;
    this.#filters[list] = (this.#filters[list] === (target.dataset.filter ?? "")) ? "" : (target.dataset.filter ?? "");
    this.#applyFilters(this.element.querySelector(".wz-step"));
  }

  /** A jutsu to the first pool with room that takes it. */
  static #onJutsuAdd(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const jutsu = this.#catalog.byUuid.get(uuid);
    const pools = this.#plan?.derived.jutsu ?? [];
    if (!jutsu || this.draft.jutsus.some(j => j.uuid === uuid)) return;
    const inPool = id => this.draft.jutsus.filter(j => j.pool === id).length;
    // The pool that takes the fewest kinds of jutsus first (the hanyô's Carisma before Conhecimento de Jutsus)
    const pool = [...pools].sort((a, b) => (a.anyChakra - b.anyChakra) || (a.chakras.length - b.chakras.length))
      .find(p => poolTakes(p, jutsu) && (inPool(p.id) < p.count));
    if (!pool) return ui.notifications.warn(W("Jutsus.full"));
    this.draft.jutsus.push({ uuid, pool: pool.id });
    return this.#refresh();
  }

  static #onJutsuRemove(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    this.draft.jutsus = this.draft.jutsus.filter(j => j.uuid !== uuid);
    return this.#refresh();
  }

  /** The caste (and its money): the kit is bought again with the new money when the bag still holds exactly the kit. */
  static #onCaste(event, target) {
    const caste = target.dataset.caste;
    if (!CASTES[caste] || (this.draft.caste === caste)) return;
    const kitBefore = this.#kitCart();
    const wasKit = this.draft.cart.length && ([...this.draft.cart].sort().join("|") === [...kitBefore].sort().join("|"));
    this.draft.caste = caste;
    if (wasKit || !this.draft.cart.length) this.draft.cart = this.#kitCart();
    return this.#refresh();
  }

  static #onBuy(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const ware = this.#catalog.byUuid.get(uuid);
    if (!ware) return;
    if (ware.price > moneyOf(this.draft, this.#catalog).left) return ui.notifications.warn(W("Gear.noMoney"));
    this.draft.cart.push(uuid);
    return this.#refresh();
  }

  static #onSell(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const i = this.draft.cart.lastIndexOf(uuid);
    if (i < 0) return;
    this.draft.cart.splice(i, 1);
    return this.#refresh();
  }

  static #onKit() {
    this.draft.cart = this.#kitCart();
    return this.#refresh();
  }

  static #onEmptyCart() {
    this.draft.cart = [];
    return this.#refresh();
  }

  /** The portrait (the token takes it too while it has the default one). */
  static #onPortrait() {
    const picker = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: this.draft.img,
      callback: path => {
        this.draft.img = path;
        this.#refresh();
      }
    });
    return picker.browse();
  }

  /** The starting age by the class's dice (p. 87). */
  static async #onRollAge() {
    const cls = this.#cls();
    const roll = await new Roll(`15 + ${AGE_DICE[cls?.key] ?? "1d6"}`).evaluate();
    this.draft.details.age = String(roll.total);
    const input = this.element.querySelector("[data-field='detail'][data-key='age']");
    if (input) input.value = this.draft.details.age;
  }

  /** A language more or less (as many as the Intelligence bonus). */
  static #onLanguage(event, target) {
    const name = target.dataset.name;
    const list = this.draft.details.languages ?? [];
    const sys = this.#plan.preview.system;
    const max = Math.max(0, sys.abilities.int.mod);
    if (list.includes(name)) this.draft.details.languages = list.filter(l => l !== name);
    else if (list.filter(l => l !== "Ningo").length < max) this.draft.details.languages = [...list, name];
    else return;
    return this.#refresh();
  }

  /** Create the character, then open its sheet. */
  static async #onCreate(event, target) {
    if (this.#creating) return;
    await this.#replan();
    const done = this.#done();
    if (!STEPS.every(s => done[s.id])) return ui.notifications.warn(W("notDone"));
    if (!CreationWizard.isBlank(this.actor)) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: W("Summary.rebuildTitle") },
        content: `<p>${W("Summary.rebuildConfirm")}</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    this.#creating = true;
    if (target) target.disabled = true;
    try {
      const plan = this.#plan;
      // The languages: Ningo, the race's own and those picked
      const racial = RACE_LANGUAGES[plan.race?.key] ?? [];
      this.draft.details.languages = ["Ningo", ...racial, ...(this.draft.details.languages ?? []).filter(l => (l !== "Ningo") && !racial.includes(l))];
      const final = await planCharacter(this.draft, { catalog: this.#catalog, rolls: this.#rolls().values, actor: this.actor, violations: setting("creationViolations") !== false });
      await createCharacter(this.actor, final, this.draft);
      if (setting("creationCard") !== false) await this.#announce(final);
      await this.close();
      const sheet = this.actor.sheet;
      if (sheet) {
        sheet.tabGroups.primary = "ficha";
        await sheet.render({ force: true });
      }
      ui.notifications.info(WF("created", { name: this.actor.name }));
    }
    catch (err) {
      console.error(`${SYSTEM_ID} | não foi possível criar o personagem`, err);
      ui.notifications.error(WF("error", { error: err.message }));
      if (target) target.disabled = false;
    }
    finally {
      this.#creating = false;
    }
  }

  /** A card in the chat: the new character and what it chose. */
  async #announce(plan) {
    const sys = this.actor.system;
    const content = await foundry.applications.handlebars.renderTemplate(`${DIR}/chat-card.hbs`, {
      name: this.actor.name,
      img: this.actor.img,
      lines: [
        plan.race && { label: W("Step.race"), value: plan.race.name, img: plan.race.img },
        plan.cls && { label: W("Step.class"), value: `${plan.cls.name} 1`, img: plan.cls.img },
        this.draft.caste && { label: W("Rail.caste"), value: casteLabel(this.draft.caste) }
      ].filter(Boolean),
      numbers: [
        { label: L("IJ.PV.abbr"), value: sys.attributes.pv.max },
        { label: L("IJ.PM.abbr"), value: sys.attributes.pm.max },
        { label: L("IJ.CA.abbr"), value: sys.ca.total },
        { label: L("IJ.Ability.hon"), value: sys.abilities.hon.total }
      ],
      violations: plan.honor.list.filter(v => v.damage).map(v => ({ label: v.label, damage: v.damage }))
    });
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content });
  }
}
