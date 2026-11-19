import {
  ABILITIES, ABILITY_SOURCES, ARMOR_CATEGORIES, BBA_PROGRESSIONS, CASTES, CHAKRAS, CONSUMABLE_KINDS, CURRENCIES,
  DAMAGE_TYPES, FEAT_CATEGORIES, HONOR_TIERS, JUTSU_GRADES, KEY_ABILITIES, SAVES, SIZES, SKILLS, SPECIALTIES, SYSTEM_ID,
  VIOLATIONS, WEAPON_CATEGORIES, WEAPON_GRIPS, WEAPON_KINDS
} from "../config.mjs";
import { signed } from "../dice/rolls.mjs";
import { bookText } from "../book-text.mjs";
import { usesLeft } from "../auto/effects.mjs";
import { dataFor, inactiveReason, norm } from "../auto/context.mjs";
import { CreationWizard, LevelUpWizard, canLevel, maybeOpenWizard } from "../creation/index.mjs";
import { loadCatalog } from "../creation/catalog.mjs";
import { featContext, whoFor } from "../creation/plan.mjs";
import { checkPrerequisites, parsePrerequisites } from "../creation/rules.mjs";
import { katana, lotus } from "./graphics.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

const L = key => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);
const DIR = `systems/${SYSTEM_ID}/templates/actor`;
const DETAIL = `${DIR}/parts/detail.hbs`;

/** Partials of the sheet (registered in imperio.mjs). */
export const SHEET_PARTIALS = {
  "ij-detail": DETAIL,
  "ij-feat-node": `${DIR}/parts/feat-node.hbs`
};

/** Number fields that also accept "+5" / "-3" (relative) or "=7" (absolute) typed in the sheet. */
const DELTA_FIELDS = [
  "system.attributes.pv.value", "system.attributes.pv.temp", "system.attributes.pm.value", "system.attributes.xp",
  "system.currency.yo", "system.currency.yp", "system.currency.y"
];

/** The tabs with a scroll at the side, and what the scroll shows while nothing is chosen. */
const DRAWERS = {
  caminho: { kanji: "道", hint: "IJ.Path.pick" },
  jutsus: { kanji: "術", hint: "IJ.Jutsu.pick" },
  equipamento: { kanji: "袋", hint: "IJ.Inventory.pick" }
};

const GRADE_KEYS = Object.keys(JUTSU_GRADES);
const flagsOf = item => item?.flags?.[SYSTEM_ID] ?? {};

/** "detectar desonra" → "Detectar desonra". */
const capitalize = text => (text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : "");

/** The abilities a level of a class table lists ("Resolução (RD 5, 15 PV), bateu levou"): commas outside parentheses. */
const splitFeatures = text => String(text ?? "").split(/,\s*(?![^()]*\))/).map(s => s.trim()).filter(Boolean);

/** How long an effect still lasts, in the words of the book ("2 rodadas", "uma cena"). */
function effectTime(effect) {
  const d = effect.duration ?? {};
  if (effect.flags?.[SYSTEM_ID]?.scene || (d.expiry === "combatEnd")) return L("IJ.Duration.cena");
  if ((d.units === "rounds") && !d.value) return L("IJ.Duration.turno");
  const unit = { rounds: "rodada", minutes: "minuto", hours: "hora", days: "dia" }[d.units];
  if (!unit || !d.value) return "";
  const n = Number.isFinite(d.remaining) && (d.units === "rounds") ? Math.max(1, Math.ceil(d.remaining)) : d.value;
  return F(`IJ.Duration.${unit}${n > 1 ? "Plural" : ""}`, { n });
}

/** What was chosen on an ability or feat: the text typed (Foco em Arma: katana) or the options marked (a fighting style). */
function choiceLabel(item) {
  const sys = item.system;
  if (sys.choiceText) return sys.choiceText;
  const options = sys.auto?.choice?.options ?? [];
  return (sys.choices ?? []).map(id => options.find(o => o.id === id)?.label).filter(Boolean).join(", ");
}

/** Does using the item do something (its automation, or PM to pay)? */
const isUsable = item => item.hasActivation || ((item.system.cost ?? 0) > 0);

/**
 * The character sheet: a page of washi held by a tray of jade lacquer. The hero (portrait, PV, PM, armor class and, on
 * the first tab, the katana of Honor) stays on every tab; the tabs are seals on the rail. Values are shown as totals;
 * the edit mode (the brush at the foot of the rail) turns the base values into fields.
 */
export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["imperiodejade", "ij-sheet", "ij-character"],
    position: { width: 1100, height: 900 },
    window: {
      resizable: true,
      controls: [
        // The creation wizard: for a character of the 1st level (made, or made again)
        {
          icon: "fa-solid fa-feather-pointed", label: "IJ.Wizard.open", action: "openWizard", ownership: "OWNER",
          visible: function() { return CreationWizard.canCreate(this.actor); }
        },
        // The level-up wizard: a level more (also without the experience, for groups that level by milestones)
        {
          icon: "fa-solid fa-angles-up", label: "IJ.Level.open", action: "levelUp", ownership: "OWNER",
          visible: function() { return canLevel(this.actor); }
        },
        { icon: "fa-solid fa-gears", label: "IJ.Auto.syncActor", action: "syncAuto", ownership: "OWNER" }
      ]
    },
    form: { submitOnChange: true },
    actions: {
      openWizard: CharacterSheet.#onOpenWizard,
      syncAuto: CharacterSheet.#onSyncAuto,
      toggleEdit: CharacterSheet.#onToggleEdit,
      rollAbility: CharacterSheet.#onRollAbility,
      rollSkill: CharacterSheet.#onRollSkill,
      rollSave: CharacterSheet.#onRollSave,
      rollPlainAttack: CharacterSheet.#onRollPlainAttack,
      rollManeuver: CharacterSheet.#onRollManeuver,
      healAbility: CharacterSheet.#onHealAbility,
      rollInitiative: CharacterSheet.#onRollInitiative,
      itemCreate: CharacterSheet.#onItemCreate,
      itemEdit: CharacterSheet.#onItemEdit,
      itemDelete: CharacterSheet.#onItemDelete,
      itemUse: CharacterSheet.#onItemUse,
      itemActivate: CharacterSheet.#onItemActivate,
      itemDamage: CharacterSheet.#onItemDamage,
      itemEquip: CharacterSheet.#onItemEquip,
      itemQuantity: CharacterSheet.#onItemQuantity,
      itemSelect: CharacterSheet.#onItemSelect,
      openUuid: CharacterSheet.#onOpenUuid,
      pathToggle: CharacterSheet.#onPathToggle,
      budsToggle: CharacterSheet.#onBudsToggle,
      usesPip: CharacterSheet.#onUsesPip,
      specialtyAdd: CharacterSheet.#onSpecialtyAdd,
      specialtyDelete: CharacterSheet.#onSpecialtyDelete,
      toggleTrained: CharacterSheet.#onToggleTrained,
      chakraToggle: CharacterSheet.#onChakraToggle,
      honorViolation: CharacterSheet.#onHonorViolation,
      honorGain: CharacterSheet.#onHonorGain,
      honorReserve: CharacterSheet.#onHonorReserve,
      honorReserveReset: CharacterSheet.#onHonorReserveReset,
      rest: CharacterSheet.#onRest,
      levelUp: CharacterSheet.#onLevelUp,
      removeCondition: CharacterSheet.#onRemoveCondition,
      effectEnd: CharacterSheet.#onEffectEnd
    }
  };

  static PARTS = {
    nav: { template: `${DIR}/parts/nav.hbs` },
    hero: { template: `${DIR}/parts/hero.hbs` },
    ficha: { template: `${DIR}/parts/ficha.hbs`, scrollable: [""] },
    caminho: { template: `${DIR}/parts/caminho.hbs`, scrollable: [".ij-pane", ".ij-detail__body"] },
    jutsus: { template: `${DIR}/parts/jutsus.hbs`, scrollable: [".ij-pane", ".ij-detail__body"] },
    equipamento: { template: `${DIR}/parts/equipamento.hbs`, scrollable: [".ij-pane", ".ij-detail__body"] },
    biografia: { template: `${DIR}/parts/biografia.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      initial: "ficha",
      labelPrefix: "IJ.Tab",
      tabs: [
        { id: "ficha", kanji: "人" },
        { id: "caminho", kanji: "道" },
        { id: "jutsus", kanji: "術" },
        { id: "equipamento", kanji: "袋" },
        { id: "biografia", kanji: "伝" }
      ]
    }
  };

  /** Edit mode: base values become fields. Starts on for a brand-new character. */
  #editMode = null;

  /** The item unrolled on the scroll of each tab that has one. */
  #picked = { caminho: null, jutsus: null, equipamento: null };

  /** Classes whose bamboo shows every level up to the 20th. */
  #wholePaths = new Set();

  /** Show the feats the character's own feats open the way to. */
  #buds = false;

  get editMode() {
    if (this.#editMode === null) this.#editMode = this.actor.system.abilities.for.value === 10
      && Object.values(this.actor.system.abilities).every(a => a.value === 10) && this.isEditable;
    return this.#editMode && this.isEditable;
  }

  /** @override */
  get title() {
    return this.actor.name;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const source = actor._source.system;
    const items = actor.items;
    const editMode = this.editMode;

    const itemsOf = type => items.filter(i => i.type === type).sort((a, b) => a.sort - b.sort);

    // Abilities: the six on the first tab, Honor on the hilt of its katana
    const abilityView = key => {
      const cfg = ABILITIES[key];
      const a = sys.abilities[key];
      return {
        key, kanji: cfg.kanji, label: L(cfg.label), abbr: L(cfg.abbr),
        value: source.abilities[key].value, bonus: source.abilities[key].bonus,
        racial: a.racial ? signed(a.racial) : "",
        total: a.total, mod: signed(a.mod), negative: a.mod < 0, damage: a.damage ?? 0
      };
    };
    const abilities = KEY_ABILITIES.map(abilityView);

    // Classes and race
    const classItems = itemsOf("class");
    const primary = classItems.find(c => c.system.primary) ?? classItems[0] ?? null;
    const race = items.get(sys.auto.raceId) ?? null;

    // Honor: the score, the measure and the katana that shows both
    const tiers = [...HONOR_TIERS].reverse().map(t => ({ key: t.key, min: Number.isFinite(t.min) ? t.min : 0, label: L(t.label) }));
    const honor = {
      ...abilityView("hon"),
      tier: L(sys.honorTier.label), tierKey: sys.honorTier.key,
      katana: katana(sys.abilities.hon.total, tiers),
      reserve: { used: sys.honor.reserveUsed, available: sys.honorReserve.available, bonus: signed(sys.honorReserve.bonus) },
      violations: Object.entries(VIOLATIONS).map(([key, v]) => ({ key, label: L(v.label), short: L(v.label).charAt(0) }))
    };

    // Armor class: the parts for the line of the first tab and for the tooltip of the sword guard
    const caParts = [
      { label: L("IJ.CA.base"), value: 10, fixed: true },
      { label: L("IJ.Level.half"), value: sys.halfLevel },
      { label: L("IJ.AbilityAbbr.des"), value: sys.ca.dex },
      { label: L("IJ.Armor.body"), value: sys.armor.bodyBonus },
      { label: L("IJ.Armor.shield"), value: sys.armor.shieldBonus },
      { label: L("IJ.Size.label"), value: sys.size.ca },
      { label: L("IJ.Skill.other"), value: source.attributes.ca.bonus, field: "system.attributes.ca.bonus" }
    ];
    // What effects and conditions add or take (Constitution of Casca Grossa, conditions, the helpless override)
    const rest = sys.ca.total - caParts.reduce((t, p) => t + p.value, 0);
    if (rest) caParts.push({ label: L("IJ.CA.effects"), value: rest });
    for (const p of caParts) {
      p.text = p.fixed ? String(p.value) : signed(p.value);
      p.show = p.fixed || (p.value !== 0);
    }

    // The hero
    const kanji = primary?.system.kanji || race?.system.kanji || "";
    const casteLabel = source.details.caste ? L(CASTES[source.details.caste]) : "—";
    const hero = {
      kanji, kanjiLen: Math.min(3, [...kanji].length),
      race: race ? { id: race.id, name: race.name } : null,
      // A race with ability picks still to make ("+2 em duas habilidades à escolha")
      racePending: !!race && ((race.system.abilityChoice?.count ?? 0) > (race.system.chosen?.length ?? 0)),
      classes: classItems.map(c => ({ id: c.id, name: c.name, levels: c.system.levels, primary: c === primary })),
      caste: casteLabel.replace(/\s*\(.*\)\s*$/, ""),
      caTip: caParts.filter(p => p.show).map(p => `${p.text} ${p.label}`).join(" · "),
      // Conditions on the character (status effects), with the rule as tooltip
      conditions: [...(actor.statuses ?? [])].filter(id => CONFIG.statusEffects.find(s => s.id === id)).map(id => {
        const st = CONFIG.statusEffects.find(s => s.id === id);
        return { id, label: L(st.name), hint: st.description ? L(st.description) : "" };
      })
    };

    // Skills, with the specialties of Atuação, Conhecimento and Ofício under their skill
    const skillRow = (key, data, spec = null, specId = null) => {
      const cfg = SKILLS[key];
      const abbr = L(ABILITIES[data.ability].abbr);
      const tip = [
        `${L("IJ.Skill.ranksShort")} ${data.ranks}`,
        `${abbr} ${signed(data.abilityMod)}`,
        data.bonus ? `${L("IJ.Skill.other")} ${signed(data.bonus)}` : "",
        data.penalty ? `${L("IJ.Armor.body")} ${signed(data.penalty)}` : "",
        data.sizeBonus ? `${L("IJ.Size.label")} ${signed(data.sizeBonus)}` : "",
        data.condition ? `${L("IJ.Auto.conditions")} ${signed(data.condition)}` : ""
      ].filterJoin(" · ");
      return {
        key, specialtyId: specId, isSpecialty: !!spec,
        display: spec ? (spec.label || "—") : L(cfg.label), specialty: spec?.label ?? "",
        ability: data.ability, abilityAbbr: abbr,
        trained: data.trained, bonus: data.bonus,
        total: signed(data.total), usable: data.usable, stone: data.trained && data.usable,
        trainedOnly: !spec && !!cfg.trainedOnly, armor: !spec && !!cfg.armor, multi: !spec && !!cfg.specialty,
        inputName: spec ? `system.specialties.${specId}` : `system.skills.${key}`,
        tip: data.usable ? tip : L("IJ.Skill.trainedOnly")
      };
    };
    const skills = [];
    for (const [key, cfg] of Object.entries(SKILLS)) {
      skills.push(skillRow(key, sys.skills[key]));
      if (!cfg.specialty) continue;
      for (const [id, spec] of Object.entries(sys.specialties).filter(([, s]) => s.skill === key)) {
        skills.push(skillRow(key, spec, spec, id));
      }
    }

    // What is carried
    const picked = this.#pick(items);
    const armorView = item => (item ? {
      id: item.id, name: item.name, img: item.img,
      bonus: signed(item.system.bonus),
      maxDex: item.system.maxDex === null ? "—" : signed(item.system.maxDex),
      penalty: item.system.penalty ? signed(item.system.penalty) : "0",
      rd: item.system.rd,
      equipped: item.system.equipped, isShield: item.system.category === "escudo",
      picked: item.id === picked.equipamento
    } : null);
    const weapons = itemsOf("weapon").map(w => ({
      id: w.id, name: w.name, img: w.img, equipped: w.system.equipped,
      attack: signed(w.system.attackTotal), damage: w.system.damageFormula, crit: w.system.critLabel,
      typeLabel: L(DAMAGE_TYPES[w.system.damageType] ?? ""),
      kind: L(WEAPON_KINDS[w.system.kind]?.label ?? ""),
      proficient: w.system.isProficient ?? w.system.proficient,
      picked: w.id === picked.equipamento
    }));
    const armors = itemsOf("armor").map(armorView);
    const gear = itemsOf("gear").map(g => ({
      id: g.id, name: g.name, img: g.img, quantity: g.system.quantity, equipped: g.system.equipped,
      power: g.hasActivation, picked: g.id === picked.equipamento
    }));
    const consumables = itemsOf("consumable").map(c => ({
      id: c.id, name: c.name, img: c.img, quantity: c.system.quantity,
      kind: L(CONSUMABLE_KINDS[c.system.kind]),
      uses: c.system.uses.max > 0
        ? Array.fromRange(c.system.uses.max).map(i => ({ n: i + 1, full: i < c.system.uses.value }))
        : null,
      picked: c.id === picked.equipamento
    }));
    const weight = items.reduce((t, i) => t + ((i.system.weight ?? 0) * (i.system.quantity ?? 0)), 0);

    // Abilities and feats: a leaf of the bamboo, a blossom of the branch, a line among the techniques
    const offLabel = item => {
      const reason = inactiveReason(item);
      if (reason === "honor") return F("IJ.Arts.off.honor", { n: Math.max(item.system.honorMin ?? 0, item.system.auto?.requires?.honorMin ?? 0) });
      return ["armor", "shield", "armorType"].includes(reason) ? L(`IJ.Arts.off.${reason}`) : "";
    };
    const leaf = (item, extra = {}) => ({
      id: item.id, name: item.name, note: choiceLabel(item),
      usable: isUsable(item), cost: item.system.cost ?? 0, off: !!offLabel(item),
      picked: item.id === picked.caminho, ...extra
    });
    const powers = itemsOf("power");
    const feats = itemsOf("feat");

    const { paths, placed } = this.#paths(classItems, primary, powers, leaf);
    const racePowers = powers.filter(p => p.system.origin === "raca");
    const roots = race ? {
      id: race.id, name: race.name, kanji: race.system.kanji ?? "",
      powers: racePowers.map(p => leaf(p))
    } : null;
    // Abilities with no class or race on the sheet to hang from
    const loose = powers.filter(p => !placed.has(p.id) && !(race && (p.system.origin === "raca"))).map(p => leaf(p, { note: [p.system.originName, choiceLabel(p)].filterJoin(" · ") }));

    const { tree: featTree, legend: featLegend } = await this.#featTree(feats, leaf);

    // Techniques: what spends PM or has uses, one click away on the first tab
    const arts = [...powers, ...feats].filter(isUsable).map(item => ({
      id: item.id, name: item.name, cost: item.system.cost ?? 0,
      uses: item.system.auto?.activation?.uses ? `${usesLeft(item, dataFor(item))}/${item.system.auto.activation.uses.per}` : "",
      off: !!offLabel(item), offLabel: offLabel(item),
      tip: [item.system.originName || (item.type === "feat" ? L("TYPES.Item.feat") : ""), item.system.action].filterJoin(" · ")
    }));

    // Jutsus: the lotus of the chakras and what each chakra feeds
    const jutsus = itemsOf("jutsu");
    const chakras = Object.entries(CHAKRAS).map(([key, cfg]) => {
      const c = sys.chakras[key];
      const abbr = L(ABILITIES[key].abbr);
      const gradeLabel = L(JUTSU_GRADES[c.grade].label);
      return {
        key, kanji: cfg.kanji, label: L(cfg.label), open: c.open, grade: c.grade, gradeLabel,
        note: c.open ? `${abbr} ${signed(c.mod)} · ${gradeLabel}` : L("IJ.Chakra.closed"),
        tip: editMode ? L(c.open ? "IJ.Chakra.openTip" : "IJ.Chakra.closedTip") : L(c.open ? "IJ.Chakra.openNote" : "IJ.Chakra.closedNote")
      };
    });
    const openChakras = chakras.filter(c => c.open);
    // On the first tab: every jutsu one click away, the cheapest first
    const quickJutsus = jutsus.map(j => ({
      id: j.id, name: j.name, cost: j.system.cost, off: !sys.chakras[j.system.chakra]?.open,
      tip: [L(CHAKRAS[j.system.chakra].label), j.system.execution, j.system.range, j.system.duration, j.system.resistance].filterJoin(" · ")
    })).sort((a, b) => (a.cost - b.cost) || a.name.localeCompare(b.name, "pt-BR"));

    // Effects in course: what abilities, jutsus and items left on the character for a while (conditions are on the hero)
    const effects = actor.effects.filter(e => !e.disabled && e.isTemporary && !e.statuses.size).map(e => ({
      id: e.id, name: e.name, img: e.img, time: effectTime(e),
      tip: e.description ?? ""
    }));
    const reach = Math.max(-1, ...openChakras.map(c => GRADE_KEYS.indexOf(c.grade)));
    const veins = chakras.map(c => ({
      ...c,
      grades: GRADE_KEYS.map(g => ({
        key: g, label: L(JUTSU_GRADES[g].label), cost: JUTSU_GRADES[g].cost, dc: JUTSU_GRADES[g].dc,
        items: jutsus.filter(j => (j.system.chakra === c.key) && (j.system.grade === g)).map(j => ({
          id: j.id, name: j.name, cost: j.system.cost, picked: j.id === picked.jutsus,
          tip: [j.system.execution, j.system.range, j.system.duration].filterJoin(" · ")
        }))
      })).filter(g => g.items.length)
    })).filter(v => v.open || v.grades.length);

    Object.assign(context, {
      actor, system: sys, source, editMode,
      editable: this.isEditable,
      owner: actor.isOwner,
      config: CONFIG.IJ,
      auto: sys.auto,
      hero, abilities, honor,
      level: sys.level,
      xp: sys.xp,
      pv: sys.attributes.pv,
      pm: sys.attributes.pm,
      ca: sys.ca.total,
      caParts,
      movement: sys.movement,
      sizeLabel: L(sys.size.label),
      casteLabel,
      // First tab
      skills,
      skillCount: sys.skillCount,
      skillOver: !!sys.skillCount.allowed && (sys.skillCount.trained > sys.skillCount.allowed),
      specialties: SPECIALTIES,
      armorPenalty: sys.armor.penalty,
      saves: Object.entries(SAVES).map(([key, cfg]) => ({
        key, label: L(cfg.label), ability: L(ABILITIES[cfg.ability].abbr),
        total: signed(sys.saves[key].total), mod: signed(sys.saves[key].mod), bonus: source.saves[key].bonus
      })),
      bba: signed(sys.bba),
      melee: signed(sys.attack.melee),
      ranged: signed(sys.attack.ranged),
      initiative: signed(sys.initiative),
      rd: sys.rd,
      weaponsInHand: weapons.filter(w => w.equipped).slice(0, 6),
      bodyArmor: armorView(items.get(sys.armor.bodyId)),
      shield: armorView(items.get(sys.armor.shieldId)),
      maneuvers: ["agarrar", "derrubar", "desarmar", "empurrar", "atropelar", "separar"].map(key => ({
        key, label: L(`IJ.Maneuver.${key}`), tip: L(`IJ.Maneuver.note.${key}`)
      })),
      arts, quickJutsus, effects,
      quick: consumables.filter(c => c.uses || (c.quantity > 0)).slice(0, 6),
      jutsuCount: jutsus.length,
      // The path
      paths, roots, loose, featTree, featLegend, buds: this.#buds,
      // Jutsus
      chakras, veins,
      lotus: lotus(Object.fromEntries(chakras.map(c => [c.key, c])), sys.attributes.pm),
      chakraNote: F("IJ.Chakra.openCount", { n: openChakras.length }),
      grades: GRADE_KEYS.map((key, i) => ({
        label: L(JUTSU_GRADES[key].label), cost: JUTSU_GRADES[key].cost, dc: JUTSU_GRADES[key].dc,
        dots: GRADE_KEYS.map((_, n) => n <= i), far: i > reach
      })),
      // Equipment
      weapons, armors, gear, consumables,
      weight: Math.round(weight * 10) / 10,
      currencies: Object.entries(CURRENCIES).map(([key, c]) => ({ key, label: L(c.label), abbr: c.abbr, value: source.currency[key] })),
      choices: {
        abilities: Object.fromEntries(KEY_ABILITIES.map(k => [k, L(ABILITIES[k].abbr)])),
        sizes: Object.fromEntries(Object.entries(SIZES).map(([k, s]) => [k, L(s.label)])),
        castes: { "": "—", ...Object.fromEntries(Object.entries(CASTES).map(([k, v]) => [k, L(v)])) },
        grades: Object.fromEntries(Object.entries(JUTSU_GRADES).map(([k, g]) => [k, L(g.label)]))
      },
      // The scroll at the side of each tab that has one
      details: Object.fromEntries(await Promise.all(Object.keys(DRAWERS).map(async tab => [tab, await this.#detail(tab)]))),
      // A blank character: the banner that opens the creation wizard
      wizard: { blank: CreationWizard.isBlank(actor), can: CreationWizard.canCreate(actor) }
    });
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId];
    if (partId in DRAWERS) context.detail = context.details[partId];
    if (partId === "biografia") {
      const enrich = html => TextEditor.implementation.enrichHTML(html ?? "", {
        secrets: this.actor.isOwner, rollData: this.actor.getRollData(), relativeTo: this.actor
      });
      const bio = context.source.biography;
      context.bio = {
        appearance: await enrich(bio.appearance),
        personality: await enrich(bio.personality),
        history: await enrich(bio.history),
        notes: await enrich(bio.notes)
      };
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  The bamboo, the branch and the scroll       */
  /* -------------------------------------------- */

  /**
   * What each scroll shows: the item chosen on its tab while it is still on the sheet, else the first one worth
   * reading, so the scroll is never an empty strip.
   */
  #pick(items) {
    const first = (types, test = () => true) => items.filter(i => types.includes(i.type) && test(i)).sort((a, b) => a.sort - b.sort)[0]?.id ?? null;
    const pools = {
      caminho: () => first(["power"], isUsable) ?? first(["power"]) ?? first(["feat"]),
      jutsus: () => first(["jutsu"]),
      equipamento: () => first(["weapon"], i => i.system.equipped) ?? first(["weapon", "armor", "gear", "consumable"])
    };
    for (const [tab, pool] of Object.entries(pools)) {
      if (!items.get(this.#picked[tab])) this.#picked[tab] = pool();
    }
    return this.#picked;
  }

  /**
   * The bamboo of each class: one segment per level, from the 1st at the foot to the levels still ahead on top. The
   * leaves of a level are what the class table lists there, tied to the ability on the sheet when the character has it.
   * @returns {{paths: object[], placed: Set<string>}}  `placed`: the abilities that hang from some bamboo
   */
  #paths(classItems, primary, powers, leaf) {
    const placed = new Set();
    const paths = [];
    for (const cls of classItems) {
      const levels = cls.system.levels;
      const features = cls.system.features ?? [];
      const own = powers.filter(p => (p.system.origin === "classe") && (norm(p.system.originName) === norm(cls.name)));
      const byUuid = new Map(own.map(p => [flagsOf(p).sourceUuid, p]));
      const byName = new Map(own.map(p => [norm(p.name), p]));
      const known = [...features.map(f => ({ name: f.name, uuid: f.uuid })), ...own.filter(p => !features.some(f => norm(f.name) === norm(p.name))).map(p => ({ name: p.name, uuid: null }))];
      // The ability a label of the table speaks of: the longest name the label begins with
      const match = label => {
        const n = norm(label);
        let best = null;
        for (const k of known) {
          const key = norm(k.name);
          if (((n === key) || n.startsWith(`${key} `)) && (!best || (key.length > norm(best.name).length))) best = k;
        }
        return best;
      };
      const top = this.#wholePaths.has(cls.id) ? 20 : Math.min(20, levels + 2);
      const rows = [];
      for (let level = 1; level <= top; level++) {
        const reached = level <= levels;
        const line = cls.system.table?.find(t => t.level === level);
        const labels = line ? splitFeatures(line.features) : features.filter(f => f.level === level).map(f => f.name);
        const entries = labels.map(label => {
          const hit = match(label);
          const item = hit ? (byUuid.get(hit.uuid) ?? byName.get(norm(hit.name)) ?? null) : null;
          // "Espadas ancestrais +2" → the ability's own name, and "+2" beside it
          const exact = hit && (norm(label.slice(0, hit.name.length)) === norm(hit.name));
          const name = exact ? hit.name : capitalize(label);
          const note = exact ? label.slice(hit.name.length).trim() : "";
          if (item && reached) {
            placed.add(item.id);
            // What the table says of this level ("+2"), else what was chosen on the ability
            return leaf(item, note ? { name, note } : { name });
          }
          return { id: null, uuid: hit?.uuid ?? null, name, note };
        });
        rows.push({ level, reached, now: level === levels, entries });
      }
      // Abilities of the class the table doesn't speak of (made by hand, or picked from a list): at their own level
      for (const p of own.filter(p => !placed.has(p.id))) {
        const row = rows[Math.clamp(p.system.level || 1, 1, levels) - 1];
        row.entries.push(leaf(p));
        placed.add(p.id);
      }
      const bba = L(BBA_PROGRESSIONS[cls.system.bba]?.label ?? "").replace(/\s*\(.*\)\s*$/, "");
      paths.push({
        id: cls.id, name: cls.name, kanji: cls.system.kanji ?? "", levels, primary: cls === primary,
        summary: F("IJ.Path.level", { n: levels }),
        tip: F("IJ.Path.classTip", { bba, pv: cls.system.pv.perLevel, pm: cls.system.pm.perLevel }),
        more: (levels + 2 < 20) ? L(this.#wholePaths.has(cls.id) ? "IJ.Path.less" : "IJ.Path.more") : "",
        rows: rows.reverse()
      });
    }
    // The first class at the foot, right above the root; the classes taken later on top
    paths.sort((a, b) => Number(a.primary) - Number(b.primary));
    return { paths, placed };
  }

  /**
   * The branch of the feats: a feat that needs another one the character has grows from it (from the deepest of them,
   * when it needs several). With the buds on, each feat also shows the feats of the compendium it opens the way to.
   * @returns {Promise<{tree: object[], legend: object[]}>}
   */
  async #featTree(feats, leaf) {
    const key = item => norm(item.name);
    const byKey = new Map();
    for (const f of feats) if (!byKey.has(key(f))) byKey.set(key(f), f);
    const names = { feats: new Set(byKey.keys()), powers: new Set(), races: new Set(), classes: new Set() };
    const featsOf = checks => checks.flatMap(c => (c.kind === "any" ? featsOf(c.alts) : (c.kind === "feat" ? [c.name] : [])));
    const needs = new Map(feats.map(f => [f.id, featsOf(parsePrerequisites(f.system.prerequisites, names)).filter(n => n !== key(f))]));
    const depths = new Map();
    const depth = (f, seen = new Set()) => {
      if (depths.has(f.id)) return depths.get(f.id);
      if (seen.has(f.id)) return 0;
      seen.add(f.id);
      const d = Math.max(0, ...needs.get(f.id).map(n => 1 + depth(byKey.get(n), seen)));
      depths.set(f.id, d);
      return d;
    };
    const deepest = parents => parents.reduce((best, n) => {
      const p = byKey.get(n);
      return (!best || (depth(p) > depth(best))) ? p : best;
    }, null);

    const nodes = new Map(feats.map(f => [f.id, { ...leaf(f), category: f.system.category, children: [] }]));
    const order = Object.keys(FEAT_CATEGORIES);
    const sort = list => list.sort((a, b) => (order.indexOf(a.category) - order.indexOf(b.category)) || a.name.localeCompare(b.name, "pt-BR"));
    const tree = [];
    for (const f of feats) {
      const parent = deepest(needs.get(f.id));
      (parent ? nodes.get(parent.id).children : tree).push(nodes.get(f.id));
    }

    // The buds: feats of the compendium that need one of the character's, under the deepest one they need
    if (this.#buds) {
      const catalog = await loadCatalog().catch(() => null);
      const ctx = catalog ? featContext(this.actor) : null;
      for (const f of catalog?.feats ?? []) {
        if (byKey.has(f.key)) continue;
        const parent = deepest(featsOf(f.checks).filter(n => byKey.has(n)));
        if (!parent) continue;
        const unmet = checkPrerequisites(f.checks, whoFor(ctx, f, false)).filter(r => r.ok === false).map(r => r.text);
        nodes.get(parent.id).children.push({
          bud: true, uuid: f.uuid, name: f.name, category: f.category, ripe: !unmet.length, children: [],
          tip: unmet.length ? F("IJ.Path.budUnmet", { list: unmet.join(", ") }) : L("IJ.Path.budRipe")
        });
      }
    }
    for (const node of nodes.values()) node.children.sort((a, b) => (Number(!!a.bud) - Number(!!b.bud)) || a.name.localeCompare(b.name, "pt-BR"));
    // Whole branches first, then the feats that stand alone
    sort(tree).sort((a, b) => Number(!b.children.length) - Number(!a.children.length));

    const legend = order.map(category => ({
      key: category, label: L(FEAT_CATEGORIES[category]), count: feats.filter(f => f.system.category === category).length
    })).filter(c => c.count);
    return { tree, legend };
  }

  /** What the scroll of a tab shows of the item chosen there. */
  async #detail(tab) {
    const actor = this.actor;
    const item = actor.items.get(this.#picked[tab]);
    if (!item) return { kanji: DRAWERS[tab].kanji, hint: L(DRAWERS[tab].hint) };
    const sys = item.system;
    const enrich = html => TextEditor.implementation.enrichHTML(html ?? "", {
      secrets: actor.isOwner, rollData: actor.getRollData(), relativeTo: item
    });
    const tags = [];
    const stats = [];
    const stat = (label, value) => { if (value || (value === 0)) stats.push({ label: L(label), value }); };
    const detail = {
      id: item.id, name: item.name, type: L(`TYPES.Item.${item.type}`), kanji: "", tags, stats,
      editable: this.isEditable, use: null, prerequisites: "", enhancements: "",
      description: await enrich(bookText.of(item) ?? sys.description ?? "")
    };

    if (["power", "feat"].includes(item.type)) {
      const cls = (item.type === "power") ? actor.items.find(i => (i.type === "class") && (norm(i.name) === norm(sys.originName))) : null;
      const race = actor.items.find(i => i.type === "race");
      if (item.type === "power") {
        detail.type = [sys.originName || L(ABILITY_SOURCES[sys.origin]), (sys.origin === "classe") && sys.levels ? F("IJ.Path.levels", { list: sys.levels }) : ""].filterJoin(" · ");
        detail.kanji = cls?.system.kanji || ((sys.origin === "raca") ? (race?.system.kanji ?? "") : "") || "能";
      } else {
        detail.type = `${L("TYPES.Item.feat")} · ${L(FEAT_CATEGORIES[sys.category] ?? "")}`;
        detail.kanji = "才";
        detail.prerequisites = sys.prerequisites;
      }
      const chosen = choiceLabel(item);
      if (chosen) tags.push({ label: chosen, cls: "jade" });
      if (sys.action) tags.push({ label: sys.action });
      if (sys.cost) tags.push({ label: `${sys.cost} ${L("IJ.PM.abbr")}`, cls: "ki" });
      const uses = sys.auto?.activation?.uses;
      if (uses) tags.push({ label: `${usesLeft(item, dataFor(item))}/${uses.per}`, cls: "gold", tip: L("IJ.Auto.usesTip") });
      const honorMin = Math.max(sys.honorMin ?? 0, sys.auto?.requires?.honorMin ?? 0);
      const reason = inactiveReason(item);
      if (honorMin) tags.push({ label: F("IJ.Arts.off.honor", { n: honorMin }), cls: reason === "honor" ? "warn" : "gold", tip: L("IJ.Power.honorReq") });
      if (["armor", "shield", "armorType"].includes(reason)) tags.push({ label: L(`IJ.Arts.off.${reason}`), cls: "warn" });
      if (sys.auto && Object.keys(sys.auto).length && !sys.auto.status) tags.push({ label: L("IJ.Auto.summary"), cls: "jade", tip: L("IJ.Auto.automatedTip") });
      detail.use = isUsable(item)
        ? { label: L("IJ.Auto.use"), cost: sys.cost ?? 0, ki: (sys.cost ?? 0) > 0 }
        : { label: L("IJ.Item.toChat"), cost: 0, ki: false };
    }
    else if (item.type === "jutsu") {
      const chakra = CHAKRAS[sys.chakra];
      detail.type = `${L(chakra.label)} · ${L(JUTSU_GRADES[sys.grade].label)}`;
      detail.kanji = chakra.kanji;
      tags.push({ label: `${sys.cost} ${L("IJ.PM.abbr")}`, cls: "ki" }, { label: `${L("IJ.Jutsu.dc")} ${sys.dc}` });
      if (!actor.system.chakras[sys.chakra]?.open) tags.push({ label: L("IJ.Chakra.closed"), cls: "warn" });
      stat("IJ.Jutsu.execution", sys.execution);
      stat("IJ.Jutsu.range", sys.range);
      stat("IJ.Jutsu.target", sys.target);
      stat("IJ.Jutsu.duration", sys.duration);
      stat("IJ.Jutsu.resistance", sys.resistance);
      stat("IJ.Jutsu.descriptors", sys.descriptors);
      detail.enhancements = sys.enhancements ? await enrich(sys.enhancements) : "";
      detail.use = { label: L("IJ.Jutsu.execute"), cost: sys.cost, ki: true };
    }
    else if (item.type === "weapon") {
      detail.type = [L(WEAPON_CATEGORIES[sys.category] ?? ""), L(WEAPON_KINDS[sys.kind]?.label ?? ""), L(WEAPON_GRIPS[sys.grip] ?? "")].filterJoin(" · ");
      detail.kanji = "刀";
      tags.push({ label: L(sys.equipped ? "IJ.Weapon.inHandOn" : "IJ.Item.stowed"), cls: sys.equipped ? "jade" : "" });
      if (!(sys.isProficient ?? sys.proficient)) tags.push({ label: L("IJ.Weapon.notProficientShort"), cls: "warn" });
      if (sys.dishonorable) tags.push({ label: L("IJ.Item.dishonorable"), cls: "warn", tip: L("IJ.Item.dishonorableTip") });
      stat("IJ.Weapon.attack", signed(sys.attackTotal));
      stat("IJ.Weapon.damage", `${sys.damageFormula} · ${L(DAMAGE_TYPES[sys.damageType] ?? "")}`);
      stat("IJ.Weapon.critical", sys.critLabel);
      stat("IJ.Weapon.range", sys.range ? `${sys.range} m` : "");
      detail.use = { label: L("IJ.Weapon.attackTip"), cost: 0, ki: false };
    }
    else if (item.type === "armor") {
      detail.type = L(ARMOR_CATEGORIES[sys.category] ?? "");
      detail.kanji = sys.category === "escudo" ? "盾" : "鎧";
      tags.push({ label: L(sys.equipped ? "IJ.Item.equipped" : "IJ.Item.stowed"), cls: sys.equipped ? "jade" : "" });
      if (sys.dishonorable) tags.push({ label: L("IJ.Item.dishonorable"), cls: "warn", tip: L("IJ.Item.dishonorableTip") });
      stat("IJ.Armor.bonus", signed(sys.bonus));
      stat("IJ.Armor.maxDex", sys.maxDex === null ? "" : signed(sys.maxDex));
      stat("IJ.Armor.penalty", sys.penalty ? signed(sys.penalty) : "");
      stat("IJ.RD.label", sys.rd || "");
    }
    else {
      detail.kanji = item.type === "consumable" ? "薬" : "具";
      if (item.type === "consumable") {
        detail.type = L(CONSUMABLE_KINDS[sys.kind]);
        if (sys.uses.max > 0) tags.push({ label: `${L("IJ.Consumable.uses")} ${sys.uses.value}/${sys.uses.max}`, cls: "gold" });
        detail.use = { label: L("IJ.Auto.use"), cost: 0, ki: false };
      } else {
        if (sys.equipped) tags.push({ label: L("IJ.Item.equipped"), cls: "jade" });
        if (sys.magic) tags.push({ label: L("IJ.Item.magic"), cls: "ki" });
        if (sys.slot) tags.push({ label: sys.slot });
        if (item.hasActivation) detail.use = { label: L("IJ.Auto.use"), cost: 0, ki: false };
      }
      stat("IJ.Item.quantity", sys.quantity);
    }
    if ("weight" in sys) {
      stat("IJ.Item.weight", sys.weight ? `${sys.weight} kg` : "");
      stat("IJ.Item.price", sys.price);
    }
    return detail;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Right click on anything that is an item opens its sheet; a double click on its name uses it
    this.element.addEventListener("contextmenu", ev => {
      const row = ev.target.closest(".ij-item[data-item-id]");
      if (!row || ev.target.closest("input, select, prose-mirror")) return;
      ev.preventDefault();
      this.actor.items.get(row.dataset.itemId)?.sheet.render(true);
    });
    this.element.addEventListener("dblclick", ev => {
      if (!ev.target.closest("[data-action=itemSelect]")) return;
      const id = ev.target.closest("[data-item-id]")?.dataset.itemId;
      this.actor.items.get(id)?.use({ event: ev });
    });
    // Select the whole number when a field gets focus (quick typing of PV, PM, money)
    this.element.addEventListener("focusin", ev => {
      if (ev.target.matches?.("input.ij-select-on-focus")) ev.target.select();
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    // A blank character opened by one of its owners: the creation wizard opens beside the sheet
    if (options.isFirstRender) maybeOpenWizard(this.actor);
    this.element.classList.toggle("ij-editing", this.editMode);
    this.element.dataset.honor = context.honor.tierKey;
    // The hero is whole on the first tab and a slim bar on the others
    this.element.dataset.tab = this.tabGroups.primary ?? "ficha";
  }

  /** @override */
  changeTab(tab, group, options = {}) {
    super.changeTab(tab, group, options);
    if ((group === "primary") && this.element) this.element.dataset.tab = tab;
  }

  /** Relative and absolute values typed in the resource fields ("+5", "-3", "=7"). */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const path of DELTA_FIELDS) {
      const raw = foundry.utils.getProperty(data, path);
      if ((raw === undefined) || (typeof raw === "number")) continue;
      const current = foundry.utils.getProperty(this.actor._source, path) ?? 0;
      const v = String(raw).trim().replace("−", "-");
      let n = current;
      if (/^[+-]\s*\d+$/.test(v)) n = current + Number(v.replace(/\s/g, ""));
      else if (/^=\s*-?\d+$/.test(v)) n = Number(v.replace(/[=\s]/g, ""));
      else if (/^\d+$/.test(v)) n = Number(v);
      foundry.utils.setProperty(data, path, n);
    }
    return data;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** The item of the clicked row. */
  #item(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }

  /** The creation wizard (module/creation/wizard.mjs). */
  static #onOpenWizard() {
    CreationWizard.open(this.actor);
  }

  /** Bring the automation of the items on this sheet up to date with the compendium. */
  static async #onSyncAuto() {
    const n = await game.imperiodejade.auto.syncActor(this.actor);
    ui.notifications.info(game.i18n.format("IJ.Auto.migrated", { n, v: game.system.version }));
  }

  static #onToggleEdit() {
    this.#editMode = !this.editMode;
    this.render();
  }

  static #onRollAbility(event, target) {
    this.actor.rollAbility(target.dataset.ability, { event });
  }

  static #onRollSkill(event, target) {
    this.actor.rollSkill(target.dataset.skill, { event, specialtyId: target.dataset.specialty || null });
  }

  static #onRollSave(event, target) {
    this.actor.rollSave(target.dataset.save, { event });
  }

  /** One point of ability damage healed (rest heals one per day by itself). */
  static async #onHealAbility(event, target) {
    const key = target.dataset.ability;
    const d = this.actor.system.abilities[key]?.damage ?? 0;
    if (d > 0) await this.actor.update({ [`system.abilities.${key}.damage`]: d - 1 });
  }

  static #onRollManeuver(event, target) {
    this.actor.rollManeuver(target.dataset.kind, { event });
  }

  static #onRollPlainAttack(event, target) {
    this.actor.rollPlainAttack(target.dataset.type, { event });
  }

  static #onRollInitiative(event) {
    this.actor.rollInitiativeCheck({ event });
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const data = { name: game.i18n.format("IJ.Item.new", { type: L(`TYPES.Item.${type}`) }), type };
    if (target.dataset.origin) foundry.utils.setProperty(data, "system.origin", target.dataset.origin);
    if (target.dataset.category) foundry.utils.setProperty(data, "system.category", target.dataset.category);
    if (target.dataset.grade) foundry.utils.setProperty(data, "system.grade", target.dataset.grade);
    const [item] = await this.actor.createEmbeddedDocuments("Item", [data]);
    item?.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    this.#item(target)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = this.#item(target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("IJ.Item.deleteTitle") },
      content: `<p>${game.i18n.format("IJ.Item.deleteConfirm", { name: foundry.utils.escapeHTML(item.name) })}</p>`,
      rejectClose: false
    });
    if (ok) await item.delete();
  }

  static #onItemUse(event, target) {
    this.#item(target)?.use({ event });
  }

  /** The power of a weapon, armor or accessory (its activation), not the attack. */
  static #onItemActivate(event, target) {
    const item = this.#item(target);
    if (item) game.imperiodejade.auto.useItem(item, { event });
  }

  static #onItemDamage(event, target) {
    this.#item(target)?.rollDamage({ critical: target.dataset.crit === "true" });
  }

  static async #onItemEquip(event, target) {
    const item = this.#item(target);
    if (!item || !("equipped" in item.system)) return;
    const equipped = !item.system.equipped;
    const updates = [{ _id: item.id, "system.equipped": equipped }];
    // One body armor and one shield at a time (p. 150)
    if (equipped && item.type === "armor") {
      const isShield = item.system.category === "escudo";
      for (const other of this.actor.items) {
        if ((other.type !== "armor") || (other.id === item.id) || !other.system.equipped) continue;
        if ((other.system.category === "escudo") === isShield) updates.push({ _id: other.id, "system.equipped": false });
      }
    }
    await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  static async #onItemQuantity(event, target) {
    const item = this.#item(target);
    if (!item) return;
    const delta = Number(target.dataset.delta) || 0;
    await item.update({ "system.quantity": Math.max(0, item.system.quantity + delta) });
  }

  /** Unroll an item on the scroll of its tab (no render: only the scroll and the mark of what is chosen change). */
  static async #onItemSelect(event, target) {
    const tab = target.dataset.drawer;
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (!(tab in DRAWERS) || !id) return;
    this.#picked[tab] = id;
    const part = this.element.querySelector(`.tab[data-tab="${tab}"]`);
    if (!part) return;
    for (const el of part.querySelectorAll(".is-picked")) el.classList.remove("is-picked");
    for (const el of part.querySelectorAll(`[data-item-id="${id}"]:not(.ij-detail):not(.ij-sub)`)) el.classList.add("is-picked");
    const html = await foundry.applications.handlebars.renderTemplate(DETAIL, await this.#detail(tab));
    // Another click may have come while this one was read
    if (this.#picked[tab] === id) part.querySelector(".ij-drawer").innerHTML = html;
  }

  /** An ability still ahead on the bamboo, or a bud of the branch: its page in the compendium. */
  static async #onOpenUuid(event, target) {
    const doc = await fromUuid(target.dataset.uuid);
    doc?.sheet.render(true);
  }

  /** Show the whole bamboo of a class (up to the 20th level), or only the next levels. */
  static #onPathToggle(event, target) {
    const id = target.dataset.class;
    if (this.#wholePaths.has(id)) this.#wholePaths.delete(id);
    else this.#wholePaths.add(id);
    this.render({ parts: ["caminho"] });
  }

  /** Show or hide the feats the character's feats open the way to. */
  static #onBudsToggle() {
    this.#buds = !this.#buds;
    this.render({ parts: ["caminho"] });
  }

  static async #onUsesPip(event, target) {
    const item = this.#item(target);
    if (!item) return;
    const n = Number(target.dataset.n);
    const value = item.system.uses.value === n ? n - 1 : n;
    await item.update({ "system.uses.value": value });
  }

  static async #onSpecialtyAdd(event, target) {
    const skill = target.dataset.skill;
    const id = foundry.utils.randomID();
    await this.actor.update({ [`system.specialties.${id}`]: { skill, label: "", trained: true, bonus: 0 } });
  }

  static async #onSpecialtyDelete(event, target) {
    const id = target.dataset.specialty;
    if (!id) return;
    await this.actor.update({ [`system.specialties.${id}`]: new foundry.data.operators.ForcedDeletion() });
  }

  /** Training is part of building the character: only in the edit mode. */
  static async #onToggleTrained(event, target) {
    if (!this.editMode) return;
    const spec = target.dataset.specialty;
    const path = spec ? `system.specialties.${spec}.trained` : `system.skills.${target.dataset.skill}.trained`;
    await this.actor.update({ [path]: !foundry.utils.getProperty(this.actor._source, path) });
  }

  /** Opening a chakra changes the PM and their limit: only in the edit mode. */
  static async #onChakraToggle(event, target) {
    if (!this.editMode) return;
    const key = target.dataset.chakra;
    await this.actor.update({ [`system.chakras.${key}.open`]: !this.actor._source.system.chakras[key].open });
  }

  static async #onHonorViolation(event, target) {
    await this.actor.honorViolation(target.dataset.severity ?? "leve", { fixed: event.shiftKey });
  }

  static async #onHonorGain() {
    await this.actor.honorGain(1);
  }

  static async #onHonorReserve() {
    await this.actor.useHonorReserve();
  }

  static async #onHonorReserveReset() {
    await this.actor.update({ "system.honor.reserveUsed": false });
  }

  static async #onRest() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("IJ.Rest.title") },
      content: `<p>${L("IJ.Rest.confirm")}</p>`,
      rejectClose: false
    });
    if (ok) await this.actor.rest();
  }

  /** Remove a condition from the character (all the effects that give it). */
  static async #onRemoveCondition(event, target) {
    const id = target.dataset.condition;
    const ids = this.actor.effects.filter(e => e.statuses.has(id)).map(e => e.id);
    if (ids.length) await this.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }

  /** End an effect in course before its time. */
  static async #onEffectEnd(event, target) {
    await this.actor.effects.get(target.dataset.effect)?.delete();
  }

  /** A level more: the level-up wizard with classes on the sheet; without them, the typed level rises by one. */
  static async #onLevelUp() {
    const sys = this.actor.system;
    if (sys.level >= 20) return;
    // With classes, the level-up wizard asks what the level brings, in order (module/creation/levelup.mjs)
    if (canLevel(this.actor)) return LevelUpWizard.open(this.actor);
    if (sys.auto.classes) {
      // A new level in the first class: its abilities arrive and Honor rises by 1 (module/documents/item.mjs)
      const primary = this.actor.items.find(i => i.type === "class" && i.system.primary)
        ?? this.actor.items.find(i => i.type === "class");
      return primary?.update({ "system.levels": primary.system.levels + 1 });
    }
    await this.actor.update({ "system.attributes.level": sys.attributes.level + 1 });
  }
}
