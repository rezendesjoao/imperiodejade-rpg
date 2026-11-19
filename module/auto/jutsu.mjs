/**
 * Jutsus under the automation: the rules of the executor that change a jutsu (cost reductions of the ninja tricks and
 * of the Escolhido Celestial, +2 DC of the Bênçãos, Wu-Jen de Batalha damage, Bênção de Fuyuan healing, Dominar
 * Jutsu) and the enhancement feats (Jutsu Maximizado, Irresistível, Acelerado...) offered when executing it.
 *
 * Trait lists (from feats and abilities):
 *   jutsuCost:   [{ value: -1, filter: { descriptor: "ninja" } }]          PM added to the final cost (min 0)
 *   jutsuDc:     [{ value: 2, filter: { chakra: "int" } }]                 to the save DC
 *   jutsuDamage: [{ value: "@int" }]  jutsuHeal: [{ value: "@sab" }]       to the damage / healing
 *   jutsuGradeDown: [{ filter: { chosenJutsu: true } }]                    costs the grade below (Dominar Jutsu)
 *   jutsuEnhancements: [{ id, label, cost, max, effect: "maximize"|"dc"|"dcHonor"|"note", value, note, discount }]
 */
import { matches, situation, evaluate } from "./context.mjs";

const L = key => game.i18n.localize(key);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const GRADES = ["basico", "mediano", "avancado", "sublime", "lendario"];

/** The rules of an actor that apply to a jutsu. */
export function jutsuRules(actor, jutsu) {
  const traits = actor?.system?.traits ?? {};
  const ctx = { item: jutsu, chakra: jutsu.system.chakra, descriptors: `${jutsu.system.descriptors ?? ""} ${jutsu.name}` };
  const itemOf = id => actor?.items.get(id) ?? null;
  const pick = key => (traits[key] ?? []).filter(r => r && matches(r.filter, ctx, itemOf(r._item))
    && (!r.when || situation(r.when, actor)) && (!r.minLevel || ((r._data?.classe ?? 1) >= r.minLevel)));
  const sum = list => list.reduce((t, r) => t + Math.floor(evaluate(r.value ?? 0, r._data ?? {})), 0);
  // Enhancement feats: one entry per enhancement. A second source of the same one only gives a discount: its own
  // `discount` (the ninja's tricks: 3 PM off Jutsu Acelerado in ninja jutsus) or 1 PM (a talisman of a feat you have)
  const enh = new Map();
  for (const e of pick("jutsuEnhancements")) {
    const discount = Math.floor(evaluate(e.discount ?? 0, e._data ?? {}));
    const old = enh.get(e.id);
    if (old) { old.discount = Math.max(old.discount, discount || 1); continue; }
    enh.set(e.id, { ...e, discount, cost: Math.floor(evaluate(e.cost ?? 0, e._data ?? {})), max: Number(e.max ?? 1) });
  }
  return {
    costDelta: sum(pick("jutsuCost")),
    // The lowest cost the reductions allow (an item's discount: 1 PM; the ninja's tricks: 0)
    costMin: pick("jutsuCost").reduce((m, r) => Math.max(m, Number(r.min ?? 0)), 0),
    dcDelta: sum(pick("jutsuDc")),
    damageDelta: sum(pick("jutsuDamage")),
    healDelta: sum(pick("jutsuHeal")),
    gradeDown: pick("jutsuGradeDown").length > 0,
    enhancements: [...enh.values()]
  };
}

/** The PM of a grade (Dominar Jutsu: the grade below; a basic jutsu then costs 0). */
export function gradeCost(grade, down = false) {
  const i = GRADES.indexOf(grade);
  if (!down) return CONFIG.IJ.JUTSU_GRADES[grade]?.cost ?? 1;
  return i <= 0 ? 0 : CONFIG.IJ.JUTSU_GRADES[GRADES[i - 1]].cost;
}

/**
 * The execution dialog: PM for the jutsu's own enhancements and the enhancement feats, with the total and the limit.
 * @returns {Promise<{extra: number, enh: Record<string, number>}|null>}
 */
export async function jutsuDialog(jutsu, { base, limit, rules }) {
  const scaleCost = jutsu.system.damage?.scaleDice ? (jutsu.system.damage.scaleCost || 0) : 0;
  const rows = rules.enhancements.map(e => `<li class="ij-opt">
      <label><span class="ij-opt-name">${esc(e.label)}</span>
      <span class="ij-opt-tag">+${e.cost} PM${e.discount ? ` (−${e.discount})` : ""}${e.max > 1 ? ` · ${L("IJ.Jutsu.stack")}` : ""}</span></label>
      <span class="ij-opt-pm"><input type="number" name="enh-${esc(e.id)}" data-cost="${e.cost}" data-discount="${e.discount}" value="0" min="0" max="${e.max}" step="1"> ×</span>
    </li>`).join("");
  const content = `<div class="ij-dialog-mod ij-options ij-jutsu-dialog">
    <p>${game.i18n.format("IJ.Jutsu.extraHint", { cost: base, limit })}</p>
    ${scaleCost ? `<label class="ij-opt-bonus">${game.i18n.format("IJ.Jutsu.scaleSteps", { cost: scaleCost })} <input type="number" name="steps" data-cost="${scaleCost}" value="0" min="0" step="1" autofocus></label>` : ""}
    <label class="ij-opt-bonus">${L(scaleCost ? "IJ.Jutsu.otherPm" : "IJ.Jutsu.extraPm")} <input type="number" name="extra" value="0" min="0" max="${Math.max(0, limit)}" step="1" ${scaleCost ? "" : "autofocus"}></label>
    ${rows ? `<p class="ij-opt-hint">${L("IJ.Jutsu.enhancementFeats")}</p><ul class="ij-opt-list">${rows}</ul>` : ""}
    <p class="ij-jutsu-total">${L("IJ.Jutsu.total")}: <strong data-total>${Math.max(0, base + rules.costDelta)}</strong> / ${limit} PM</p>
  </div>`;
  const total = el => {
    let t = base + (Number(el.querySelector("input[name=extra]")?.value) || 0)
      + (Number(el.querySelector("input[name=steps]")?.value) || 0) * scaleCost;
    for (const input of el.querySelectorAll("input[name^=enh-]")) {
      const n = Number(input.value) || 0;
      if (n > 0) t += n * Number(input.dataset.cost) - Number(input.dataset.discount || 0);
    }
    return Math.max(0, t + rules.costDelta);
  };
  return foundry.applications.api.DialogV2.wait({
    window: { title: jutsu.name, icon: "fa-solid fa-hand-sparkles" },
    classes: ["imperiodejade", "ij-dialog"],
    position: { width: 440 },
    content,
    rejectClose: false,
    render: (event, dialog) => {
      const el = dialog.element;
      const refresh = () => {
        const t = total(el);
        const out = el.querySelector("[data-total]");
        if (out) { out.textContent = t; out.classList.toggle("over", t > limit); }
      };
      el.addEventListener("input", refresh);
    },
    buttons: [{
      action: "go", label: L("IJ.Jutsu.execute"), icon: "fa-solid fa-hand-sparkles", default: true,
      callback: (e, b, dialog) => {
        const el = dialog.element;
        const enh = {};
        for (const input of el.querySelectorAll("input[name^=enh-]")) {
          const n = Math.clamp(Number(input.value) || 0, 0, Number(input.max) || 1);
          if (n > 0) enh[input.name.slice(4)] = n;
        }
        return {
          extra: Math.max(0, Number(el.querySelector("input[name=extra]")?.value) || 0),
          steps: Math.max(0, Number(el.querySelector("input[name=steps]")?.value) || 0),
          enh
        };
      }
    }]
  });
}
