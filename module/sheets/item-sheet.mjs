import {
  ABILITY_SOURCES, ARMOR_CATEGORIES, BBA_PROGRESSIONS, CHAKRAS, CONSUMABLE_KINDS, DAMAGE_TYPES, FEAT_CATEGORIES,
  JUTSU_GRADES, KEY_ABILITIES, ABILITIES, SIZES, SKILLS, SYSTEM_ID, WEAPON_CATEGORIES, WEAPON_GRIPS, WEAPON_KINDS
} from "../config.mjs";
import { signed } from "../dice/rolls.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

const L = key => game.i18n.localize(key);
const localized = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, L(typeof v === "string" ? v : v.label)]));

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
        grades: localized(JUTSU_GRADES)
      },
      abilityMods: item.type === "race"
        ? KEY_ABILITIES.map(k => ({ key: k, label: L(ABILITIES[k].abbr), value: sys.abilityMods[k] }))
        : [],
      classSkills: item.type === "class"
        ? Object.entries(SKILLS).map(([k, s]) => ({ key: k, label: L(s.label), checked: sys.classSkills.includes(k) }))
        : [],
      derived: this.#derived(item),
      usable: !!item.actor && ["weapon", "jutsu", "power", "feat", "consumable"].includes(item.type)
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
