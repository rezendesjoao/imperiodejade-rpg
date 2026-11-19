/**
 * Checks the automation blocks (`auto`) of src/data/*.json against docs/automacao.md: known keys, conditions,
 * durations, situations, traits, and formulas that evaluate. Exit code 1 when something is wrong.
 *
 *   node tools/check-auto.mjs            all files
 *   node tools/check-auto.mjs feats-a    only files starting with that
 *   node tools/check-auto.mjs --stats    how many entries have automation, per file
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandMacros } from "../module/auto/formula.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "data");
const args = process.argv.slice(2);
const stats = args.includes("--stats");
const only = args.filter(a => !a.startsWith("--"));

const TOP = ["passive", "requires", "traits", "rollOptions", "activation", "reactions", "triggers", "grants", "choice", "status", "notes", "damageType", "touch", "dishonor"];
const CONDITIONS = ["abalado", "agarrado", "apavorado", "atordoado", "caido", "cego", "confuso", "desprevenido", "enjoado", "enredado",
  "exausto", "fascinado", "fatigado", "inconsciente", "incorporeo", "indefeso", "inerte", "invisivel", "lento", "ofuscado",
  "paralisado", "pasmo", "sangrando", "surdo", "surpreendido"];
const IMMUNE = ["medo", "critico", "furtivo", "doenca", "veneno", "sono", "fadiga", "enjoo", "paralisia", "atordoamento", "encantamento",
  "ilusao", "movimento", "acido", "eletricidade", "fogo", "frio", "vento", "luz", "trevas", "vacuo", "sonico", "surpresa",
  "danoHabilidade", "transmutacao", "humanoide", "envelhecimento", "nivelNegativo", "adivinhacao", ...CONDITIONS];
const ENERGIES = ["acido", "eletricidade", "fogo", "frio", "vento", "luz", "trevas", "vacuo", "sonico", "energia"];
const UNITS = ["rodada", "turno", "cena", "minuto", "hora", "dia"];
const USES = ["rodada", "cena", "dia", "sessao", "total"];
const SAVES = ["fort", "ref", "von"];
const SITUATIONS = ["hpHalf", "hp10", "hp20", "inDanger", "vsMonster", "vsYoukai", "vsAnimal", "vsConstruct", "vsHumanoid", "vsLowerHonor", "vsDishonored",
  "vsSordid", "vsInhuman", "vsHonored", "vsFlatFooted", "vsProne", "inCombat", "outOfCombat", "noArmor", "resolve"];
const FOR = ["attack", "save", "skill", "ability", "initiative", "maneuver"];
const SKILLS = ["acrobacia", "adestrarAnimais", "atletismo", "atuacao", "cavalgar", "conhecimento", "cura", "diplomacia", "enganacao",
  "furtividade", "identificarMagia", "iniciativa", "intimidacao", "intuicao", "ladinagem", "obterInformacao", "oficio", "percepcao", "sobrevivencia"];
const ABILITIES = ["for", "des", "con", "int", "sab", "car", "hon"];
const TRAITS = ["evasion", "uncannyDodge", "fortification", "immune", "resist", "vulnerable", "healFrom", "noHeal", "autoSave", "saveBest",
  "trainedSkills", "untrainedSkills", "proficiency", "exotic", "proficiencyShift", "finesse", "finesseDamage", "rangedDexDamage",
  "twoHandedStrength", "conToCa", "unarmed", "deathAtFull", "nemMorto", "reservePerScene", "reserveHonorBonus", "reserveExtra",
  "touchUsesCa", "jutsuMeleeAbility", "fastHealing", "retaliate", "costMods", "jutsuCost", "jutsuDc", "jutsuDamage", "jutsuHeal",
  "jutsuGradeDown", "jutsuEnhancements", "incorporeal", "guardAllies", "defense", "seeInvisible", "touchIncorporeal", "missChance"];
const FILTER = ["melee", "ranged", "unarmed", "light", "twoHanded", "monk", "ninja", "weapon", "chosenWeapon", "chosenWeaponOf", "weaponCategory", "skills", "maneuvers",
  "saves", "abilities", "chakra", "descriptor", "jutsu", "chosenJutsu", "jutsuExact", "itemName"];
const OPTION_KEYS = ["id", "label", "for", "filter", "value", "attack", "damage", "type", "noCrit", "precision", "ca", "critRange", "critMult",
  "ignoreRd", "cost", "pm", "when", "locked", "optional", "strict", "minRank", "minLevel", "option", "onHit", "onCrit", "note", "reroll", "best", "extraAttack", "selfEffect", "defense", "both", "autoCrit", "touch", "noMissChance"];
const ACTIVATION_KEYS = ["cost", "variable", "action", "uses", "duration", "self", "tempPv", "heal", "healTargets", "restore", "targets", "save",
  "damage", "attack", "honorViolation", "note", "options", "consume", "anywhere", "extraSaves"];
const BLOCK_KEYS = ["changes", "traits", "rollOptions", "conditions", "statuses", "key", "duration", "who", "includeSelf", "save", "damage", "pmLoss", "variants", "removeConditions", "turnStart",
  "abilityDamage", "negativeLevels", "setPv", "kill", "dispel", "aura", "reactions", "consumeOn", "absorb", "half", "negate", "onFail", "onSuccess", "type", "dc", "label"];
const REACTION_ON = ["saveFailed", "saveRolled", "dropToZero", "attacked", "honorDamage", "allyDown"];
const REACTION_EFFECTS = ["reroll", "addBonus", "negateDamage", "stayUp", "counterattack", "opposedAttack", "opposedSkill", "reduceHonor", "honorTest", "note"];
const PASSIVE_PREFIX = [/^system\.abilities\.(for|des|con|int|sab|car|hon)\.bonus$/, /^system\.skills\.\w+\.(bonus|ability|trained)$/,
  /^system\.saves\.(fort|ref|von)\.bonus$/, /^system\.attributes\.(ca\.bonus|rd|critBonus|critMult|negativeLevels|armorPenaltyMod)$/,
  /^system\.attributes\.attack\.(melee|ranged|damage)$/, /^system\.attributes\.mods\.(attack|skills|physSkills|abilityTests|saves)$/,
  /^system\.attributes\.movement\.bonus$/, /^system\.attributes\.(pv|pm)\.(bonus|limitBonus)$/, /^system\.chakras\.(for|des|con|int|sab|car)\.(open|grade)$/,
  /^system\.bonus\.(ca|saves|attack|damage)$/];

const problems = [];
let checked = 0;
const count = {};

/** Evaluate a formula with every reference at 3 (dice at their maximum). */
function formulaOk(expr) {
  if (typeof expr === "number" || typeof expr === "boolean") return true;
  if (typeof expr !== "string" || !expr.trim()) return false;
  let s = expr.replace(/\bdice\(([^()]*)\)/g, (m, a) => a.split(",")[0].trim())
    .replace(/\bdlvl\(([^()]*)\)/g, (m, a) => (a.split(",")[0].split(":")[1] ?? "0").trim());
  s = expandMacros(s).replace(/@[\w.]+/g, "3");
  s = s.replace(/\)d(\d+)/g, ")*$1").replace(/(\d+)d(\d+)/g, "($1*$2)").replace(/\bd(\d+)/g, "($1)");
  if (/[^0-9+\-*/().,\s a-z]/i.test(s)) return false;
  const words = (s.match(/[a-z]+/gi) ?? []).filter(w => !["floor", "ceil", "max", "min", "abs", "round"].includes(w));
  if (words.length) return false;
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function("Math", `with (Math) { return (${s}); }`)(Math);
    return Number.isFinite(v);
  } catch { return false; }
}

function check(where, cond, msg) {
  if (!cond) problems.push(`${where}: ${msg}`);
}
const keysIn = (where, obj, allowed, label) => {
  for (const k of Object.keys(obj ?? {})) check(where, allowed.includes(k), `${label} desconhecido "${k}"`);
};
const duration = (where, d) => {
  if (!d) return;
  check(where, UNITS.includes(d.unit), `duração com unidade "${d.unit}"`);
  if (d.value !== undefined) check(where, formulaOk(d.value), `duração com valor inválido "${d.value}"`);
};
const conditions = (where, list) => {
  for (const c of list ?? []) {
    const id = typeof c === "string" ? c : c?.id;
    check(where, CONDITIONS.includes(id), `condição "${id}"`);
    if (c?.duration) duration(where, c.duration);
  }
};
const situations = (where, when) => {
  if (!when) return;
  for (const w of String(when).split("|")) check(where, SITUATIONS.includes(w.trim()), `situação "${w}"`);
};
const changes = (where, list) => {
  for (const c of list ?? []) {
    check(where, PASSIVE_PREFIX.some(re => re.test(c?.key ?? "")), `campo "${c?.key}"`);
    const isOverride = c?.mode === "override" || c?.type === "override";
    if (!isOverride) check(where, formulaOk(c?.value), `valor "${c?.value}"`);
  }
};
const filterOk = (where, f) => {
  keysIn(where, f, FILTER, "filtro");
  for (const s of f?.skills ?? []) check(where, SKILLS.includes(s), `perícia "${s}"`);
  for (const s of f?.saves ?? []) check(where, SAVES.includes(s), `resistência "${s}"`);
};
const traitsOk = (where, t) => {
  keysIn(where, t, TRAITS, "traço");
  for (const i of t?.immune ?? []) check(where, IMMUNE.includes(i), `imunidade "${i}"`);
  for (const e of [...Object.keys(t?.resist ?? {}), ...(t?.vulnerable ?? []), ...(t?.healFrom ?? [])]) check(where, ENERGIES.includes(e), `energia "${e}"`);
  for (const [k, v] of Object.entries(t?.resist ?? {})) check(where, formulaOk(v), `resistência ${k} "${v}"`);
  for (const d of t?.defense ?? []) { check(where, formulaOk(d.value ?? 0), `defense "${d.value}"`); situations(where, d.when); }
  for (const k of ["evasion", "uncannyDodge", "fortification", "reserveHonorBonus", "fastHealing", "proficiencyShift", "guardAllies", "deathAtFull"]) {
    if (t?.[k] !== undefined) check(where, formulaOk(t[k]), `${k} "${t[k]}"`);
  }
  for (const k of ["jutsuCost", "jutsuDc", "jutsuDamage", "jutsuHeal", "costMods"]) {
    for (const r of t?.[k] ?? []) {
      if (r.value !== undefined) check(where, formulaOk(r.value), `${k}.value "${r.value}"`);
      if (r.filter) filterOk(where, r.filter);
      situations(where, r.when);
    }
  }
  for (const r of t?.retaliate ?? []) check(where, formulaOk(r.formula), `retaliate "${r.formula}"`);
  for (const e of t?.jutsuEnhancements ?? []) {
    check(where, !!e.id && !!e.label, "aprimoramento sem id/label");
    check(where, ["maximize", "dc", "dcHonor", "note"].includes(e.effect ?? "note"), `aprimoramento com effect "${e.effect}"`);
  }
};
const optionOk = (where, o) => {
  keysIn(where, o, OPTION_KEYS, "chave de opção");
  for (const f of [o.for ?? "attack"].flat()) check(where, FOR.includes(f), `for "${f}"`);
  filterOk(where, o.filter);
  situations(where, o.when);
  for (const k of ["value", "attack", "ca", "critRange", "critMult", "cost"]) if (o[k] !== undefined) check(where, formulaOk(o[k]), `${k} "${o[k]}"`);
  if (o.damage !== undefined) check(where, formulaOk(o.damage), `dano "${o.damage}"`);
  if (o.ignoreRd !== undefined && o.ignoreRd !== "all") check(where, formulaOk(o.ignoreRd), `ignoreRd "${o.ignoreRd}"`);
  if (o.onHit?.save) check(where, SAVES.includes(o.onHit.save.type), `onHit.save "${o.onHit.save.type}"`);
  conditions(where, o.onHit?.conditions);
};
const blockOk = (where, b) => {
  if (!b) return;
  keysIn(where, b, BLOCK_KEYS, "chave de bloco");
  changes(where, b.changes);
  traitsOk(where, b.traits);
  for (const o of b.rollOptions ?? []) optionOk(where, o);
  conditions(where, b.conditions);
  duration(where, b.duration);
  if (b.who) check(where, ["allies", "enemies", "any"].includes(b.who), `who "${b.who}"`);
  if (b.save) check(where, SAVES.includes(b.save.type), `save "${b.save.type}"`);
  for (const id of b.removeConditions ?? []) check(where, CONDITIONS.includes(id), `condição a remover "${id}"`);
  if (b.turnStart) {
    keysIn(where, b.turnStart, ["damage", "type", "heal", "save", "half", "negate", "endOnSave", "conditions", "abilityDamage", "ignoreRd"], "chave de turnStart");
    if (b.turnStart.damage) check(where, formulaOk(b.turnStart.damage), `turnStart.damage "${b.turnStart.damage}"`);
    if (b.turnStart.heal) check(where, formulaOk(b.turnStart.heal), `turnStart.heal "${b.turnStart.heal}"`);
    if (b.turnStart.save) check(where, SAVES.includes(b.turnStart.save.type), `turnStart.save "${b.turnStart.save.type}"`);
    conditions(where, b.turnStart.conditions);
  }
  for (const v of b.variants ?? []) { const { when, ...rest } = v; situations(where, when); blockOk(where, rest); }
};
const activationOk = (where, a, nested = false) => {
  keysIn(where, a, nested ? [...ACTIVATION_KEYS, "id", "label", "option", "minLevel", "minRank", "honorMin", "hint"] : ACTIVATION_KEYS, "chave de activation");
  if (a.cost !== undefined) check(where, formulaOk(a.cost), `custo "${a.cost}"`);
  if (a.variable) { check(where, formulaOk(a.variable.max ?? 1), `variable.max "${a.variable.max}"`); }
  if (a.uses) { check(where, USES.includes(a.uses.per), `uses.per "${a.uses.per}"`); check(where, formulaOk(a.uses.max ?? 1), `uses.max "${a.uses.max}"`); }
  duration(where, a.duration);
  blockOk(where, a.self);
  blockOk(where, a.targets);
  for (const k of ["tempPv", "heal"]) if (a[k] !== undefined) check(where, formulaOk(a[k]), `${k} "${a[k]}"`);
  if (a.restore) for (const [k, v] of Object.entries(a.restore)) check(where, formulaOk(v), `restore.${k} "${v}"`);
  if (a.save) {
    check(where, SAVES.includes(a.save.type), `save "${a.save.type}"`);
    if (a.save.dc !== undefined) check(where, formulaOk(a.save.dc), `CD "${a.save.dc}"`);
    blockOk(where, a.save.onFail);
    blockOk(where, a.save.onSuccess);
  }
  if (a.damage?.formula !== undefined) check(where, formulaOk(a.damage.formula), `dano "${a.damage.formula}"`);
  for (const p of a.damage?.extra ?? []) check(where, formulaOk(p.formula), `dano extra "${p.formula}"`);
  for (const r of a.damage?.perTarget ?? []) { situations(where, r.when); check(where, Number.isFinite(Number(r.mult)), `perTarget.mult "${r.mult}"`); }
  for (const s of a.extraSaves ?? []) {
    check(where, SAVES.includes(s.type), `extraSaves.type "${s.type}"`);
    if (s.dc !== undefined) check(where, formulaOk(s.dc), `extraSaves.dc "${s.dc}"`);
    blockOk(where, s.onFail); blockOk(where, s.onSuccess);
  }
  if (a.attack && !(a.attack.weapon && !a.attack.type)) check(where, ["corpo", "toque", "distancia", "toqueDistancia"].includes(a.attack.type), `ataque "${a.attack.type}"`);
  if (a.honorViolation) check(where, ["leve", "moderada", "severa", "extrema"].includes(a.honorViolation), `violação "${a.honorViolation}"`);
  const ids = new Set();
  for (const o of a.options ?? []) {
    check(where, !!o.id && !ids.has(o.id), `opção sem id ou repetida "${o.id}"`);
    ids.add(o.id);
    activationOk(`${where}/${o.id}`, o, true);
  }
};

function checkAuto(where, auto) {
  checked++;
  keysIn(where, auto, TOP, "chave");
  changes(where, auto.passive);
  if (auto.requires) keysIn(where, auto.requires, ["honorMin", "noArmor", "noShield", "lightArmor", "armorChosen", "armorCategory"], "requisito");
  traitsOk(where, auto.traits);
  for (const o of auto.rollOptions ?? []) optionOk(where, o);
  if (auto.activation) activationOk(where, auto.activation);
  for (const r of auto.reactions ?? []) {
    check(where, REACTION_ON.includes(r.on), `reação on "${r.on}"`);
    check(where, REACTION_EFFECTS.includes(r.effect ?? "note"), `reação effect "${r.effect}"`);
    if (r.cost !== undefined) check(where, formulaOk(r.cost), `reação custo "${r.cost}"`);
  }
  for (const t of auto.triggers ?? []) check(where, ["creatureDown"].includes(t.on), `gatilho "${t.on}"`);
  for (const g of auto.grants ?? []) check(where, !!g.name, "concessão sem nome");
  if (auto.choice) {
    const ids = new Set();
    for (const o of auto.choice.options ?? []) {
      check(where, !!o.id && !ids.has(o.id), `escolha sem id ou repetida "${o.id}"`);
      ids.add(o.id);
      keysIn(`${where}/${o.id}`, o, ["id", "label", "grants", "passive", "traits", "rollOptions", "reactions", "triggers", "minLevel", "hint"], "chave de escolha");
      changes(`${where}/${o.id}`, o.passive);
      traitsOk(`${where}/${o.id}`, o.traits);
      for (const r of o.rollOptions ?? []) optionOk(`${where}/${o.id}`, r);
      for (const g of o.grants ?? []) check(where, !!g.name, "concessão sem nome");
    }
    if (auto.choice.count !== undefined) check(where, formulaOk(auto.choice.count), `choice.count "${auto.choice.count}"`);
  }
}

// Every name of the data, in the keys the automation files use ("Bushi/Resolução", "Foco em Arma", "Oni/Garra")
const norm = x => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const known = new Map();
for (const file of fs.readdirSync(DATA).filter(f => f.endsWith(".json")).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  const list = Array.isArray(data) ? data : Object.values(data).flat();
  let total = 0;
  for (const e of list) {
    if (e.features) for (const f of e.features) { known.set(norm(`${e.name}/${f.name}`), file); total++; }
    else if (e.specials || e.attacks) {
      for (const x of [...(e.attacks ?? []), ...(e.specials ?? [])]) { known.set(norm(`${e.name}/${x.name ?? "Ataque"}`), file); total++; }
    } else { known.set(norm(e.name), file); total++; }
  }
  count[file] = { total, auto: 0 };
}
const AUTO_DIR = path.join(ROOT, "src", "auto");
const seen = new Set();
for (const file of (fs.existsSync(AUTO_DIR) ? fs.readdirSync(AUTO_DIR) : []).filter(f => f.endsWith(".json")).sort()) {
  if (only.length && !only.some(o => file.startsWith(o))) continue;
  let blocks;
  try { blocks = JSON.parse(fs.readFileSync(path.join(AUTO_DIR, file), "utf8")); }
  catch (err) { problems.push(`${file}: JSON inválido (${err.message})`); continue; }
  for (const [key, auto] of Object.entries(blocks)) {
    if (key.startsWith("_")) continue;
    const where = `${file} › ${key}`;
    const k = norm(key);
    if (seen.has(k)) problems.push(`${where}: chave repetida`);
    seen.add(k);
    const dataFile = known.get(k);
    if (!dataFile) { problems.push(`${where}: não existe nos dados (confira o nome)`); continue; }
    count[dataFile].auto++;
    if (auto && typeof auto === "object" && Object.keys(auto).length) checkAuto(where, auto);
  }
}
for (const f of Object.keys(count)) count[f] = `${count[f].auto}/${count[f].total}`;

if (stats) for (const [f, c] of Object.entries(count)) console.log(`${f.padEnd(18)} ${c}`);
if (problems.length) {
  console.log(`${problems.length} problema(s):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log(`ok: ${checked} bloco(s) de automação conferidos`);
