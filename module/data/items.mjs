import {
  ABILITY_SOURCES, ARMOR_CATEGORIES, BBA_PROGRESSIONS, CHAKRAS, CONSUMABLE_KINDS, DAMAGE_TYPES, FEAT_CATEGORIES,
  JUTSU_GRADES, KEY_ABILITIES, SIZES, SKILLS, WEAPON_CATEGORIES, WEAPON_GRIPS, WEAPON_KINDS
} from "../config.mjs";

const { fields } = foundry.data;

const int = (initial = 0, options = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const num = (initial = 0, options = {}) => new fields.NumberField({ required: true, nullable: false, initial, ...options });
const text = (initial = "") => new fields.StringField({ required: true, blank: true, initial });
const choice = (choices, initial) => new fields.StringField({ required: true, initial, choices: Object.keys(choices) });
const html = () => new fields.HTMLField({ required: true, blank: true });

/** Fields every item shares: the description and where it came from (book page). */
class ItemBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: html(),
      source: text()
    };
  }
}

/** Physical items: quantity, weight (kg) and price. */
const physical = () => ({
  quantity: int(1, { min: 0 }),
  weight: num(0, { min: 0 }),
  price: text()
});

/* -------------------------------------------- */

/** A class (chapter 1): levels in it, PV, PM, BBA progression, trained skills and Honor modifier. */
export class ClassData extends ItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      levels: int(1, { min: 1, max: 20 }),
      primary: new fields.BooleanField({ initial: false }),
      pv: new fields.SchemaField({ initial: int(12, { min: 0 }), perLevel: int(3, { min: 0 }) }),
      pm: new fields.SchemaField({ initial: int(4, { min: 0 }), perLevel: int(2, { min: 0 }) }),
      bba: choice(BBA_PROGRESSIONS, "full"),
      skills: int(4, { min: 0 }),
      classSkills: new fields.ArrayField(new fields.StringField({ choices: Object.keys(SKILLS) })),
      honor: int(0),
      startingFeats: text()
    };
  }
}

/** A race (chapter 1): size, movement, ability adjustments, Honor modifier and extra trained skills. */
export class RaceData extends ItemBase {
  static defineSchema() {
    const mods = {};
    for (const key of KEY_ABILITIES) mods[key] = int(0);
    return {
      ...super.defineSchema(),
      size: choice(SIZES, "medio"),
      movement: int(9, { min: 0 }),
      abilityMods: new fields.SchemaField(mods),
      honor: int(0),
      bonusSkills: int(0, { min: 0 })
    };
  }
}

/** A weapon (p. 141-149). */
export class WeaponData extends ItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      ...physical(),
      category: choice(WEAPON_CATEGORIES, "simples"),
      kind: choice(WEAPON_KINDS, "corpo"),
      grip: choice(WEAPON_GRIPS, "umaMao"),
      damage: text("1d6"),
      damageType: choice(DAMAGE_TYPES, "C"),
      critRange: int(20, { min: 2, max: 20 }),
      critMult: int(2, { min: 2, max: 6 }),
      range: int(0, { min: 0 }),
      attackBonus: int(0),
      damageBonus: int(0),
      proficient: new fields.BooleanField({ initial: true }),
      equipped: new fields.BooleanField({ initial: true }),
      dishonorable: new fields.BooleanField({ initial: false })
    };
  }

  /*
   * The numbers below depend on the owner's derived data, which is prepared after its items: they are getters, read
   * when the sheet or a roll needs them.
   */

  /** The owner's character data, when the weapon is carried by a character. */
  get #owner() {
    const actor = this.parent?.actor;
    return (actor?.type === "character") ? actor.system : null;
  }

  /** "19/x2", "x3"... */
  get critLabel() {
    return `${this.critRange < 20 ? `${this.critRange}/` : ""}x${this.critMult}`;
  }

  /** The ability used to attack: Strength in melee, Dexterity at range (p. 141). */
  get attackAbility() {
    return (WEAPON_KINDS[this.kind] ?? WEAPON_KINDS.corpo).attack;
  }

  /** Total attack bonus: BBA + ability + size + weapon bonus, −4 without proficiency (p. 141). */
  get attackTotal() {
    const sys = this.#owner;
    if (!sys?.attack) return this.attackBonus;
    const base = this.attackAbility === "for" ? sys.attack.melee : sys.attack.ranged;
    return base + this.attackBonus - (this.proficient ? 0 : 4);
  }

  /** Flat damage: Strength for melee and thrown weapons, none for missile weapons (p. 227), plus bonuses. */
  get damageFlat() {
    const sys = this.#owner;
    const kind = WEAPON_KINDS[this.kind] ?? WEAPON_KINDS.corpo;
    const strength = (kind.damage && sys) ? (sys.abilities?.for?.mod ?? 0) : 0;
    return strength + this.damageBonus + (sys?.attack?.damage ?? 0);
  }

  /** "1d10 + 3" */
  get damageFormula() {
    const flat = this.damageFlat;
    return flat ? `${this.damage} ${flat > 0 ? "+" : "-"} ${Math.abs(flat)}` : this.damage;
  }
}

/** Armor or shield (p. 150-151). `maxDex` null means no limit. */
export class ArmorData extends ItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      ...physical(),
      category: choice(ARMOR_CATEGORIES, "leve"),
      bonus: int(2),
      maxDex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      penalty: int(0, { max: 0 }),
      rd: int(0, { min: 0 }),
      equipped: new fields.BooleanField({ initial: false }),
      dishonorable: new fields.BooleanField({ initial: false })
    };
  }
}

/** General equipment (p. 153-157). */
export class GearData extends ItemBase {
  static defineSchema() {
    return { ...super.defineSchema(), ...physical() };
  }
}

/** Consumables: ofuda, potions, herbs, ammunition... with charges. */
export class ConsumableData extends ItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      ...physical(),
      kind: choice(CONSUMABLE_KINDS, "outro"),
      uses: new fields.SchemaField({ value: int(0, { min: 0 }), max: int(0, { min: 0 }) })
    };
  }
}

/** A feat (chapter 2). */
export class FeatData extends ItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      category: choice(FEAT_CATEGORIES, "combate"),
      prerequisites: text(),
      cost: int(0, { min: 0 }),
      honorMin: int(0, { min: 0 })
    };
  }
}

/** A class or race ability (powers listed in the class tables and racial traits). */
export class PowerData extends ItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      origin: choice(ABILITY_SOURCES, "classe"),
      originName: text(),
      level: int(1, { min: 0, max: 20 }),
      cost: int(0, { min: 0 }),
      honorMin: int(0, { min: 0 }),
      action: text()
    };
  }
}

/** A jutsu (chapter 4): chakra, grade, execution, range, effect, duration, save and enhancements. */
export class JutsuData extends ItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      chakra: choice(CHAKRAS, "int"),
      grade: choice(JUTSU_GRADES, "basico"),
      descriptors: text(),
      execution: text("padrão"),
      range: text("curto"),
      target: text(),
      duration: text("instantânea"),
      resistance: text(),
      extraCost: int(0, { min: 0 }),
      enhancements: html()
    };
  }

  prepareDerivedData() {
    const grade = JUTSU_GRADES[this.grade] ?? JUTSU_GRADES.basico;
    this.cost = grade.cost + this.extraCost;
    this.dc = grade.dc;
  }
}

export const ITEM_MODELS = {
  class: ClassData,
  race: RaceData,
  weapon: WeaponData,
  armor: ArmorData,
  gear: GearData,
  consumable: ConsumableData,
  feat: FeatData,
  power: PowerData,
  jutsu: JutsuData
};
