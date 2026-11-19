/**
 * The rules of character creation (Império de Jade, chapters 1 to 4) as the creation wizard uses them: how the seven
 * abilities are generated, the starting money of each caste, the Honor violations a creation can commit (with the
 * fixed damage of p. 84), prices, the prerequisites of feats and the class tables the book leaves to the player
 * (ability priorities, recommended gear). Pure data and functions: no documents and no rendering.
 */
import { HONOR_TIERS, SKILLS, abilityMod, honorTier } from "../config.mjs";
import { norm } from "../auto/context.mjs";

/** The seven abilities a creation generates: the six basic ones and Honor (p. 26 and 81). */
export const GEN_KEYS = ["for", "des", "con", "int", "sab", "car", "hon"];

/* -------------------------------------------- */
/*  Generating the abilities (p. 26)            */
/* -------------------------------------------- */

/** Point buy: 24 points for the seven scores, from 8 to 18. */
export const POINT_BUY = {
  budget: 24,
  min: 8,
  max: 18,
  cost: { 8: -2, 9: -1, 10: 0, 11: 1, 12: 2, 13: 3, 14: 4, 15: 6, 16: 8, 17: 11, 18: 14 }
};

export const pointCost = score => POINT_BUY.cost[score] ?? 0;

/** The points a set of scores costs. */
export const pointsSpent = base => GEN_KEYS.reduce((t, k) => t + pointCost(base?.[k] ?? 10), 0);

/** Rolling: 4d6 with the lowest die dropped, seven times. */
export const ROLL = { formula: "4d6kh3", count: 7 };

/** A set may be rolled again when its modifiers add up to less than +4 or none of its scores is 14 or more. */
export function rerollAllowed(values = []) {
  if (values.length < ROLL.count) return false;
  const mods = values.reduce((t, v) => t + abilityMod(v), 0);
  return (mods < 4) || !values.some(v => v >= 14);
}

/** Scores typed by hand (rolled with real dice at the table). */
export const FREE = { min: 3, max: 18 };

/** The generation methods, and what the GM's setting allows. */
export const METHODS = ["points", "roll", "free"];
export const METHOD_SETTING = { choose: ["points", "roll"], points: ["points"], roll: ["roll"], free: ["free"], all: ["points", "roll", "free"] };

/** The spread suggested for the point buy (24 points): the class's first abilities get the higher scores. */
export const SUGGESTED_SCORES = [16, 16, 14, 14, 12, 10, 8];

/**
 * The abilities each class leans on, from the most to the least important (keys: the class's name, normalized).
 * Samurai and shugenja need Honor 16 for their abilities of the 1st level, so Honor comes early for them.
 */
export const CLASS_PRIORITIES = {
  bushi: ["for", "con", "des", "sab", "hon", "int", "car"],
  kensei: ["for", "des", "con", "sab", "hon", "int", "car"],
  monge: ["sab", "des", "for", "con", "hon", "int", "car"],
  ninja: ["des", "int", "con", "sab", "car", "for", "hon"],
  onimusha: ["for", "con", "des", "sab", "car", "int", "hon"],
  samurai: ["for", "hon", "sab", "con", "des", "car", "int"],
  shinkan: ["sab", "con", "car", "des", "hon", "int", "for"],
  shugenja: ["sab", "hon", "con", "des", "car", "int", "for"],
  "wu jen": ["int", "con", "des", "sab", "car", "hon", "for"],
  yakuza: ["des", "car", "int", "con", "sab", "for", "hon"]
};

/** The scores suggested for a class: SUGGESTED_SCORES in the order of its priorities. */
export function suggestedScores(className) {
  const order = CLASS_PRIORITIES[norm(className)] ?? GEN_KEYS;
  return Object.fromEntries(order.map((k, i) => [k, SUGGESTED_SCORES[i]]));
}

/**
 * Rolled values for the abilities in the class's order: the highest roll to the first priority.
 * @returns {Object<string, number>} ability → index of the roll
 */
export function assignRolls(values, className) {
  const order = CLASS_PRIORITIES[norm(className)] ?? GEN_KEYS;
  const byValue = values.map((v, i) => ({ v, i })).sort((a, b) => (b.v - a.v) || (a.i - b.i));
  return Object.fromEntries(order.map((k, n) => [k, byValue[n]?.i ?? null]));
}

/* -------------------------------------------- */
/*  Castes, money, age, languages               */
/* -------------------------------------------- */

/** Starting money of a 1st-level character (p. 140), in ¥o: shimin 100, +50% for nobles, −50% for nai'nin. */
export const CASTE_MONEY = { daizenshi: 150, shimin: 100, nainin: 50 };

/** The caste a character usually belongs to (p. 89-91): the default the wizard proposes. */
export function suggestedCaste({ race = "", className = "", honor = 10 } = {}) {
  const r = norm(race);
  const c = norm(className);
  if ((r === "kaijin") || (r === "nezumi")) return "nainin";
  if (["yakuza", "ninja", "wu jen", "shinkan", "onimusha"].includes(c)) return "nainin";
  if ((r === "humano") && ["samurai", "shugenja"].includes(c)) return "daizenshi";
  return honor >= 10 ? "shimin" : "nainin";
}

/**
 * What the rules say about a caste for this character (p. 89-91): nobles are born in the old samurai and shugenja
 * families; a shimin practices honesty (Honor 10+) and is never a kaijin.
 * @returns {{ok: boolean, note: string}} `note`: an i18n key
 */
export function casteFit(caste, { race = "", honor = 10 } = {}) {
  const r = norm(race);
  if ((caste !== "nainin") && (r === "kaijin")) return { ok: false, note: "IJ.Wizard.Caste.kaijin" };
  if ((caste === "shimin") && (honor < 10)) return { ok: false, note: "IJ.Wizard.Caste.honesty" };
  if (caste === "daizenshi") return { ok: true, note: "IJ.Wizard.Caste.noble" };
  return { ok: true, note: "" };
}

/** Starting age (p. 87): 15 + dice by class. */
export const AGE_DICE = {
  bushi: "1d4", "wu jen": "1d4", yakuza: "1d4",
  ninja: "1d6", onimusha: "1d6", shinkan: "1d6",
  kensei: "2d6", monge: "2d6", samurai: "2d6", shugenja: "2d6"
};

/** The languages of Tamu-ra (p. 88). Everyone speaks Ningo; nezumi and vanara also speak their own. */
export const LANGUAGES = ["Ningo", "Varukaru", "Higo", "Kigo", "Mizugo", "Rattiki", "Ryuugo", "Sarugo", "Tengo", "Yamago", "Yaminogo"];
export const RACE_LANGUAGES = { nezumi: ["Rattiki"], vanara: ["Sarugo"] };

/* -------------------------------------------- */
/*  Class picks and recommended gear            */
/* -------------------------------------------- */

/**
 * The exotic weapons the Ninja and the Monk pick with their starting feats (ids of the options of Usar Arma Exótica):
 * the ninja four of the book's list, the monk three monk weapons (p. 148) that simple weapons don't cover.
 */
export const CLASS_WEAPON_PICKS = {
  ninja: { count: 4, options: ["chicote", "corrente", "granada", "jitte", "kusarigama", "leque", "nekote", "nunchaku", "rede", "sai", "shuriken", "tonfa"] },
  monge: { count: 3, options: ["jitte", "lajatang", "leque", "naginata", "nunchaku", "sansetsukon", "sai", "shuriken", "tonfa"] }
};

/** The name of the feat those picks go to. */
export const EXOTIC_FEAT = "Usar Arma Exótica";

/**
 * The gear recommended for each class (compendium names), bought in this order while the money lasts. Sized for the
 * 100 ¥o of a shimin: a noble has more to spend, a nai'nin keeps the first pieces. Proficiency weapons the ninja and
 * the monk picked come after these (CLASS_WEAPON_PICKS).
 */
export const CLASS_KITS = {
  bushi: ["Naginata", "Armadura ashigaru", "Kit de aventureiro", "Azagaia", "Azagaia"],
  kensei: ["Armadura ashigaru", "Kit de aventureiro", "Kunai (adaga)"],
  monge: ["Bo (bordão)", "Kit de aventureiro", "Quimono"],
  ninja: ["Kunai (adaga)", "Shinobi shozoku", "Kit de ladrão", "Kit de aventureiro", "Bomba de fumaça"],
  onimusha: ["Machado de batalha", "Armadura ashigaru", "Escudo leve", "Kit de aventureiro"],
  samurai: ["Armadura ashigaru", "Kit de aventureiro", "Quimono"],
  shinkan: ["Yari (lança)", "Armadura ashigaru", "Kit de aventureiro", "Kit de medicamentos"],
  shugenja: ["Yari (lança)", "Kit de aventureiro", "Kit de medicamentos", "Quimono"],
  "wu jen": ["Bo (bordão)", "Kunai (adaga)", "Kit de aventureiro", "Pedra de Tinta", "Pincel"],
  yakuza: ["Maça", "Armadura ashigaru", "Kunai (adaga)", "Kit de aventureiro", "Kit de ladrão"]
};

/* -------------------------------------------- */
/*  Honor violations of a creation (p. 82-84)   */
/* -------------------------------------------- */

/** The fixed Honor damage of the violations that happen while building a character (optional rule, p. 84). */
export const FIXED_DAMAGE = { leve: 1, moderada: 2, severa: 3, extrema: 5 };

/** Skills whose training is a violation by itself. */
export const SKILL_VIOLATIONS = { ladinagem: "severa", enganacao: "moderada", furtividade: "moderada" };

/** Becoming trained in dishonorable items (poison, ninja weapons) is a severe violation (p. 83). */
export const WEAPON_TRAINING_VIOLATION = "severa";

/** The order of the jutsu grades. */
export const GRADE_ORDER = ["basico", "mediano", "avancado", "sublime", "lendario"];

/**
 * The violation of learning a jutsu (p. 82-84), by its descriptors and grade: enchantment or illusion is light up to
 * advanced and moderate after; darkness is moderate when basic, severe up to advanced and extreme after.
 * @returns {string|null}
 */
export function jutsuSeverity(descriptors = [], grade = "basico") {
  const high = ["sublime", "lendario"].includes(grade);
  if (descriptors.includes("trevas")) return (grade === "basico") ? "moderada" : (high ? "extrema" : "severa");
  if (descriptors.includes("encantamento") || descriptors.includes("ilusao")) return high ? "moderada" : "leve";
  return null;
}

/**
 * The violation of a first level in another class (p. 45): a class of better Honor modifier than the original one is
 * light, the same is moderate, a worse one is severe.
 */
export function multiclassSeverity(originalHonor = 0, newHonor = 0) {
  if (newHonor > originalHonor) return "leve";
  return (newHonor === originalHonor) ? "moderada" : "severa";
}

/** The Measure of Honor ignores some violations (Honra 15−: light; 9−: moderate; 5−: severe). */
export const ignoresViolation = (honor, severity) => (honorTier(honor)?.immune ?? []).includes(severity);

/**
 * Apply violations in order: each one does its fixed damage unless the Honor it finds ignores it.
 * @param {number} honor                       The Honor before them (with the race and class adjustments)
 * @param {{label: string, severity: string}[]} violations
 * @returns {{honor: number, list: {label: string, severity: string, damage: number}[], damage: number}}
 */
export function applyViolations(honor, violations = []) {
  let current = honor;
  const list = violations.map(v => {
    const damage = ignoresViolation(current, v.severity) ? 0 : (FIXED_DAMAGE[v.severity] ?? 0);
    current = Math.max(0, current - damage);
    return { ...v, damage };
  });
  return { honor: current, list, damage: honor - current };
}

/** The lowest tier that ignores a severity (for the hints). */
export const ignoreThreshold = severity => HONOR_TIERS.find(t => t.immune.includes(severity))?.min ?? null;

/* -------------------------------------------- */
/*  Money                                       */
/* -------------------------------------------- */

const COIN = { "¥o": 100, "¥p": 10, "¥": 1 };

/**
 * A price of the compendium in copper (¥): "15 ¥o", "1 ¥p", "1 ¥", "1.500 ¥o"; "—" is free. Anything else (prices per
 * km, by creature size, surcharges) is not a plain price and gives null.
 */
export function parsePrice(text) {
  const s = String(text ?? "").trim();
  if (!s || /^[—–-]$/.test(s)) return 0;
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?\s*(¥o|¥p|¥)$/i.exec(s);
  if (!m) return null;
  const value = Number(m[1].replace(/\./g, "")) + (m[2] ? Number(`0.${m[2]}`) : 0);
  return Math.round(value * (COIN[m[3].toLowerCase()] ?? 1));
}

/** Copper to coins (the fewest coins): {yo, yp, y}. */
export function splitMoney(copper) {
  const c = Math.max(0, Math.round(copper));
  return { yo: Math.floor(c / 100), yp: Math.floor((c % 100) / 10), y: c % 10 };
}

/** A sum of copper as the sheet writes it: "39 ¥o 5 ¥p". */
export function moneyLabel(copper) {
  const { yo, yp, y } = splitMoney(copper);
  const parts = [];
  if (yo) parts.push(`${yo.toLocaleString("pt-BR")} ¥o`);
  if (yp) parts.push(`${yp} ¥p`);
  if (y) parts.push(`${y} ¥`);
  return parts.join(" ") || "0 ¥o";
}

/* -------------------------------------------- */
/*  Prerequisites of feats                      */
/* -------------------------------------------- */

const ABILITY_WORDS = { for: "for", des: "des", con: "con", int: "int", sab: "sab", car: "car", hon: "hon" };
const NUMBER_WORDS = { um: 1, uma: 1, outro: 1, outra: 1, dois: 2, duas: 2, tres: 3, quatro: 4 };

/** The skill a text names ("Ofício (alquimia)" → oficio + "alquimia"). */
function skillOf(text) {
  const m = /^(.*?)\s*(?:\(([^)]*)\))?$/.exec(String(text).trim());
  const name = norm(m?.[1] ?? text);
  const key = Object.keys(SKILLS).find(k => norm(game.i18n.localize(SKILLS[k].label)) === name) ?? null;
  return key ? { key, specialty: m?.[2] ? norm(m[2]) : "" } : null;
}

/**
 * The prerequisites of a feat, parsed into checks the wizard can make. A part it doesn't understand stays as text
 * (`kind: "text"`), shown to be confirmed with the GM.
 * @param {string} text           The feat's prerequisites ("Des 13, Esquiva, bônus base de ataque +4")
 * @param {object} names          What the parts may name
 * @param {Set<string>} names.feats    Normalized feat names
 * @param {Set<string>} names.powers   Normalized names of class and race abilities
 * @param {Set<string>} names.races    Normalized race names
 * @param {Set<string>} names.classes  Normalized class names
 * @returns {object[]}
 */
export function parsePrerequisites(text, names) {
  return String(text ?? "").split(/\s*[,;]\s*/).map(s => s.trim()).filter(Boolean).map(part => parsePart(part, names));
}

function parsePart(part, names) {
  const n = norm(part);
  // Alternatives: "hanyô ou vanara", "canalizar energia ou capacidade de executar jutsus de luz"
  if (/\sou\s/.test(n)) {
    const alts = part.split(/\s+ou\s+/i).map(p => parsePart(p, names));
    return { kind: "any", text: part, alts };
  }
  let m;
  if ((m = /^(for|des|con|int|sab|car|hon)\s+(\d+)$/.exec(n))) return { kind: "ability", key: ABILITY_WORDS[m[1]], min: Number(m[2]), text: part };
  if ((m = /^bonus base de ataque (\d+)$/.exec(n))) return { kind: "bba", min: Number(m[1]), text: part };
  if ((m = /^personagem (\d+)o? nivel$/.exec(n))) return { kind: "level", min: Number(m[1]), text: part };
  if ((m = /^(.+?) (\d+)o? nivel$/.exec(n)) && names.classes.has(m[1])) return { kind: "classLevel", cls: m[1], min: Number(m[2]), text: part };
  if (names.races.has(n)) return { kind: "race", race: n, text: part };
  if ((m = /^treinado em (.+)$/i.exec(part.trim()))) {
    const skill = skillOf(m[1]);
    return skill ? { kind: "trained", ...skill, text: part } : { kind: "text", text: part };
  }
  if ((m = /^(\w+) outros? talentos? da tormenta$/.exec(n))) return { kind: "tormenta", min: NUMBER_WORDS[m[1]] ?? 1, text: part };
  if (/^saber usar /.test(n) || /escolhid[oa] \d+$/.test(n) || /^treinado na pericia escolhida$/.test(n)) return { kind: "choice", text: part };
  // "Foco em Arma com a arma escolhida", "Foco em Armadura do tipo escolhido": the feat (its choice comes later)
  const featName = n.replace(/\s+(com a arma escolhida|do tipo escolhido)$/, "");
  if (names.feats.has(featName)) return { kind: "feat", name: featName, text: part };
  // "canalizar energia 2d6": the ability, grown to that die
  if ((m = /^(.+?) (\d+)d\d+$/.exec(n)) && names.powers.has(m[1])) return { kind: "power", name: m[1], rank: Number(m[2]), text: part };
  if (names.powers.has(n)) return { kind: "power", name: n, rank: 1, text: part };
  return { kind: "text", text: part };
}

/**
 * Check parsed prerequisites against a character.
 * @param {object[]} checks   parsePrerequisites()
 * @param {object} who
 * @param {Object<string, number>} who.abilities   Totals (Honor included)
 * @param {number} who.bba
 * @param {number} who.level
 * @param {string} who.race                        Normalized
 * @param {Object<string, number>} who.classes     Normalized name → levels
 * @param {Set<string>} who.trained                Skill keys, and "key:specialty"
 * @param {Set<string>} who.feats                  Normalized feat names
 * @param {Map<string, number>} who.powers         Normalized ability name → rank
 * @param {number} who.tormenta                    Tormenta feats
 * @returns {{text: string, ok: boolean|null}[]}   ok null: can't be told here
 */
export function checkPrerequisites(checks, who) {
  return checks.map(c => ({ text: c.text, ok: checkOne(c, who) }));
}

function checkOne(c, who) {
  switch (c.kind) {
    case "ability": return (who.abilities[c.key] ?? 0) >= c.min;
    case "bba": return who.bba >= c.min;
    case "level": return who.level >= c.min;
    case "classLevel": return (who.classes[c.cls] ?? 0) >= c.min;
    case "race": return who.race === c.race;
    case "trained": return c.specialty ? who.trained.has(`${c.key}:${c.specialty}`) : (who.trained.has(c.key) || [...who.trained].some(t => t.startsWith(`${c.key}:`)));
    case "tormenta": return who.tormenta >= c.min;
    case "feat": return who.feats.has(c.name);
    case "power": return (who.powers.get(c.name) ?? 0) >= c.rank;
    case "any": {
      const results = c.alts.map(a => checkOne(a, who));
      if (results.includes(true)) return true;
      return results.includes(null) ? null : false;
    }
    default: return null;
  }
}

/** Whether a set of checked prerequisites stops a feat: any part that fails. */
export const prerequisitesFail = results => results.some(r => r.ok === false);

/* -------------------------------------------- */
/*  Jutsus learned at the 1st level             */
/* -------------------------------------------- */

/**
 * Where the jutsus of a 1st-level character come from (the class's apprentice ability, the hanyô's chakra, the feat
 * Conhecimento de Jutsus), keyed by the normalized name of the ability or feat. `count` is a number or a function of
 * the modifiers; `chakras` the chakras of the jutsus it teaches (null: any chakra the character can use); `names`
 * the words that let a jutsu of another chakra in (p. 66, 69, 72); `grade`: the grade at the 1st level.
 */
export const JUTSU_SOURCES = {
  "aprendiz celestial": { count: mods => Math.max(1, mods.sab), chakras: ["sab"], names: ["celestial", "ancestrais"] },
  "aprendiz dos espiritos": { count: mods => Math.max(1, mods.sab), chakras: ["sab"], names: ["espirito", "espiritual", "ancestrais"] },
  "aprendiz da mente": { count: () => 4, chakras: ["int"], names: ["mandala"] },
  "brincar com os sentimentos": { count: () => 1, chakras: ["car"], names: [] },
  "conhecimento de jutsus": { count: () => 2, chakras: null, names: [] }
};

/** Words in a jutsu's name a devotion lets in without the chakra (Devoto de Lin-Wu: "Lin-Wu"). */
export const DEVOTION_NAMES = { "devoto de lin wu": ["lin wu"] };

/**
 * Words in a jutsu's name that abilities let Conhecimento de Jutsus teach without the chakra (p. 49-73): the kensei's
 * strikes, the monk's katas and touches, the samurai's kiai, and the casters' own words.
 */
export const NAME_ALLOWANCES = {
  "aprendiz de golpes": ["golpe", "arma"],
  "movimento rapido": ["kata"],
  "ataque chi": ["toque"],
  "grito de kiai": ["kiai"],
  "aprendiz celestial": ["celestial", "ancestrais"],
  "aprendiz dos espiritos": ["espirito", "espiritual", "ancestrais"],
  "aprendiz da mente": ["mandala"],
  "devoto de lin wu": ["lin wu"]
};

/**
 * The grades the casters reach in their chakra (p. 66-73): the disciple, initiate, adept and master abilities open
 * the medium, advanced, sublime and legendary jutsus of Wisdom (shugenja, shinkan) or Intelligence (wu-jen).
 */
export const CASTER_GRADES = {
  "discipulo celestial": ["sab", "mediano"], "iniciado celestial": ["sab", "avancado"],
  "adepto celestial": ["sab", "sublime"], "mestre celestial": ["sab", "lendario"],
  "discipulo dos espiritos": ["sab", "mediano"], "iniciado dos espiritos": ["sab", "avancado"],
  "adepto dos espiritos": ["sab", "sublime"], "mestre dos espiritos": ["sab", "lendario"],
  "discipulo da mente": ["int", "mediano"], "iniciado da mente": ["int", "avancado"],
  "adepto da mente": ["int", "sublime"], "mestre da mente": ["int", "lendario"]
};

/**
 * The class abilities that give a feat at some levels (keys: "class|ability", normalized), and what the feat may be.
 * `deity`: a granted power of that religion; "own" is the religion of the character's devotion.
 */
export const LEVEL_FEATS = {
  "kensei|tecnica de luta": { categories: ["combate"] },
  "monge|tecnica de luta": { categories: ["combate"] },
  "samurai|tecnica de luta": { categories: ["combate"] },
  "samurai|poder concedido": { powers: "lin wu" },
  "shugenja|poder concedido": { powers: "own" },
  "shinkan|licoes espirituais": { powers: "bushintau", categories: ["jutsu"] },
  "wu jen|estudos caoticos": { categories: ["jutsu"] }
};

/** The class abilities that teach jutsus at their levels: how many, and from which level any grade instead of basic. */
export const LEVEL_JUTSUS = {
  "shinkan|conhecimento de jutsus": { count: 2, anyGradeFrom: 4 },
  "shugenja|conhecimento de jutsus": { count: 2, anyGradeFrom: 4 },
  "wu jen|conhecimento de jutsus": { count: 3, anyGradeFrom: 4 }
};

/** Feats that teach a jutsu of the chakra chosen on them, of a grade (p. 116-117), or two of any (Conhecimento de Jutsus). */
export const FEAT_JUTSUS = {
  "abrir chacra": { count: 1, grade: "basico", chosenChakra: true },
  "chacra mediano": { count: 1, grade: "mediano", chosenChakra: true },
  "chacra avancado": { count: 1, grade: "avancado", chosenChakra: true },
  "chacra sublime": { count: 1, grade: "sublime", chosenChakra: true },
  "chacra lendario": { count: 1, grade: "lendario", chosenChakra: true },
  "conhecimento de jutsus": { count: 2, grade: null }
};

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/** The first paragraph of an HTML text, as plain text. */
export function leadOf(html) {
  const first = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(String(html ?? ""))?.[1] ?? String(html ?? "");
  return first.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Plain text of an HTML text, cut at `max` characters. */
export function plainText(html, max = 0) {
  const text = String(html ?? "").replace(/<\/(p|li|h\d)>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return (max && (text.length > max)) ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export const signed = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
