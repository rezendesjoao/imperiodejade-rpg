/**
 * Active effects of Império de Jade. An effect carried by a weapon, armor or accessory only applies while the item is
 * equipped (magic items, p. 290); effects of abilities and feats always apply.
 */
export class ImperioActiveEffect extends ActiveEffect {
  get isSuppressed() {
    const item = this.parent;
    if ((item instanceof Item) && item.system && ("equipped" in item.system) && !item.system.equipped) return true;
    return super.isSuppressed;
  }
}
