/**
 * Rules data of Império de Jade (Tormenta RPG), as used by the data models, the sheets and the rolls.
 * Labels are i18n keys (lang/pt-BR.json); page numbers point at the core book.
 */
export const SYSTEM_ID = "imperiodejade";

/** The six basic abilities plus Honor (p. 25). The kanji are decorative watermarks on the sheet. */
export const ABILITIES = {
  for: { label: "IJ.Ability.for", abbr: "IJ.AbilityAbbr.for", kanji: "力" },
  des: { label: "IJ.Ability.des", abbr: "IJ.AbilityAbbr.des", kanji: "敏" },
  con: { label: "IJ.Ability.con", abbr: "IJ.AbilityAbbr.con", kanji: "体" },
  int: { label: "IJ.Ability.int", abbr: "IJ.AbilityAbbr.int", kanji: "知" },
  sab: { label: "IJ.Ability.sab", abbr: "IJ.AbilityAbbr.sab", kanji: "智" },
  car: { label: "IJ.Ability.car", abbr: "IJ.AbilityAbbr.car", kanji: "魅" },
  hon: { label: "IJ.Ability.hon", abbr: "IJ.AbilityAbbr.hon", kanji: "誉" }
};

/** Abilities a skill or save can be keyed to (Honor is never a key ability). */
export const KEY_ABILITIES = ["for", "des", "con", "int", "sab", "car"];

/**
 * The skills (p. 98-110). `trainedOnly` skills can't be tested untrained, `armor` ones take the armor penalty,
 * `size` adds the size bonus to stealth, and `specialty` skills are really several skills (one per specialty).
 */
export const SKILLS = {
  acrobacia: { label: "IJ.Skill.acrobacia", ability: "des", armor: true },
  adestrarAnimais: { label: "IJ.Skill.adestrarAnimais", ability: "car", trainedOnly: true },
  atletismo: { label: "IJ.Skill.atletismo", ability: "for" },
  atuacao: { label: "IJ.Skill.atuacao", ability: "car", specialty: true },
  cavalgar: { label: "IJ.Skill.cavalgar", ability: "des" },
  conhecimento: { label: "IJ.Skill.conhecimento", ability: "int", trainedOnly: true, specialty: true },
  cura: { label: "IJ.Skill.cura", ability: "sab" },
  diplomacia: { label: "IJ.Skill.diplomacia", ability: "car" },
  enganacao: { label: "IJ.Skill.enganacao", ability: "car" },
  furtividade: { label: "IJ.Skill.furtividade", ability: "des", armor: true, size: true },
  identificarMagia: { label: "IJ.Skill.identificarMagia", ability: "int", trainedOnly: true },
  iniciativa: { label: "IJ.Skill.iniciativa", ability: "des" },
  intimidacao: { label: "IJ.Skill.intimidacao", ability: "car" },
  intuicao: { label: "IJ.Skill.intuicao", ability: "sab" },
  ladinagem: { label: "IJ.Skill.ladinagem", ability: "des", trainedOnly: true, armor: true },
  obterInformacao: { label: "IJ.Skill.obterInformacao", ability: "car" },
  oficio: { label: "IJ.Skill.oficio", ability: "int", specialty: true },
  percepcao: { label: "IJ.Skill.percepcao", ability: "sab" },
  sobrevivencia: { label: "IJ.Skill.sobrevivencia", ability: "sab" }
};

/** Suggested specialties of the multi-skills (p. 101, 103, 107). Any other name can be typed. */
export const SPECIALTIES = {
  atuacao: ["Arte Tradicional", "Dramaturgia", "Dança", "Música", "Oratória"],
  conhecimento: ["Arcano", "Engenharia", "Geografia", "Guerra", "História", "Natureza", "Nobreza", "Religião", "Tormenta"],
  oficio: ["Alquimia", "Alvenaria", "Carpintaria", "Joalheria", "Metalurgia"]
};

/** Saving throws (p. 78): 1d20 + ability modifier + half the character level. */
export const SAVES = {
  fort: { label: "IJ.Save.fort", ability: "con" },
  ref: { label: "IJ.Save.ref", ability: "des" },
  von: { label: "IJ.Save.von", ability: "sab" }
};

/** Sizes (p. 78 and chapter 5): armor class, attack, stealth and maneuver adjustments, base movement. */
export const SIZES = {
  infimo: { label: "IJ.Size.infimo", ca: 8, attack: 8, stealth: 16, maneuver: -16, movement: 3 },
  diminuto: { label: "IJ.Size.diminuto", ca: 4, attack: 4, stealth: 12, maneuver: -12, movement: 3 },
  minimo: { label: "IJ.Size.minimo", ca: 2, attack: 2, stealth: 8, maneuver: -8, movement: 6 },
  pequeno: { label: "IJ.Size.pequeno", ca: 1, attack: 1, stealth: 4, maneuver: -4, movement: 6 },
  medio: { label: "IJ.Size.medio", ca: 0, attack: 0, stealth: 0, maneuver: 0, movement: 9 },
  grande: { label: "IJ.Size.grande", ca: -1, attack: -1, stealth: -4, maneuver: 4, movement: 9 },
  enorme: { label: "IJ.Size.enorme", ca: -2, attack: -2, stealth: -8, maneuver: 8, movement: 12 },
  descomunal: { label: "IJ.Size.descomunal", ca: -4, attack: -4, stealth: -12, maneuver: 12, movement: 12 },
  colossal: { label: "IJ.Size.colossal", ca: -8, attack: -8, stealth: -16, maneuver: 16, movement: 15 }
};

/** Sizes a player character can have (races and the henge's animal form). */
export const CHARACTER_SIZES = ["minimo", "pequeno", "medio"];

/** Creature types of the bestiary (p. 255). */
export const CREATURE_TYPES = {
  animal: "IJ.Creature.animal",
  construto: "IJ.Creature.construto",
  humanoide: "IJ.Creature.humanoide",
  monstro: "IJ.Creature.monstro",
  youkai: "IJ.Creature.youkai"
};

/** The three castes (p. 89). */
export const CASTES = {
  daizenshi: "IJ.Caste.daizenshi",
  shimin: "IJ.Caste.shimin",
  nainin: "IJ.Caste.nainin"
};

/** Measure of Honor (p. 80-81), from the highest threshold down. `immune` lists the violations it ignores. */
export const HONOR_TIERS = [
  { key: "dignissimo", min: 22, label: "IJ.Honor.tier.dignissimo", immune: [] },
  { key: "honrado", min: 16, label: "IJ.Honor.tier.honrado", immune: [] },
  { key: "honesto", min: 10, label: "IJ.Honor.tier.honesto", immune: ["leve"] },
  { key: "desonrado", min: 6, label: "IJ.Honor.tier.desonrado", immune: ["leve", "moderada"] },
  { key: "sordido", min: 1, label: "IJ.Honor.tier.sordido", immune: ["leve", "moderada", "severa"] },
  { key: "desumano", min: -Infinity, label: "IJ.Honor.tier.desumano", immune: ["leve", "moderada", "severa"] }
];

/** Honor violations (p. 82-84) and the Honor damage each deals; `fixed` is the optional fixed damage rule. */
export const VIOLATIONS = {
  leve: { label: "IJ.Honor.violation.leve", formula: "1", fixed: 1 },
  moderada: { label: "IJ.Honor.violation.moderada", formula: "1d3", fixed: 2 },
  severa: { label: "IJ.Honor.violation.severa", formula: "1d4+1", fixed: 3 },
  extrema: { label: "IJ.Honor.violation.extrema", formula: "2d4", fixed: 5 }
};

/** Base attack bonus progressions (class tables, chapter 1). */
export const BBA_PROGRESSIONS = {
  full: { label: "IJ.BBA.full", calc: level => level },
  threeQuarters: { label: "IJ.BBA.threeQuarters", calc: level => Math.floor((level * 3) / 4) },
  half: { label: "IJ.BBA.half", calc: level => Math.floor(level / 2) }
};

/** The six chakras (p. 159-160), each tied to an ability; opening one adds its modifier to PM and to the PM limit. */
export const CHAKRAS = {
  for: { label: "IJ.Chakra.for", kanji: "腕" },
  des: { label: "IJ.Chakra.des", kanji: "脚" },
  con: { label: "IJ.Chakra.con", kanji: "胴" },
  int: { label: "IJ.Chakra.int", kanji: "知" },
  sab: { label: "IJ.Chakra.sab", kanji: "霊" },
  car: { label: "IJ.Chakra.car", kanji: "情" }
};

/** Jutsu grades (p. 160-161): PM cost and the save DC. */
export const JUTSU_GRADES = {
  basico: { label: "IJ.Grade.basico", cost: 1, dc: 15 },
  mediano: { label: "IJ.Grade.mediano", cost: 3, dc: 18 },
  avancado: { label: "IJ.Grade.avancado", cost: 6, dc: 22 },
  sublime: { label: "IJ.Grade.sublime", cost: 10, dc: 25 },
  lendario: { label: "IJ.Grade.lendario", cost: 15, dc: 28 }
};

/** Weapons (p. 141-149). */
export const WEAPON_CATEGORIES = {
  simples: "IJ.Weapon.category.simples",
  marcial: "IJ.Weapon.category.marcial",
  exotica: "IJ.Weapon.category.exotica"
};
export const WEAPON_KINDS = {
  corpo: { label: "IJ.Weapon.kind.corpo", attack: "for", damage: true },
  arremesso: { label: "IJ.Weapon.kind.arremesso", attack: "des", damage: true },
  disparo: { label: "IJ.Weapon.kind.disparo", attack: "des", damage: false }
};
export const WEAPON_GRIPS = {
  leve: "IJ.Weapon.grip.leve",
  umaMao: "IJ.Weapon.grip.umaMao",
  duasMaos: "IJ.Weapon.grip.duasMaos"
};
export const DAMAGE_TYPES = {
  C: "IJ.Damage.C",
  P: "IJ.Damage.P",
  E: "IJ.Damage.E",
  CP: "IJ.Damage.CP",
  PE: "IJ.Damage.PE"
};

/** Armor categories (p. 150-151). */
export const ARMOR_CATEGORIES = {
  leve: "IJ.Armor.category.leve",
  media: "IJ.Armor.category.media",
  pesada: "IJ.Armor.category.pesada",
  escudo: "IJ.Armor.category.escudo"
};

/** Feat groups (chapter 2). */
export const FEAT_CATEGORIES = {
  combate: "IJ.Feat.category.combate",
  pericia: "IJ.Feat.category.pericia",
  destino: "IJ.Feat.category.destino",
  jutsu: "IJ.Feat.category.jutsu",
  aprimoramento: "IJ.Feat.category.aprimoramento",
  poder: "IJ.Feat.category.poder",
  tormenta: "IJ.Feat.category.tormenta"
};

/** Where an ability comes from. */
export const ABILITY_SOURCES = {
  classe: "IJ.Power.source.classe",
  raca: "IJ.Power.source.raca",
  outra: "IJ.Power.source.outra"
};

/** Consumable kinds. */
export const CONSUMABLE_KINDS = {
  ofuda: "IJ.Consumable.kind.ofuda",
  pocao: "IJ.Consumable.kind.pocao",
  erva: "IJ.Consumable.kind.erva",
  municao: "IJ.Consumable.kind.municao",
  outro: "IJ.Consumable.kind.outro"
};

/** Yan coins (p. 139): 1 ¥o = 10 ¥p = 100 ¥. */
export const CURRENCIES = {
  yo: { label: "IJ.Currency.yo", abbr: "¥o", rate: 100 },
  yp: { label: "IJ.Currency.yp", abbr: "¥p", rate: 10 },
  y: { label: "IJ.Currency.y", abbr: "¥", rate: 1 }
};

/** Experience needed for each level (p. 45): 500 × L × (L − 1). */
export const xpForLevel = level => 500 * level * (level - 1);

/** Ability modifier from its score (p. 25). */
export const abilityMod = score => Math.floor((score - 10) / 2);

/** Measure of Honor of a score. */
export const honorTier = score => HONOR_TIERS.find(t => score >= t.min) ?? HONOR_TIERS.at(-1);

export const IJ = {
  ABILITIES, KEY_ABILITIES, SKILLS, SPECIALTIES, SAVES, SIZES, CHARACTER_SIZES, CREATURE_TYPES, CASTES, HONOR_TIERS, VIOLATIONS, BBA_PROGRESSIONS,
  CHAKRAS, JUTSU_GRADES, WEAPON_CATEGORIES, WEAPON_KINDS, WEAPON_GRIPS, DAMAGE_TYPES, ARMOR_CATEGORIES,
  FEAT_CATEGORIES, ABILITY_SOURCES, CONSUMABLE_KINDS, CURRENCIES
};
