import {
  ABILITIES, BBA_PROGRESSIONS, CASTES, CHAKRAS, JUTSU_GRADES, KEY_ABILITIES, SAVES, SIZES, SKILLS,
  abilityMod, honorTier, xpForLevel
} from "../config.mjs";

const { fields } = foundry.data;

const int = (initial = 0, options = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const text = (initial = "") => new fields.StringField({ required: true, blank: true, initial });

/**
 * The player character of Império de Jade.
 *
 * Stored values are what the player types (ability scores, trained skills, bonuses, current PV/PM...). Everything a
 * rule derives (modifiers, skill totals, armor class, saves, attacks, PV/PM maxima with class items, the Measure of
 * Honor...) is computed in prepareDerivedData and never saved.
 *
 * Level, BBA and the PV/PM maxima are typed by hand while the actor has no class item; with class items they come
 * from the classes (multiclass included, p. 45).
 */
export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const abilities = {};
    for (const key of Object.keys(ABILITIES)) {
      abilities[key] = new fields.SchemaField({ value: int(10, { min: 0 }), bonus: int(0) });
    }
    const skills = {};
    for (const [key, skill] of Object.entries(SKILLS)) {
      skills[key] = new fields.SchemaField({
        trained: new fields.BooleanField({ initial: false }),
        ability: new fields.StringField({ required: true, initial: skill.ability, choices: KEY_ABILITIES }),
        bonus: int(0)
      });
    }
    const saves = {};
    for (const key of Object.keys(SAVES)) saves[key] = new fields.SchemaField({ bonus: int(0) });
    const chakras = {};
    for (const key of Object.keys(CHAKRAS)) {
      chakras[key] = new fields.SchemaField({
        open: new fields.BooleanField({ initial: false }),
        grade: new fields.StringField({ required: true, initial: "basico", choices: Object.keys(JUTSU_GRADES) })
      });
    }

    return {
      abilities: new fields.SchemaField(abilities),
      skills: new fields.SchemaField(skills),
      // Atuação, Conhecimento and Ofício are one skill per specialty (p. 101): {id: {skill, label, trained, bonus}}
      specialties: new fields.TypedObjectField(new fields.SchemaField({
        skill: new fields.StringField({ required: true, initial: "conhecimento", choices: ["atuacao", "conhecimento", "oficio"] }),
        label: text(),
        trained: new fields.BooleanField({ initial: true }),
        bonus: int(0)
      })),
      saves: new fields.SchemaField(saves),
      attributes: new fields.SchemaField({
        level: int(1, { min: 1, max: 20 }),
        xp: int(0, { min: 0 }),
        bba: int(0),
        pv: new fields.SchemaField({ value: int(10), max: int(10, { min: 0 }), temp: int(0, { min: 0 }), bonus: int(0) }),
        pm: new fields.SchemaField({ value: int(4), max: int(4, { min: 0 }), bonus: int(0), limitBonus: int(0) }),
        ca: new fields.SchemaField({ bonus: int(0) }),
        attack: new fields.SchemaField({ melee: int(0), ranged: int(0), damage: int(0) }),
        movement: new fields.SchemaField({ base: int(9, { min: 0 }), bonus: int(0) }),
        rd: int(0, { min: 0 }),
        energy: text()
      }),
      honor: new fields.SchemaField({
        // The Reserve of Strength, once per game session (p. 86)
        reserveUsed: new fields.BooleanField({ initial: false })
      }),
      chakras: new fields.SchemaField(chakras),
      details: new fields.SchemaField({
        player: text(),
        race: text(),
        className: text(),
        size: new fields.StringField({ required: true, initial: "medio", choices: Object.keys(SIZES) }),
        caste: new fields.StringField({ required: true, blank: true, initial: "shimin", choices: ["", ...Object.keys(CASTES)] }),
        religion: text(),
        clan: text(),
        sentai: text(),
        gender: text(),
        age: text(),
        height: text(),
        weight: text(),
        title: text()
      }),
      currency: new fields.SchemaField({ yo: int(0, { min: 0 }), yp: int(0, { min: 0 }), y: int(0, { min: 0 }) }),
      biography: new fields.SchemaField({
        appearance: new fields.HTMLField({ required: true, blank: true }),
        personality: new fields.HTMLField({ required: true, blank: true }),
        history: new fields.HTMLField({ required: true, blank: true }),
        notes: new fields.HTMLField({ required: true, blank: true })
      })
    };
  }

  /* -------------------------------------------- */

  prepareBaseData() {
    for (const ability of Object.values(this.abilities)) {
      ability.total = ability.value + ability.bonus;
      ability.mod = abilityMod(ability.total);
    }
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    const actor = this.parent;
    const items = actor.items;
    const abl = this.abilities;
    const mod = key => abl[key]?.mod ?? 0;

    // Classes and race (items). The primary class is the flagged one, or the first one by sort order.
    const classes = items.filter(i => i.type === "class").sort((a, b) => a.sort - b.sort);
    const primary = classes.find(c => c.system.primary) ?? classes[0] ?? null;
    const race = items.find(i => i.type === "race") ?? null;
    // Plain summaries only: documents never live inside the system data
    this.classes = classes.map(c => ({ id: c.id, name: c.name, img: c.img, levels: c.system.levels, primary: c === primary }));
    this.auto = { classes: classes.length > 0, race: !!race, raceId: race?.id ?? null };

    // Level, BBA and half level (p. 45-46)
    const level = classes.length ? Math.max(1, classes.reduce((t, c) => t + c.system.levels, 0)) : this.attributes.level;
    this.level = level;
    this.halfLevel = Math.floor(level / 2);
    this.bba = classes.length
      ? classes.reduce((t, c) => t + (BBA_PROGRESSIONS[c.system.bba]?.calc(c.system.levels) ?? 0), 0)
      : this.attributes.bba;
    this.classLabel = classes.length
      ? classes.map(c => `${c.name} ${c.system.levels}`).join(" / ")
      : this.details.className;
    this.raceLabel = race?.name ?? this.details.race;

    // Experience (p. 45)
    const xpNext = level >= 20 ? xpForLevel(20) : xpForLevel(level + 1);
    const xpPrev = xpForLevel(level);
    this.xp = {
      value: this.attributes.xp,
      next: xpNext,
      prev: xpPrev,
      pct: level >= 20 ? 100 : Math.clamp(Math.round(((this.attributes.xp - xpPrev) / Math.max(1, xpNext - xpPrev)) * 100), 0, 100),
      canLevel: (level < 20) && (this.attributes.xp >= xpNext)
    };

    // Size and movement (race item or the details)
    const sizeKey = race?.system.size ?? this.details.size;
    const size = SIZES[sizeKey] ?? SIZES.medio;
    this.size = { key: sizeKey, ...size };
    const baseMove = race ? race.system.movement : this.attributes.movement.base;
    this.movement = baseMove + this.attributes.movement.bonus;

    // Equipped armor and shield (p. 150): armor class, maximum Dexterity, armor penalty, damage reduction
    const armors = items.filter(i => (i.type === "armor") && i.system.equipped);
    const bodyArmor = armors.find(a => a.system.category !== "escudo") ?? null;
    const shield = armors.find(a => a.system.category === "escudo") ?? null;
    const maxDex = armors.reduce((m, a) => (a.system.maxDex === null ? m : Math.min(m, a.system.maxDex)), Infinity);
    this.armor = {
      bodyId: bodyArmor?.id ?? null,
      shieldId: shield?.id ?? null,
      bodyBonus: bodyArmor?.system.bonus ?? 0,
      shieldBonus: shield?.system.bonus ?? 0,
      maxDex: Number.isFinite(maxDex) ? maxDex : null,
      penalty: armors.reduce((t, a) => t + Math.min(0, a.system.penalty), 0),
      rd: armors.reduce((t, a) => t + (a.system.rd ?? 0), 0)
    };
    this.rd = this.attributes.rd + this.armor.rd;

    // Armor class (p. 77 and the level table, p. 45): 10 + half level + Dex (capped by armor) + armor + shield
    const dexToCa = this.armor.maxDex === null ? mod("des") : Math.min(mod("des"), this.armor.maxDex);
    this.ca = {
      dex: dexToCa,
      total: 10 + this.halfLevel + dexToCa + this.armor.bodyBonus + this.armor.shieldBonus + size.ca + this.attributes.ca.bonus
    };

    // Saving throws (p. 78)
    for (const [key, save] of Object.entries(SAVES)) {
      const s = this.saves[key];
      s.ability = save.ability;
      s.mod = mod(save.ability);
      s.total = this.halfLevel + s.mod + s.bonus;
    }

    // Attacks (p. 227): BBA + Strength (melee) or Dexterity (ranged)
    this.attack = {
      melee: this.bba + mod("for") + size.attack + this.attributes.attack.melee,
      ranged: this.bba + mod("des") + size.attack + this.attributes.attack.ranged,
      damage: this.attributes.attack.damage
    };

    // Skills (p. 97, 223): ranks = level + 3 trained, half level otherwise; + key ability; armor penalty
    const skillTotal = (skill, data) => {
      const ranks = data.trained ? level + 3 : this.halfLevel;
      const abilityMod = mod(data.ability);
      const penalty = skill.armor ? this.armor.penalty : 0;
      const sizeBonus = skill.size ? size.stealth : 0;
      return { ranks, abilityMod, penalty, sizeBonus, total: ranks + abilityMod + data.bonus + penalty + sizeBonus };
    };
    for (const [key, skill] of Object.entries(SKILLS)) {
      Object.assign(this.skills[key], skillTotal(skill, this.skills[key]), {
        usable: this.skills[key].trained || !skill.trainedOnly
      });
    }
    for (const spec of Object.values(this.specialties)) {
      const skill = SKILLS[spec.skill];
      const ability = this.skills[spec.skill]?.ability ?? skill.ability;
      Object.assign(spec, skillTotal(skill, { ...spec, ability }), { ability, usable: spec.trained || !skill.trainedOnly });
    }

    // Trained skills allowed (p. 97): primary class + Int modifier (+2 for humans), at least one
    const trained = Object.values(this.skills).filter(s => s.trained).length
      + Object.values(this.specialties).filter(s => s.trained).length;
    const allowed = primary
      ? Math.max(1, primary.system.skills + mod("int") + (race?.system.bonusSkills ?? 0))
      : null;
    this.skillCount = { trained, allowed };

    // Chakras (p. 160): each open one adds its ability modifier to PM and to the PM limit
    let chakraPm = 0;
    let chakraLimit = 0;
    for (const [key, chakra] of Object.entries(this.chakras)) {
      chakra.mod = mod(key);
      chakra.dc = JUTSU_GRADES[chakra.grade]?.dc ?? 15;
      if (!chakra.open) continue;
      chakraPm += chakra.mod;
      chakraLimit += chakra.mod;
    }

    // Hit points and mana points (classes, p. 45-46): only the first class gives the initial values
    const pv = this.attributes.pv;
    const pm = this.attributes.pm;
    if (classes.length) {
      let pvFromClasses = 0;
      let pmFromClasses = 0;
      for (const c of classes) {
        const isPrimary = c === primary;
        const { levels } = c.system;
        pvFromClasses += isPrimary ? c.system.pv.initial + (c.system.pv.perLevel * (levels - 1)) : c.system.pv.perLevel * levels;
        pmFromClasses += isPrimary ? c.system.pm.initial + (c.system.pm.perLevel * (levels - 1)) : c.system.pm.perLevel * levels;
      }
      pv.max = Math.max(1, pvFromClasses + (mod("con") * level) + pv.bonus);
      pm.max = Math.max(0, pmFromClasses + chakraPm + pm.bonus);
    } else {
      // Typed by hand: read the stored value, so preparing twice never adds the bonuses twice
      const src = this._source.attributes;
      pv.max = Math.max(0, src.pv.max + pv.bonus);
      pm.max = Math.max(0, src.pm.max + chakraPm + pm.bonus);
    }
    pv.pct = pv.max ? Math.clamp(Math.round((pv.value / pv.max) * 100), 0, 100) : 0;
    pm.pct = pm.max ? Math.clamp(Math.round((pm.value / pm.max) * 100), 0, 100) : 0;
    // Death at negative half of the total PV (p. 77)
    pv.death = -Math.floor(pv.max / 2);
    pm.limit = level + chakraLimit + pm.limitBonus;
    this.chakraPm = chakraPm;

    // Honor (p. 80-86)
    const hon = abl.hon.total;
    const tier = honorTier(hon);
    this.honorTier = tier;
    this.honorReserve = { available: abl.hon.mod > 0 && !this.honor.reserveUsed, bonus: abl.hon.mod * 2 };

    // Initiative is the Iniciativa skill
    this.initiative = this.skills.iniciativa.total;
  }
}
