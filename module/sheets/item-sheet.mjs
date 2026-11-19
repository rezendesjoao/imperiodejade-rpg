import {
  ABILITY_SOURCES, ARMOR_CATEGORIES, BBA_PROGRESSIONS, CHAKRAS, CONSUMABLE_KINDS, DAMAGE_TYPES, FEAT_CATEGORIES,
  JUTSU_GRADES, KEY_ABILITIES, ABILITIES, SIZES, SKILLS, SYSTEM_ID, WEAPON_CATEGORIES, WEAPON_GRIPS, WEAPON_KINDS
} from "../config.mjs";
import { signed } from "../dice/rolls.mjs";
import { bookText } from "../book-text.mjs";
import { dataFor, evaluate, inactiveReason, resolveFormula } from "../auto/context.mjs";
import { usesLeft, durationLabel } from "../auto/effects.mjs";

/** A readable summary of what an item's automation does (for the "Automação" box of the item sheet). */
function autoSummary(item) {
  const auto = item.system.auto ?? {};
  const lines = [];
  const data = item.actor ? dataFor(item) : { rank: 1, classe: 1 };
  const n = v => (item.actor ? evaluate(v, data) : v);
  const act = auto.activation;
  if (act) {
    const bits = [];
    if (act.cost) bits.push(`${n(act.cost)} PM`);
    if (act.variable) bits.push(game.i18n.localize("IJ.Auto.sum.variable"));
    if (act.duration) bits.push(durationLabel(act.duration, data));
    if (act.uses) bits.push(game.i18n.format("IJ.Auto.sum.uses", { n: n(act.uses.max ?? 1), per: act.uses.per }));
    if (act.options?.length) bits.push(game.i18n.format("IJ.Auto.sum.options", { n: act.options.length }));
    lines.push(`${game.i18n.localize("IJ.Auto.sum.use")}${bits.length ? ` (${bits.join(", ")})` : ""}`);
    if (act.tempPv) lines.push(game.i18n.format("IJ.Auto.tempPv", { n: n(act.tempPv) }));
    if (act.targets?.conditions?.length || act.save?.onFail?.conditions?.length) {
      const conds = [...(act.targets?.conditions ?? []), ...(act.save?.onFail?.conditions ?? [])].map(c => game.i18n.localize(`IJ.Condition.${c.id ?? c}`));
      lines.push(game.i18n.format("IJ.Auto.sum.conditions", { list: conds.join(", ") }));
    }
  }
  const traits = auto.traits ?? {};
  const T = key => game.i18n.localize(`IJ.Auto.trait.${key}`);
  for (const [key, value] of Object.entries(traits)) {
    if (Array.isArray(value)) {
      if (value.every(v => typeof v === "string")) lines.push(`${T(key)}: ${value.join(", ")}`);
      else lines.push(T(key));
    } else if (value && typeof value === "object") lines.push(`${T(key)}: ${Object.entries(value).map(([k, v]) => `${k} ${n(v)}`).join(", ")}`);
    else if (typeof value === "boolean") lines.push(T(key));
    else lines.push(`${T(key)}: ${n(value)}`);
  }
  for (const o of auto.rollOptions ?? []) {
    const what = [o.attack ? `${signed(n(o.attack))} ${game.i18n.localize("IJ.Auto.tag.attack")}` : "", o.value ? signed(n(o.value)) : "",
      o.damage ? `+${item.actor ? resolveFormula(o.damage, data) : o.damage} ${game.i18n.localize("IJ.Auto.tag.damage")}` : ""].filter(Boolean).join(" · ");
    lines.push(`${o.label ?? item.name}${what ? `: ${what}` : ""}${o.cost ? ` (${n(o.cost)} PM)` : ""}`);
  }
  for (const r of auto.reactions ?? []) lines.push(`${game.i18n.localize("IJ.Auto.sum.reaction")}: ${r.label ?? item.name}${r.cost ? ` (${n(r.cost)} PM)` : ""}`);
  for (const g of auto.grants ?? []) lines.push(`${game.i18n.localize("IJ.Auto.sum.grants")}: ${g.name}`);
  if (auto.choice) {
    const picked = (auto.choice.options ?? []).filter(o => (item.system.choices ?? []).includes(o.id)).map(o => o.label ?? o.id);
    lines.push(game.i18n.format("IJ.Auto.sum.choice", { label: auto.choice.label ?? "", picked: picked.join(", ") || "—" }));
  }
  if (auto.status === "narrativo") lines.push(game.i18n.localize("IJ.Auto.sum.narrative"));
  if (auto.status === "parcial") lines.push(game.i18n.localize("IJ.Auto.sum.partial"));
  if (auto.notes) lines.push(auto.notes);
  if (item.actor) {
    const left = usesLeft(item, data);
    if (left !== null) lines.push(game.i18n.format("IJ.Auto.usesLeft", { n: left }));
  }
  return lines;
}

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

const L = key => game.i18n.localize(key);
const localized = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, L(typeof v === "string" ? v : v.label)]));

/** A readable line for an active effect change ("+4 Percepção", "Atletismo usa Des"). */
function effectLabel(change) {
  const v = change.value;
  const n = Number(v);
  const sign = Number.isFinite(n) ? signed(n) : String(v);
  const parts = change.key.split(".");
  if (parts[1] === "abilities") return `${sign} ${L(ABILITIES[parts[2]]?.abbr ?? parts[2])}`;
  if (parts[1] === "skills") {
    const skill = L(SKILLS[parts[2]]?.label ?? parts[2]);
    return parts[3] === "ability" ? game.i18n.format("IJ.Effect.skillAbility", { skill, ability: L(ABILITIES[v]?.abbr ?? v) }) : `${sign} ${skill}`;
  }
  if (parts[1] === "saves") return `${sign} ${L(`IJ.Save.${parts[2]}`)}`;
  if (parts[1] === "chakras") return game.i18n.format("IJ.Effect.chakraOpen", { chakra: L(CHAKRAS[parts[2]]?.label ?? parts[2]) });
  const key = parts.slice(1).join(".");
  const labels = {
    "attributes.pv.bonus": "PV", "attributes.pm.bonus": "PM", "attributes.pm.limitBonus": L("IJ.Effect.pmLimit"),
    "attributes.ca.bonus": "CA", "attributes.attack.melee": L("IJ.Attack.melee"), "attributes.attack.ranged": L("IJ.Attack.ranged"),
    "attributes.attack.damage": L("IJ.Attack.damageBonus"), "attributes.movement.bonus": L("IJ.Movement.label"),
    "attributes.rd": "RD", "attributes.critBonus": L("IJ.Effect.threat"), "attributes.critMult": L("IJ.Effect.critMult"),
    "attributes.mods.attack": L("IJ.Effect.modsAttack"), "attributes.mods.skills": L("IJ.Effect.modsSkills"), "attributes.mods.saves": L("IJ.Effect.modsSaves"),
    "attributes.mods.abilityTests": L("IJ.Effect.modsAbility"), "attributes.mods.physSkills": L("IJ.Effect.modsPhys")
  };
  return `${sign} ${labels[key] ?? key}`;
}

/** Kanji of each item type, shown as the watermark of the sheet. */
const TYPE_KANJI = { class: "道", race: "族", weapon: "刀", armor: "鎧", gear: "物", consumable: "薬", feat: "才", power: "能", jutsu: "術" };

/** One parchment card for every item type: picture, name, the type's fields and the description. */
export class ItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["imperiodejade", "ij-sheet", "ij-item"],
    position: { width: 560, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleClassSkill: ItemSheet.#onToggleClassSkill,
      toggleRaceChoice: ItemSheet.#onToggleRaceChoice,
      toggleAutoChoice: ItemSheet.#onToggleAutoChoice,
      useItem: ItemSheet.#onUseItem,
      activateItem: ItemSheet.#onActivateItem
    }
  };

  static PARTS = {
    sheet: { template: `systems/${SYSTEM_ID}/templates/item/item-sheet.hbs`, scrollable: [".ij-item-body"] }
  };

  /** @override */
  get title() {
    return this.item.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const sys = item.system;
    const enrich = html => TextEditor.implementation.enrichHTML(html ?? "", {
      secrets: item.isOwner, rollData: item.actor?.getRollData() ?? {}, relativeTo: item
    });
    Object.assign(context, {
      item, system: sys, source: item._source.system,
      type: item.type,
      typeLabel: L(`TYPES.Item.${item.type}`),
      kanji: TYPE_KANJI[item.type] ?? "物",
      editable: this.isEditable,
      isType: Object.fromEntries(Object.keys(TYPE_KANJI).map(t => [t, item.type === t])),
      enriched: {
        description: await enrich(sys.description),
        enhancements: item.type === "jutsu" ? await enrich(sys.enhancements) : ""
      },
      choices: {
        bba: localized(BBA_PROGRESSIONS),
        sizes: localized(SIZES),
        weaponCategories: localized(WEAPON_CATEGORIES),
        weaponKinds: localized(WEAPON_KINDS),
        grips: localized(WEAPON_GRIPS),
        damageTypes: localized(DAMAGE_TYPES),
        armorCategories: localized(ARMOR_CATEGORIES),
        consumableKinds: localized(CONSUMABLE_KINDS),
        featCategories: localized(FEAT_CATEGORIES),
        sources: localized(ABILITY_SOURCES),
        chakras: localized(CHAKRAS),
        grades: localized(JUTSU_GRADES),
        saves: { "": "—", fort: L("IJ.Save.fort"), ref: L("IJ.Save.ref"), von: L("IJ.Save.von") },
        attacks: { "": "—", ...Object.fromEntries(["corpo", "toque", "distancia", "toqueDistancia"].map(k => [k, L(`IJ.Jutsu.attack.${k}`)])) }
      },
      raceChoice: item.type === "race" ? this.#raceChoice(item) : null,
      features: ["class", "race"].includes(item.type)
        ? (sys.features ?? []).map(f => ({ ...f, reached: (item.type === "class") && (f.level <= sys.levels) }))
        : [],
      // Effects tied to an option show only when it is chosen; formulas show their value on an owned item
      effects: item.effects.contents
        .filter(e => !e.flags?.[SYSTEM_ID]?.option || (sys.choices ?? []).includes(e.flags[SYSTEM_ID].option))
        .flatMap(e => e.system.changes.map(c => ({ label: effectLabel(this.#valued(c, item)) }))),
      autoChoice: this.#autoChoice(item),
      autoSummary: autoSummary(item),
      autoInactive: item.actor && sys.auto && Object.keys(sys.auto).length
        ? (r => (r && r !== "noActor" ? L(`IJ.Auto.off.${r}`) : ""))(inactiveReason(item)) : "",
      effectsNote: ("equipped" in sys) && item.effects.size ? L("IJ.Item.effectsEquipped") : "",
      abilityMods: item.type === "race"
        ? KEY_ABILITIES.map(k => ({ key: k, label: L(ABILITIES[k].abbr), value: sys.abilityMods[k] }))
        : [],
      classSkills: item.type === "class"
        ? Object.entries(SKILLS).map(([k, s]) => ({ key: k, label: L(s.label), checked: sys.classSkills.includes(k) }))
        : [],
      derived: this.#derived(item),
      usable: !!item.actor && (["weapon", "jutsu", "power", "feat", "consumable"].includes(item.type) || item.hasActivation),
      powerUse: !!item.actor && (item.type === "weapon") && item.hasActivation,
      bookText: bookText.of(item)
    });
    return context;
  }

  /** Numbers worth showing at the top of the card. */
  #derived(item) {
    const sys = item.system;
    switch (item.type) {
      case "weapon": return [
        { label: L("IJ.Weapon.attack"), value: item.actor ? signed(sys.attackTotal) : signed(sys.attackBonus) },
        { label: L("IJ.Weapon.damage"), value: sys.damageFormula },
        { label: L("IJ.Weapon.critical"), value: sys.critLabel },
        { label: L("IJ.Weapon.type"), value: sys.damageType }
      ];
      case "armor": return [
        { label: L("IJ.Armor.bonus"), value: signed(sys.bonus) },
        { label: L("IJ.Armor.maxDex"), value: sys.maxDex === null ? "—" : signed(sys.maxDex) },
        { label: L("IJ.Armor.penalty"), value: sys.penalty ? signed(sys.penalty) : "0" }
      ];
      case "jutsu": return [
        { label: L("IJ.Jutsu.cost"), value: `${sys.cost} PM` },
        { label: L("IJ.Jutsu.dc"), value: sys.dc },
        { label: L("IJ.Jutsu.chakra"), value: L(CHAKRAS[sys.chakra].label) }
      ];
      case "class": return [
        { label: L("IJ.Class.levels"), value: sys.levels },
        { label: L("IJ.BBA.abbr"), value: signed(BBA_PROGRESSIONS[sys.bba]?.calc(sys.levels) ?? 0) },
        { label: L("IJ.Ability.hon"), value: signed(sys.honor) }
      ];
      default: return [];
    }
  }

  /** A change with its formula computed for the owner (the compendium copy keeps the formula). */
  #valued(change, item) {
    if (!item.actor || typeof change.value !== "string" || !/[@(]/.test(change.value)) return change;
    return { ...change, value: Math.floor(evaluate(change.value, dataFor(item))) };
  }

  /** The choice of an ability (style, options per level, element): chips, how many, and the text field. */
  #autoChoice(item) {
    const choice = item.system.auto?.choice;
    if (!choice) return null;
    const picks = item.system.choices ?? [];
    const count = item.actor ? Math.max(1, Math.floor(evaluate(choice.count ?? 1, dataFor(item), 1))) : Number(choice.count) || 1;
    return {
      label: game.i18n.format("IJ.Auto.chooseLabel", { label: choice.label ?? "", n: count, done: picks.length }),
      missing: !!item.actor && (picks.length < count) && (choice.options?.length > 0),
      count,
      text: choice.text ?? "",
      options: (choice.options ?? []).map(o => ({ id: o.id, label: o.label ?? o.id, hint: o.hint ?? "", chosen: picks.includes(o.id) }))
    };
  }

  static async #onToggleAutoChoice(event, target) {
    const id = target.dataset.option;
    const choice = this.item.system.auto?.choice;
    if (!choice) return;
    const picks = new Set(this.item.system.choices ?? []);
    if (picks.has(id)) picks.delete(id);
    else {
      const count = this.item.actor ? Math.max(1, Math.floor(evaluate(choice.count ?? 1, dataFor(this.item), 1))) : 99;
      if (picks.size >= count) return ui.notifications.warn(game.i18n.format("IJ.Auto.chooseFull", { n: count }));
      picks.add(id);
    }
    await this.item.update({ "system.choices": [...picks] });
  }

  /** The "+2 em duas habilidades à escolha" picks of a race (humans, mashin). */
  #raceChoice(item) {
    const { count, value } = item.system.abilityChoice ?? {};
    const chosen = item.system.chosen ?? [];
    return {
      label: game.i18n.format("IJ.Race.chooseLabel", { n: count, v: value, done: chosen.length }),
      missing: chosen.length < count,
      options: KEY_ABILITIES.map(k => ({ key: k, label: L(ABILITIES[k].abbr), chosen: chosen.includes(k) }))
    };
  }

  static async #onToggleRaceChoice(event, target) {
    const key = target.dataset.ability;
    const sys = this.item.system;
    const chosen = new Set(sys.chosen ?? []);
    if (chosen.has(key)) chosen.delete(key);
    else {
      if (chosen.size >= (sys.abilityChoice?.count ?? 0)) return ui.notifications.warn(game.i18n.format("IJ.Race.chooseFull", { n: sys.abilityChoice.count }));
      chosen.add(key);
    }
    await this.item.update({ "system.chosen": [...chosen] });
  }

  static async #onToggleClassSkill(event, target) {
    const key = target.dataset.skill;
    const list = new Set(this.item.system.classSkills);
    if (list.has(key)) list.delete(key);
    else list.add(key);
    await this.item.update({ "system.classSkills": [...list] });
  }

  static #onUseItem(event) {
    this.item.use({ event });
  }

  static #onActivateItem(event) {
    game.imperiodejade.auto.useItem(this.item, { event });
  }
}
