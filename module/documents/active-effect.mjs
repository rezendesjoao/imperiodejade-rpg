import { inactiveReason, rankOf, classLevelOf, chosen, SYSTEM } from "../auto/context.mjs";

/**
 * Active effects of Império de Jade.
 * - An item's effect is off while the item's automation is (unequipped, Honor below its minimum, armor where the
 *   ability asks for none) and, for an effect tied to an option of the item, while that option isn't chosen.
 * - Formulas in the changes see @rank (how far the ability has grown) and @classe (its class level).
 */
export class ImperioActiveEffect extends ActiveEffect {
  get isSuppressed() {
    if (super.isSuppressed) return true;
    const item = this.parent instanceof Item ? this.parent : null;
    if (!item?.actor) return false;
    const option = this.flags?.[SYSTEM]?.option;
    if (option && !chosen(item, option)) return true;
    return !!inactiveReason(item);
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
