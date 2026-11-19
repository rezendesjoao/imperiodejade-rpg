/**
 * Items that bring other items: a class brings its abilities as it gains levels (and its starting feats when it is
 * the first class), a race brings its racial abilities. Granted items remember who granted them
 * (flags.imperiodejade.grantedBy) and where they came from (flags.imperiodejade.sourceUuid), so they are never
 * granted twice and leave with the item that brought them.
 */
import { SYSTEM_ID } from "../config.mjs";

const flagOf = item => item.flags?.[SYSTEM_ID] ?? {};

const normText = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Whether the actor already has the item that `uuid` points to (granted, dropped from the compendium or by name).
 * With a choice (Foco em Arma for the katana), only a copy with the same choice counts.
 */
function alreadyHas(actor, uuid, name, type, choiceText = null) {
  return actor.items.some(i => {
    const same = (flagOf(i).sourceUuid === uuid) || (i._stats?.compendiumSource === uuid) || ((i.name === name) && (i.type === type));
    if (!same) return false;
    return choiceText ? normText(i.system.choiceText) === normText(choiceText) : true;
  });
}

/**
 * Create the items of a list of {uuid, name} on the actor, flagged as granted by `source`.
 * @returns {Promise<Item[]>} The created items.
 */
async function grant(actor, source, entries) {
  const data = [];
  const pending = new Set();
  for (const entry of entries) {
    if (!entry.uuid) continue;
    // The same item twice in one batch (a class that gives "Usar Armas Simples" by two paths) comes once
    const key = `${entry.uuid}|${entry.choiceText ?? ""}`;
    if (pending.has(key)) continue;
    pending.add(key);
    const doc = await fromUuid(entry.uuid).catch(() => null);
    if (!doc) {
      console.warn(`${SYSTEM_ID} | ${source.name}: não achei ${entry.name} (${entry.uuid})`);
      continue;
    }
    // "@choice": the granted item takes the choice made on the item that grants it (the kensei's Arma eleita)
    const choiceText = entry.choiceText === "@choice" ? (source.system?.choiceText ?? "") : (entry.choiceText ?? null);
    if (entry.choiceText === "@choice" && !choiceText) continue;
    if (alreadyHas(actor, entry.uuid, doc.name, doc.type, choiceText)) continue;
    const itemData = game.items.fromCompendium(doc, { clearFolder: true, keepId: false });
    foundry.utils.setProperty(itemData, `flags.${SYSTEM_ID}.grantedBy`, source.id);
    foundry.utils.setProperty(itemData, `flags.${SYSTEM_ID}.sourceUuid`, entry.uuid);
    if (entry.option) foundry.utils.setProperty(itemData, `flags.${SYSTEM_ID}.grantedOption`, entry.option);
    // A feat granted for a chosen thing (Foco em Arma for the eleita) carries the choice along
    if (choiceText) foundry.utils.setProperty(itemData, "system.choiceText", choiceText);
    if (entry.choiceText === "@choice") foundry.utils.setProperty(itemData, `flags.${SYSTEM_ID}.copyChoice`, true);
    // A granted item can come with its choice made (Usar Arma Exótica: katana)
    if (entry.choices?.length) foundry.utils.setProperty(itemData, "system.choices", [...entry.choices]);
    data.push(itemData);
  }
  if (!data.length) return [];
  const created = await actor.createEmbeddedDocuments("Item", data, { ijGranted: true });
  ui.notifications.info(game.i18n.format("IJ.Grant.received", {
    name: actor.name, items: created.map(i => i.name).join(", ")
  }));
  return created;
}

/** A class reached `levels` (from `fromLevel`): grant the abilities of the levels in between. */
export async function grantClassFeatures(cls, { fromLevel = 0 } = {}) {
  const actor = cls.actor;
  if (!actor || actor.type !== "character") return [];
  const levels = cls.system.levels;
  const features = (cls.system.features ?? []).filter(f => (f.level > fromLevel) && (f.level <= levels));
  const entries = [...features];
  // Starting feats: only for the first class (multiclass characters don't get them, p. 45)
  if ((fromLevel === 0) && cls.system.primary) entries.push(...(cls.system.startingFeatList ?? []));
  return grant(actor, cls, entries);
}

/** A race was added: grant its racial abilities. */
export async function grantRaceFeatures(race) {
  const actor = race.actor;
  if (!actor || actor.type !== "character") return [];
  return grant(actor, race, race.system.features ?? []);
}

/**
 * Items an ability, feat or item brings (system.auto.grants), plus those of the options chosen on it
 * (system.auto.choice.options[].grants). Options no longer chosen take their grants back.
 */
export async function syncItemGrants(item) {
  const actor = item.actor;
  if (!actor || !["character", "npc"].includes(actor.type)) return [];
  // An amulet's jutsus only while it is worn
  if (["gear", "weapon", "armor"].includes(item.type) && (item.system.equipped === false)) {
    await removeGranted(item);
    return [];
  }
  const auto = item.system.auto ?? {};
  const picks = item.system.choices ?? [];
  const entries = [...(auto.grants ?? [])];
  for (const opt of auto.choice?.options ?? []) {
    if (picks.includes(opt.id)) entries.push(...(opt.grants ?? []).map(g => ({ ...g, option: opt.id })));
  }
  // Grants of options that were unchosen
  const stale = actor.items.filter(i => (flagOf(i).grantedBy === item.id) && flagOf(i).grantedOption && !picks.includes(flagOf(i).grantedOption)).map(i => i.id);
  if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale, { ijGranted: true });
  // Granted copies that follow the choice text get the new text
  const follow = actor.items.filter(i => (flagOf(i).grantedBy === item.id) && flagOf(i).copyChoice && (i.system.choiceText !== item.system.choiceText));
  if (follow.length) await actor.updateEmbeddedDocuments("Item", follow.map(i => ({ _id: i.id, "system.choiceText": item.system.choiceText })));
  return entries.length ? grant(actor, item, entries) : [];
}

/** The item left the actor: its granted items leave too. */
export async function removeGranted(source) {
  const actor = source.actor;
  if (!actor) return;
  const ids = actor.items.filter(i => flagOf(i).grantedBy === source.id).map(i => i.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids, { ijGranted: true });
}
