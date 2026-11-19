/**
 * Império de Jade — Foundry VTT system.
 * Entry point: configuration, data models, document classes, sheets, Handlebars helpers and chat cards.
 */
import { IJ, SYSTEM_ID } from "./config.mjs";
import { CharacterData } from "./data/character.mjs";
import { ITEM_MODELS } from "./data/items.mjs";
import { ImperioActor } from "./documents/actor.mjs";
import { ImperioItem } from "./documents/item.mjs";
import { CharacterSheet } from "./sheets/character-sheet.mjs";
import { ItemSheet } from "./sheets/item-sheet.mjs";
import { registerChatListeners, signed, applyDamage } from "./dice/rolls.mjs";

const PARTIALS = {
  "ij-shield": `systems/${SYSTEM_ID}/templates/partials/shield.hbs`,
  "ij-medallion": `systems/${SYSTEM_ID}/templates/partials/medallion.hbs`,
  "ij-item-controls": `systems/${SYSTEM_ID}/templates/partials/item-controls.hbs`
};

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | Império de Jade — inicializando`);
  CONFIG.IJ = IJ;

  // Documents and data models
  CONFIG.Actor.documentClass = ImperioActor;
  CONFIG.Item.documentClass = ImperioItem;
  CONFIG.Actor.dataModels.character = CharacterData;
  Object.assign(CONFIG.Item.dataModels, ITEM_MODELS);

  // Initiative is the Iniciativa skill (p. 228); ties go to the higher Dexterity
  CONFIG.Combat.initiative = { formula: "1d20 + @skills.iniciativa.total + (@abilities.des.mod / 100)", decimals: 2 };

  // Sheets
  const { Actors, Items } = foundry.documents.collections;
  Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  Actors.registerSheet(SYSTEM_ID, CharacterSheet, { types: ["character"], makeDefault: true, label: "IJ.Sheet.character" });
  Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
  Items.registerSheet(SYSTEM_ID, ItemSheet, { makeDefault: true, label: "IJ.Sheet.item" });

  // Handlebars
  Handlebars.registerHelper("ij-signed", n => signed(n));
  Handlebars.registerHelper("ij-eq", (a, b) => a === b);
  Handlebars.registerHelper("ij-pct", (value, max) => (max ? Math.clamp(Math.round((value / max) * 100), 0, 100) : 0));
  foundry.applications.handlebars.loadTemplates(PARTIALS);

  // Macros and other modules
  game[SYSTEM_ID] = { config: IJ, applyDamage };

  registerChatListeners();
});

Hooks.once("ready", () => {
  console.log(`${SYSTEM_ID} | pronto`);
});
