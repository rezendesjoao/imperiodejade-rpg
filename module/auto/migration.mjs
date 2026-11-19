/**
 * Bringing the automation to items already on the sheets: an owned copy of a compendium item (an ability granted by
 * a class, a feat dragged from the pack) keeps the data of when it was copied. Syncing replaces its automation block
 * and its compendium effects with the current ones; the player's own data (choices, uses spent, equipped, quantity,
 * text edits) stays.
 */
import { SYSTEM } from "./context.mjs";

const SETTING = "automationVersion";

/** The compendium source of an owned item, when it is one of this system's. */
function sourceUuid(item) {
  const uuid = item.flags?.[SYSTEM]?.sourceUuid ?? item._stats?.compendiumSource;
  return (typeof uuid === "string" && uuid.startsWith(`Compendium.${SYSTEM}.`)) ? uuid : null;
}

/**
 * Sync the automation of an actor's items with the compendium.
 * @returns {Promise<number>} How many items changed
 */
export async function syncActor(actor) {
  let changed = 0;
  for (const item of actor.items) {
    const uuid = sourceUuid(item);
    if (!uuid) continue;
    const src = await fromUuid(uuid).catch(() => null);
    if (!src) continue;
    let touched = false;
    const auto = src.system.auto ?? {};
    if (!foundry.utils.objectsEqual(item._source.system.auto ?? {}, auto)) {
      await item.update({ "system.auto": foundry.data.operators.ForcedReplacement.create(foundry.utils.deepClone(auto)) });
      touched = true;
    }
    const create = [];
    const update = [];
    for (const effect of src.effects) {
      const data = effect.toObject();
      const mine = item.effects.get(effect.id);
      if (!mine) create.push(data);
      else if (!foundry.utils.objectsEqual(mine.toObject().system?.changes ?? [], data.system?.changes ?? [])
        || !foundry.utils.objectsEqual(mine.flags?.[SYSTEM] ?? {}, data.flags?.[SYSTEM] ?? {})) {
        update.push({ _id: effect.id, name: data.name, system: data.system, flags: data.flags });
      }
    }
    if (create.length) await item.createEmbeddedDocuments("ActiveEffect", create, { keepId: true });
    if (update.length) await item.updateEmbeddedDocuments("ActiveEffect", update);
    if (touched || create.length || update.length) changed++;
  }
  return changed;
}

/** Register the world setting that remembers which version synced the actors. */
export function registerMigrationSetting() {
  game.settings.register(SYSTEM, SETTING, { scope: "world", config: false, type: String, default: "" });
}

/**
 * At ready (active GM): when the system version changed, sync every actor of the world (and the unlinked tokens of
 * the scenes) with the compendium automation.
 */
export async function migrateWorld({ force = false } = {}) {
  if (!game.users.activeGM?.isSelf) return;
  const version = game.system.version;
  if (!force && game.settings.get(SYSTEM, SETTING) === version) return;
  const actors = new Set(game.actors.filter(a => ["character", "npc"].includes(a.type)));
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink && token.actor) actors.add(token.actor);
  let items = 0;
  for (const actor of actors) {
    try { items += await syncActor(actor); }
    catch (err) { console.warn(`${SYSTEM} | não consegui atualizar a automação de ${actor.name}`, err); }
  }
  await game.settings.set(SYSTEM, SETTING, version);
  if (items) ui.notifications.info(game.i18n.format("IJ.Auto.migrated", { n: items, v: version }));
}
