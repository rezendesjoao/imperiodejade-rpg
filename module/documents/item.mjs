import { ABILITIES, CHAKRAS, DAMAGE_TYPES, JUTSU_GRADES, SAVES, WEAPON_KINDS, SYSTEM_ID } from "../config.mjs";
import { infoCard, signed } from "../dice/rolls.mjs";
import { grantClassFeatures, grantRaceFeatures, removeGranted, syncItemGrants } from "./grants.mjs";
import { useItem, perform, postCard, adjustCost, availableOptions, specFor, applyTargetBlock } from "../auto/activation.mjs";
import { askActivation } from "../auto/dialog.mjs";
import { attackRoll, armorClassOf } from "../auto/attack.mjs";
import { rollDamage, isPhysical } from "../auto/damage.mjs";
import { dataFor, evaluate, resolveFormula, norm } from "../auto/context.mjs";
import { jutsuDialog, jutsuRules, gradeCost } from "../auto/jutsu.mjs";

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
    // The first class of a character is its primary class (initial PV and PM, p. 45); a later one never is
    if ((this.type === "class") && this.parent) {
      this.updateSource({ "system.primary": !this.parent.items.some(i => i.type === "class") });
    }
  }

  /** A class or race added to a character brings its abilities; any item brings what its automation grants. */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if ((userId !== game.user.id) || !this.actor) return;
    if (this.actor.type === "character") {
      if (this.type === "class") grantClassFeatures(this);
      else if (this.type === "race") {
        // One race per character: the old one (and what it granted) leaves
        const others = this.actor.items.filter(i => (i.type === "race") && (i.id !== this.id)).map(i => i.id);
        if (others.length) this.actor.deleteEmbeddedDocuments("Item", others);
        grantRaceFeatures(this);
      }
    }
    if (this.system.auto?.grants?.length || this.system.choices?.length) syncItemGrants(this);
  }

  /** Remember the class level before the change, to know which abilities the new levels bring. */
  async _preUpdate(changed, options, user) {
    if ((await super._preUpdate(changed, options, user)) === false) return false;
    if ((this.type === "class") && (foundry.utils.getProperty(changed, "system.levels") !== undefined)) {
      options.ijPreviousLevels = this.system.levels;
    }
  }

  /**
   * A class gained levels: grant the abilities of the new levels and, for the first class, +1 Honor per level
   * (persistence, p. 81). Choices changed on an ability: its grants follow.
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if ((userId !== game.user.id) || !this.actor) return;
    if ((foundry.utils.getProperty(changed, "system.choices") !== undefined) || (foundry.utils.getProperty(changed, "system.choiceText") !== undefined)
      || ((foundry.utils.getProperty(changed, "system.equipped") !== undefined) && (this.system.auto?.grants?.length || this.system.auto?.choice))) syncItemGrants(this);
    if ((this.type !== "class") || (this.actor.type !== "character")) return;
    const before = options.ijPreviousLevels;
    if ((before === undefined) || (this.system.levels <= before)) return;
    grantClassFeatures(this, { fromLevel: before });
    if (this.system.primary) {
      const gained = this.system.levels - before;
      const hon = this.actor.system.abilities.hon;
      this.actor.update({ "system.abilities.hon.value": hon.value + gained });
      infoCard({
        actor: this.actor, kind: "honor", kanji: "誉",
        title: game.i18n.format("IJ.Grant.levelUp", { name: this.name, n: this.system.levels }),
        subtitle: `${L("IJ.Ability.hon")} ${hon.total} → ${hon.total + gained}`,
        body: `<p>${game.i18n.format("IJ.Grant.persistence", { n: gained })}</p>`
      });
    }
  }

  /** An item leaving takes what it granted. */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    if ((userId !== game.user.id) || !this.actor) return;
    if (["class", "race"].includes(this.type) || this.system.auto?.grants?.length || this.system.auto?.choice) removeGranted(this);
  }

  /** The description, enriched for a card. */
  async enrichedDescription() {
    return TextEditor.implementation.enrichHTML(this.system.description ?? "", {
      secrets: this.isOwner, rollData: this.actor?.getRollData() ?? {}, relativeTo: this
    });
  }

  /** Whether using the item does something automatic. */
  get hasActivation() {
    return !!this.system.auto?.activation;
  }

  /* -------------------------------------------- */
  /*  Weapons                                     */
  /* -------------------------------------------- */

  /**
   * Attack roll with this weapon (p. 227): the attacker's options, each target's CA, the damage buttons.
   * @param {object} [options]
   * @param {Event} [options.event]
   * @param {Actor} [options.target]   Attack this one (a reaction)
   * @param {string} [options.reaction]
   */
  async rollAttack({ event, target = null, reaction = null, extraOptions = [] } = {}) {
    if (this.type !== "weapon" || !this.actor) return null;
    const sys = this.system;
    const actor = this.actor;
    const ability = sys.attackAbility;
    const kind = WEAPON_KINDS[sys.kind];
    const ranged = sys.kind !== "corpo";
    // A character adds BBA and ability; a threat's attack bonus is already the total from its stat block
    const parts = (actor.type === "character") ? [
      { label: L(ability === "for" ? "IJ.Attack.melee" : "IJ.Attack.ranged"), value: sys.attackTotal - sys.attackBonus + (sys.isProficient ? 0 : 4) },
      { label: L("IJ.Weapon.attackBonus"), value: sys.attackBonus },
      { label: L("IJ.Weapon.notProficient"), value: sys.isProficient ? 0 : -4 }
    ] : [{ label: L("IJ.Weapon.attack"), value: sys.attackTotal }];
    // A creature's natural weapon can deal energy (auto.damageType) and be a touch attack (auto.touch)
    const damageType = sys.auto?.damageType || sys.damageType;
    return attackRoll({
      actor, weapon: this, ranged, event, target, reaction, extraOptions,
      touch: !!sys.auto?.touch,
      unarmed: norm(this.name).includes("desarmado"),
      title: this.name,
      subtitle: [L(kind.label), `${L("IJ.Weapon.damage")} ${sys.damageFormula}`, sys.critLabel].join(" · "),
      bonus: sys.attackTotal,
      parts,
      critRange: sys.threat,
      critMult: sys.critMult,
      damage: { formula: sys.damageFormula, type: damageType },
      kanji: "刀"
    });
  }

  /** Damage roll without an attack card (macros); a critical multiplies dice and modifiers (p. 141). */
  async rollDamage({ critical = false } = {}) {
    if (this.type !== "weapon") return null;
    const sys = this.system;
    return rollDamage({
      actor: this.actor,
      title: this.name,
      subtitle: [L(DAMAGE_TYPES[sys.damageType] ?? ""), critical ? game.i18n.format("IJ.Weapon.criticalX", { n: sys.critMult }) : ""].filterJoin(" · "),
      parts: [{ formula: sys.damageFormula, type: sys.damageType, physical: true }],
      critical,
      mult: sys.critMult + (this.actor?.system?.attributes?.critMult ?? 0),
      kanji: critical ? "斬" : "撃",
      link: { melee: sys.kind === "corpo" }
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
      case "feat": return this.activate({ event });
      case "consumable": return this.consume({ event });
      default: return this.hasActivation ? useItem(this, { event }) : this.toChat();
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

  /** Activate a class/race ability or a feat: its automation, or the plain card that pays its PM. */
  async activate({ event } = {}) {
    if (this.hasActivation) return useItem(this, { event });
    const sys = this.system;
    const actor = this.actor;
    if (actor && sys.honorMin && (actor.type === "character") && (actor.system.abilities.hon.total < sys.honorMin)) {
      ui.notifications.warn(game.i18n.format("IJ.Power.honorTooLow", { name: this.name, n: sys.honorMin }));
      return null;
    }
    const cost = adjustCost(actor, sys.cost ?? 0, { kind: "power", ctx: { item: this } });
    if (actor && cost && !(await actor.spendPm(cost))) return null;
    return postCard(this, {}, dataFor(this), { cost });
  }

  /** Use one charge (or one unit) of a consumable, with what its automation does. */
  async consume({ event } = {}) {
    const sys = this.system;
    if (sys.uses.max > 0) {
      if (sys.uses.value <= 0) return ui.notifications.warn(game.i18n.format("IJ.Consumable.empty", { name: this.name }));
    } else if (sys.quantity <= 0) return ui.notifications.warn(game.i18n.format("IJ.Consumable.empty", { name: this.name }));
    const result = this.hasActivation ? await useItem(this, { event }) : await infoCard({
      actor: this.actor, kind: "item", kanji: "薬",
      title: this.name,
      subtitle: L(CONFIG.IJ.CONSUMABLE_KINDS[sys.kind]),
      body: await this.enrichedDescription()
    });
    if (!result) return null;
    if (sys.uses.max > 0) await this.update({ "system.uses.value": sys.uses.value - 1 });
    else await this.update({ "system.quantity": sys.quantity - 1 });
    return result;
  }

  /**
   * The attack of an ability or jutsu card (spec.attack, or the jutsu's attack field). Touch attacks are resisted with
   * a Reflexos test of the target instead of its CA (p. 230), unless something lets it use the CA.
   */
  async rollAutoAttack({ message = null, event = null } = {}) {
    const actor = this.actor;
    if (!actor) return null;
    const flags = message?.flags?.[SYSTEM_ID] ?? {};
    const spec = flags.jutsuSpec ?? this.system.auto?.activation ?? {};
    // An ability or jutsu that strikes with the weapon: the weapon's attack, with this one's bonus, damage and hit effects
    if (spec.attack?.weapon) return this.#weaponStrike(spec, flags, message, event);
    const type = spec.attack?.type ?? this.system.attack ?? "corpo";
    const ranged = ["distancia", "toqueDistancia"].includes(type);
    const touch = type.startsWith("toque");
    const data = dataFor(this, { spent: flags.source?.spent ?? 0 });
    let bonus;
    if (actor.type === "character") {
      bonus = ranged ? actor.system.attack.ranged : actor.system.attack.melee;
      // Bênção de Tikauromu: Wisdom for the melee attacks of jutsus
      if (!ranged && this.type === "jutsu" && actor.system.traits?.jutsuMeleeAbility) {
        const a = actor.system.traits.jutsuMeleeAbility;
        bonus += (actor.system.abilities[a]?.mod ?? 0) - (actor.system.abilities.for.mod ?? 0);
      }
    } else bonus = (actor.system.level ?? 0) + ((ranged ? actor.system.mods?.des : actor.system.mods?.for) ?? 0);
    bonus += Math.floor(evaluate(spec.attack?.bonus ?? 0, data));
    const hitOption = (spec.attack?.onHit || spec.attack?.onCrit) ? [{
      id: `strike.${this.id}`, label: this.name, itemName: this.name, itemId: this.id,
      value: 0, attack: 0, damage: "", damageType: "", noCrit: true, precision: false, ca: 0, critRange: 0, critMult: 0,
      ignoreRd: 0, cost: 0, pm: null, onHit: spec.attack.onHit ?? null, onCrit: spec.attack.onCrit ?? null, note: "",
      auto: true, locked: true, data
    }] : [];
    const msg = await attackRoll({
      actor, ranged, event, touch,
      title: this.name,
      subtitle: L(`IJ.Jutsu.attack.${type}`) + (touch ? ` · ${L("IJ.Jutsu.touchNote")}` : ""),
      bonus,
      kanji: this.type === "jutsu" ? "術" : "能",
      damage: null,
      extraFlags: { touchOf: message?.id ?? null },
      extraOptions: hitOption
    });
    if (msg && spec.targets && !spec.targets.save) {
      const label = spec.optionLabel ? `${this.name}: ${spec.optionLabel}` : this.name;
      for (const t of msg.flags[SYSTEM_ID].attack.targets.filter(r => r.hit)) {
        const doc = fromUuidSync(t.uuid);
        const target = doc?.actor ?? doc;
        if (target?.system) await applyTargetBlock(this, spec.targets, data, target, label, { duration: spec.duration ?? null, optionKey: spec.optionId ?? null });
      }
    }
    return msg;
  }

  /**
   * Strike with the equipped weapon for an ability or jutsu (Golpe Desonrado, Pancada Poderosa): the weapon's attack
   * and damage, plus the ability's attack bonus, extra damage (not multiplied) and what a hit brings.
   */
  async #weaponStrike(spec, flags, message, event) {
    const actor = this.actor;
    const a = spec.attack;
    const ranged = a.weapon === "distancia" || a.type === "distancia";
    const data = dataFor(this, { spent: flags.source?.spent ?? 0, ...(flags.jutsuData ?? {}) });
    let candidates = actor.items.filter(i => (i.type === "weapon") && i.system.equipped && (ranged ? i.system.kind !== "corpo" : i.system.kind === "corpo"));
    if ((typeof a.weapon === "string") && !["corpo", "distancia"].includes(a.weapon)) {
      const names = a.weapon.split("|").map(n => n.trim().toLowerCase()).filter(Boolean);
      const named = candidates.filter(i => names.some(n => i.name.toLowerCase().includes(n)));
      if (named.length) candidates = named;
    }
    let weapon = candidates[0] ?? null;
    // Several weapons in hand (or Shift held): ask which one strikes, or a strike without a weapon
    if (((candidates.length > 1) || (event?.shiftKey && candidates.length)) && !event?.altKey) {
      const { askActivation } = await import("../auto/dialog.mjs");
      const answer = await askActivation(this.name, [...candidates.map(w => ({ id: w.id, label: w.name })), { id: "none", label: L("IJ.Auto.unarmedStrike") }]);
      if (!answer) return null;
      weapon = (answer.choice && answer.choice !== "none") ? actor.items.get(answer.choice) : null;
    }
    const extraDamage = a.damage ?? spec.damage?.formula ?? "";
    const option = {
      id: `strike.${this.id}`, label: this.name, itemName: this.name, itemId: this.id,
      value: 0, attack: Math.floor(evaluate(a.bonus ?? 0, data)),
      damage: extraDamage ? resolveFormula(flags.damageFormula ?? extraDamage, data) : "",
      damageType: a.damageType ?? spec.damage?.type ?? "", noCrit: true, precision: false, ca: 0,
      critRange: Math.floor(evaluate(a.critRange ?? 0, data)), critMult: Math.floor(evaluate(a.critMult ?? 0, data)),
      ignoreRd: a.ignoreRd === "all" ? Infinity : Math.floor(evaluate(a.ignoreRd ?? 0, data)),
      cost: 0, pm: null, onHit: a.onHit ?? null, onCrit: a.onCrit ?? null, note: "", auto: true, locked: true, data
    };
    const msg = weapon
      ? await weapon.rollAttack({ event, reaction: this.name, extraOptions: [option] })
      : await actor.rollPlainAttack(ranged ? "ranged" : "melee", { event, extraOptions: [option] });
    // The ability's effects on those it hit
    if (msg && spec.targets && !spec.targets.save) {
      const label = spec.optionLabel ? `${this.name}: ${spec.optionLabel}` : this.name;
      for (const t of msg.flags[SYSTEM_ID].attack.targets.filter(r => r.hit)) {
        const doc = fromUuidSync(t.uuid);
        const target = doc?.actor ?? doc;
        if (target?.system) await applyTargetBlock(this, spec.targets, data, target, label, { duration: spec.duration ?? null, optionKey: spec.optionId ?? null });
      }
    }
    return msg;
  }

  /* -------------------------------------------- */
  /*  Jutsus                                      */
  /* -------------------------------------------- */

  /**
   * Execute a jutsu (p. 161): its grade cost with the executor's rules, PM for its own enhancements and the
   * enhancement feats, all within the PM limit; then its effects, and the card with attack, damage and save.
   */
  async executeJutsu({ event, choice } = {}) {
    const actor = this.actor;
    const sys = this.system;
    const grade = JUTSU_GRADES[sys.grade];
    const rules = actor ? jutsuRules(actor, this) : { costDelta: 0, dcDelta: 0, damageDelta: 0, healDelta: 0, gradeDown: false, enhancements: [] };
    const base = gradeCost(sys.grade, rules.gradeDown) + (sys.extraCost ?? 0);
    // A variant picked when executing (Mandala Elemental: the energy)
    const opts = availableOptions(this);
    let optionId = (choice !== undefined) ? choice : (opts.length === 1 ? opts[0].id : null);
    if ((choice === undefined) && (opts.length > 1)) {
      const pick = await askActivation(this.name, opts.map(o => ({ id: o.id, label: o.label, hint: o.hint ?? "" })));
      if (!pick) return null;
      optionId = pick.choice;
    }
    let extra = 0;
    let steps = 0;
    let enh = {};
    const limit = actor?.pmLimit ?? 99;
    if (actor && !event?.altKey && ((limit > base) || rules.enhancements.length)) {
      const answer = await jutsuDialog(this, { base, limit, rules });
      if (!answer) return null;
      extra = answer.extra;
      steps = answer.steps ?? 0;
      enh = answer.enh;
    }
    // Cost: grade + own enhancements (damage steps apart) + enhancement feats, then the executor's reductions and rules
    const scalePm = steps * (sys.damage?.scaleCost || 0);
    let total = base + extra + scalePm;
    const used = [];
    let dcBonus = 0;
    let maximize = false;
    for (const e of rules.enhancements) {
      const n = enh[e.id] ?? 0;
      if (!n) continue;
      total += n * e.cost - (e.discount ?? 0);
      used.push(n > 1 ? `${e.label} ×${n}` : e.label);
      if (e.effect === "maximize") maximize = true;
      if (e.effect === "dc") dcBonus += n * Number(e.value ?? 1);
      if (e.effect === "dcHonor") dcBonus += Math.max(0, actor?.system?.abilities?.hon?.mod ?? 0);
    }
    total = Math.max((rules.gradeDown && sys.grade === "basico") ? 1 : 0, rules.costDelta < 0 ? (rules.costMin ?? 0) : 0, total + rules.costDelta);
    total = adjustCost(actor, total, { kind: "jutsu", ctx: { item: this, chakra: sys.chakra, descriptors: sys.descriptors } });
    if (actor) {
      if (total > limit) return ui.notifications.warn(game.i18n.format("IJ.Auto.overLimit", { n: total, limit }));
      if (!(await actor.spendPm(total))) return null;
    }

    // Using a jutsu can be an Honor violation (the jutsu says which)
    const auto = specFor(this, optionId);
    if (auto.honorViolation && actor?.type === "character") await actor.honorViolation(auto.honorViolation);

    // The spec of this execution: the jutsu's own save, damage and attack, plus its automation
    const dc = sys.dc + rules.dcDelta + dcBonus;
    const spec = { ...auto };
    const res = sys.resistance ?? "";
    if (sys.save) {
      spec.save = {
        ...(auto.save ?? {}), type: sys.save, dc,
        half: auto.save?.half ?? /metade/i.test(res),
        negate: auto.save?.negate ?? (/anula/i.test(res) && !/metade/i.test(res))
      };
    } else if (spec.save) spec.save.dc = dc;
    if (spec.targets?.save) spec.targets.save.dc = dc;
    let damageFormula = null;
    if (sys.damage?.formula) {
      damageFormula = this.jutsuFormula(scalePm);
      const delta = sys.damage.healing ? rules.healDelta : rules.damageDelta;
      if (delta) damageFormula = `${damageFormula} + ${delta}`;
      spec.damage = { formula: damageFormula, type: sys.damage.type, healing: sys.damage.healing, magic: true, ...(auto.damage ?? {}) };
      spec.damage.formula = damageFormula;
    }
    if (sys.attack) spec.attack = { type: sys.attack, ...(auto.attack ?? {}) };
    // @dc: the DC of this execution (ongoing saves of the jutsu use it)
    const data = dataFor(this, { spent: extra, dc });
    const results = await perform(this, spec, data, { spent: extra, optionId });

    const tags = [
      `${total} PM`,
      `${L("IJ.Jutsu.dc")} ${dc}`,
      sys.execution, sys.range, sys.duration, sys.resistance,
      ...used
    ].filter(Boolean);
    const enhText = sys.enhancements ? await TextEditor.implementation.enrichHTML(sys.enhancements, { relativeTo: this }) : "";
    return postCard(this, spec, data, {
      cost: total, spent: extra, optionId, results, kanji: "術", kind: "jutsu",
      subtitle: `${L(CHAKRAS[sys.chakra].label)} · ${L(grade.label)}${(extra + scalePm) ? ` · ${game.i18n.format("IJ.Jutsu.enhanced", { n: extra + scalePm })}` : ""}`,
      tags,
      extraBody: (sys.target ? `<p><strong>${L("IJ.Jutsu.target")}:</strong> ${foundry.utils.escapeHTML(sys.target)}</p>` : "")
        + (enhText ? `<div class="ij-card-enh"><strong>${L("IJ.Jutsu.enhancements")}</strong>${enhText}</div>` : ""),
      flags: { jutsuSpec: spec, jutsuData: { spent: extra, dc }, damageFormula, maximize }
    });
  }

  /**
   * The jutsu's damage formula with the "aumenta o dano" enhancement paid: each scaleCost PM adds scaleDice
   * (cumulative, p. 161). Dice of the same size merge: 6d6 + 3×1d6 → 9d6.
   * @param {number} extra  PM spent on enhancements
   */
  jutsuFormula(extra = 0) {
    const { formula, scaleDice, scaleCost } = this.system.damage ?? {};
    if (!formula) return "";
    const steps = (scaleCost > 0) ? Math.floor(extra / scaleCost) : 0;
    if (!steps || !scaleDice) return formula;
    const scale = /^\s*(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(scaleDice);
    if (!scale) {
      const flat = Number(scaleDice);
      return Number.isFinite(flat) ? `${formula} + ${flat * steps}` : formula;
    }
    const count = Number(scale[1]) * steps;
    const die = scale[2];
    const flat = scale[4] ? (scale[3] === "-" ? -1 : 1) * Number(scale[4]) * steps : 0;
    const flatText = flat ? ` ${flat > 0 ? "+" : "-"} ${Math.abs(flat)}` : "";
    const base = /^\s*(\d+)d(\d+)(.*)$/i.exec(formula);
    if (base && (base[2] === die)) return `${Number(base[1]) + count}d${die}${base[3]}${flatText}`;
    return `${formula} + ${count}d${die}${flatText}`;
  }

  /** Macro helpers kept from 0.2: the damage and the attack of a jutsu outside a card. */
  async rollJutsuDamage({ extra = 0 } = {}) {
    const dmg = this.system.damage;
    if (!dmg?.formula) return null;
    return rollDamage({
      actor: this.actor, title: this.name, subtitle: dmg.healing ? L("IJ.Chat.healing") : (dmg.type || ""),
      parts: [{ formula: this.jutsuFormula(extra), type: dmg.type, noCrit: true }], healing: dmg.healing, magic: true, kanji: "術"
    });
  }

  async rollJutsuAttack() {
    return this.rollAutoAttack({});
  }
}

export { SYSTEM_ID, ABILITIES, signed };
