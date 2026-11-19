import { ABILITIES, CREATURE_TYPES, SIZES, abilityMod, honorTier } from "../config.mjs";
import { collectTraits, norm } from "../auto/context.mjs";
import { conditionMods } from "../auto/conditions.mjs";

const { fields } = foundry.data;

const int = (initial = 0, options = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const text = (initial = "") => new fields.StringField({ required: true, blank: true, initial });

/** Words of the stat blocks and the immunity keys of the automation. */
const IMMUNITY_WORDS = [
  [/acertos? criticos?/, "critico"], [/acido/, "acido"], [/eletricidade/, "eletricidade"], [/fogo/, "fogo"],
  [/frio/, "frio"], [/\bluz\b/, "luz"], [/trevas/, "trevas"], [/vento/, "vento"], [/vacuo/, "vacuo"],
  [/venenos?/, "veneno"], [/doencas?/, "doenca"], [/paralisia/, "paralisia"], [/sono/, "sono"], [/medo/, "medo"],
  [/enjoo/, "enjoo"], [/sangramento/, "sangrando"], [/atordoamento/, "atordoamento"], [/dano de habilidade/, "danoHabilidade"],
  [/transmutacao/, "transmutacao"], [/encantamento/, "encantamento"], [/surpresa/, "surpresa"]
];
const ENERGY_WORDS = ["acido", "eletricidade", "fogo", "frio", "vento", "luz", "trevas", "vacuo", "energia"];

/**
 * Read the defenses of a stat block ("imunidade a acertos críticos, fogo e venenos, resistência a energia 30,
 * fortificação 75%, vulnerabilidade a frio, cura acelerada 5") into automation traits.
 */
export function parseDefenses(textIn) {
  const out = { immune: [], resist: {}, vulnerable: [], fortification: 0, fastHealing: 0 };
  const t = norm(textIn).replace(/\s+/g, " ");
  if (!t) return out;
  // Split into clauses at the keywords
  const clauses = t.split(/(?=imunidade|resistencia|vulnerabilidade|fortificacao|cura acelerada)/);
  for (const clause of clauses) {
    if (clause.startsWith("imunidade")) {
      for (const [re, key] of IMMUNITY_WORDS) if (re.test(clause) && !out.immune.includes(key)) out.immune.push(key);
    } else if (clause.startsWith("resistencia")) {
      const n = Number(/(\d+)/.exec(clause)?.[1] ?? 0);
      for (const e of ENERGY_WORDS) if (new RegExp(`\\b${e}\\b`).test(clause)) out.resist[e] = Math.max(out.resist[e] ?? 0, n);
    } else if (clause.startsWith("vulnerabilidade")) {
      for (const e of ENERGY_WORDS) if (new RegExp(`\\b${e}\\b`).test(clause)) out.vulnerable.push(e);
    } else if (clause.startsWith("fortificacao")) {
      out.fortification = Number(/(\d+)/.exec(clause)?.[1] ?? 0);
    } else if (clause.startsWith("cura acelerada")) {
      out.fastHealing = Number(/(\d+)/.exec(clause)?.[1] ?? 0);
    }
  }
  if (/incorporeo/.test(t)) out.incorporeal = true;
  return out;
}

/** "10/esmagamento" → { value: 10, bypass: "E" } */
export function parseRd(textIn, fallback = 0) {
  const t = norm(textIn);
  const value = Number(/(\d+)/.exec(t)?.[1] ?? fallback) || 0;
  const bypass = /esmag/.test(t) ? "E" : /perfur/.test(t) ? "P" : /corte/.test(t) ? "C" : /luz/.test(t) ? "luz" : null;
  return { value, bypass };
}

/**
 * A threat of the bestiary (chapter 7): the stat block as printed. The totals are typed (they come ready from the
 * book); attacks are weapon items (attack bonus = the total), special abilities are ability items, jutsus are jutsus.
 * Conditions and effects change the numbers that matter in play (CA, saves) through the automation.
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
      negativeLevels: int(0, { min: 0 }),
      // Ability damage taken (poisons, drains): lowers the score and its modifier
      abilityDamage: new fields.SchemaField({ for: int(0, { min: 0 }), des: int(0, { min: 0 }), con: int(0, { min: 0 }), int: int(0, { min: 0 }), sab: int(0, { min: 0 }), car: int(0, { min: 0 }) }),
      // Bonuses that effects give (buffs and debuffs of abilities and jutsus)
      bonus: new fields.SchemaField({ ca: int(0), saves: int(0), attack: int(0), damage: int(0) }),
      description: new fields.HTMLField({ required: true, blank: true }),
      notes: new fields.HTMLField({ required: true, blank: true }),
      source: text()
    };
  }

  prepareDerivedData() {
    this.mods = {};
    for (const [key, score] of Object.entries(this.abilities)) {
      this.mods[key] = (score === null) ? null : abilityMod(Math.max(0, score - (this.abilityDamage?.[key] ?? 0)));
    }
    this.honorTier = this.abilities.hon === null ? null : honorTier(this.abilities.hon);
    this.sizeData = SIZES[this.size] ?? SIZES.medio;
    const rd = parseRd(this._source.rd, this.rdValue);
    this.rdText = this._source.rd;
    this.rd = Math.max(this.rdValue, rd.value);
    this.rdBypass = rd.bypass;
    this.pv.pct = this.pv.max ? Math.clamp(Math.round((this.pv.value / this.pv.max) * 100), 0, 100) : 0;
    this.pm.pct = this.pm.max ? Math.clamp(Math.round((this.pm.value / this.pm.max) * 100), 0, 100) : 0;

    // Traits: the stat block's defenses plus what its abilities and effects give
    const actor = this.parent;
    const traits = collectTraits(actor);
    const parsed = parseDefenses(this.resistances);
    for (const k of parsed.immune) if (!traits.immune.includes(k)) traits.immune.push(k);
    for (const [k, v] of Object.entries(parsed.resist)) traits.resist[k] = Math.max(traits.resist[k] ?? 0, v);
    traits.vulnerable = [...new Set([...(traits.vulnerable ?? []), ...parsed.vulnerable])];
    traits.fortification = Math.min(100, (traits.fortification ?? 0) + parsed.fortification);
    traits.fastHealing = Math.max(traits.fastHealing ?? 0, parsed.fastHealing);
    if (parsed.incorporeal) traits.incorporeal = true;
    if (traits.immune.includes("surpresa")) traits.uncannyDodge = Math.max(traits.uncannyDodge ?? 0, 1);
    this.traits = traits;

    // Conditions and effects on the numbers of play
    const cond = conditionMods(actor);
    this.conditions = { list: [...cond.statuses], noActions: cond.noActions, oneAction: cond.oneAction, miss: cond.miss };
    this.caTotal = cond.caOverride ? 5 + this.sizeData.ca : this.ca + cond.ca + this.bonus.ca;
    this.saveTotals = {
      fort: this.saves.fort + cond.saves + this.bonus.saves,
      ref: this.saves.ref + cond.saves + cond.ref + this.bonus.saves,
      von: this.saves.von + cond.saves + this.bonus.saves
    };
    this.attackMod = { melee: cond.attack + cond.attackMelee + this.bonus.attack, ranged: cond.attack + cond.attackRanged + this.bonus.attack, damage: cond.damage + this.bonus.damage };
    this.checkMod = cond.skills + cond.abilityTests;
    this.perceptionTotal = this.perception + cond.skills + cond.perception;
    this.initiativeTotal = this.initiative + cond.skills + cond.initiative;
  }
}
