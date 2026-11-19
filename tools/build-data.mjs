/**
 * Compendium sources: src/data/*.json (the book's rules, summarized) -> src/packs/<pack>/*.json (Foundry documents).
 * Then `node tools/packs.mjs build` compiles src/packs into the LevelDB packs of packs/.
 *
 * Ids are stable (a hash of pack, type and name), so rebuilding keeps every link: classes point at their abilities,
 * races at their racial abilities, class starting feats at the feats, threats at their jutsus.
 *
 *   node tools/build-data.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { expandMacros } from "../module/auto/formula.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "data");
const OUT = path.join(ROOT, "src", "packs");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const SYSTEM = manifest.id;
const STATS = {
  coreVersion: "14.367", systemId: SYSTEM, systemVersion: manifest.version,
  createdTime: null, modifiedTime: null, lastModifiedBy: null, compendiumSource: null, duplicateSource: null, exportSource: null
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** A stable 16-character Foundry id from any parts. */
function makeId(...parts) {
  const hash = crypto.createHash("sha256").update(parts.join("|")).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += ALPHABET[hash[i] % ALPHABET.length];
  return id;
}

const read = file => {
  const p = path.join(DATA, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
};
const readAll = prefix => fs.readdirSync(DATA).filter(f => f.startsWith(prefix) && f.endsWith(".json")).sort().flatMap(read);
const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const source = page => (page ? `Império de Jade, p. ${page}` : "Império de Jade");
const uuidOf = (pack, id, type = "Item") => `Compendium.${SYSTEM}.${pack}.${type}.${id}`;
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = v => (v === null || v === undefined) ? "" : String(v);
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
const escape = s => str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ------------------------------------------------------------------ */
/*  Icons (Foundry's own set, searched by keyword)                    */
/* ------------------------------------------------------------------ */

const ICON_ROOT = ["C:/Users/Administrador/AppData/Local/Programs/Foundry Virtual Tabletop/resources/app/public/icons",
  process.env.FOUNDRY_ICONS].find(p => p && fs.existsSync(p));
const ICONS = [];
if (ICON_ROOT) {
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(webp|svg)$/.test(e.name)) ICONS.push(`icons/${path.relative(ICON_ROOT, full).replace(/\\/g, "/")}`);
    }
  };
  walk(ICON_ROOT);
  ICONS.sort();
}
/** Icons nobody wants on a weapon or item, even when the folder matches (brooms in staves...). */
const ICON_EXCLUDE = /broom|mop|feather-quill|toilet/;
/**
 * An icon under `folder` whose path has every substring. With a `seed` (the item's name) the pick varies from item to
 * item but stays the same on every build; without one it is the first match. `fallback` when nothing matches.
 */
function icon(folder, subs = [], fallback = null, seed = null) {
  const found = ICONS.filter(p => p.startsWith(`icons/${folder}/`) && subs.every(s => p.includes(s)) && !ICON_EXCLUDE.test(p));
  if (found.length) {
    if (!seed) return found[0];
    const h = crypto.createHash("md5").update(String(seed)).digest().readUInt32BE(0);
    return found[h % found.length];
  }
  return fallback ?? ICONS.find(p => p.startsWith(`icons/${folder}/`)) ?? "icons/svg/item-bag.svg";
}
/** Rules [regex on the name, folder, substrings], tried in order; the name varies the pick inside the folder. */
function iconByName(name, rules, fallback) {
  const n = norm(name);
  for (const [re, folder, subs] of rules) if (re.test(n)) return icon(folder, subs, null, name);
  return fallback;
}

const WEAPON_ICONS = [
  [/katana|wakizashi|tachi|nodachi|daisho/, "weapons/swords", ["katana"]],
  [/ninja to|ninjato|tanto|kunai|adaga|faca|sai\b|jitte|punhal/, "weapons/daggers", []],
  [/espada|zanbatou|cimitarra|montante|sabre|lamina/, "weapons/swords", ["sword"]],
  [/yari|lanca|naginata|bisento|tridente|alabarda|glaive|kama yari|haste/, "weapons/polearms", []],
  [/shuriken|estrela/, "weapons/thrown", ["shuriken"]],
  [/granada|bomba/, "weapons/thrown", ["bomb"]],
  [/azagaia|dardo|chakram|bumerangue/, "weapons/thrown", []],
  [/arco|yumi|hankyu|daikyu/, "weapons/bows", []],
  [/besta/, "weapons/crossbows", []],
  [/fukiya|zarabatana/, "weapons/ammunition", ["dart"]],
  [/teppo|mosquete|pistola|arma de fogo|polvora/, "weapons/guns", []],
  [/tetsubo|kanabo|clava|porrete/, "weapons/clubs", []],
  [/bo\b|bastao|jo\b|cajado/, "weapons/staves", ["staff"]],
  [/maca|mangual/, "weapons/maces", []],
  [/martelo/, "weapons/hammers", []],
  [/machado|ono\b/, "weapons/axes", []],
  [/kama|foice|kusari/, "weapons/sickles", []],
  [/funda/, "weapons/slings", []],
  [/tekko|soco|desarmado|garra|manopla|punho/, "weapons/fist", []],
  [/escudo/, "equipment/shield", []],
  [/leque|tessen/, "weapons/misc", ["fan"]],
  [/rede/, "weapons/misc", ["net"]],
  [/chicote|corrente|sansetsukon|nunchaku/, "weapons/misc", []]
];
const GEAR_ICONS = [
  [/mochila|bolsa|saco|alforje/, "containers/bags", []],
  [/corda/, "sundries/survival", ["rope"]],
  [/tocha/, "sundries/lights", ["torch"]],
  [/lanterna|lampiao|vela/, "sundries/lights", []],
  [/kit|ferramenta|instrumento|estojo/, "tools", []],
  [/quimono|roupa|traje|vestimenta|shozoku|fuku/, "equipment/chest", ["robe"]],
  [/racao|comida|refeicao|arroz/, "consumables/food", []],
  [/sake|bebida|cha\b/, "consumables/drinks", []],
  [/cavalo|cao leao|montaria|kabuto|animal|boi|mula/, "creatures/mammals", []],
  [/barco|navio|carroca|carruagem|liteira|riquixa|veiculo|junco|pipa/, "environment/settlement", []],
  [/hospedagem|estalagem|ryokan|servico|banho|mensageiro|escriba|medico/, "sundries/documents", []],
  [/aco rubi|akamono|bambu|jade|material/, "commodities/gems", []],
  [/papel|pergaminho|livro|mapa/, "sundries/scrolls", []],
  [/tenda|saco de dormir|cobertor/, "sundries/survival", []]
];
const CONSUMABLE_ICONS = [
  [/flecha/, "weapons/ammunition", ["arrow"]],
  [/virote/, "weapons/ammunition", ["bolt"]],
  [/ofuda|pergaminho/, "sundries/scrolls", []],
  [/erva|planta|folha/, "consumables/plants", []],
  [/bomba/, "weapons/thrown", ["bomb"]],
  [/racao|comida/, "consumables/food", []],
  [/balsamo|pocao|elixir|unguento|tonico|veneno/, "consumables/potions", []]
];
const MAGIC_ICONS = [
  [/amuleto|talisma|colar|medalhao|rosario|juzu/, "equipment/neck", []],
  [/anel/, "equipment/finger", []],
  [/bracadeira|bracelete|pulseira/, "equipment/wrist", []],
  [/cinturao|cinto|faixa|obi/, "equipment/waist", []],
  [/sandalia|bota|tabi|geta/, "equipment/feet", []],
  [/manto|capa|haori/, "equipment/back", []],
  [/chapeu|elmo|mascara|kabuto|tiara|faixa de cabeca|hachimaki/, "equipment/head", []],
  [/luva/, "equipment/hand", []],
  [/flauta|biwa|koto|taiko|tambor|instrumento/, "tools/instruments", []],
  [/orbe|esfera|cristal|perola|joia/, "commodities/gems", []],
  [/leque/, "weapons/misc", ["fan"]],
  [/espelho/, "sundries/misc", []],
  [/quimono|traje|vestimenta|fuku|shozoku/, "equipment/chest", ["robe"]]
];
const CREATURE_ICONS = [
  [/bisonte|boi|touro/, "creatures/mammals", ["bull"]],
  [/cao leao|leao/, "creatures/mammals", ["lion"]],
  [/kabuto|besouro/, "creatures/invertebrates", ["beetle"]],
  [/oonokami|lobo/, "creatures/mammals", ["wolf"]],
  [/rato/, "creatures/mammals", ["rat"]],
  [/salamandra/, "creatures/amphibians", []],
  [/akumashin|bariki|tsukumogami|construto/, "creatures/magical", ["construct"]],
  [/goblin/, "creatures/magical", ["goblin"]],
  [/kappa/, "creatures/amphibians", []],
  [/ogro|tita/, "creatures/magical", ["giant"]],
  [/tengu|daitengu/, "creatures/birds", ["corvid"]],
  [/dokumo|aranha/, "creatures/invertebrates", ["spider"]],
  [/kaiju insetoide|kanatur|hidotsu/, "creatures/invertebrates", []],
  [/kaijin/, "creatures/tentacles", []],
  [/kaiju|sauroide/, "creatures/reptiles", ["dragon"]],
  [/dragao/, "creatures/reptiles", ["dragon"]],
  [/elemental.*fogo|fogo/, "creatures/magical", ["fire"]],
  [/elemental.*(ar|vento)/, "creatures/magical", ["air"]],
  [/elemental.*(terra|acido)/, "creatures/magical", ["earth"]],
  [/elemental.*(agua|frio)/, "creatures/magical", ["water"]],
  [/elemental/, "creatures/magical", []],
  [/kyoukotsu|esqueleto|odokuro/, "creatures/unholy", ["skeleton"]],
  [/gaki|yuurei|fantasma/, "creatures/unholy", ["ghost"]],
  [/oni|demonio/, "creatures/unholy", ["demon"]]
];
const CREATURE_TYPE_ICONS = {
  animal: () => icon("creatures/mammals", [], "icons/svg/mystery-man.svg"),
  construto: () => icon("creatures/magical", ["construct"]),
  humanoide: () => icon("creatures/magical", ["humanoid"]),
  monstro: () => icon("creatures/reptiles", []),
  youkai: () => icon("creatures/unholy", [])
};
const CHAKRA_FOLDERS = { for: "magic/fire", des: "magic/air", con: "magic/earth", int: "magic/lightning", sab: "magic/holy", car: "magic/control" };
const FEAT_FOLDERS_ICON = {
  combate: "skills/melee", pericia: "skills/trades", destino: "magic/time", jutsu: "magic/symbols",
  aprimoramento: "magic/symbols", poder: "magic/holy", tormenta: "creatures/tentacles"
};
const CLASS_ICONS = {
  bushi: () => icon("weapons/axes", []), kensei: () => icon("weapons/swords", ["katana"]), monge: () => icon("weapons/fist", []),
  ninja: () => icon("weapons/thrown", ["shuriken"]), onimusha: () => icon("creatures/unholy", ["demon"]),
  samurai: () => icon("weapons/swords", ["katana"]), shinkan: () => icon("magic/nature", []), shugenja: () => icon("magic/holy", []),
  "wu jen": () => icon("magic/lightning", []), yakuza: () => icon("weapons/daggers", [])
};
const classIcon = name => (CLASS_ICONS[norm(name)] ?? (() => icon("sundries/books", [])))();
const RACE_ICONS = {
  humano: () => icon("environment/people", ["group"]), hanyo: () => icon("magic/control", []), henge: () => icon("creatures/mammals", ["fox"]),
  kaijin: () => icon("creatures/tentacles", []), mashin: () => icon("creatures/magical", ["construct"]), nezumi: () => icon("creatures/mammals", ["rat"]),
  ryuujin: () => icon("creatures/reptiles", ["dragon"]), vanara: () => icon("creatures/mammals", [])
};

/* ------------------------------------------------------------------ */
/*  Documents                                                         */
/* ------------------------------------------------------------------ */

const packs = Object.fromEntries(manifest.packs.map(p => [p.name, { docs: [], folders: new Map(), type: p.type }]));

/** The folder `name` of a pack (created on first use). */
function folderId(pack, name, sort = 0) {
  if (!name) return null;
  const p = packs[pack];
  if (!p.folders.has(name)) {
    const id = makeId(pack, "folder", name);
    p.folders.set(name, {
      _id: id, name, type: p.type, sorting: "a", sort: sort || (p.folders.size + 1) * 100000, folder: null, color: null,
      description: "", flags: {}, _stats: STATS, _key: `!folders!${id}`
    });
  }
  return p.folders.get(name)._id;
}

/**
 * One active-effect change from the data: { key, value, type|mode: "add"|"override" }. Formula strings get their
 * rank()/lvl()/from() macros expanded (Foundry evaluates the rest with @rank and @classe, documents/active-effect.mjs).
 */
function changeOf(e) {
  const override = (e.type === "override") || (e.mode === "override");
  let value = e.value;
  if ((typeof value === "string") && !override) value = expandMacros(value);
  return { key: e.key, type: override ? "override" : "add", value, phase: "initial", priority: null };
}

/**
 * Active effects of an item: the old {key, type, value} list plus the automation's passive changes, and one effect per
 * option of a choice that has passive changes (off until the option is chosen on the owned item).
 */
function effectsOf(parentKey, parentId, name, img, effects = [], auto = null) {
  const base = [...(effects ?? []), ...(auto?.passive ?? [])].filter(e => e?.key?.startsWith("system."));
  const out = [];
  const make = (effName, changes, flags = {}) => {
    const id = makeId(parentId, "effect", effName);
    out.push({
      _id: id, name: effName, img, type: "base", origin: null, transfer: true, disabled: false, tint: "#ffffff",
      duration: { value: null, units: "seconds", expiry: null, expired: false }, start: null,
      system: { changes: changes.map(changeOf) },
      description: "", statuses: [], sort: 0, showIcon: 1, flags,
      _key: `!${parentKey}.effects!${parentId}.${id}`
    });
  };
  if (base.length) make(name, base);
  for (const opt of auto?.choice?.options ?? []) {
    const changes = (opt.passive ?? []).filter(e => e?.key?.startsWith("system."));
    if (changes.length) make(`${name}: ${opt.label ?? opt.id}`, changes, { [SYSTEM]: { option: opt.id } });
  }
  return out;
}

/**
 * The automation blocks live in src/auto/*.json, keyed by name ("Bushi/Resolução", "Foco em Arma", "Oni/Garra");
 * an "auto" inside the entry also works. A copy, so the build never edits the source.
 */
const AUTO = new Map();
const AUTO_DIR = path.join(ROOT, "src", "auto");
if (fs.existsSync(AUTO_DIR)) {
  for (const file of fs.readdirSync(AUTO_DIR).filter(f => f.endsWith(".json")).sort()) {
    for (const [key, block] of Object.entries(JSON.parse(fs.readFileSync(path.join(AUTO_DIR, file), "utf8")))) {
      if (key.startsWith("_")) continue;
      if (AUTO.has(norm(key))) console.warn(`automação repetida: ${key} (${file})`);
      AUTO.set(norm(key), block);
    }
  }
}
const autoUsed = new Set();
const autoOf = (e, key = e?.name) => {
  const block = AUTO.get(norm(key)) ?? e?.auto;
  if (AUTO.has(norm(key))) autoUsed.add(norm(key));
  return (block && typeof block === "object") ? structuredClone(block) : {};
};

/** An item document in a pack (or embedded in an actor when `actorId` is given). */
function itemDoc(pack, { type, name, img, system, effects = [], folder = null, sort = 0, flags = {} }, { actorId = null } = {}) {
  const id = actorId ? makeId(actorId, "item", type, name, sort) : makeId(pack, type, name);
  const key = actorId ? `!actors.items!${actorId}.${id}` : `!items!${id}`;
  const parentKey = actorId ? "actors.items" : "items";
  const effectParent = actorId ? `${actorId}.${id}` : id;
  const doc = {
    _id: id, name, type, img, system,
    effects: effectsOf(parentKey, effectParent, name, img, effects, system.auto),
    folder: actorId ? null : folder, sort, flags, ownership: { default: 0 }, _stats: STATS, _key: key
  };
  return doc;
}

/* ------------------------------------------------------------------ */
/*  Feats (first: classes and races link to them)                     */
/* ------------------------------------------------------------------ */

const FEAT_FOLDERS = {
  combate: "Talentos de Combate", pericia: "Talentos de Perícia", destino: "Talentos de Destino", jutsu: "Talentos de Jutsu",
  aprimoramento: "Talentos de Aprimoramento", poder: "Poderes Concedidos", tormenta: "Talentos da Tormenta"
};
const featIndex = new Map(); // normalized name -> uuid
const feats = readAll("feats-");
feats.forEach((f, i) => {
  const category = pick(f.category, Object.keys(FEAT_FOLDERS), "combate");
  const img = icon(FEAT_FOLDERS_ICON[category], [], null, f.name);
  const doc = itemDoc("talentos", {
    type: "feat", name: f.name, img, sort: i * 100,
    folder: folderId("talentos", FEAT_FOLDERS[category], Object.keys(FEAT_FOLDERS).indexOf(category) + 1),
    system: {
      description: str(f.description), source: source(f.page), category,
      prerequisites: str(f.prerequisites), cost: int(f.cost), honorMin: int(f.honorMin), deity: str(f.deity),
      auto: autoOf(f)
    },
    effects: f.effects
  });
  packs.talentos.docs.push(doc);
  featIndex.set(norm(f.name), uuidOf("talentos", doc._id));
});

/** The feat a starting-feat text points at ("Usar Armaduras (leves e médias)" -> the matching feats). */
function featsFor(text) {
  const n = norm(text);
  if (featIndex.has(n)) return [{ name: text, uuid: featIndex.get(n) }];
  // "Usar Armaduras (leves, médias e pesadas)" / "Usar Armas (simples e marciais)": one feat per kind
  const m = /^(usar armaduras|usar armas|usar escudos)\s+(.*)$/.exec(n);
  if (m) {
    const kinds = m[2].split(/\s+(?:e\s+)?/).filter(k => k && k !== "e");
    const found = [];
    for (const k of kinds) {
      for (const [fname, uuid] of featIndex) {
        if (fname.startsWith(m[1]) && fname.includes(k.slice(0, 5))) found.push({ name: fname, uuid });
      }
    }
    if (found.length) return found;
  }
  // Fall back to a feat whose name starts the text ("Fortitude Maior" in "Fortitude Maior"), singular or plural
  // ("Usar Armas Exóticas (escolha quatro...)" -> "Usar Arma Exótica")
  const stem = s => s.split(" ").map(w => w.replace(/s$/, "")).join(" ");
  for (const [fname, uuid] of featIndex) if (n.startsWith(fname) || stem(n).startsWith(stem(fname))) return [{ name: text, uuid }];
  return [{ name: text, uuid: "" }];
}

/* ------------------------------------------------------------------ */
/*  Races and racial abilities                                        */
/* ------------------------------------------------------------------ */

const ABBR = { for: "For", des: "Des", con: "Con", int: "Int", sab: "Sab", car: "Car" };
const signed = n => (n < 0 ? `–${Math.abs(n)}` : `+${n}`);
read("racas.json").forEach((r, i) => {
  const raceImg = (RACE_ICONS[norm(r.name)] ?? (() => icon("environment/people", [])))();
  const folder = folderId("habilidades-raca", r.name, i + 1);
  const features = [];
  for (const [j, f] of (r.features ?? []).entries()) {
    const doc = itemDoc("habilidades-raca", {
      type: "power", name: f.name, img: raceImg, folder, sort: j * 100,
      system: {
        description: f.description, source: source(r.page), origin: "raca", originName: r.name, level: 0, cost: 0,
        honorMin: 0, action: "", levels: "", noArmor: false, choice: false, auto: autoOf(f, `${r.name}/${f.name}`)
      },
      effects: f.effects
    });
    // Same ability name in two races (Faro, Visão no Escuro): the id already differs by folder? Make it unique by race
    doc._id = makeId("habilidades-raca", r.name, f.name);
    doc._key = `!items!${doc._id}`;
    doc.effects = effectsOf("items", doc._id, f.name, raceImg, f.effects, doc.system.auto);
    packs["habilidades-raca"].docs.push(doc);
    features.push({ name: f.name, uuid: uuidOf("habilidades-raca", doc._id) });
    for (const feat of f.grantFeats ?? []) features.push(...featsFor(feat).filter(x => x.uuid));
  }
  const mods = Object.fromEntries(Object.keys(ABBR).map(k => [k, int(r.abilityMods?.[k])]));
  const adjust = [
    ...Object.entries(mods).filter(([, v]) => v).map(([k, v]) => `${signed(v)} ${ABBR[k]}`),
    ...(r.abilityChoice?.count ? [`+${r.abilityChoice.value} em ${r.abilityChoice.count} habilidades à escolha`] : []),
    ...(r.honor ? [`Honra ${signed(r.honor)}`] : [])
  ].join(", ");
  const description = `${r.summary}<p><strong>Ajustes:</strong> ${adjust}.</p>`
    + `<p><strong>Tamanho:</strong> ${r.size === "pequeno" ? "Pequeno" : "Médio"} · <strong>Deslocamento:</strong> ${r.movement}m</p>`
    + `<p><strong>Habilidades de raça:</strong> ${(r.features ?? []).map(f => escape(f.name)).join(", ")}.</p>`;
  packs.racas.docs.push(itemDoc("racas", {
    type: "race", name: r.name, img: raceImg, sort: i * 100,
    system: {
      description, source: source(r.page), size: r.size, movement: int(r.movement, 9), abilityMods: mods,
      abilityChoice: { count: int(r.abilityChoice?.count), value: int(r.abilityChoice?.value) }, chosen: [],
      honor: int(r.honor), bonusSkills: int(r.bonusSkills), bonusFeats: int(r.bonusFeats), kanji: str(r.kanji), features
    }
  }));
});

/* ------------------------------------------------------------------ */
/*  Classes and class abilities                                       */
/* ------------------------------------------------------------------ */

const SKILL_KEYS = ["acrobacia", "adestrarAnimais", "atletismo", "atuacao", "cavalgar", "conhecimento", "cura", "diplomacia",
  "enganacao", "furtividade", "identificarMagia", "iniciativa", "intimidacao", "intuicao", "ladinagem", "obterInformacao",
  "oficio", "percepcao", "sobrevivencia"];
const ACTIONS = { padrao: "padrão", "padrão": "padrão", movimento: "movimento", completa: "completa", livre: "livre", "reação": "reação", reacao: "reação" };
readAll("classes-").forEach((c, i) => {
  const img = classIcon(c.name);
  const folder = folderId("habilidades-classe", c.name, i + 1);
  const features = [];
  for (const [j, f] of (c.features ?? []).entries()) {
    const levels = (f.levels ?? []).map(Number).filter(n => n >= 1 && n <= 20).sort((a, b) => a - b);
    const first = levels[0] ?? 1;
    const doc = itemDoc("habilidades-classe", {
      type: "power", name: f.name, img, folder, sort: (first * 1000) + j,
      system: {
        description: str(f.description), source: source(f.page ?? c.page), origin: "classe", originName: c.name,
        level: first, cost: int(f.cost), honorMin: int(f.honorMin), action: ACTIONS[norm(f.action)] ?? str(f.action),
        levels: levels.join(", "), noArmor: !!f.noArmor, choice: !!f.choice, auto: autoOf(f, `${c.name}/${f.name}`)
      },
      effects: f.effects
    });
    doc._id = makeId("habilidades-classe", c.name, f.name);
    doc._key = `!items!${doc._id}`;
    doc.effects = effectsOf("items", doc._id, f.name, img, f.effects, doc.system.auto);
    packs["habilidades-classe"].docs.push(doc);
    features.push({ level: first, name: f.name, uuid: uuidOf("habilidades-classe", doc._id) });
  }
  const startingFeatList = (c.startingFeatList ?? []).flatMap(featsFor);
  const table = (c.table ?? []).map(t => ({ level: int(t.level, 1), bba: int(t.bba), features: str(t.features) }));
  const tableHtml = table.length ? `<table class="ij-class-table"><thead><tr><th>Nível</th><th>BBA</th><th>Habilidades de classe</th></tr></thead><tbody>${
    table.map(t => `<tr><td>${t.level}º</td><td>+${t.bba}</td><td>${escape(t.features)}</td></tr>`).join("")}</tbody></table>` : "";
  const bbaLabel = { full: "total (igual ao nível)", threeQuarters: "médio (3/4 do nível)", half: "baixo (metade do nível)" }[c.bba] ?? c.bba;
  const description = `${str(c.summary)}`
    + `<p><strong>Modificador de Honra:</strong> ${signed(int(c.honor))} · <strong>PV:</strong> ${c.pv?.initial} + Con no 1º nível, ${c.pv?.perLevel} + Con por nível · <strong>PM:</strong> ${c.pm?.initial} no 1º nível, ${c.pm?.perLevel} por nível · <strong>BBA:</strong> ${bbaLabel}</p>`
    + `<p><strong>Perícias treinadas:</strong> ${c.skills} + mod. de Inteligência · <strong>Talentos iniciais:</strong> ${escape(c.startingFeats)}</p>`
    + tableHtml + str(c.notes);
  packs.classes.docs.push(itemDoc("classes", {
    type: "class", name: c.name, img, sort: i * 100,
    system: {
      description, source: source(c.page), levels: 1, primary: false,
      pv: { initial: int(c.pv?.initial), perLevel: int(c.pv?.perLevel) },
      pm: { initial: int(c.pm?.initial), perLevel: int(c.pm?.perLevel) },
      bba: pick(c.bba, ["full", "threeQuarters", "half"], "full"),
      skills: int(c.skills), classSkills: (c.classSkills ?? []).filter(k => SKILL_KEYS.includes(k)),
      honor: int(c.honor), startingFeats: str(c.startingFeats), kanji: str(c.kanji),
      startingFeatList, features, table
    }
  }));
});

/* ------------------------------------------------------------------ */
/*  Jutsus                                                            */
/* ------------------------------------------------------------------ */

const GRADES = { basico: "Jutsus Básicos", mediano: "Jutsus Medianos", avancado: "Jutsus Avançados", sublime: "Jutsus Sublimes", lendario: "Jutsus Lendários" };
const CHAKRA_KEYS = ["for", "des", "con", "int", "sab", "car"];
const jutsuIndex = new Map();
readAll("jutsus-").forEach((j, i) => {
  const grade = pick(j.grade, Object.keys(GRADES), "basico");
  const chakra = pick(j.chakra, CHAKRA_KEYS, "int");
  const img = icon(CHAKRA_FOLDERS[chakra], [], null, j.name);
  const enh = (j.enhancements ?? []).map(e => `<li><strong>+${int(e.cost)} PM:</strong> ${escape(e.text)}</li>`).join("");
  const others = (j.chakras ?? []).filter(k => k !== chakra && CHAKRA_KEYS.includes(k));
  const descriptors = [str(j.descriptors), others.length ? `também ${others.map(k => ABBR[k]).join(", ")}` : ""].filter(Boolean).join("; ");
  const dmg = j.damage && j.damage.formula ? {
    formula: str(j.damage.formula).replace(/\s+/g, " ").trim(), type: str(j.damage.type), healing: !!j.damage.healing,
    scaleDice: str(j.damage.scaleDice), scaleCost: int(j.damage.scaleCost)
  } : { formula: "", type: "", healing: false, scaleDice: "", scaleCost: 0 };
  const doc = itemDoc("jutsus", {
    type: "jutsu", name: j.name, img, sort: i * 100,
    folder: folderId("jutsus", GRADES[grade], Object.keys(GRADES).indexOf(grade) + 1),
    system: {
      description: str(j.description), source: source(j.page), chakra, grade, descriptors,
      execution: str(j.execution), range: str(j.range), target: str(j.target), duration: str(j.duration),
      resistance: str(j.resistance), save: pick(j.save, ["", "fort", "ref", "von"], ""),
      attack: pick(j.attack, ["", "corpo", "toque", "distancia", "toqueDistancia"], ""),
      damage: dmg, extraCost: 0, enhancements: enh ? `<ul>${enh}</ul>` : "",
      auto: autoOf(j)
    }
  });
  packs.jutsus.docs.push(doc);
  jutsuIndex.set(norm(j.name), doc);
});

/* ------------------------------------------------------------------ */
/*  Equipment and magic items                                         */
/* ------------------------------------------------------------------ */

const DICE = /^\d+d\d+([+-]\d+)?$/i;
const DAMAGE_TYPES = ["C", "P", "E", "CP", "PE"];
function weaponSystem(w) {
  const damage = str(w.damage).replace(/\s+/g, "");
  return {
    description: str(w.description), source: source(w.page), quantity: 1, weight: num(w.weight), price: str(w.price),
    category: pick(w.category, ["simples", "marcial", "exotica"], "simples"),
    kind: pick(w.kind, ["corpo", "arremesso", "disparo"], "corpo"),
    grip: pick(w.grip, ["leve", "umaMao", "duasMaos"], "umaMao"),
    damage: DICE.test(damage) ? damage : "0", damageType: pick(w.damageType, DAMAGE_TYPES, "E"),
    critRange: Math.min(20, Math.max(2, int(w.critRange, 20))), critMult: Math.min(6, Math.max(2, int(w.critMult, 2))),
    range: int(w.range), attackBonus: int(w.attackBonus), damageBonus: int(w.damageBonus),
    proficient: true, equipped: true, dishonorable: !!w.dishonorable
  };
}
function armorSystem(a) {
  return {
    description: str(a.description), source: source(a.page), quantity: 1, weight: num(a.weight), price: str(a.price),
    category: pick(a.category, ["leve", "media", "pesada", "escudo"], "leve"), bonus: int(a.bonus),
    maxDex: (a.maxDex === null || a.maxDex === undefined || a.maxDex === "") ? null : int(a.maxDex),
    penalty: Math.min(0, int(a.penalty)), rd: Math.max(0, int(a.rd)), equipped: false, dishonorable: !!a.dishonorable
  };
}
function gearSystem(g, magic = false) {
  return {
    description: str(g.description), source: source(g.page), quantity: 1, weight: num(g.weight), price: str(g.price),
    equipped: false, slot: str(g.slot), magic
  };
}
function consumableSystem(c) {
  const uses = Math.max(0, int(c.uses));
  return {
    description: str(c.description), source: source(c.page), quantity: 1, weight: num(c.weight), price: str(c.price),
    kind: pick(c.kind, ["ofuda", "pocao", "erva", "municao", "outro"], "outro"), uses: { value: uses, max: uses }
  };
}

function addPhysical(pack, e, i, magic = false) {
  const type = pick(e.type, ["weapon", "armor", "gear", "consumable"], "gear");
  let name = e.name;
  let img;
  let system;
  if (type === "weapon") {
    // The shields also appear as weapons (shield bash): a distinct name keeps both
    if (/^escudo/i.test(name) && !magic) name = `${name} (ataque)`;
    system = weaponSystem(e);
    img = iconByName(name, WEAPON_ICONS, icon("weapons/swords", [], null, name));
  } else if (type === "armor") {
    system = armorSystem(e);
    img = system.category === "escudo" ? icon("equipment/shield", [], null, name)
      : system.category === "leve" ? icon("equipment/chest", ["leather"], null, name)
        : system.category === "media" ? icon("equipment/chest", ["banded"], null, name) : icon("equipment/chest", ["steel"], null, name);
  } else if (type === "consumable") {
    system = consumableSystem(e);
    img = iconByName(name, CONSUMABLE_ICONS, icon("consumables/potions", [], null, name));
  } else {
    system = gearSystem(e, magic);
    img = magic ? iconByName(name, MAGIC_ICONS, /encantamento|melhoria/i.test(e.group ?? "") ? icon("magic/symbols", ["rune"], null, name)
      : /artefato/i.test(e.group ?? "") ? icon("commodities/treasure", [], icon("sundries/misc", [], null, name), name)
        : /amuleto/i.test(e.group ?? "") ? icon("equipment/neck", [], null, name) : icon("sundries/misc", [], null, name))
      : iconByName(name, GEAR_ICONS, icon("containers/bags", [], null, name));
  }
  system.auto = autoOf(e);
  packs[pack].docs.push(itemDoc(pack, {
    type, name, img, sort: i * 100, folder: folderId(pack, e.group || null), system, effects: e.effects
  }));
}

const equipment = read("equipment.json");
equipment.forEach((e, i) => {
  const pack = e.type === "weapon" ? "armas" : e.type === "armor" ? "armaduras" : "equipamento";
  addPhysical(pack, e, i);
});
[...read("magic-a.json"), ...read("magic-b.json")].forEach((e, i) => addPhysical("itens-magicos", e, i, true));

/* ------------------------------------------------------------------ */
/*  Bestiary                                                          */
/* ------------------------------------------------------------------ */

const SIZE_KEYS = ["infimo", "diminuto", "minimo", "pequeno", "medio", "grande", "enorme", "descomunal", "colossal"];
const TOKEN_SIZE = { infimo: 0.5, diminuto: 0.5, minimo: 0.5, pequeno: 1, medio: 1, grande: 2, enorme: 3, descomunal: 4, colossal: 6 };
const damageTypeOf = text => {
  const t = norm(text);
  if (/corte/.test(t) && /perfur/.test(t)) return "CP";
  if (/perfur/.test(t) && /esmag/.test(t)) return "PE";
  if (/corte/.test(t)) return "C";
  if (/perfur/.test(t)) return "P";
  return "E";
};
read("bestiary.json").forEach((m, i) => {
  const actorId = makeId("bestiario", "npc", m.name);
  const type = pick(m.creatureType, ["animal", "construto", "humanoide", "monstro", "youkai"], "monstro");
  const img = iconByName(m.name, CREATURE_ICONS, CREATURE_TYPE_ICONS[type]());
  const size = pick(m.size, SIZE_KEYS, "medio");
  const items = [];
  (m.attacks ?? []).forEach((a, j) => {
    const name = a.name ? a.name.charAt(0).toUpperCase() + a.name.slice(1) : "Ataque";
    const damage = str(a.damage).replace(/\s+/g, "");
    const notes = [a.count > 1 ? `${a.count} ataques por ação` : "", str(a.note)].filter(Boolean).join(". ");
    items.push(itemDoc("bestiario", {
      type: "weapon", name, img: iconByName(name, WEAPON_ICONS, icon("weapons/fist", [])), sort: j * 100,
      system: {
        description: notes ? `<p>${escape(notes)}</p>` : "", source: source(m.page), quantity: 1, weight: 0, price: "",
        category: "simples", kind: a.kind === "distancia" ? "disparo" : "corpo", grip: "umaMao",
        damage: DICE.test(damage) ? damage : "0", damageType: damageTypeOf(a.damageType || a.name),
        critRange: Math.min(20, Math.max(2, int(a.critRange, 20))), critMult: Math.min(6, Math.max(2, int(a.critMult, 2))),
        range: int(a.range), attackBonus: int(a.bonus), damageBonus: int(a.damageBonus),
        proficient: true, equipped: true, dishonorable: false, auto: autoOf(a, `${m.name}/${a.name ?? "Ataque"}`)
      }
    }, { actorId }));
  });
  (m.specials ?? []).forEach((s, j) => {
    items.push(itemDoc("bestiario", {
      type: "power", name: s.name, img: icon("magic/symbols", ["star"]), sort: 10000 + (j * 100),
      system: {
        description: str(s.description), source: source(m.page), origin: "outra", originName: m.name, level: 0,
        cost: int(s.cost), honorMin: 0, action: str(s.action), levels: "", noArmor: false, choice: false, auto: autoOf(s, `${m.name}/${s.name}`)
      }
    }, { actorId }));
  });
  (m.jutsus ?? []).forEach((js, j) => {
    const known = jutsuIndex.get(norm(js.name));
    if (known) {
      items.push({
        ...itemDoc("bestiario", { type: "jutsu", name: known.name, img: known.img, sort: 20000 + (j * 100), system: structuredClone(known.system) }, { actorId })
      });
      return;
    }
    items.push(itemDoc("bestiario", {
      type: "power", name: `Jutsu: ${js.name}`, img: icon("magic/symbols", []), sort: 20000 + (j * 100),
      system: {
        description: js.note ? `<p>${escape(js.note)}</p>` : "", source: source(m.page), origin: "outra", originName: m.name,
        level: 0, cost: 0, honorMin: 0, action: "", levels: "", noArmor: false, choice: false
      }
    }, { actorId }));
  });
  const abilities = {};
  for (const k of ["for", "des", "con", "int", "sab", "car", "hon"]) {
    const v = m.abilities?.[k];
    abilities[k] = (v === null || v === undefined || v === "") ? null : int(v);
  }
  const rdValue = int(/\d+/.exec(str(m.rd))?.[0] ?? 0);
  const tokenSize = TOKEN_SIZE[size] ?? 1;
  packs.bestiario.docs.push({
    _id: actorId, name: m.name, type: "npc", img,
    system: {
      nd: str(m.nd) || "1", creatureType: type, level: int(m.level), size, sizeNote: str(m.sizeNote),
      initiative: int(m.initiative), perception: int(m.perception), senses: str(m.senses),
      ca: int(m.ca, 10), caNote: str(m.caNote),
      pv: { value: int(m.pv), max: int(m.pv), temp: 0 }, pm: { value: int(m.pm), max: int(m.pm) },
      saves: { fort: int(m.saves?.fort), ref: int(m.saves?.ref), von: int(m.saves?.von) },
      movement: str(m.movement), abilities, skills: str(m.skills), rd: str(m.rd), rdValue,
      resistances: str(m.resistances), treasure: str(m.treasure), attackText: str(m.attackText),
      description: str(m.summary), notes: "", source: source(m.page)
    },
    items,
    effects: [],
    prototypeToken: {
      name: m.name, actorLink: false, disposition: -1, displayBars: 20, displayName: 30,
      width: tokenSize, height: tokenSize, texture: { src: img },
      bar1: { attribute: "pv" }, bar2: { attribute: "pm" }
    },
    folder: folderId("bestiario", m.group || null), sort: i * 100, flags: {}, ownership: { default: 0 }, _stats: STATS,
    _key: `!actors!${actorId}`
  });
});

/* ------------------------------------------------------------------ */
/*  Write                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Grants of the automation: names -> compendium uuids               */
/* ------------------------------------------------------------------ */

const nameIndex = { feat: new Map(), jutsu: new Map(), power: new Map(), item: new Map() };
for (const [pack, p] of Object.entries(packs)) {
  for (const doc of p.docs) {
    const kind = doc.type === "feat" ? "feat" : doc.type === "jutsu" ? "jutsu" : doc.type === "power" ? "power" : ["weapon", "armor", "gear", "consumable"].includes(doc.type) ? "item" : null;
    if (kind && !nameIndex[kind].has(norm(doc.name))) nameIndex[kind].set(norm(doc.name), uuidOf(pack, doc._id));
  }
}
const unresolved = [];
function resolveGrants(list, owner) {
  for (const g of list ?? []) {
    if (g.uuid) continue;
    const order = g.type ? [g.type] : ["feat", "jutsu", "power", "item"];
    for (const kind of order) {
      const u = nameIndex[kind]?.get(norm(g.name));
      if (u) { g.uuid = u; break; }
    }
    if (!g.uuid) unresolved.push(`${owner}: ${g.name}`);
  }
}
const walkAuto = (doc) => {
  const auto = doc.system?.auto;
  if (!auto) return;
  resolveGrants(auto.grants, doc.name);
  for (const opt of auto.choice?.options ?? []) resolveGrants(opt.grants, `${doc.name}/${opt.id}`);
};
for (const p of Object.values(packs)) for (const doc of p.docs) { walkAuto(doc); for (const it of doc.items ?? []) walkAuto(it); }
const orphans = [...AUTO.keys()].filter(k => !autoUsed.has(k));
if (orphans.length) console.warn(`automação sem item nos dados (${orphans.length}): ${orphans.join(", ")}`);
if (unresolved.length) console.warn(`concessões sem item no compêndio (${unresolved.length}):\n  ${unresolved.join("\n  ")}`);

const safe = s => str(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "doc";
fs.rmSync(OUT, { recursive: true, force: true });
let total = 0;
for (const [name, p] of Object.entries(packs)) {
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  const ids = new Set();
  for (const doc of p.docs) {
    if (ids.has(doc._id)) throw new Error(`${name}: id repetido ${doc._id} (${doc.name})`);
    ids.add(doc._id);
    fs.writeFileSync(path.join(dir, `${safe(doc.name)}_${doc._id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  }
  for (const folder of p.folders.values()) {
    fs.writeFileSync(path.join(dir, `_folder_${safe(folder.name)}_${folder._id}.json`), `${JSON.stringify(folder, null, 2)}\n`);
  }
  total += p.docs.length;
  console.log(`${name.padEnd(20)} ${String(p.docs.length).padStart(4)} documentos, ${p.folders.size} pastas`);
}
console.log(`total: ${total} documentos${ICON_ROOT ? "" : " (sem ícones do Foundry para conferir)"}`);
