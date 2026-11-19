/**
 * What the creation wizard offers, read from the system's compendia once per session: the races and the classes (whole
 * documents), the race and class abilities, the feats, the jutsus and the shop (indexes with the fields the pages
 * show). The documents of what a character receives are fetched when needed and kept.
 */
import {
  ARMOR_CATEGORIES, BBA_PROGRESSIONS, CHAKRAS, DAMAGE_TYPES, FEAT_CATEGORIES, JUTSU_GRADES, SIZES, SYSTEM_ID,
  WEAPON_CATEGORIES, WEAPON_GRIPS, WEAPON_KINDS
} from "../config.mjs";
import { norm } from "../auto/context.mjs";
import { bookText } from "../book-text.mjs";
import { leadOf, moneyLabel, parsePrerequisites, parsePrice, plainText } from "./rules.mjs";

const L = key => game.i18n.localize(key);

/** The fields each index carries. */
const INDEX_FIELDS = {
  "habilidades-raca": ["system.description", "system.originName", "system.auto", "system.levels", "system.honorMin", "system.action", "system.cost"],
  "habilidades-classe": ["system.description", "system.originName", "system.auto", "system.levels", "system.honorMin", "system.action", "system.cost"],
  talentos: ["system.category", "system.prerequisites", "system.honorMin", "system.cost", "system.deity", "system.description", "system.auto"],
  jutsus: ["system.chakra", "system.grade", "system.descriptors", "system.execution", "system.range", "system.target", "system.duration",
    "system.resistance", "system.description", "system.extraCost"],
  armas: ["system.category", "system.kind", "system.grip", "system.damage", "system.damageType", "system.critRange", "system.critMult",
    "system.range", "system.price", "system.weight", "system.dishonorable", "system.description"],
  armaduras: ["system.category", "system.bonus", "system.maxDex", "system.penalty", "system.rd", "system.price", "system.weight",
    "system.dishonorable", "system.description"],
  equipamento: ["system.price", "system.weight", "system.description", "system.kind", "system.uses", "system.quantity"]
};

/** Feats taken once per weapon, skill, armor, chakra or descriptor: a second copy needs another choice. */
const PER_CHOICE_FEATS = new Set([
  "foco em arma", "foco em arma aprimorado", "especializacao em arma", "especializacao em arma aprimorada",
  "acerto critico aprimorado", "mestre em arma", "ataque duplo", "usar arma exotica", "infinita municao",
  "foco em pericia", "pericia aprimorada", "treino em pericia", "foco em armadura", "especializacao em armadura",
  "abrir chacra", "terreno familiar", "dominar jutsu", "resistencia aberrante", "cura elemental adicional", "lideranca",
  "braco armado"
]);

/** Shop folders that don't sell plain goods (services, surcharges, materials). */
const NOT_SOLD = ["servicos", "materiais especiais", "pecas obra primas"];

/** The shop's filters, in order: weapons by category, armor by category, then the gear folders. */
export const SHOP_FILTERS = [
  { id: "weapon:simples", icon: "fa-solid fa-staff", label: "IJ.Weapon.category.simples" },
  { id: "weapon:marcial", icon: "fa-solid fa-sword", label: "IJ.Weapon.category.marcial" },
  { id: "weapon:exotica", icon: "fa-solid fa-khanda", label: "IJ.Weapon.category.exotica" },
  { id: "armor:body", icon: "fa-solid fa-shirt", label: "IJ.Wizard.Gear.filter.armor" },
  { id: "armor:escudo", icon: "fa-solid fa-shield", label: "IJ.Armor.category.escudo" },
  { id: "gear:equipamento de aventura", icon: "fa-solid fa-sack", label: "IJ.Wizard.Gear.filter.adventure" },
  { id: "gear:ferramentas e kits", icon: "fa-solid fa-toolbox", label: "IJ.Wizard.Gear.filter.tools" },
  { id: "gear:vestuario", icon: "fa-solid fa-vest", label: "IJ.Wizard.Gear.filter.clothes" },
  { id: "gear:municao", icon: "fa-solid fa-bullseye", label: "IJ.Wizard.Gear.filter.ammo" },
  { id: "gear:alimentacao e hospedagem", icon: "fa-solid fa-bowl-rice", label: "IJ.Wizard.Gear.filter.food" },
  { id: "gear:animais e montarias", icon: "fa-solid fa-horse", label: "IJ.Wizard.Gear.filter.animals" },
  { id: "gear:veiculos", icon: "fa-solid fa-cart-flatbed", label: "IJ.Wizard.Gear.filter.vehicles" }
];

const pack = name => game.packs.get(`${SYSTEM_ID}.${name}`) ?? null;

/** The text a page shows of a compendium entry: the book's own words when a local module gives them, else the summary. */
export function htmlOf(entry) {
  if (!entry) return "";
  return bookText.of({ pack: true, uuid: entry.uuid, type: entry.type, name: entry.name, flags: {} }) ?? entry.system?.description ?? "";
}

/* -------------------------------------------- */
/*  Documents                                   */
/* -------------------------------------------- */

/** Documents fetched so far (uuid → promise of the document). */
const documents = new Map();

/**
 * The compendium documents of these uuids, fetched in one query per compendium and kept for the session.
 * @param {string[]} uuids
 * @returns {Promise<Map<string, Document>>}
 */
export async function loadDocuments(uuids) {
  const wanted = [...new Set((uuids ?? []).filter(Boolean))];
  const missing = wanted.filter(u => !documents.has(u));
  const byPack = new Map();
  for (const uuid of missing) {
    const parsed = foundry.utils.parseUuid(uuid);
    const collection = parsed?.collection;
    if (!(collection instanceof foundry.documents.collections.CompendiumCollection)) {
      documents.set(uuid, fromUuid(uuid).catch(() => null));
      continue;
    }
    if (!byPack.has(collection)) byPack.set(collection, []);
    byPack.get(collection).push({ uuid, id: parsed.id });
  }
  for (const [collection, list] of byPack) {
    const query = collection.getDocuments({ _id__in: list.map(e => e.id) }).catch(err => {
      console.warn(`${SYSTEM_ID} | não foi possível ler ${collection.collection}`, err);
      return [];
    });
    for (const { uuid, id } of list) {
      documents.set(uuid, query.then(docs => docs.find(d => d.id === id) ?? null));
    }
  }
  const out = new Map();
  for (const uuid of wanted) {
    const doc = await documents.get(uuid);
    if (doc) out.set(uuid, doc);
    else documents.delete(uuid);
  }
  return out;
}

/** One compendium document (kept). */
export async function loadDocument(uuid) {
  return (await loadDocuments([uuid])).get(uuid) ?? null;
}

/* -------------------------------------------- */
/*  The catalog                                 */
/* -------------------------------------------- */

let catalog = null;

/**
 * The catalog, read once per session.
 * @returns {Promise<object>}
 */
export function loadCatalog() {
  catalog ??= buildCatalog().catch(err => {
    catalog = null;
    throw err;
  });
  return catalog;
}

/** Forget the catalog (the compendia changed). */
export function resetCatalog() {
  catalog = null;
  documents.clear();
}

async function indexOf(name) {
  const p = pack(name);
  if (!p) return [];
  const index = await p.getIndex({ fields: INDEX_FIELDS[name] ?? [] });
  return index.contents.map(e => ({ ...e, uuid: e.uuid ?? p.getUuid(e._id), folderName: p.folders.get(e.folder)?.name ?? "" }));
}

async function docsOf(name) {
  const p = pack(name);
  return p ? p.getDocuments() : [];
}

async function buildCatalog() {
  const [races, classes, raceFeatures, classFeatures, feats, jutsus, weapons, armors, gear] = await Promise.all([
    docsOf("racas"), docsOf("classes"), indexOf("habilidades-raca"), indexOf("habilidades-classe"), indexOf("talentos"),
    indexOf("jutsus"), indexOf("armas"), indexOf("armaduras"), indexOf("equipamento")
  ]);
  for (const doc of [...races, ...classes]) documents.set(doc.uuid, Promise.resolve(doc));

  // Abilities of races and classes, by uuid
  const features = new Map();
  for (const e of [...raceFeatures, ...classFeatures]) features.set(e.uuid, featureView(e));

  const raceViews = races.map(raceView(features)).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const classViews = classes.map(classView(features)).sort((a, b) => a.name.localeCompare(b.name));

  // Names the prerequisites of feats may point at
  const names = {
    feats: new Set(feats.map(f => norm(f.name))),
    powers: new Set([...features.values()].map(f => f.key)),
    races: new Set(raceViews.map(r => r.key)),
    classes: new Set(classViews.map(c => c.key))
  };
  const featViews = feats.map(e => featView(e, names)).sort((a, b) => a.name.localeCompare(b.name));
  const jutsuViews = jutsus.map(jutsuView).sort((a, b) => a.name.localeCompare(b.name));
  const wares = [...weapons.map(wareView("weapon")), ...armors.map(wareView("armor")), ...gear.map(wareView("gear"))];

  const byUuid = new Map();
  for (const list of [raceViews, classViews, featViews, jutsuViews, wares]) for (const v of list) byUuid.set(v.uuid, v);
  for (const [uuid, v] of features) byUuid.set(uuid, v);

  return {
    races: raceViews,
    classes: classViews,
    features,
    feats: featViews,
    featByName: new Map(featViews.map(f => [f.key, f])),
    jutsus: jutsuViews,
    wares,
    shop: wares.filter(w => w.sold),
    weaponNames: wares.filter(w => w.type === "weapon").map(w => w.name),
    byUuid,
    names
  };
}

/* -------------------------------------------- */
/*  Views                                       */
/* -------------------------------------------- */

/** A race or class ability. */
function featureView(e) {
  const sys = e.system ?? {};
  const levels = String(sys.levels ?? "").split(/[^0-9]+/).map(Number).filter(n => n > 0);
  return {
    uuid: e.uuid,
    name: e.name,
    img: e.img,
    type: e.type,
    key: norm(e.name),
    origin: sys.originName ?? "",
    levels,
    honorMin: sys.honorMin ?? 0,
    action: sys.action ?? "",
    cost: sys.cost ?? 0,
    auto: sys.auto ?? {},
    choice: sys.auto?.choice ?? null,
    html: htmlOf(e),
    text: plainText(htmlOf(e), 260)
  };
}

const ABBR = key => L(`IJ.AbilityAbbr.${key}`);

function raceView(features) {
  return (doc, i) => {
    const sys = doc.system;
    const mods = Object.entries(sys.abilityMods ?? {}).filter(([, v]) => v).map(([k, v]) => ({ key: k, value: v, label: `${ABBR(k)} ${v > 0 ? "+" : "−"}${Math.abs(v)}` }));
    return {
      uuid: doc.uuid,
      name: doc.name,
      img: doc.img,
      key: norm(doc.name),
      sort: doc.sort ?? i,
      kanji: sys.kanji ?? "",
      page: sys.source ?? "",
      lead: leadOf(htmlOf(doc)),
      size: sys.size,
      sizeLabel: L(SIZES[sys.size]?.label ?? "IJ.Size.medio"),
      movement: sys.movement,
      abilityMods: { ...sys.abilityMods },
      mods,
      choice: { count: sys.abilityChoice?.count ?? 0, value: sys.abilityChoice?.value ?? 0 },
      honor: sys.honor ?? 0,
      bonusSkills: sys.bonusSkills ?? 0,
      bonusFeats: sys.bonusFeats ?? 0,
      features: (sys.features ?? []).map(f => features.get(f.uuid) ?? { uuid: f.uuid, name: f.name, img: doc.img, text: "", html: "", key: norm(f.name) })
    };
  };
}

function classView(features) {
  return doc => {
    const sys = doc.system;
    return {
      uuid: doc.uuid,
      name: doc.name,
      img: doc.img,
      key: norm(doc.name),
      kanji: sys.kanji ?? "",
      page: sys.source ?? "",
      lead: leadOf(htmlOf(doc)),
      honor: sys.honor ?? 0,
      pv: { ...sys.pv },
      pm: { ...sys.pm },
      bba: sys.bba,
      // "Total (igual ao nível)" → "Total"
      bbaLabel: L(BBA_PROGRESSIONS[sys.bba]?.label ?? "").replace(/\s*\(.*\)\s*$/, ""),
      bbaLong: L(BBA_PROGRESSIONS[sys.bba]?.label ?? ""),
      skills: sys.skills ?? 0,
      classSkills: [...(sys.classSkills ?? [])],
      startingFeats: sys.startingFeats ?? "",
      startingFeatList: (sys.startingFeatList ?? []).filter(f => f.uuid).map(f => ({ ...f })),
      features: (sys.features ?? []).map(f => ({ level: f.level, name: f.name, uuid: f.uuid, view: features.get(f.uuid) ?? null })),
      table: (sys.table ?? []).map(t => ({ ...t }))
    };
  };
}

function featView(e, names) {
  const sys = e.system ?? {};
  const html = htmlOf(e);
  const choice = sys.auto?.choice ?? null;
  return {
    uuid: e.uuid,
    name: e.name,
    img: e.img,
    key: norm(e.name),
    category: sys.category,
    categoryLabel: L(FEAT_CATEGORIES[sys.category] ?? ""),
    prerequisites: sys.prerequisites ?? "",
    checks: parsePrerequisites(sys.prerequisites ?? "", names),
    honorMin: sys.honorMin ?? 0,
    cost: sys.cost ?? 0,
    deity: sys.deity ?? "",
    choice,
    // Taken more than once: the text says so, or it is a feat made for one weapon, skill or descriptor at a time
    repeatable: /mais de uma vez|v[aá]rias vezes|diversas vezes/i.test(plainText(html)) || PER_CHOICE_FEATS.has(norm(e.name)),
    perChoice: PER_CHOICE_FEATS.has(norm(e.name)),
    html,
    text: plainText(html, 220),
    search: norm(`${e.name} ${sys.prerequisites ?? ""} ${plainText(html)}`)
  };
}

function jutsuView(e) {
  const sys = e.system ?? {};
  const grade = JUTSU_GRADES[sys.grade] ?? JUTSU_GRADES.basico;
  const html = htmlOf(e);
  const descriptors = String(sys.descriptors ?? "").split(/[,;]/).map(s => norm(s)).filter(Boolean);
  return {
    uuid: e.uuid,
    name: e.name,
    img: e.img,
    key: norm(e.name),
    chakra: sys.chakra,
    chakraLabel: L(CHAKRAS[sys.chakra]?.label ?? ""),
    kanji: CHAKRAS[sys.chakra]?.kanji ?? "",
    grade: sys.grade,
    gradeLabel: L(grade.label),
    cost: grade.cost + (sys.extraCost ?? 0),
    dc: grade.dc,
    descriptors,
    descriptorsLabel: sys.descriptors ?? "",
    execution: sys.execution ?? "",
    range: sys.range ?? "",
    target: sys.target ?? "",
    duration: sys.duration ?? "",
    resistance: sys.resistance ?? "",
    html,
    text: plainText(html, 200),
    search: norm(`${e.name} ${sys.descriptors ?? ""} ${plainText(html)}`)
  };
}

function wareView(type) {
  return e => {
    const sys = e.system ?? {};
    const price = parsePrice(sys.price);
    const folder = norm(e.folderName);
    const html = htmlOf(e);
    let filter = `gear:${folder}`;
    let line = "";
    const ware = {
      uuid: e.uuid,
      name: e.name,
      img: e.img,
      type: e.type,
      kind: type,
      key: norm(e.name),
      folder: e.folderName,
      price,
      priceLabel: price === null ? (sys.price || "—") : (price ? moneyLabel(price) : L("IJ.Wizard.Gear.free")),
      weight: sys.weight ?? 0,
      dishonorable: !!sys.dishonorable,
      html,
      text: plainText(html, 180)
    };
    if (type === "weapon") {
      filter = `weapon:${sys.category}`;
      const kind = L(WEAPON_KINDS[sys.kind]?.label ?? "");
      line = [sys.damage, L(DAMAGE_TYPES[sys.damageType] ?? ""), `${sys.critRange < 20 ? `${sys.critRange}/` : ""}x${sys.critMult}`,
        kind, L(WEAPON_GRIPS[sys.grip] ?? ""), sys.range ? `${sys.range} m` : ""].filter(Boolean).join(" · ");
      ware.weapon = { category: sys.category, categoryLabel: L(WEAPON_CATEGORIES[sys.category] ?? ""), kind: sys.kind, grip: sys.grip, damage: sys.damage };
    } else if (type === "armor") {
      filter = sys.category === "escudo" ? "armor:escudo" : "armor:body";
      const dex = (sys.maxDex === null || sys.maxDex === undefined) ? "—" : `+${sys.maxDex}`;
      line = [`CA +${sys.bonus}`, `Des máx. ${dex}`, `${L("IJ.Armor.penalty")} ${sys.penalty || 0}`, L(ARMOR_CATEGORIES[sys.category] ?? "")].join(" · ");
      ware.armor = { category: sys.category, bonus: sys.bonus, maxDex: sys.maxDex, penalty: sys.penalty };
    } else {
      line = sys.weight ? `${String(sys.weight).replace(".", ",")} kg` : "";
    }
    ware.filter = filter;
    ware.line = line;
    // Sold: a plain price, a folder of goods, and not the unarmed strike (it isn't an object)
    ware.sold = (price !== null) && !NOT_SOLD.includes(folder) && (ware.key !== "ataque desarmado");
    ware.search = norm(`${e.name} ${line} ${e.folderName}`);
    return ware;
  };
}
