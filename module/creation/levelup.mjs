/**
 * The level-up wizard: one level gained, step by step, in the order the book gives (p. 44-45), and written on the
 * sheet at once at the end. Only the steps the level asks for show:
 *
 *   1. Class      a level more in a class the character has, or the first level of another (multiclass, with the
 *                 Honor violation it is); the page shows what that level gives.
 *   2. Choices    the choices of the abilities the level brings (style, PM of the casters...), the choices that grow
 *                 with the level on what the character has (paths, effects, chakras, survivor's feats), the samurai's
 *                 ancestral sword that gets the +1, and the skill or starting feat of a new class.
 *   3. Feat       the benefit of the level: a feat or +1 in an ability; and the feats the class gives at that level
 *                 (technique, granted powers, chaotic studies, spiritual lessons), with their prerequisites checked.
 *   4. Jutsus     what the level teaches: the casters' Conhecimento de Jutsus, a new caster class, Abrir Chacra and the
 *                 chakra feats, the chakras the wu-jen opens.
 *   5. Skills     the skills a higher Intelligence brings.
 *   6. Summary    before and after, what comes and the Honor of the level.
 *
 * Beside every step, the character at the new level: a preview actor in memory (module/creation/level-plan.mjs).
 */
import { ABILITIES, CHAKRAS, SKILLS, SPECIALTIES, SYSTEM_ID, honorTier } from "../config.mjs";
import { norm } from "../auto/context.mjs";
import { loadCatalog } from "./catalog.mjs";
import { featContext, whoFor } from "./plan.mjs";
import {
  LEVEL_LOG, applyLevelUp, canLevel, classOptions, classesOf, emptyLevelDraft, levelChoiceDone, levelPoolTakes,
  levelRequirements, planLevelUp, primaryClass
} from "./level-plan.mjs";
import { FIXED_DAMAGE, GRADE_ORDER, SKILL_VIOLATIONS, checkPrerequisites, ignoresViolation, jutsuSeverity, signed } from "./rules.mjs";
import { choiceLists, featPickView, featRows, jutsuRows, tipHtml } from "./views.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DIR = `systems/${SYSTEM_ID}/templates/creation`;
const L = key => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);
const V = key => L(`IJ.Level.${key}`);
const VF = (key, data) => F(`IJ.Level.${key}`, data);
const W = key => L(`IJ.Wizard.${key}`);
const ABBR = k => L(ABILITIES[k].abbr);
const LABEL = k => L(ABILITIES[k].label);
const setting = key => {
  try {
    return game.settings.get(SYSTEM_ID, key);
  } catch {
    return undefined;
  }
};

/** The steps, in order; only those the level asks for show. */
export const LEVEL_STEPS = [
  { id: "class", kanji: "道", icon: "fa-solid fa-torii-gate" },
  { id: "choices", kanji: "選", icon: "fa-solid fa-hand-pointer" },
  { id: "feats", kanji: "才", icon: "fa-solid fa-star" },
  { id: "jutsus", kanji: "術", icon: "fa-solid fa-hand-sparkles" },
  { id: "skills", kanji: "技", icon: "fa-solid fa-scroll" },
  { id: "summary", kanji: "進", icon: "fa-solid fa-angles-up" }
];

/** The templates of the level-up steps (loaded at init). The jutsus and skills steps use the creation's. */
export const LEVEL_TEMPLATES = [`${DIR}/lv-class.hbs`, `${DIR}/lv-choices.hbs`, `${DIR}/lv-feats.hbs`, `${DIR}/lv-summary.hbs`];
const PARTIAL = { class: "lv-class", choices: "lv-choices", feats: "lv-feats", jutsus: "jutsus", skills: "skills", summary: "lv-summary" };

/** The order the feats of a level go to: the class's own pools before the open feat of the level. */
const isOpenPool = id => id === "level";

export class LevelUpWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  static idFor(actor) {
    return `ij-levelup-${actor.id}`;
  }

  /** Open the wizard of a character (or bring it to the front). */
  static open(actor) {
    if (!canLevel(actor)) {
      ui.notifications.warn(V("notAllowed"));
      return null;
    }
    const existing = foundry.applications.instances.get(this.idFor(actor));
    if (existing) return existing.render({ force: true });
    return new this(actor).render({ force: true });
  }

  constructor(actor, options = {}) {
    const width = Math.min(1260, window.innerWidth - 40);
    const height = Math.min(880, window.innerHeight - 40);
    super({
      ...options,
      id: LevelUpWizard.idFor(actor),
      position: { width, height, left: Math.max(0, (window.innerWidth - width) / 2), top: Math.max(0, (window.innerHeight - height) / 2) }
    });
    this.actor = actor;
    this.draft = emptyLevelDraft(actor);
    this.step = "class";
  }

  static DEFAULT_OPTIONS = {
    classes: ["imperiodejade", "ij-wizard", "ij-levelup"],
    tag: "div",
    window: { icon: "fa-solid fa-angles-up", resizable: true },
    actions: {
      step: LevelUpWizard.#onStep,
      next: LevelUpWizard.#onNext,
      back: LevelUpWizard.#onBack,
      pick: LevelUpWizard.#onPick,
      option: LevelUpWizard.#onOption,
      multiclass: LevelUpWizard.#onMulticlass,
      levelBonus: LevelUpWizard.#onLevelBonus,
      featAdd: LevelUpWizard.#onFeatAdd,
      featRemove: LevelUpWizard.#onFeatRemove,
      featOption: LevelUpWizard.#onFeatOption,
      expand: LevelUpWizard.#onExpand,
      filter: LevelUpWizard.#onFilter,
      jutsuAdd: LevelUpWizard.#onJutsuAdd,
      jutsuRemove: LevelUpWizard.#onJutsuRemove,
      skill: LevelUpWizard.#onSkill,
      specialty: LevelUpWizard.#onSpecialty,
      specialtyRemove: LevelUpWizard.#onSpecialtyRemove,
      create: LevelUpWizard.#onApply
    }
  };

  static PARTS = {
    head: { template: `${DIR}/head.hbs` },
    rail: { template: `${DIR}/lv-rail.hbs` },
    step: { template: `${DIR}/step.hbs`, scrollable: [".wz-grid", ".wz-detail", ".wz-scroll", ".wz-list", ".wz-side"] },
    foot: { template: `${DIR}/foot.hbs` }
  };

  #catalog = null;
  #plan = null;
  #seq = 0;
  #filters = { feats: "", featQuery: "", jutsus: "", jutsuQuery: "" };
  #expanded = new Set();
  #applying = false;

  /** @override */
  get title() {
    return VF("title", { name: this.actor.name, level: (this.actor.system.level ?? 1) + 1 });
  }

  /* -------------------------------------------- */
  /*  The plan and the steps                      */
  /* -------------------------------------------- */

  async #replan() {
    const seq = ++this.#seq;
    const plan = await planLevelUp(this.actor, this.draft, { catalog: this.#catalog, violations: setting("creationViolations") !== false });
    plan.reqs = levelRequirements(plan, this.draft, this.actor, this.#catalog);
    plan.ctx = featContext(plan.preview);
    if (seq === this.#seq) this.#plan = plan;
    return plan;
  }

  /** The steps this level asks for. */
  #steps(plan) {
    const r = plan.reqs;
    const show = {
      class: true,
      choices: r.choices.length > 0 || !!r.ancestral || !!r.multiclass,
      feats: true,
      jutsus: r.jutsuPools.length > 0,
      skills: r.skills.count > 0,
      summary: true
    };
    return LEVEL_STEPS.filter(s => show[s.id]);
  }

  /** Whether each step is done. */
  #done(plan) {
    const d = this.draft;
    const r = plan.reqs;
    const multiclass = !r.multiclass || ((d.multiclass.kind === "skill") ? !!d.multiclass.skill : this.#multiclassFeatDone(r));
    return {
      class: true,
      choices: r.choices.every(c => levelChoiceDone(c, d)) && (!r.ancestral || !!d.ancestral) && multiclass,
      feats: ((d.bonus.kind !== "ability") || !!d.bonus.ability) && (this.#featState(plan).problem === null),
      jutsus: this.#jutsuState(plan).problem === null,
      skills: this.#skillState(plan).problem === null,
      summary: true
    };
  }

  /** The starting feat picked for a new class, with its choice made. */
  #multiclassFeatDone(reqs) {
    const m = this.draft.multiclass;
    const feat = reqs.multiclass?.feats.find(f => f.uuid === m.feat);
    if (!feat) return false;
    if (feat.choice?.options?.length && !(m.choices ?? []).length) return false;
    if (feat.choice?.text && !String(m.text ?? "").trim()) return false;
    return true;
  }

  #featState(plan) {
    const pools = plan.reqs.featPools;
    const ctx = plan.ctx;
    const picks = this.draft.feats.map(pick => {
      const feat = this.#catalog.byUuid.get(pick.uuid);
      const pool = pools.find(p => p.id === pick.pool);
      if (!feat) return { pick, feat: null, problems: [W("Feats.missing")] };
      const problems = [];
      if (!pool || !pool.accepts(feat)) problems.push(W("Feats.badPool"));
      for (const r of checkPrerequisites(feat.checks, whoFor(ctx, feat, true))) if (r.ok === false) problems.push(F("IJ.Wizard.Feats.unmet", { text: r.text }));
      if (feat.honorMin && ((ctx.abilities.hon ?? 0) < feat.honorMin)) problems.push(F("IJ.Wizard.Feats.honor", { n: feat.honorMin }));
      if (!feat.repeatable && ((ctx.featCounts.get(feat.key) ?? 0) > 1)) problems.push(W("Feats.twice"));
      if (feat.perChoice && this.#sameChoice(pick)) problems.push(W("Feats.sameChoice"));
      if (feat.choice) {
        if ((feat.choice.options ?? []).length && !(pick.choices ?? []).length) problems.push(W("Feats.choose"));
        if (feat.choice.text && !String(pick.text ?? "").trim()) problems.push(W("Feats.chooseText"));
      }
      return { pick, feat, pool, problems };
    });
    const inPool = id => picks.filter(x => x.pick.pool === id).length;
    const open = pools.reduce((t, p) => t + Math.max(0, p.count - inPool(p.id)), 0);
    let problem = null;
    if ((this.draft.bonus.kind === "ability") && !this.draft.bonus.ability) problem = V("Hint.bonusAbility");
    else if (picks.some(x => x.problems.length)) problem = W("Hint.featsInvalid");
    else if (pools.some(p => inPool(p.id) > p.count)) problem = W("Hint.featsOver");
    else if (open) problem = F("IJ.Wizard.Hint.feats", { n: open });
    return { picks, problem };
  }

  /** The options of a picked feat that another copy already has (on the character, or another pick). */
  #takenFor(pick) {
    const taken = new Set(this.actor.items.filter(i => i._stats?.compendiumSource === pick.uuid).flatMap(i => i.system.choices ?? []));
    for (const other of this.draft.feats) if ((other.key !== pick.key) && (other.uuid === pick.uuid)) for (const c of other.choices ?? []) taken.add(c);
    return taken;
  }

  /** A picked feat made for one weapon or skill repeats a choice the character (or another pick) already has. */
  #sameChoice(pick) {
    const mine = { choices: pick.choices ?? [], text: norm(pick.text ?? "") };
    if (!mine.choices.length && !mine.text) return false;
    const others = this.actor.items.filter(i => i._stats?.compendiumSource === pick.uuid).map(i => ({ choices: i.system.choices ?? [], text: norm(i.system.choiceText ?? "") }));
    for (const other of this.draft.feats) if ((other.key !== pick.key) && (other.uuid === pick.uuid)) others.push({ choices: other.choices ?? [], text: norm(other.text ?? "") });
    return others.some(o => (mine.text && (o.text === mine.text)) || mine.choices.some(c => o.choices.includes(c)));
  }

  #jutsuState(plan) {
    const pools = plan.reqs.jutsuPools;
    const picks = this.draft.jutsus.map(pick => {
      const jutsu = this.#catalog.byUuid.get(pick.uuid);
      const pool = pools.find(p => p.id === pick.pool);
      return { pick, jutsu, pool, ok: !!jutsu && !!pool && levelPoolTakes(pool, jutsu) };
    });
    const inPool = id => picks.filter(x => x.pick.pool === id).length;
    // A pool asks for what it can teach: slots no jutsu within reach can fill don't hold the level
    const reach = p => Math.min(p.count, this.#catalog.jutsus.filter(j => levelPoolTakes(p, j)).length);
    const open = pools.reduce((t, p) => t + Math.max(0, reach(p) - inPool(p.id)), 0);
    let problem = null;
    if (picks.some(x => !x.ok)) problem = W("Hint.jutsusInvalid");
    else if (pools.some(p => inPool(p.id) > p.count)) problem = W("Hint.jutsusOver");
    else if (open) problem = F("IJ.Wizard.Hint.jutsus", { n: open });
    return { picks, pools, problem };
  }

  #skillState(plan) {
    const slots = plan.reqs.skills;
    const count = this.draft.skills.length + this.draft.specialties.length;
    let problem = null;
    if (count < slots.count) problem = F("IJ.Wizard.Hint.skills", { n: slots.count - count });
    else if (count > slots.count) problem = F("IJ.Wizard.Hint.skillsOver", { n: count - slots.count });
    else if (this.draft.specialties.some(s => !String(s.label ?? "").trim())) problem = W("Hint.specialty");
    return { count, problem };
  }

  #reachable(id, steps, done) {
    const index = steps.findIndex(s => s.id === id);
    return (index >= 0) && steps.slice(0, index).every(s => done[s.id]);
  }

  async goTo(id) {
    const plan = this.#plan;
    if (plan) {
      const steps = this.#steps(plan);
      if (!this.#reachable(id, steps, this.#done(plan))) return;
    }
    this.step = id;
    return this.#refresh();
  }

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
    const steps = this.#steps(plan);
    const done = this.#done(plan);
    if (!this.#reachable(this.step, steps, done)) this.step = steps.find(s => !done[s.id])?.id ?? steps[0].id;
    const index = steps.findIndex(s => s.id === this.step);
    return {
      plan, done,
      steps: steps.map((s, i) => ({
        ...s, n: i + 1, label: V(`Step.${s.id}`), done: done[s.id] && this.#reachable(s.id, steps, done),
        current: s.id === this.step, reachable: this.#reachable(s.id, steps, done)
      })),
      stepCount: steps.length,
      stepIndex: index,
      first: index === 0,
      last: index === steps.length - 1,
      next: steps[index + 1] ? V(`Step.${steps[index + 1].id}`) : "",
      complete: done[this.step],
      allDone: steps.every(s => done[s.id]),
      createLabel: VF("apply", { level: plan.level })
    };
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const plan = context.plan;
    switch (partId) {
      case "head": {
        const step = LEVEL_STEPS.find(s => s.id === this.step);
        return Object.assign(context, {
          kanji: step.kanji,
          eyebrow: VF("stepOf", { n: context.stepIndex + 1, total: context.stepCount, level: plan.level }),
          heading: V(`Heading.${this.step}`),
          lead: V(`Lead.${this.step}`)
        });
      }
      case "rail": return Object.assign(context, this.#railContext(plan));
      case "step": return Object.assign(context, this.#stepContext(plan));
      case "foot": {
        const steps = this.#steps(plan);
        const index = steps.findIndex(s => s.id === this.step);
        return Object.assign(context, {
          hint: context.done[this.step] ? V(`Done.${this.step}`) : this.#hint(plan),
          backLabel: index > 0 ? V(`Step.${steps[index - 1].id}`) : ""
        });
      }
    }
    return context;
  }

  /** What the open step still asks for. */
  #hint(plan) {
    const r = plan.reqs;
    const d = this.draft;
    switch (this.step) {
      case "choices": {
        const left = r.choices.filter(c => !levelChoiceDone(c, d));
        if (left.length) return F("IJ.Wizard.Hint.choices", { name: left[0].name });
        if (r.ancestral && !d.ancestral) return V("Hint.ancestral");
        return V("Hint.multiclass");
      }
      case "feats": return this.#featState(plan).problem ?? "";
      case "jutsus": return this.#jutsuState(plan).problem ?? "";
      case "skills": return this.#skillState(plan).problem ?? "";
    }
    return "";
  }

  /** The character before and at the new level. */
  #railContext(plan) {
    const before = this.actor.system;
    const after = plan.preview.system;
    const pair = (icon, label, a, b, sign = false) => ({ icon, label, before: sign ? signed(a) : a, after: sign ? signed(b) : b, up: b > a, down: b < a });
    const classLine = classesOf(this.actor).map(c => `${c.name} ${c.system.levels}`).join(" / ");
    const classAfter = plan.items.filter(i => i.type === "class").map(c => `${c.name} ${c.system.levels}`).join(" / ");
    const tier = honorTier(after.abilities.hon.total);
    return {
      portrait: this.actor.img,
      name: this.actor.name,
      levelBefore: before.level,
      levelAfter: plan.level,
      classLine, classAfter,
      abilities: ["for", "des", "con", "int", "sab", "car", "hon"].map(k => ({
        key: k, abbr: ABBR(k), total: after.abilities[k].total, mod: signed(after.abilities[k].mod), honor: k === "hon",
        up: after.abilities[k].total > before.abilities[k].total, down: after.abilities[k].total < before.abilities[k].total
      })),
      numbers: [
        pair("fa-solid fa-heart", L("IJ.PV.abbr"), before.attributes.pv.max, after.attributes.pv.max),
        pair("fa-solid fa-droplet", L("IJ.PM.abbr"), before.attributes.pm.max, after.attributes.pm.max),
        pair("fa-solid fa-shield-halved", L("IJ.CA.abbr"), before.ca.total, after.ca.total),
        pair("fa-solid fa-hand-fist", L("IJ.BBA.abbr"), before.bba, after.bba, true)
      ],
      saves: ["fort", "ref", "von"].map(k => pair("", L(`IJ.Save.${k}`), before.saves[k].total, after.saves[k].total, true)),
      honor: { total: after.abilities.hon.total, before: before.abilities.hon.total, tier: L(tier.label), key: tier.key, up: after.abilities.hon.total > before.abilities.hon.total, down: after.abilities.hon.total < before.abilities.hon.total }
    };
  }

  #stepContext(plan) {
    const base = { step: this.step, partial: `${DIR}/${PARTIAL[this.step]}.hbs` };
    switch (this.step) {
      case "class": return { ...base, ...this.#classStep(plan) };
      case "choices": return { ...base, ...this.#choicesStep(plan) };
      case "feats": return { ...base, ...this.#featsStep(plan) };
      case "jutsus": return { ...base, ...this.#jutsusStep(plan) };
      case "skills": return { ...base, ...this.#skillsStep(plan) };
      case "summary": return { ...base, ...this.#summaryStep(plan) };
    }
    return base;
  }

  #violationTag(plan, severity) {
    if (!severity) return null;
    const ignored = (setting("creationViolations") === false) || ignoresViolation(plan.honor.before + plan.honor.gain, severity);
    return { label: L(`IJ.Honor.violation.${severity}`), damage: FIXED_DAMAGE[severity], ignored };
  }

  #classStep(plan) {
    const options = classOptions(this.actor, this.#catalog);
    const selected = plan.cls?.uuid ?? "";
    const view = o => ({
      uuid: o.cls.uuid, name: o.cls.name, img: o.cls.img, kanji: o.cls.kanji, next: o.next, isNew: o.isNew, primary: o.primary,
      selected: o.cls.uuid === selected,
      line: o.isNew ? V("Class.multiclassCard") : VF("Class.continueCard", { n: o.next }),
      violation: o.violation ? this.#violationTag(plan, o.violation) : null,
      gains: [
        { icon: "fa-solid fa-heart", label: VF("Class.pv", { n: o.pv }) },
        { icon: "fa-solid fa-droplet", label: VF("Class.pm", { n: o.pm }) },
        o.bba ? { icon: "fa-solid fa-hand-fist", label: VF("Class.bba", { n: o.bba }) } : null,
        o.honor ? { icon: "fa-solid fa-yin-yang", label: V("Class.honor") } : null
      ].filter(Boolean),
      features: o.features.map(f => ({ ...f, tip: tipHtml({ name: f.name, img: f.img, html: f.html }) })),
      table: o.cls.table.map(t => ({ ...t, bba: signed(t.bba), on: t.level === o.next })),
      classSkills: o.cls.classSkills.map(k => L(SKILLS[k]?.label ?? k)).join(", "),
      startingFeats: o.cls.startingFeatList.map(f => this.#catalog.byUuid.get(f.uuid)?.name ?? f.name).filter((n, i, all) => all.indexOf(n) === i).join(", ")
    });
    const own = options.filter(o => !o.isNew).map(view);
    const others = options.filter(o => o.isNew).map(view);
    return { own, others, classes: [...own, ...others], selectedKey: selected, level: plan.level };
  }

  /** A choice of the level in the shape of templates/creation/choice.hbs. */
  #choiceView(req) {
    const made = this.draft.choices[req.key] ?? {};
    const picks = (made.choices ?? []).filter(c => !req.prior.includes(c));
    const full = picks.length >= req.count;
    return {
      uuid: req.key, kind: "level", name: req.origin ? `${req.origin} · ${req.name}` : req.name, img: req.img,
      label: req.label, count: req.count, multi: req.count > 1, picked: picks.length, active: true,
      done: levelChoiceDone(req, this.draft), listId: req.key.replace(/[^a-zA-Z0-9]/g, ""),
      showText: !!req.text, text: req.text, textValue: made.text ?? "",
      weapons: (req.text && /arma/i.test(req.text)) ? this.#catalog.weaponNames.filter(n => norm(n) !== "ataque desarmado") : null,
      options: req.options.map(o => {
        const prior = req.prior.includes(o.id);
        const on = prior || picks.includes(o.id);
        return { id: o.id, label: prior ? `${o.label} ✓` : o.label, hint: prior ? V("Choices.prior") : o.hint, on, disabled: prior || (!on && full && (req.count > 1)) };
      })
    };
  }

  #choicesStep(plan) {
    const r = plan.reqs;
    const d = this.draft;
    const flag = item => Number(item?.flags?.[SYSTEM_ID]?.ancestral ?? /\+(\d+)\s*$/.exec(item?.name ?? "")?.[1] ?? 0) || 0;
    const ancestral = r.ancestral ? {
      uuid: "ancestral", kind: "ancestral", name: V("Choices.ancestralName"), label: V("Choices.ancestral"), count: 1, active: true,
      img: r.ancestral.katana?.img ?? r.ancestral.wakizashi?.img, done: !!d.ancestral, picked: d.ancestral ? 1 : 0,
      options: ["katana", "wakizashi"].filter(k => r.ancestral[k]).map(k => ({
        id: k, label: `${r.ancestral[k].name} → +${flag(r.ancestral[k]) + 1}`, on: d.ancestral === k, hint: ""
      }))
    } : null;
    let multiclass = null;
    if (r.multiclass) {
      const m = d.multiclass;
      const feat = r.multiclass.feats.find(f => f.uuid === m.feat) ?? null;
      multiclass = {
        className: plan.cls.name,
        isFeat: m.kind !== "skill",
        isSkill: m.kind === "skill",
        feats: r.multiclass.feats.map(f => ({ uuid: f.uuid, name: f.name, img: f.img, on: f.uuid === m.feat, tip: tipHtml({ name: f.name, img: f.img, meta: f.categoryLabel, html: f.html }) })),
        skills: r.multiclass.skills.map(k => ({ key: k, label: L(SKILLS[k].label), on: m.skill === k, violation: this.#violationTag(plan, SKILL_VIOLATIONS[k]) })),
        featChoice: (feat?.choice) ? {
          label: feat.choice.label ?? "", text: feat.choice.text ?? "", textValue: m.text ?? "",
          options: (feat.choice.options ?? []).map(o => ({ id: o.id, label: o.label ?? o.id, on: (m.choices ?? []).includes(o.id) }))
        } : null,
        done: (m.kind === "skill") ? !!m.skill : this.#multiclassFeatDone(r)
      };
    }
    return { choices: r.choices.map(c => this.#choiceView(c)), ancestral, multiclass, nothing: !r.choices.length && !ancestral && !multiclass };
  }

  #featsStep(plan) {
    const ctx = plan.ctx;
    const pools = plan.reqs.featPools;
    const state = this.#featState(plan);
    const picksIn = id => state.picks.filter(x => x.pick.pool === id);
    const hasRoom = feat => pools.some(p => p.accepts(feat) && (picksIn(p.id).length < p.count));
    const { feats, filters } = featRows({
      catalog: this.#catalog, ctx, hasRoom, expanded: this.#expanded, active: this.#filters.feats,
      violation: feat => ((feat.category === "tormenta") ? this.#violationTag(plan, "severa") : null)
    });
    const b = this.draft.bonus;
    const after = plan.preview.system.abilities;
    return {
      levelBonus: {
        eyebrow: VF("Bonus.eyebrow", { level: plan.level }),
        note: V("Bonus.note"),
        feat: b.kind !== "ability",
        ability: b.kind === "ability",
        done: (b.kind !== "ability") || !!b.ability,
        abilities: ["for", "des", "con", "int", "sab", "car"].map(k => ({
          key: k, abbr: ABBR(k), label: LABEL(k), on: (b.kind === "ability") && (b.ability === k),
          after: ((b.kind === "ability") && (b.ability === k)) ? `${after[k].total} (${signed(after[k].mod)})` : ""
        }))
      },
      granted: [],
      pools: pools.map(p => ({
        id: p.id,
        label: isOpenPool(p.id) ? V("Feats.levelPool") : p.name,
        hint: isOpenPool(p.id) ? V("Feats.levelHint") : V("Feats.classHint"),
        count: p.count,
        picks: picksIn(p.id).map(x => featPickView(x, this.#catalog, this.#takenFor(x.pick))),
        empty: Array.from({ length: Math.max(0, p.count - picksIn(p.id).length) }, () => ({}))
      })),
      noPools: !pools.length,
      feats, filters, query: this.#filters.featQuery, ...choiceLists(this.#catalog)
    };
  }

  #jutsusStep(plan) {
    const state = this.#jutsuState(plan);
    const pools = state.pools;
    const picked = new Set(this.draft.jutsus.map(j => j.uuid));
    const owned = new Set(this.actor.items.filter(i => i.type === "jutsu").map(i => i._stats?.compendiumSource).filter(Boolean));
    const ownedNames = new Set(this.actor.items.filter(i => i.type === "jutsu").map(i => norm(i.name)));
    const roomFor = j => pools.some(p => levelPoolTakes(p, j) && (state.picks.filter(x => x.pick.pool === p.id).length < p.count));
    const eligible = this.#catalog.jutsus.filter(j => pools.some(p => levelPoolTakes(p, j)));
    const { jutsus, filters } = jutsuRows({
      jutsus: eligible, owned: new Set([...owned, ...eligible.filter(j => ownedNames.has(j.key)).map(j => j.uuid)]), picked, roomFor,
      violation: j => this.#violationTag(plan, jutsuSeverity(j.descriptors, j.grade)), expanded: this.#expanded, active: this.#filters.jutsus
    });
    const gradeName = g => L(`IJ.Grade.${g}`);
    const describe = p => {
      const chakras = p.chakras ? p.chakras.map(c => L(CHAKRAS[c]?.label ?? c)).join(", ") : W("Jutsus.anyChakra");
      const grade = p.grade ? gradeName(p.grade) : V("Jutsus.anyGrade");
      return VF("Jutsus.poolRule", { n: p.count, grade, chakras }) + ((p.names ?? []).length ? ` ${F("IJ.Wizard.Jutsus.poolNames", { names: p.names.map(n => `“${n}”`).join(", ") })}` : "");
    };
    return {
      none: false,
      pools: pools.map(p => {
        const picks = state.picks.filter(x => x.pick.pool === p.id);
        return {
          id: p.id, name: p.name, img: p.img, count: p.count, rule: describe(p),
          picks: picks.map(x => ({ uuid: x.pick.uuid, name: x.jutsu?.name ?? "—", img: x.jutsu?.img, kanji: x.jutsu?.kanji, ok: x.ok,
            tip: x.jutsu ? tipHtml({ name: x.jutsu.name, img: x.jutsu.img, meta: `${x.jutsu.chakraLabel} · ${x.jutsu.gradeLabel}`, html: x.jutsu.html }) : "" })),
          empty: Array.from({ length: Math.max(0, p.count - picks.length) }, () => ({}))
        };
      }),
      jutsus, filters, query: this.#filters.jutsuQuery
    };
  }

  #skillsStep(plan) {
    const d = this.draft;
    const slots = plan.reqs.skills;
    const sys = plan.preview.system;
    const state = this.#skillState(plan);
    const full = state.count >= slots.count;
    const rows = Object.entries(SKILLS).map(([key, cfg]) => {
      const inClass = slots.classSkills.has(key);
      const always = slots.trained.has(key);
      const picked = d.skills.includes(key);
      const mod = sys.abilities[cfg.ability]?.mod ?? 0;
      let reason = "";
      if (always) reason = W("Skills.always");
      else if (!inClass) reason = W("Skills.notClass");
      else if (!picked && full) reason = W("Skills.full");
      const specs = d.specialties.filter(s => s.skill === key);
      return {
        key, label: L(cfg.label), ability: ABBR(cfg.ability), inClass, always, picked: picked || always,
        multi: !!cfg.specialty, trainedOnly: !!cfg.trainedOnly, armor: !!cfg.armor,
        trainedTotal: signed(sys.level + 3 + mod + (sys.skills[key]?.bonus ?? 0)),
        untrainedTotal: cfg.trainedOnly ? "—" : signed(Math.floor(sys.level / 2) + mod + (sys.skills[key]?.bonus ?? 0)),
        // a skill trained before costs no Honor now
        disabled: !!reason && !picked, reason, outside: !inClass, violation: always ? null : this.#violationTag(plan, SKILL_VIOLATIONS[key]),
        specialties: specs.map(s => ({ ...s, empty: !String(s.label ?? "").trim() })),
        suggestions: cfg.specialty ? (SPECIALTIES[key] ?? []).filter(n => !specs.some(s => norm(s.label) === norm(n))
          && !Object.values(this.actor.system.specialties).some(s => (s.skill === key) && (norm(s.label) === norm(n))))
          .map(n => ({ name: n, disabled: full || !inClass })) : null,
        specDisabled: full || !inClass
      };
    });
    return {
      lead: VF("Skills.lead", { n: slots.count }),
      className: plan.cls?.name ?? "",
      slots: { total: slots.count, count: state.count, left: Math.max(0, slots.count - state.count), pips: Array.from({ length: slots.count }, (_, i) => ({ on: i < state.count })) },
      int: signed(sys.abilities.int.mod),
      classRows: rows.filter(r => r.inClass),
      otherRows: rows.filter(r => !r.inClass),
      humanNote: "",
      threshold: 15
    };
  }

  #summaryStep(plan) {
    const before = this.actor.system;
    const after = plan.preview.system;
    const row = (label, a, b, sign = false) => ({ label, before: sign ? signed(a) : a, after: sign ? signed(b) : b, changed: a !== b, up: b > a });
    const changed = plan.updates.filter(u => u["system.choices"]).map(u => {
      const item = this.actor.items.get(u._id);
      const options = item?.system.auto?.choice?.options ?? [];
      const added = u["system.choices"].filter(c => !(item?.system.choices ?? []).includes(c)).map(c => options.find(o => o.id === c)?.label ?? c);
      return item ? { name: item.name, img: item.img, added: added.join(", ") } : null;
    }).filter(Boolean);
    const swordUpdate = plan.updates.find(u => u.name && (u._id !== plan.clsData._id));
    const newOf = type => plan.newItems.filter(i => i.type === type).map(i => ({ name: i.system.choiceText ? `${i.name} (${i.system.choiceText})` : i.name, img: i.img, origin: i.system.originName ?? "" }));
    const bonus = this.draft.bonus;
    return {
      level: plan.level,
      classAfter: plan.items.filter(i => i.type === "class").map(c => `${c.name} ${c.system.levels}`).join(" / "),
      rows: [
        row(V("Summary.level"), before.level, plan.level),
        row(L("IJ.PV.label"), before.attributes.pv.max, after.attributes.pv.max),
        row(L("IJ.PM.long"), before.attributes.pm.max, after.attributes.pm.max),
        row(W("Summary.pmLimit"), before.attributes.pm.limit, after.attributes.pm.limit),
        row(L("IJ.CA.label"), before.ca.total, after.ca.total),
        row(L("IJ.BBA.abbr"), before.bba, after.bba, true),
        row(L("IJ.Attack.melee"), before.attack.melee, after.attack.melee, true),
        row(L("IJ.Attack.ranged"), before.attack.ranged, after.attack.ranged, true),
        ...["fort", "ref", "von"].map(k => row(L(`IJ.Save.${k}`), before.saves[k].total, after.saves[k].total, true)),
        row(L("IJ.Skill.iniciativa"), before.initiative, after.initiative, true),
        row(L("IJ.Ability.hon"), before.abilities.hon.total, after.abilities.hon.total)
      ],
      bonus: (bonus.kind === "ability" && bonus.ability) ? VF("Summary.ability", { name: LABEL(bonus.ability), n: after.abilities[bonus.ability].total }) : "",
      powers: newOf("power"),
      feats: newOf("feat"),
      jutsus: newOf("jutsu"),
      gear: [...newOf("weapon"), ...newOf("armor"), ...newOf("gear")],
      changed,
      sword: swordUpdate ? swordUpdate.name : "",
      skills: [...this.draft.skills.map(k => L(SKILLS[k]?.label ?? k)), ...this.draft.specialties.map(s => `${L(SKILLS[s.skill].label)} (${s.label})`),
        ...((plan.isNew && (this.draft.multiclass.kind === "skill") && this.draft.multiclass.skill) ? [L(SKILLS[this.draft.multiclass.skill].label)] : [])],
      honor: {
        gain: plan.honor.gain, damage: plan.honor.damage, before: plan.honor.before, final: plan.honor.final,
        list: plan.honor.list.map(v => ({ ...v, severityLabel: L(`IJ.Honor.violation.${v.severity}`), ignored: !v.damage }))
      },
      chakras: Object.entries(plan.actorUpdate).filter(([k]) => /^system\.chakras\.\w+\.grade$/.test(k))
        .map(([k, g]) => VF("Summary.chakra", { chakra: L(CHAKRAS[k.split(".")[2]].label), grade: L(`IJ.Grade.${g}`) }))
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  _syncPartState(partId, newElement, priorElement, state) {
    if ((partId === "step") && (priorElement?.className !== newElement?.className)) state.scrollPositions = [];
    super._syncPartState(partId, newElement, priorElement, state);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const step = this.element.querySelector(".wz-step");
    if (!step) return;
    this.#activateCards(step);
    for (const input of step.querySelectorAll("[data-field]")) {
      const field = input.dataset.field;
      input.addEventListener(field === "query" ? "input" : "change", () => this.#onField(input, field));
    }
    this.#applyFilters(step);
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

  /** The class cards and their pages (the page of the card under the pointer, else of the one chosen). */
  #activateCards(step) {
    const pages = [...step.querySelectorAll(".wz-page[data-key]")];
    if (!pages.length) return;
    const chosen = step.dataset.selected || "";
    const show = key => {
      const target = key || chosen;
      for (const page of pages) page.hidden = page.dataset.key !== target;
      step.querySelector(".wz-detail")?.classList.toggle("preview", !!key && (key !== chosen));
    };
    const grid = step.querySelector(".wz-grid");
    grid?.addEventListener("pointerover", event => {
      const card = event.target.closest?.(".wz-card[data-key]");
      if (card) show(card.dataset.key);
    });
    grid?.addEventListener("pointerleave", () => show(null));
    show(null);
  }

  #onField(input, field) {
    const d = this.draft;
    const value = input.value;
    switch (field) {
      case "choiceText": {
        const key = input.dataset.uuid;
        d.choices[key] = { ...(d.choices[key] ?? {}), text: String(value ?? "").trim() };
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
      case "multiclassText": {
        d.multiclass.text = String(value ?? "").trim();
        return this.#refresh();
      }
      case "specialtyLabel": {
        const spec = d.specialties.find(s => s.id === input.dataset.id);
        if (spec) spec.label = String(value ?? "").trim();
        return this.#refresh();
      }
      case "query": {
        this.#filters[input.dataset.key] = value;
        return this.#applyFilters(this.element.querySelector(".wz-step"));
      }
    }
  }

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
      const empty = step.querySelector(`${selector}-empty`);
      if (empty) empty.hidden = shown > 0;
      for (const chip of step.querySelectorAll(`[data-action='filter'][data-list='${filterKey}']`)) chip.classList.toggle("active", (chip.dataset.filter ?? "") === filter);
    };
    apply(".wz-feat", "feats", "featQuery", (row, f) => !f || ((f === "available") ? row.dataset.available === "true" : row.dataset.category === f));
    apply(".wz-jutsu", "jutsus", "jutsuQuery", (row, f) => !f || (row.dataset.chakra === f));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onStep(event, target) {
    return this.goTo(target.dataset.step);
  }

  static #onNext() {
    const plan = this.#plan;
    const steps = this.#steps(plan);
    const index = steps.findIndex(s => s.id === this.step);
    if (!this.#done(plan)[this.step] || !steps[index + 1]) return;
    return this.goTo(steps[index + 1].id);
  }

  static #onBack() {
    const steps = this.#steps(this.#plan);
    const index = steps.findIndex(s => s.id === this.step);
    if (index > 0) return this.goTo(steps[index - 1].id);
  }

  /** The class of the level: one the character has, or a new one. Everything chosen for the old one goes. */
  static #onPick(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    const owned = classesOf(this.actor).find(i => (i._stats?.compendiumSource === key) || (norm(i.name) === this.#catalog.byUuid.get(key)?.key));
    const d = this.draft;
    const same = owned ? (d.classId === owned.id) : (!d.classId && (d.classUuid === key));
    if (same) return;
    Object.assign(d, emptyLevelDraft(this.actor), { bonus: d.bonus, classId: owned?.id ?? null, classUuid: owned ? null : key });
    return this.#refresh();
  }

  /** An option of a choice (a class ability, a choice grown with the level, the ancestral sword). */
  static #onOption(event, target) {
    const box = target.closest("[data-choice]");
    const key = box.dataset.choice;
    const id = target.dataset.option;
    const d = this.draft;
    if (box.dataset.kind === "ancestral") {
      d.ancestral = id;
      return this.#refresh();
    }
    const req = this.#plan.reqs.choices.find(c => c.key === key);
    if (!req || req.prior.includes(id)) return;
    const made = d.choices[key] ?? { choices: [], text: "" };
    let picks = (made.choices ?? []).filter(c => !req.prior.includes(c));
    if (picks.includes(id)) picks = picks.filter(c => c !== id);
    else if (req.count === 1) picks = [id];
    else if (picks.length < req.count) picks.push(id);
    else return;
    d.choices[key] = { ...made, choices: picks };
    return this.#refresh();
  }

  /** The first level of a new class: a skill or a starting feat (data-kind; data-skill; data-feat; data-option). */
  static #onMulticlass(event, target) {
    const m = this.draft.multiclass;
    const { kind, skill, feat, option } = target.dataset;
    if (kind) m.kind = kind;
    if (skill) m.skill = (m.skill === skill) ? null : skill;
    if (feat) {
      m.feat = (m.feat === feat) ? null : feat;
      m.choices = [];
      m.text = "";
    }
    if (option) m.choices = (m.choices ?? []).includes(option) ? [] : [option];
    return this.#refresh();
  }

  /** The benefit of the level: a feat or +1 in an ability. */
  static #onLevelBonus(event, target) {
    const { kind, ability } = target.dataset;
    const b = this.draft.bonus;
    if (kind) {
      b.kind = kind;
      if (kind === "ability") this.draft.feats = this.draft.feats.filter(f => f.pool !== "level");
    }
    if (ability) b.ability = (b.ability === ability) ? null : ability;
    // A different Intelligence: the skills it brought go
    this.draft.skills = [];
    this.draft.specialties = [];
    return this.#refresh();
  }

  /** A feat to a pool with room that takes it: the class's own first, the open feat of the level last. */
  static #onFeatAdd(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const feat = this.#catalog.byUuid.get(uuid);
    const pools = this.#plan?.reqs.featPools ?? [];
    if (!feat) return;
    const inPool = id => this.draft.feats.filter(f => f.pool === id).length;
    const pool = [...pools].sort((a, b) => isOpenPool(a.id) - isOpenPool(b.id)).find(p => p.accepts(feat) && (inPool(p.id) < p.count));
    if (!pool) return ui.notifications.warn(W("Feats.full"));
    const options = feat.choice?.options ?? [];
    this.draft.feats.push({ key: foundry.utils.randomID(), uuid, pool: pool.id, choices: (options.length === 1) ? [options[0].id] : [], text: "" });
    return this.#refresh();
  }

  static #onFeatRemove(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    this.draft.feats = this.draft.feats.filter(f => f.key !== key);
    this.draft.jutsus = [];
    return this.#refresh();
  }

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

  static #onExpand(event, target) {
    if (event.target.closest("button, input, select")) return;
    const row = target.closest("[data-uuid]");
    const uuid = row?.dataset.uuid;
    if (!uuid) return;
    if (this.#expanded.has(uuid)) this.#expanded.delete(uuid);
    else this.#expanded.add(uuid);
    row.classList.toggle("expanded", this.#expanded.has(uuid));
  }

  static #onFilter(event, target) {
    const list = target.dataset.list;
    this.#filters[list] = (this.#filters[list] === (target.dataset.filter ?? "")) ? "" : (target.dataset.filter ?? "");
    this.#applyFilters(this.element.querySelector(".wz-step"));
  }

  static #onJutsuAdd(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const jutsu = this.#catalog.byUuid.get(uuid);
    const pools = this.#plan?.reqs.jutsuPools ?? [];
    if (!jutsu || this.draft.jutsus.some(j => j.uuid === uuid)) return;
    const inPool = id => this.draft.jutsus.filter(j => j.pool === id).length;
    // The narrowest pool first (one chakra and one grade before any)
    const width = p => (p.chakras ? p.chakras.length : 6) + (p.grade ? 0 : 6);
    const pool = [...pools].sort((a, b) => width(a) - width(b)).find(p => levelPoolTakes(p, jutsu) && (inPool(p.id) < p.count));
    if (!pool) return ui.notifications.warn(W("Jutsus.full"));
    this.draft.jutsus.push({ uuid, pool: pool.id });
    return this.#refresh();
  }

  static #onJutsuRemove(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    this.draft.jutsus = this.draft.jutsus.filter(j => j.uuid !== uuid);
    return this.#refresh();
  }

  static #onSkill(event, target) {
    const key = target.closest("[data-skill]").dataset.skill;
    const d = this.draft;
    if (d.skills.includes(key)) d.skills = d.skills.filter(k => k !== key);
    else {
      const slots = this.#plan.reqs.skills;
      if ((d.skills.length + d.specialties.length) >= slots.count) return ui.notifications.warn(W("Skills.full"));
      if (!slots.classSkills.has(key)) return ui.notifications.warn(W("Skills.notClass"));
      d.skills.push(key);
    }
    return this.#refresh();
  }

  static #onSpecialty(event, target) {
    const skill = target.closest("[data-skill]").dataset.skill;
    const slots = this.#plan.reqs.skills;
    if ((this.draft.skills.length + this.draft.specialties.length) >= slots.count) return ui.notifications.warn(W("Skills.full"));
    this.draft.specialties.push({ id: foundry.utils.randomID(), skill, label: target.dataset.name ?? "" });
    return this.#refresh();
  }

  static #onSpecialtyRemove(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    this.draft.specialties = this.draft.specialties.filter(s => s.id !== id);
    return this.#refresh();
  }

  /** Gain the level; then, with experience for one more, the wizard of the next level opens. */
  static async #onApply(event, target) {
    if (this.#applying) return;
    const plan = await this.#replan();
    const steps = this.#steps(plan);
    const done = this.#done(plan);
    if (!steps.every(s => done[s.id])) return ui.notifications.warn(W("notDone"));
    this.#applying = true;
    if (target) target.disabled = true;
    try {
      const gained = await applyLevelUp(this.actor, plan);
      await this.#announce(plan, gained);
      await this.close();
      ui.notifications.info(VF("done", { name: this.actor.name, level: plan.level }));
      if (this.actor.system.xp?.canLevel && canLevel(this.actor)) setTimeout(() => LevelUpWizard.open(this.actor), 400);
      else this.actor.sheet?.render(false);
    }
    catch (err) {
      console.error(`${SYSTEM_ID} | não foi possível subir de nível`, err);
      ui.notifications.error(VF("error", { error: err.message }));
      if (target) target.disabled = false;
    }
    finally {
      this.#applying = false;
    }
  }

  /** A card in the chat: the new level and what it brought. */
  async #announce(plan, gained) {
    if (setting("creationCard") === false) return;
    const content = await foundry.applications.handlebars.renderTemplate(`${DIR}/lv-chat.hbs`, {
      name: this.actor.name,
      img: this.actor.img,
      level: plan.level,
      classLine: plan.items.filter(i => i.type === "class").map(c => `${c.name} ${c.system.levels}`).join(" / "),
      gains: [
        gained.pv ? `+${gained.pv} ${L("IJ.PV.abbr")}` : null,
        gained.pm ? `+${gained.pm} ${L("IJ.PM.abbr")}` : null,
        plan.honor.gain ? `+${plan.honor.gain} ${L("IJ.Ability.hon")}` : null,
        (this.draft.bonus.kind === "ability" && this.draft.bonus.ability) ? `+1 ${LABEL(this.draft.bonus.ability)}` : null
      ].filter(Boolean),
      items: plan.newItems.filter(i => ["power", "feat", "jutsu"].includes(i.type)).map(i => ({ name: i.name, img: i.img })),
      violations: plan.honor.list.filter(v => v.damage).map(v => ({ label: v.label, damage: v.damage }))
    });
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content });
  }
}

/* -------------------------------------------- */
/*  When it opens by itself                     */
/* -------------------------------------------- */

/** Characters whose level-up wizard already opened by itself (actor id and level). */
const announced = new Set();

/**
 * The experience of a character reached its next level: the wizard opens for the player who owns it (for the GM only
 * when no player does), once per level and session; a client setting turns it off.
 */
export function maybeOpenLevelUp(actor, changes) {
  if (!foundry.utils.hasProperty(changes ?? {}, "system.attributes.xp")) return;
  if (!actor?.system?.xp?.canLevel || !canLevel(actor)) return;
  if (setting("levelUpWizard") === false) return;
  const players = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
  const mine = game.user.isGM ? !players.length : actor.testUserPermission(game.user, "OWNER");
  if (!mine) return;
  const key = `${actor.id}:${actor.system.level}`;
  if (announced.has(key)) return;
  announced.add(key);
  ui.notifications.info(VF("ready", { name: actor.name, level: actor.system.level + 1 }));
  setTimeout(() => LevelUpWizard.open(actor), 300);
}

/** The record of the levels gained (flags.imperiodejade.levelLog). */
export const levelLog = actor => actor.getFlag(SYSTEM_ID, LEVEL_LOG) ?? [];

export { primaryClass, canLevel };
