/**
 * Items that bring other items: a class brings its abilities as it gains levels (and its starting feats when it is
 * the first class), a race brings its racial abilities. Granted items remember who granted them
 * (flags.imperiodejade.grantedBy) and where they came from (flags.imperiodejade.sourceUuid), so they are never
 * granted twice and leave with the item that brought them.
 */
import { SYSTEM_ID } from "../config.mjs";

const flagOf = item => item.flags?.[SYSTEM_ID] ?? {};

/** Whether the actor already has the item that `uuid` points to (granted, dropped from the compendium or by name). */
function alreadyHas(actor, uuid, name, type) {
  return actor.items.some(i => (flagOf(i).sourceUuid === uuid)
    || (i._stats?.compendiumSource === uuid)
    || ((i.name === name) && (i.type === type)));
}

/**
 * Create the items of a list of {uuid, name} on the actor, flagged as granted by `source`.
 * @returns {Promise<Item[]>} The created items.
 */
async function grant(actor, source, entries) {
  const data = [];
  for (const entry of entries) {
    if (!entry.uuid) continue;
    const doc = await fromUuid(entry.uuid).catch(() => null);
    if (!doc) {
      console.warn(`${SYSTEM_ID} | ${source.name}: não achei ${entry.name} (${entry.uuid})`);
      continue;
    }
    if (alreadyHas(actor, entry.uuid, doc.name, doc.type)) continue;
    const itemData = game.items.fromCompendium(doc, { clearFolder: true, keepId: false });
    foundry.utils.setProperty(itemData, `flags.${SYSTEM_ID}.grantedBy`, source.id);
    foundry.utils.setProperty(itemData, `flags.${SYSTEM_ID}.sourceUuid`, entry.uuid);
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

/** The item left the actor: its granted items leave too. */
export async function removeGranted(source) {
  const actor = source.actor;
  if (!actor) return;
  const ids = actor.items.filter(i => flagOf(i).grantedBy === source.id).map(i => i.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids, { ijGranted: true });
}
