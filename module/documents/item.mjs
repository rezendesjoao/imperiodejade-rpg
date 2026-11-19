import { ABILITIES, CHAKRAS, DAMAGE_TYPES, JUTSU_GRADES, WEAPON_KINDS, SYSTEM_ID } from "../config.mjs";
import { d20Roll, damageRoll, infoCard, signed } from "../dice/rolls.mjs";

const L = key => game.i18n.localize(key);
const { TextEditor } = foundry.applications.ux;

/** Default icons of each item type (Foundry's own icon set). */
export const ITEM_ICONS = {
  class: "icons/sundries/books/book-embossed-jewel-gold-green.webp",
  race: "icons/environment/people/group.webp",
  weapon: "icons/weapons/swords/sword-katana-purple.webp",
  armor: "icons/equipment/chest/breastplate-layered-steel.webp",
  gear: "icons/containers/bags/pack-leather-white-tan.webp",
  consumable: "icons/consumables/potions/potion-tube-corked-red.webp",
  feat: "icons/sundries/scrolls/scroll-bound-sealed-red.webp",
  power: "icons/magic/symbols/runes-star-pentagon-orange.webp",
  jutsu: "icons/magic/symbols/elements-air-earth-fire-water.webp"
};

/** The item of Império de Jade: attacks, damage, using jutsus, abilities and consumables. */
export class ImperioItem extends Item {

  /** New items get their type's icon instead of the generic bag. */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    if (!data.img || data.img === Item.DEFAULT_ICON) this.updateSource({ img: ITEM_ICONS[this.type] ?? Item.DEFAULT_ICON });
    // The first class of a character is its primary class (initial PV and PM, p. 45)
    if ((this.type === "class") && this.parent && !this.parent.items.some(i => i.type === "class")) {
      this.updateSource({ "system.primary": true });
    }
  }

  /** The description, enriched for a card. */
  async enrichedDescription() {
    return TextEditor.implementation.enrichHTML(this.system.description ?? "", {
      secrets: this.isOwner, rollData: this.actor?.getRollData() ?? {}, relativeTo: this
    });
  }

  /* -------------------------------------------- */
  /*  Weapons                                     */
  /* -------------------------------------------- */

  /** Attack roll with this weapon (p. 227), with the damage buttons on the card. */
  async rollAttack({ event } = {}) {
    if (this.type !== "weapon" || !this.actor) return null;
    const sys = this.system;
    const actor = this.actor;
    const ability = sys.attackAbility;
    const base = ability === "for" ? actor.system.attack.melee : actor.system.attack.ranged;
    const kind = WEAPON_KINDS[sys.kind];
    const crit = { action: "damage", crit: true };
    return d20Roll({
      actor, event, kind: "attack",
      title: this.name,
      subtitle: [L(kind.label), `${L("IJ.Weapon.damage")} ${sys.damageFormula}`, sys.critLabel].join(" · "),
      bonus: sys.attackTotal,
      critRange: sys.critRange,
      parts: [
        { label: L(ability === "for" ? "IJ.Attack.melee" : "IJ.Attack.ranged"), value: base },
        { label: L("IJ.Weapon.attackBonus"), value: sys.attackBonus },
        { label: L("IJ.Weapon.notProficient"), value: sys.proficient ? 0 : -4 }
      ],
      kanji: "刀",
      buttons: [
        { ijAction: "damage", label: L("IJ.Weapon.rollDamage"), icon: "fa-solid fa-burst", actor: actor.uuid, item: this.id, crit: false },
        { ijAction: "damage", label: game.i18n.format("IJ.Weapon.rollCritical", { n: sys.critMult }), icon: "fa-solid fa-skull", actor: actor.uuid, item: this.id, crit: true, critical: true }
      ],
      flags: { itemId: this.id }
    });
  }

  /** Damage roll; a critical multiplies dice and modifiers (p. 141). */
  async rollDamage({ critical = false } = {}) {
    if (this.type !== "weapon") return null;
    const sys = this.system;
    return damageRoll({
      actor: this.actor,
      title: this.name,
      subtitle: [L(DAMAGE_TYPES[sys.damageType] ?? ""), critical ? game.i18n.format("IJ.Weapon.criticalX", { n: sys.critMult }) : ""].filterJoin(" · "),
      formula: sys.damageFormula,
      multiplier: critical ? sys.critMult : 1,
      damageType: sys.damageType,
      physical: true,
      kanji: critical ? "斬" : "撃"
    });
  }

  /* -------------------------------------------- */
  /*  Use                                         */
  /* -------------------------------------------- */

  /** Use the item: attack with a weapon, execute a jutsu, activate an ability, consume, or show it. */
  async use({ event } = {}) {
    switch (this.type) {
      case "weapon": return this.rollAttack({ event });
      case "jutsu": return this.executeJutsu({ event });
      case "power":
      case "feat": return this.activate();
      case "consumable": return this.consume();
      default: return this.toChat();
    }
  }

  /** Post the item to the chat. */
  async toChat() {
    return infoCard({
      actor: this.actor, kind: "item",
      title: this.name,
      subtitle: L(CONFIG.Item.typeLabels[this.type]),
      body: await this.enrichedDescription(),
      kanji: "物"
    });
  }

  /** Activate a class/race ability or a feat that costs PM. */
  async activate() {
    const sys = this.system;
    const actor = this.actor;
    if (actor && sys.honorMin && (actor.system.abilities.hon.total < sys.honorMin)) {
      ui.notifications.warn(game.i18n.format("IJ.Power.honorTooLow", { name: this.name, n: sys.honorMin }));
      return null;
    }
    if (actor && sys.cost && !(await actor.spendPm(sys.cost))) return null;
    const tags = [];
    if (sys.cost) tags.push(`${sys.cost} PM`);
    if (sys.action) tags.push(sys.action);
    if (sys.honorMin) tags.push(game.i18n.format("IJ.Power.honorTag", { n: sys.honorMin }));
    return infoCard({
      actor, kind: "power", kanji: "能",
      title: this.name,
      subtitle: this.type === "feat" ? L(CONFIG.IJ.FEAT_CATEGORIES[sys.category]) : (sys.originName || L(CONFIG.IJ.ABILITY_SOURCES[sys.origin])),
      tags,
      body: await this.enrichedDescription()
    });
  }

  /** Use one charge (or one unit) of a consumable. */
  async consume() {
    const sys = this.system;
    if (sys.uses.max > 0) {
      if (sys.uses.value <= 0) return ui.notifications.warn(game.i18n.format("IJ.Consumable.empty", { name: this.name }));
      await this.update({ "system.uses.value": sys.uses.value - 1 });
    } else {
      if (sys.quantity <= 0) return ui.notifications.warn(game.i18n.format("IJ.Consumable.empty", { name: this.name }));
      await this.update({ "system.quantity": sys.quantity - 1 });
    }
    return infoCard({
      actor: this.actor, kind: "item", kanji: "薬",
      title: this.name,
      subtitle: L(CONFIG.IJ.CONSUMABLE_KINDS[sys.kind]),
      body: await this.enrichedDescription()
    });
  }

  /**
   * Execute a jutsu (p. 161): pays its grade cost plus any extra PM for enhancements, up to the PM limit.
   */
  async executeJutsu({ event } = {}) {
    const actor = this.actor;
    const sys = this.system;
    const grade = JUTSU_GRADES[sys.grade];
    let extra = 0;
    if (actor) {
      const limit = actor.system.attributes.pm.limit;
      const max = Math.max(0, limit - sys.cost);
      if (max > 0 && !event?.altKey) {
        const content = `<div class="ij-dialog-mod">
          <p>${game.i18n.format("IJ.Jutsu.extraHint", { cost: sys.cost, limit })}</p>
          <label>${L("IJ.Jutsu.extraPm")} <input type="number" name="extra" value="0" min="0" max="${max}" step="1" autofocus></label>
        </div>`;
        const result = await foundry.applications.api.DialogV2.wait({
          window: { title: this.name, icon: "fa-solid fa-hand-sparkles" },
          classes: ["imperiodejade", "ij-dialog"],
          content,
          rejectClose: false,
          buttons: [{
            action: "go", label: L("IJ.Jutsu.execute"), icon: "fa-solid fa-hand-sparkles", default: true,
            callback: (e, b, dialog) => Math.clamp(Number(dialog.element.querySelector("input[name=extra]")?.value) || 0, 0, max)
          }]
        });
        if (result === null || result === undefined) return null;
        extra = result;
      }
      if (!(await actor.spendPm(sys.cost + extra))) return null;
    }
    const tags = [
      `${sys.cost + extra} PM`,
      `${L("IJ.Jutsu.dc")} ${sys.dc}`,
      sys.execution, sys.range, sys.duration, sys.resistance
    ].filter(Boolean);
    const enh = sys.enhancements ? await TextEditor.implementation.enrichHTML(sys.enhancements, { relativeTo: this }) : "";
    return infoCard({
      actor, kind: "jutsu", kanji: "術",
      title: this.name,
      subtitle: `${L(CHAKRAS[sys.chakra].label)} · ${L(grade.label)}${extra ? ` · ${game.i18n.format("IJ.Jutsu.enhanced", { n: extra })}` : ""}`,
      tags,
      body: (sys.target ? `<p><strong>${L("IJ.Jutsu.target")}:</strong> ${foundry.utils.escapeHTML(sys.target)}</p>` : "")
        + await this.enrichedDescription()
        + (enh ? `<div class="ij-card-enh"><strong>${L("IJ.Jutsu.enhancements")}</strong>${enh}</div>` : "")
    });
  }
}

export { SYSTEM_ID, ABILITIES, signed };
