/**
 * The creation wizard in the system: its settings, its templates, and when it opens by itself — when one of its owners
 * opens the sheet of a blank character (no race and no class), once per session and character.
 */
import { SYSTEM_ID } from "../config.mjs";
import { CreationWizard, DIR, STEP_TEMPLATES } from "./wizard.mjs";
import { LEVEL_TEMPLATES, LevelUpWizard, canLevel, maybeOpenLevelUp } from "./levelup.mjs";
import { resetCatalog } from "./catalog.mjs";

export { CreationWizard, LevelUpWizard, canLevel };

/** Characters whose wizard already opened by itself in this session. */
const opened = new Set();

/** Call during the `init` hook. */
export function registerCreation() {
  game.settings.register(SYSTEM_ID, "creationWizard", {
    name: "IJ.Wizard.Setting.auto",
    hint: "IJ.Wizard.Setting.autoHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(SYSTEM_ID, "creationMethods", {
    name: "IJ.Wizard.Setting.methods",
    hint: "IJ.Wizard.Setting.methodsHint",
    scope: "world",
    config: true,
    type: String,
    default: "choose",
    choices: {
      choose: "IJ.Wizard.Setting.methodChoose",
      points: "IJ.Wizard.Setting.methodPoints",
      roll: "IJ.Wizard.Setting.methodRoll",
      free: "IJ.Wizard.Setting.methodFree",
      all: "IJ.Wizard.Setting.methodAll"
    }
  });
  game.settings.register(SYSTEM_ID, "creationViolations", {
    name: "IJ.Wizard.Setting.violations",
    hint: "IJ.Wizard.Setting.violationsHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(SYSTEM_ID, "creationCard", {
    name: "IJ.Wizard.Setting.card",
    hint: "IJ.Wizard.Setting.cardHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(SYSTEM_ID, "levelUpWizard", {
    name: "IJ.Level.Setting.auto",
    hint: "IJ.Level.Setting.autoHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  foundry.applications.handlebars.loadTemplates([...STEP_TEMPLATES, ...LEVEL_TEMPLATES, `${DIR}/bonus.hbs`]);
  // Experience enough for the next level: the level-up wizard opens for the player who owns the character
  Hooks.on("updateActor", (actor, changes) => maybeOpenLevelUp(actor, changes));
  // A compendium edited in the session: the catalog is read again next time
  Hooks.on("updateCompendium", () => resetCatalog());
}

/**
 * The sheet of a blank character was opened by one of its owners: the wizard opens beside it (once per session and
 * character; a client setting turns it off).
 * @param {Actor} actor
 */
export function maybeOpenWizard(actor) {
  if (!actor || opened.has(actor.id)) return;
  if (game.settings.get(SYSTEM_ID, "creationWizard") === false) return;
  if (!CreationWizard.isBlank(actor) || !CreationWizard.canCreate(actor)) return;
  opened.add(actor.id);
  setTimeout(() => CreationWizard.open(actor), 250);
}
