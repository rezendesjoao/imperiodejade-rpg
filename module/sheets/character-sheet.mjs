import {
  ABILITIES, ABILITY_SOURCES, ARMOR_CATEGORIES, CASTES, CHAKRAS, CONSUMABLE_KINDS, CURRENCIES, DAMAGE_TYPES,
  FEAT_CATEGORIES, JUTSU_GRADES, KEY_ABILITIES, SAVES, SIZES, SKILLS, SPECIALTIES, SYSTEM_ID, VIOLATIONS, WEAPON_KINDS
} from "../config.mjs";
import { signed } from "../dice/rolls.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

const L = key => game.i18n.localize(key);
const DIR = `systems/${SYSTEM_ID}/templates/actor`;

/** Number fields that also accept "+5" / "-3" (relative) or "=7" (absolute) typed in the sheet. */
const DELTA_FIELDS = [
  "system.attributes.pv.value", "system.attributes.pv.temp", "system.attributes.pm.value", "system.attributes.xp",
  "system.currency.yo", "system.currency.yp", "system.currency.y"
];

/**
 * The character sheet: a parchment page in the style of a printed character sheet, with a vertical rail of silk
 * tabs. Values are shown as totals; the edit mode (the brush button) turns the base values into fields.
 */
export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["imperiodejade", "ij-sheet", "ij-character"],
    position: { width: 1100, height: 900 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleEdit: CharacterSheet.#onToggleEdit,
      rollAbility: CharacterSheet.#onRollAbility,
      rollSkill: CharacterSheet.#onRollSkill,
      rollSave: CharacterSheet.#onRollSave,
      rollPlainAttack: CharacterSheet.#onRollPlainAttack,
      rollInitiative: CharacterSheet.#onRollInitiative,
      itemCreate: CharacterSheet.#onItemCreate,
      itemEdit: CharacterSheet.#onItemEdit,
      itemDelete: CharacterSheet.#onItemDelete,
      itemUse: CharacterSheet.#onItemUse,
      itemDamage: CharacterSheet.#onItemDamage,
      itemEquip: CharacterSheet.#onItemEquip,
      itemQuantity: CharacterSheet.#onItemQuantity,
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
      toggleCollapse: CharacterSheet.#onToggleCollapse
    }
  };

  static PARTS = {
    nav: { template: `${DIR}/parts/nav.hbs` },
    ficha: { template: `${DIR}/parts/ficha.hbs`, scrollable: [""] },
    pericias: { template: `${DIR}/parts/pericias.hbs`, scrollable: [""] },
    combate: { template: `${DIR}/parts/combate.hbs`, scrollable: [""] },
    habilidades: { template: `${DIR}/parts/habilidades.hbs`, scrollable: [""] },
    jutsus: { template: `${DIR}/parts/jutsus.hbs`, scrollable: [""] },
    inventario: { template: `${DIR}/parts/inventario.hbs`, scrollable: [""] },
    biografia: { template: `${DIR}/parts/biografia.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      initial: "ficha",
      labelPrefix: "IJ.Tab",
      tabs: [
        { id: "ficha", kanji: "人" },
        { id: "pericias", kanji: "技" },
        { id: "combate", kanji: "戦" },
        { id: "habilidades", kanji: "能" },
        { id: "jutsus", kanji: "術" },
        { id: "inventario", kanji: "袋" },
        { id: "biografia", kanji: "伝" }
      ]
    }
  };

  /** Edit mode: base values become fields. Starts on for a brand-new character. */
  #editMode = null;

  /** Collapsed item descriptions, by item id. */
  #expanded = new Set();

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

    // Abilities (plaques)
    const abilities = Object.entries(ABILITIES).map(([key, cfg], index) => {
      const a = sys.abilities[key];
      return {
        key, row: index + 1, kanji: cfg.kanji, label: L(cfg.label), abbr: L(cfg.abbr),
        value: source.abilities[key].value, bonus: source.abilities[key].bonus,
        total: a.total, mod: signed(a.mod), negative: a.mod < 0, isHonor: key === "hon"
      };
    });

    // Classes and race
    const classes = itemsOf("class").map(c => ({
      id: c.id, name: c.name, img: c.img, levels: c.system.levels, primary: c.system.primary,
      bba: L(CONFIG.IJ.BBA_PROGRESSIONS[c.system.bba]?.label ?? "")
    }));
    const race = items.get(sys.auto.raceId) ?? null;

    // Equipped armor and shield (the two cards of the first tab)
    const armorCard = item => item ? {
      id: item.id, name: item.name, img: item.img,
      bonus: signed(item.system.bonus),
      maxDex: item.system.maxDex === null ? "—" : signed(item.system.maxDex),
      penalty: item.system.penalty ? signed(item.system.penalty) : "0",
      rd: item.system.rd, price: item.system.price,
      category: L(ARMOR_CATEGORIES[item.system.category])
    } : null;

    // Skills
    const skillRow = (key, data, spec = null, specId = null) => {
      const cfg = SKILLS[key];
      return {
        key, specialtyId: specId, isSpecialty: !!spec,
        label: L(cfg.label), specialty: spec?.label ?? "",
        ability: data.ability, abilityAbbr: L(ABILITIES[data.ability].abbr),
        trained: data.trained, ranks: data.ranks, abilityMod: signed(data.abilityMod),
        bonus: data.bonus, penalty: data.penalty ? signed(data.penalty) : "",
        sizeBonus: data.sizeBonus ? signed(data.sizeBonus) : "",
        total: signed(data.total), usable: data.usable,
        trainedOnly: !!cfg.trainedOnly, armor: !!cfg.armor, multi: !!cfg.specialty,
        inputName: spec ? `system.specialties.${specId}` : `system.skills.${key}`,
        source: spec ? source.specialties?.[specId] : source.skills[key]
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
    const half = Math.ceil(skills.length / 2);

    // Weapons, armor, inventory
    const weapons = itemsOf("weapon").map(w => ({
      id: w.id, name: w.name, img: w.img, equipped: w.system.equipped,
      attack: signed(w.system.attackTotal), damage: w.system.damageFormula, crit: w.system.critLabel,
      type: w.system.damageType, typeLabel: L(DAMAGE_TYPES[w.system.damageType] ?? ""),
      kind: L(WEAPON_KINDS[w.system.kind]?.label ?? ""), range: w.system.range ? `${w.system.range} m` : "—",
      proficient: w.system.proficient, dishonorable: w.system.dishonorable
    }));
    const armors = itemsOf("armor").map(a => ({
      ...armorCard(a), equipped: a.system.equipped, isShield: a.system.category === "escudo",
      dishonorable: a.system.dishonorable
    }));
    const physical = item => ({
      id: item.id, name: item.name, img: item.img, type: item.type,
      quantity: item.system.quantity, weight: item.system.weight, price: item.system.price,
      equipped: item.system.equipped ?? null
    });
    const consumables = itemsOf("consumable").map(c => ({
      ...physical(c),
      kind: L(CONSUMABLE_KINDS[c.system.kind]),
      uses: c.system.uses.max > 0
        ? Array.fromRange(c.system.uses.max).map(i => ({ n: i + 1, full: i < c.system.uses.value }))
        : null
    }));
    const inventory = [
      { type: "weapon", label: L("IJ.Weapon.plural"), items: itemsOf("weapon").map(physical) },
      { type: "armor", label: L("IJ.Armor.plural"), items: itemsOf("armor").map(physical) },
      { type: "gear", label: L("IJ.Inventory.gear"), items: itemsOf("gear").map(physical) }
    ];
    const weight = items.reduce((t, i) => t + ((i.system.weight ?? 0) * (i.system.quantity ?? 0)), 0);

    // Abilities, feats and jutsus (with their descriptions, enriched)
    const enrich = async item => TextEditor.implementation.enrichHTML(item.system.description ?? "", {
      secrets: actor.isOwner, rollData: actor.getRollData(), relativeTo: item
    });
    const powerView = async item => ({
      id: item.id, name: item.name, img: item.img, type: item.type,
      cost: item.system.cost, honorMin: item.system.honorMin, level: item.system.level,
      action: item.system.action, prerequisites: item.system.prerequisites,
      origin: item.system.originName || (item.system.origin ? L(ABILITY_SOURCES[item.system.origin]) : ""),
      category: item.system.category ? L(FEAT_CATEGORIES[item.system.category]) : "",
      honorLocked: item.system.honorMin > 0 && sys.abilities.hon.total < item.system.honorMin,
      expanded: this.#expanded.has(item.id),
      description: await enrich(item)
    });
    const powers = await Promise.all(itemsOf("power").map(powerView));
    const feats = await Promise.all(itemsOf("feat").map(powerView));
    const powerGroups = Object.entries(ABILITY_SOURCES).map(([key, label]) => ({
      key, label: L(label), items: powers.filter(p => items.get(p.id).system.origin === key)
    }));

    const jutsus = await Promise.all(itemsOf("jutsu").map(async j => ({
      id: j.id, name: j.name, img: j.img,
      chakra: j.system.chakra, chakraLabel: L(CHAKRAS[j.system.chakra].label), chakraKanji: CHAKRAS[j.system.chakra].kanji,
      grade: j.system.grade, cost: j.system.cost, dc: j.system.dc,
      execution: j.system.execution, range: j.system.range, target: j.system.target,
      duration: j.system.duration, resistance: j.system.resistance, descriptors: j.system.descriptors,
      expanded: this.#expanded.has(j.id),
      description: await enrich(j)
    })));
    const jutsuGroups = Object.entries(JUTSU_GRADES).map(([key, g]) => ({
      key, label: L(g.label), cost: g.cost, dc: g.dc, items: jutsus.filter(j => j.grade === key)
    })).filter(g => g.items.length);

    const chakras = Object.entries(CHAKRAS).map(([key, cfg]) => {
      const c = sys.chakras[key];
      return {
        key, kanji: cfg.kanji, label: L(cfg.label), ability: L(ABILITIES[key].abbr),
        open: c.open, grade: c.grade, gradeLabel: L(JUTSU_GRADES[c.grade].label), mod: signed(c.mod)
      };
    });

    Object.assign(context, {
      actor, system: sys, source, editMode,
      editable: this.isEditable,
      owner: actor.isOwner,
      config: CONFIG.IJ,
      auto: sys.auto,
      abilities,
      classes,
      race: race ? { id: race.id, name: race.name, img: race.img } : null,
      honorTier: L(sys.honorTier.label),
      honorTierKey: sys.honorTier.key,
      reserve: { used: sys.honor.reserveUsed, available: sys.honorReserve.available, bonus: signed(sys.honorReserve.bonus) },
      level: sys.level,
      xp: sys.xp,
      bba: signed(sys.bba),
      melee: signed(sys.attack.melee),
      ranged: signed(sys.attack.ranged),
      initiative: signed(sys.initiative),
      perception: signed(sys.skills.percepcao.total),
      intuition: signed(sys.skills.intuicao.total),
      ca: sys.ca.total,
      caParts: [
        { label: L("IJ.CA.base"), value: 10, fixed: true },
        { label: L("IJ.Level.half"), value: sys.halfLevel },
        { label: L("IJ.AbilityAbbr.des"), value: sys.ca.dex },
        { label: L("IJ.Armor.body"), value: sys.armor.bodyBonus },
        { label: L("IJ.Armor.shield"), value: sys.armor.shieldBonus },
        { label: L("IJ.Size.label"), value: sys.size.ca },
        { label: L("IJ.Skill.other"), value: source.attributes.ca.bonus, field: "system.attributes.ca.bonus" }
      ],
      saves: Object.entries(SAVES).map(([key, cfg]) => ({
        key, label: L(cfg.label), ability: L(ABILITIES[cfg.ability].abbr),
        total: signed(sys.saves[key].total), mod: signed(sys.saves[key].mod), bonus: source.saves[key].bonus
      })),
      save: Object.fromEntries(Object.keys(SAVES).map(k => [k, signed(sys.saves[k].total)])),
      pv: sys.attributes.pv,
      pm: sys.attributes.pm,
      movement: sys.movement,
      sizeLabel: L(sys.size.label),
      rd: sys.rd,
      armorPenalty: sys.armor.penalty,
      bodyArmor: armorCard(items.get(sys.armor.bodyId)),
      shield: armorCard(items.get(sys.armor.shieldId)),
      skillColumns: [skills.slice(0, half), skills.slice(half)],
      skillCount: sys.skillCount,
      specialties: SPECIALTIES,
      weapons, armors, consumables, inventory,
      equippedWeapons: weapons.filter(w => w.equipped).slice(0, 4),
      weight: Math.round(weight * 10) / 10,
      powerGroups, feats, jutsus, jutsuGroups, chakras,
      racePowers: powers.filter(p => items.get(p.id).system.origin === "raca"),
      classPowers: powers.filter(p => items.get(p.id).system.origin === "classe"),
      grades: Object.entries(JUTSU_GRADES).map(([key, g]) => ({ key, label: L(g.label), cost: g.cost, dc: g.dc })),
      violations: Object.entries(VIOLATIONS).map(([key, v]) => ({ key, label: L(v.label) })),
      currencies: Object.entries(CURRENCIES).map(([key, c]) => ({ key, label: L(c.label), abbr: c.abbr, value: source.currency[key] })),
      choices: {
        abilities: Object.fromEntries(KEY_ABILITIES.map(k => [k, L(ABILITIES[k].abbr)])),
        sizes: Object.fromEntries(Object.entries(SIZES).map(([k, s]) => [k, L(s.label)])),
        castes: { "": "—", ...Object.fromEntries(Object.entries(CASTES).map(([k, v]) => [k, L(v)])) },
        grades: Object.fromEntries(Object.entries(JUTSU_GRADES).map(([k, g]) => [k, L(g.label)]))
      },
      casteLabel: source.details.caste ? L(CASTES[source.details.caste]) : "—"
    });
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId];
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
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("ij-editing", this.editMode);
    this.element.dataset.honor = context.honorTierKey;
    // Select the whole number when a field gets focus (quick typing of PV, PM, money)
    for (const input of this.element.querySelectorAll("input.ij-select-on-focus")) {
      input.addEventListener("focus", ev => ev.currentTarget.select());
    }
    // Right click on a weapon rolls the damage; on an item row opens its sheet
    for (const row of this.element.querySelectorAll("[data-item-id].ij-item-row, [data-item-id].ij-card-row")) {
      row.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        this.actor.items.get(row.dataset.itemId)?.sheet.render(true);
      });
    }
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

  static async #onToggleTrained(event, target) {
    if (!this.isEditable) return;
    const spec = target.dataset.specialty;
    const path = spec ? `system.specialties.${spec}.trained` : `system.skills.${target.dataset.skill}.trained`;
    await this.actor.update({ [path]: !foundry.utils.getProperty(this.actor._source, path) });
  }

  static async #onChakraToggle(event, target) {
    const key = target.dataset.chakra;
    await this.actor.update({ [`system.chakras.${key}.open`]: !this.actor._source.system.chakras[key].open });
  }

  static async #onHonorViolation(event, target) {
    const severity = target.dataset.severity
      ?? this.element.querySelector("select.ij-violation-select")?.value ?? "leve";
    await this.actor.honorViolation(severity, { fixed: event.shiftKey });
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

  /** Level up by hand (no class items): +1 level, and +1 Honor for staying in the class (p. 81). */
  static async #onLevelUp() {
    const sys = this.actor.system;
    if (sys.auto.classes) {
      const primary = this.actor.items.find(i => i.type === "class" && i.system.primary)
        ?? this.actor.items.find(i => i.type === "class");
      return primary?.sheet.render(true);
    }
    if (sys.level >= 20) return;
    await this.actor.update({ "system.attributes.level": sys.attributes.level + 1 });
  }

  static #onToggleCollapse(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (!id) return;
    if (this.#expanded.has(id)) this.#expanded.delete(id);
    else this.#expanded.add(id);
    target.closest("[data-item-id]")?.classList.toggle("expanded", this.#expanded.has(id));
  }
}
