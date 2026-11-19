import {
  ABILITY_SOURCES, ARMOR_CATEGORIES, BBA_PROGRESSIONS, CHAKRAS, CONSUMABLE_KINDS, DAMAGE_TYPES, FEAT_CATEGORIES,
  JUTSU_GRADES, KEY_ABILITIES, ABILITIES, SIZES, SKILLS, SYSTEM_ID, WEAPON_CATEGORIES, WEAPON_GRIPS, WEAPON_KINDS
} from "../config.mjs";
import { signed } from "../dice/rolls.mjs";
import { bookText } from "../book-text.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

const L = key => game.i18n.localize(key);
const localized = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, L(typeof v === "string" ? v : v.label)]));

/** A readable line for an active effect change ("+4 Percepção", "Atletismo usa Des"). */
function effectLabel(change) {
  const v = change.value;
  const n = Number(v);
  const sign = Number.isFinite(n) ? signed(n) : String(v);
  const parts = change.key.split(".");
  if (parts[1] === "abilities") return `${sign} ${L(ABILITIES[parts[2]]?.abbr ?? parts[2])}`;
  if (parts[1] === "skills") {
    const skill = L(SKILLS[parts[2]]?.label ?? parts[2]);
    return parts[3] === "ability" ? game.i18n.format("IJ.Effect.skillAbility", { skill, ability: L(ABILITIES[v]?.abbr ?? v) }) : `${sign} ${skill}`;
  }
  if (parts[1] === "saves") return `${sign} ${L(`IJ.Save.${parts[2]}`)}`;
  if (parts[1] === "chakras") return game.i18n.format("IJ.Effect.chakraOpen", { chakra: L(CHAKRAS[parts[2]]?.label ?? parts[2]) });
  const key = parts.slice(1).join(".");
  const labels = {
    "attributes.pv.bonus": "PV", "attributes.pm.bonus": "PM", "attributes.pm.limitBonus": L("IJ.Effect.pmLimit"),
    "attributes.ca.bonus": "CA", "attributes.attack.melee": L("IJ.Attack.melee"), "attributes.attack.ranged": L("IJ.Attack.ranged"),
    "attributes.attack.damage": L("IJ.Attack.damageBonus"), "attributes.movement.bonus": L("IJ.Movement.label"),
    "attributes.rd": "RD", "attributes.critBonus": L("IJ.Effect.threat")
  };
  return `${sign} ${labels[key] ?? key}`;
}

/** Kanji of each item type, shown as the watermark of the sheet. */
const TYPE_KANJI = { class: "道", race: "族", weapon: "刀", armor: "鎧", gear: "物", consumable: "薬", feat: "才", power: "能", jutsu: "術" };

/** One parchment card for every item type: picture, name, the type's fields and the description. */
export class ItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["imperiodejade", "ij-sheet", "ij-item"],
    position: { width: 560, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleClassSkill: ItemSheet.#onToggleClassSkill,
      toggleRaceChoice: ItemSheet.#onToggleRaceChoice,
      useItem: ItemSheet.#onUseItem
    }
  };

  static PARTS = {
    sheet: { template: `systems/${SYSTEM_ID}/templates/item/item-sheet.hbs`, scrollable: [".ij-item-body"] }
  };

  /** @override */
  get title() {
    return this.item.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const sys = item.system;
    const enrich = html => TextEditor.implementation.enrichHTML(html ?? "", {
      secrets: item.isOwner, rollData: item.actor?.getRollData() ?? {}, relativeTo: item
    });
    Object.assign(context, {
      item, system: sys, source: item._source.system,
      type: item.type,
      typeLabel: L(`TYPES.Item.${item.type}`),
      kanji: TYPE_KANJI[item.type] ?? "物",
      editable: this.isEditable,
      isType: Object.fromEntries(Object.keys(TYPE_KANJI).map(t => [t, item.type === t])),
      enriched: {
        description: await enrich(sys.description),
        enhancements: item.type === "jutsu" ? await enrich(sys.enhancements) : ""
      },
      choices: {
        bba: localized(BBA_PROGRESSIONS),
        sizes: localized(SIZES),
        weaponCategories: localized(WEAPON_CATEGORIES),
        weaponKinds: localized(WEAPON_KINDS),
        grips: localized(WEAPON_GRIPS),
        damageTypes: localized(DAMAGE_TYPES),
        armorCategories: localized(ARMOR_CATEGORIES),
        consumableKinds: localized(CONSUMABLE_KINDS),
        featCategories: localized(FEAT_CATEGORIES),
        sources: localized(ABILITY_SOURCES),
        chakras: localized(CHAKRAS),
        grades: localized(JUTSU_GRADES),
        saves: { "": "—", fort: L("IJ.Save.fort"), ref: L("IJ.Save.ref"), von: L("IJ.Save.von") },
        attacks: { "": "—", ...Object.fromEntries(["corpo", "toque", "distancia", "toqueDistancia"].map(k => [k, L(`IJ.Jutsu.attack.${k}`)])) }
      },
      raceChoice: item.type === "race" ? this.#raceChoice(item) : null,
      features: ["class", "race"].includes(item.type)
        ? (sys.features ?? []).map(f => ({ ...f, reached: (item.type === "class") && (f.level <= sys.levels) }))
        : [],
      effects: item.effects.contents.flatMap(e => e.system.changes.map(c => ({ label: effectLabel(c) }))),
      effectsNote: ("equipped" in sys) && item.effects.size ? L("IJ.Item.effectsEquipped") : "",
      abilityMods: item.type === "race"
        ? KEY_ABILITIES.map(k => ({ key: k, label: L(ABILITIES[k].abbr), value: sys.abilityMods[k] }))
        : [],
      classSkills: item.type === "class"
        ? Object.entries(SKILLS).map(([k, s]) => ({ key: k, label: L(s.label), checked: sys.classSkills.includes(k) }))
        : [],
      derived: this.#derived(item),
      usable: !!item.actor && ["weapon", "jutsu", "power", "feat", "consumable"].includes(item.type),
      bookText: bookText.of(item)
    });
    return context;
  }

  /** Numbers worth showing at the top of the card. */
  #derived(item) {
    const sys = item.system;
    switch (item.type) {
      case "weapon": return [
        { label: L("IJ.Weapon.attack"), value: item.actor ? signed(sys.attackTotal) : signed(sys.attackBonus) },
        { label: L("IJ.Weapon.damage"), value: sys.damageFormula },
        { label: L("IJ.Weapon.critical"), value: sys.critLabel },
        { label: L("IJ.Weapon.type"), value: sys.damageType }
      ];
      case "armor": return [
        { label: L("IJ.Armor.bonus"), value: signed(sys.bonus) },
        { label: L("IJ.Armor.maxDex"), value: sys.maxDex === null ? "—" : signed(sys.maxDex) },
        { label: L("IJ.Armor.penalty"), value: sys.penalty ? signed(sys.penalty) : "0" }
      ];
      case "jutsu": return [
        { label: L("IJ.Jutsu.cost"), value: `${sys.cost} PM` },
        { label: L("IJ.Jutsu.dc"), value: sys.dc },
        { label: L("IJ.Jutsu.chakra"), value: L(CHAKRAS[sys.chakra].label) }
      ];
      case "class": return [
        { label: L("IJ.Class.levels"), value: sys.levels },
        { label: L("IJ.BBA.abbr"), value: signed(BBA_PROGRESSIONS[sys.bba]?.calc(sys.levels) ?? 0) },
        { label: L("IJ.Ability.hon"), value: signed(sys.honor) }
      ];
      default: return [];
    }
  }

  /** The "+2 em duas habilidades à escolha" picks of a race (humans, mashin). */
  #raceChoice(item) {
    const { count, value } = item.system.abilityChoice ?? {};
    const chosen = item.system.chosen ?? [];
    return {
      label: game.i18n.format("IJ.Race.chooseLabel", { n: count, v: value, done: chosen.length }),
      missing: chosen.length < count,
      options: KEY_ABILITIES.map(k => ({ key: k, label: L(ABILITIES[k].abbr), chosen: chosen.includes(k) }))
    };
  }

  static async #onToggleRaceChoice(event, target) {
    const key = target.dataset.ability;
    const sys = this.item.system;
    const chosen = new Set(sys.chosen ?? []);
    if (chosen.has(key)) chosen.delete(key);
    else {
      if (chosen.size >= (sys.abilityChoice?.count ?? 0)) return ui.notifications.warn(game.i18n.format("IJ.Race.chooseFull", { n: sys.abilityChoice.count }));
      chosen.add(key);
    }
    await this.item.update({ "system.chosen": [...chosen] });
  }

  static async #onToggleClassSkill(event, target) {
    const key = target.dataset.skill;
    const list = new Set(this.item.system.classSkills);
    if (list.has(key)) list.delete(key);
    else list.add(key);
    await this.item.update({ "system.classSkills": [...list] });
  }

  static #onUseItem(event) {
    this.item.use({ event });
  }
}
