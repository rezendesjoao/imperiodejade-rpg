import { ABILITIES, CREATURE_TYPES, SIZES, abilityMod, honorTier } from "../config.mjs";

const { fields } = foundry.data;

const int = (initial = 0, options = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const text = (initial = "") => new fields.StringField({ required: true, blank: true, initial });

/**
 * A threat of the bestiary (chapter 7): the stat block as printed. The totals are typed (they come ready from the
 * book); attacks are weapon items (attack bonus = the total), special abilities are ability items, jutsus are jutsus.
 */
export class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const abilities = {};
    for (const key of Object.keys(ABILITIES)) {
      abilities[key] = new fields.NumberField({ required: true, nullable: true, integer: true, initial: 10, min: 0 });
    }
    return {
      nd: text("1"),
      creatureType: new fields.StringField({ required: true, initial: "humanoide", choices: Object.keys(CREATURE_TYPES) }),
      level: int(1, { min: 0 }),
      size: new fields.StringField({ required: true, initial: "medio", choices: Object.keys(SIZES) }),
      sizeNote: text(),
      initiative: int(0),
      perception: int(0),
      senses: text(),
      ca: int(10),
      caNote: text(),
      pv: new fields.SchemaField({ value: int(10), max: int(10, { min: 0 }), temp: int(0, { min: 0 }) }),
      pm: new fields.SchemaField({ value: int(0), max: int(0, { min: 0 }) }),
      saves: new fields.SchemaField({ fort: int(0), ref: int(0), von: int(0) }),
      movement: text("9m"),
      abilities: new fields.SchemaField(abilities),
      skills: text(),
      rd: text(),
      rdValue: int(0, { min: 0 }),
      resistances: text(),
      treasure: text(),
      attackText: text(),
      description: new fields.HTMLField({ required: true, blank: true }),
      notes: new fields.HTMLField({ required: true, blank: true }),
      source: text()
    };
  }

  prepareDerivedData() {
    this.mods = {};
    for (const [key, score] of Object.entries(this.abilities)) this.mods[key] = (score === null) ? null : abilityMod(score);
    this.honorTier = this.abilities.hon === null ? null : honorTier(this.abilities.hon);
    this.sizeData = SIZES[this.size] ?? SIZES.medio;
    this.rd = this.rdValue;
    this.pv.pct = this.pv.max ? Math.clamp(Math.round((this.pv.value / this.pv.max) * 100), 0, 100) : 0;
    this.pm.pct = this.pm.max ? Math.clamp(Math.round((this.pm.value / this.pm.max) * 100), 0, 100) : 0;
  }
}
