import { ABILITIES, CREATURE_TYPES, DAMAGE_TYPES, SIZES, SYSTEM_ID } from "../config.mjs";
import { signed } from "../dice/rolls.mjs";
import { bookText } from "../book-text.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

const L = key => game.i18n.localize(key);

/** Number fields of the threat that also accept "+5" / "-3" / "=7". */
const DELTA_FIELDS = ["system.pv.value", "system.pv.temp", "system.pm.value"];

/**
 * The threat sheet: the bestiary stat block on parchment, with the same pieces as the character sheet (shields,
 * medallions, plaques). Numbers are typed (they come ready from the book); the brush turns them into fields.
 */
export class NpcSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["imperiodejade", "ij-sheet", "ij-npc"],
    position: { width: 780, height: 860 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleEdit: NpcSheet.#onToggleEdit,
      rollAbility: NpcSheet.#onRollAbility,
      rollSave: NpcSheet.#onRollSave,
      rollSkill: NpcSheet.#onRollSkill,
      rollInitiative: NpcSheet.#onRollInitiative,
      itemCreate: NpcSheet.#onItemCreate,
      itemEdit: NpcSheet.#onItemEdit,
      itemDelete: NpcSheet.#onItemDelete,
      itemUse: NpcSheet.#onItemUse,
      itemDamage: NpcSheet.#onItemDamage,
      toggleCollapse: NpcSheet.#onToggleCollapse
    }
  };

  static PARTS = {
    sheet: { template: `systems/${SYSTEM_ID}/templates/actor/npc-sheet.hbs`, scrollable: [".ij-npc-body"] }
  };

  #editMode = false;
  #expanded = new Set();

  get title() {
    return this.actor.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const source = actor._source.system;
    const editMode = this.#editMode && this.isEditable;
    const enrich = html => TextEditor.implementation.enrichHTML(html ?? "", {
      secrets: actor.isOwner, rollData: actor.getRollData(), relativeTo: actor
    });
    const itemsOf = type => actor.items.filter(i => i.type === type).sort((a, b) => a.sort - b.sort);
    const view = async item => ({
      id: item.id, name: item.name, img: item.img,
      cost: item.system.cost ?? 0, expanded: this.#expanded.has(item.id),
      description: await enrich(item.system.description),
      bookText: bookText.of(item)
    });
    Object.assign(context, {
      actor, system: sys, source, editMode,
      editable: this.isEditable,
      typeLabel: L(CREATURE_TYPES[sys.creatureType] ?? ""),
      sizeLabel: L(SIZES[sys.size]?.label ?? ""),
      honorTier: sys.honorTier ? L(sys.honorTier.label) : "",
      honorTierKey: sys.honorTier?.key ?? "",
      abilities: Object.entries(ABILITIES).map(([key, cfg]) => ({
        key, kanji: cfg.kanji, abbr: L(cfg.abbr),
        score: sys.abilities[key], mod: sys.mods[key] === null ? "—" : signed(sys.mods[key]),
        none: sys.abilities[key] === null
      })),
      saves: ["fort", "ref", "von"].map(key => ({ key, label: L(`IJ.Save.${key}`), value: signed(sys.saves[key]) })),
      initiative: signed(sys.initiative),
      perception: signed(sys.perception),
      attacks: itemsOf("weapon").map(w => ({
        id: w.id, name: w.name, img: w.img,
        attack: signed(w.system.attackTotal), damage: w.system.damageFormula, crit: w.system.critLabel,
        type: w.system.damageType, typeLabel: L(DAMAGE_TYPES[w.system.damageType] ?? ""),
        range: w.system.range ? `${w.system.range} m` : ""
      })),
      specials: await Promise.all([...itemsOf("power"), ...itemsOf("feat")].map(view)),
      jutsus: await Promise.all(itemsOf("jutsu").map(async j => ({ ...(await view(j)), cost: j.system.cost, dc: j.system.dc }))),
      gear: itemsOf("gear").concat(itemsOf("armor"), itemsOf("consumable")).map(i => ({ id: i.id, name: i.name, img: i.img })),
      enriched: { description: await enrich(sys.description), notes: await enrich(sys.notes) },
      bookText: bookText.of(actor),
      choices: {
        types: Object.fromEntries(Object.entries(CREATURE_TYPES).map(([k, v]) => [k, L(v)])),
        sizes: Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, L(v.label)]))
      }
    });
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("ij-editing", context.editMode);
    for (const input of this.element.querySelectorAll("input.ij-select-on-focus")) {
      input.addEventListener("focus", ev => ev.currentTarget.select());
    }
  }

  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const path of DELTA_FIELDS) {
      const raw = foundry.utils.getProperty(data, path);
      if ((raw === undefined) || (typeof raw === "number")) continue;
      const current = foundry.utils.getProperty(this.actor._source, path) ?? 0;
      const v = String(raw).trim().replace("−", "-");
      let n = current;
      if (/^[+-]\s*\d+$/.test(v)) n = current + Number(v.replace(/\s/g, ""));
      else if (/^=\s*-?\d+$/.test(v)) n = Number(v.replace(/[=\s]/g, ""));
      else if (/^\d+$/.test(v)) n = Number(v);
      foundry.utils.setProperty(data, path, n);
    }
    // An ability typed as "-" or left empty means "none" (null), like Honra – of animals
    for (const key of Object.keys(ABILITIES)) {
      const path = `system.abilities.${key}`;
      const raw = foundry.utils.getProperty(data, path);
      if ((raw === "") || (raw === "-") || (raw === "–")) foundry.utils.setProperty(data, path, null);
    }
    return data;
  }

  #item(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }

  static #onToggleEdit() {
    this.#editMode = !this.#editMode;
    this.render();
  }

  static #onRollAbility(event, target) {
    this.actor.rollAbility(target.dataset.ability, { event });
  }

  static #onRollSave(event, target) {
    this.actor.rollSave(target.dataset.save, { event });
  }

  static #onRollSkill(event, target) {
    this.actor.rollSkill(target.dataset.skill, { event });
  }

  static #onRollInitiative(event) {
    this.actor.rollInitiativeCheck({ event });
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const data = { name: game.i18n.format("IJ.Item.new", { type: L(`TYPES.Item.${type}`) }), type };
    if (type === "weapon") data.system = { equipped: true, proficient: true, kind: "corpo" };
    const [item] = await this.actor.createEmbeddedDocuments("Item", [data]);
    item?.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    this.#item(target)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = this.#item(target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("IJ.Item.deleteTitle") },
      content: `<p>${game.i18n.format("IJ.Item.deleteConfirm", { name: foundry.utils.escapeHTML(item.name) })}</p>`,
      rejectClose: false
    });
    if (ok) await item.delete();
  }

  static #onItemUse(event, target) {
    this.#item(target)?.use({ event });
  }

  static #onItemDamage(event, target) {
    this.#item(target)?.rollDamage({ critical: target.dataset.crit === "true" });
  }

  static #onToggleCollapse(event, target) {
    const row = target.closest("[data-item-id]");
    const id = row?.dataset.itemId;
    if (!id) return;
    if (this.#expanded.has(id)) this.#expanded.delete(id);
    else this.#expanded.add(id);
    row.classList.toggle("expanded", this.#expanded.has(id));
  }
}
