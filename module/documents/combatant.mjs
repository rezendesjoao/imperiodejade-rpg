import { rollOptionsFor } from "../auto/context.mjs";

/**
 * Combatants of Império de Jade: the initiative of the tracker is the Iniciativa skill, with the automatic options of
 * the actor (fixed bonuses that apply, "roll two d20 and keep the better").
 */
export class ImperioCombatant extends Combatant {
  getInitiativeRoll(formula) {
    const actor = this.actor;
    if (!actor) return super.getInitiativeRoll(formula);
    const options = rollOptionsFor(actor, "initiative", { skill: "iniciativa", target: null }).filter(o => o.auto || o.locked);
    const bonus = options.reduce((t, o) => t + (o.value || 0), 0);
    const best = options.some(o => o.best);
    const base = actor.type === "npc" ? (actor.system.initiativeTotal ?? actor.system.initiative ?? 0) : (actor.system.skills?.iniciativa?.total ?? 0);
    const dex = actor.type === "npc" ? (actor.system.mods?.des ?? 0) : (actor.system.abilities?.des?.mod ?? 0);
    // Ties go to the higher Dexterity (p. 228)
    return foundry.dice.Roll.create(`${best ? "2d20kh" : "1d20"} + ${base + bonus} + ${dex / 100}`, actor.getRollData());
  }
}
