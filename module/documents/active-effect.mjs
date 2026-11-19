import { inactiveReason, rankOf, classLevelOf, chosen, SYSTEM } from "../auto/context.mjs";
import { npcKeyOf, MERGED_KEYS } from "../auto/effects.mjs";

/** Off for its own reasons: disabled, its item's automation off, its option not chosen. */
function offByItself(effect) {
  if (effect.disabled) return true;
  const item = effect.parent instanceof Item ? effect.parent : null;
  if (!item?.actor) return false;
  const option = effect.flags?.[SYSTEM]?.option;
  if (option && !chosen(item, option)) return true;
  return !!inactiveReason(item);
}

/**
 * Active effects of Império de Jade.
 * - An item's effect is off while the item's automation is (unequipped, Honor below its minimum, armor where the
 *   ability asks for none) and, for an effect tied to an option of the item, while that option isn't chosen.
 * - Bonuses of a group ("stack") don't add up, and character fields go to a threat's own fields.
 * - Formulas in the changes see @rank (how far the ability has grown) and @classe (its class level).
 */
export class ImperioActiveEffect extends ActiveEffect {
  /**
   * A threat's stat block has its own fields: a change on a character field (an item's passive bonus, a feat dropped on
   * a threat) goes to the threat's field; what a threat doesn't have (skills) is left out.
   */
  static applyChange(targetDoc, change, options = {}) {
    // Bonuses of a group don't stack (objects of jade): each bonus only counts when it is the strongest of its group
    const stack = change?.effect?.flags?.[SYSTEM]?.stack;
    if (stack && targetDoc?.allApplicableEffects) {
      const mine = Number(change.value) || 0;
      for (const other of targetDoc.allApplicableEffects()) {
        if ((other === change.effect) || (other.flags?.[SYSTEM]?.stack !== stack) || offByItself(other)) continue;
        for (const c of other.system?.changes ?? []) {
          if (c.key !== change.key) continue;
          const v = Number(c.value) || 0;
          if ((v > mine) || ((v === mine) && (String(other.uuid) < String(change.effect.uuid)))) return {};
        }
      }
    }
    if ((targetDoc?.documentName === "Actor") && (targetDoc.type === "npc") && (typeof change?.key === "string") && change.key.startsWith("system.")
      && !targetDoc.system?.getFieldForProperty?.(change.key.slice(7))) {
      const mapped = npcKeyOf(change.key);
      if (!mapped) return {};
      // Melee and ranged (or the three saves) of one effect count once on the threat's single field
      if (MERGED_KEYS.test(change.key)) {
        const siblings = change.effect?.system?.changes ?? [];
        const first = siblings.find(c => npcKeyOf(c.key) === mapped);
        if (first && (first.key !== change.key)) return {};
      }
      change = { ...change, key: mapped };
    }
    return super.applyChange(targetDoc, change, options);
  }

  get isSuppressed() {
    if (super.isSuppressed) return true;
    const item = this.parent instanceof Item ? this.parent : null;
    if (item?.actor) {
      const option = this.flags?.[SYSTEM]?.option;
      if (option && !chosen(item, option)) return true;
      if (inactiveReason(item)) return true;
    }
    return false;
  }

  getReplacementData(baseData) {
    const item = this.parent instanceof Item ? this.parent : null;
    if (!item) return baseData;
    const data = Object.create(baseData ?? {});
    data.rank = rankOf(item);
    data.classe = classLevelOf(item);
    return data;
  }
}
