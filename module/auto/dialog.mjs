/**
 * The roll dialog: the options an actor has for this roll (abilities that add to it, some with a PM cost), and the
 * situational modifier of the book (favorable +2, unfavorable −2, or any number).
 */
import { signedValue } from "./formula.mjs";

const L = key => game.i18n.localize(key);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** The short description of what an option does ("+2 ataque · +1d6 dano · 1 PM"). */
export function optionTag(opt) {
  const bits = [];
  if (opt.attack) bits.push(`${signedValue(opt.attack)} ${L("IJ.Auto.tag.attack")}`);
  if (opt.value) bits.push(signedValue(opt.value));
  if (opt.damage) bits.push(`${/^[-−]/.test(opt.damage) ? "" : "+"}${opt.damage}${opt.damageType ? ` ${opt.damageType}` : ""} ${L("IJ.Auto.tag.damage")}`);
  if (opt.ca) bits.push(`${signedValue(opt.ca)} ${L("IJ.Auto.tag.ca")}`);
  if (opt.critRange) bits.push(`${signedValue(opt.critRange)} ${L("IJ.Auto.tag.threat")}`);
  if (opt.critMult) bits.push(`${signedValue(opt.critMult)} ${L("IJ.Auto.tag.mult")}`);
  if (opt.ignoreRd) bits.push(Number.isFinite(opt.ignoreRd) ? game.i18n.format("IJ.Auto.tag.ignoreRd", { n: opt.ignoreRd }) : L("IJ.Auto.tag.ignoreAll"));
  if (opt.cost) bits.push(`${opt.cost} PM`);
  if (opt.note) bits.push(opt.note);
  return bits.join(" · ");
}

/**
 * Ask which options to use. Returns null if closed.
 * @param {string} title
 * @param {object[]} options    From rollOptionsFor (locked ones are listed but can't be turned off)
 * @param {object} [config]
 * @param {boolean} [config.situational=true]  Offer the favorable/unfavorable buttons
 * @param {number} [config.pmLimit]            Most PM for one action
 * @returns {Promise<{selected: Set<string>, pm: Record<string, number>, split: Record<string, {attack: number, damage: number}>, bonus: number}|null>}
 */
export async function askOptions(title, options, { situational = true, pmLimit = Infinity, hint = "" } = {}) {
  const rows = options.map(opt => {
    const checked = opt.auto || opt.locked ? "checked" : "";
    const disabled = opt.locked ? "disabled" : "";
    let pmInput = "";
    if (opt.pm) {
      const max = Math.min(opt.pm.max ?? pmLimit, pmLimit);
      pmInput = `<span class="ij-opt-pm"><input type="number" name="pm-${esc(opt.id)}" value="0" min="0" max="${max}" step="1"> PM</span>`;
      if (opt.pm.split) {
        pmInput += `<span class="ij-opt-split">${L("IJ.Auto.split")} <input type="number" name="split-${esc(opt.id)}" value="0" min="0" step="1"> ${L("IJ.Auto.tag.attack")}</span>`;
      }
    }
    return `<li class="ij-opt ${opt.locked ? "locked" : ""}">
      <label><input type="checkbox" name="opt" value="${esc(opt.id)}" ${checked} ${disabled}>
        <span class="ij-opt-name">${esc(opt.label)}</span>
        ${opt.itemName && opt.itemName !== opt.label ? `<span class="ij-opt-src">${esc(opt.itemName)}</span>` : ""}
        <span class="ij-opt-tag">${esc(optionTag(opt))}</span></label>${pmInput}</li>`;
  }).join("");
  const content = `<div class="ij-dialog-mod ij-options">
    ${hint ? `<p>${esc(hint)}</p>` : ""}
    ${rows ? `<ul class="ij-opt-list">${rows}</ul>` : ""}
    ${situational ? `<p class="ij-opt-hint">${L("IJ.Roll.situationalHint")}</p>
    <label class="ij-opt-bonus">${L("IJ.Roll.otherBonus")} <input type="number" name="bonus" value="0" step="1"></label>` : ""}
  </div>`;
  const read = (dialog, base) => {
    const el = dialog.element;
    const selected = new Set(options.filter(o => o.locked).map(o => o.id));
    for (const box of el.querySelectorAll("input[name=opt]")) if (box.checked) selected.add(box.value);
    const pm = {};
    const split = {};
    for (const opt of options) {
      if (!opt.pm) continue;
      const n = Math.max(0, Number(el.querySelector(`input[name="pm-${CSS.escape(opt.id)}"]`)?.value) || 0);
      if (n > 0) { pm[opt.id] = n; selected.add(opt.id); }
      if (opt.pm.split) {
        const total = n * (opt.pm.each || 0);
        const a = Math.clamp(Number(el.querySelector(`input[name="split-${CSS.escape(opt.id)}"]`)?.value) || 0, 0, total);
        split[opt.id] = { attack: a, damage: total - a };
      }
    }
    const bonus = base + (Number(el.querySelector("input[name=bonus]")?.value) || 0);
    return { selected, pm, split, bonus };
  };
  const buttons = situational ? [
    { action: "bad", label: L("IJ.Roll.unfavorable"), icon: "fa-solid fa-arrow-down", callback: (e, b, d) => read(d, -2) },
    { action: "normal", label: L("IJ.Roll.normal"), icon: "fa-solid fa-dice-d20", default: true, callback: (e, b, d) => read(d, 0) },
    { action: "good", label: L("IJ.Roll.favorable"), icon: "fa-solid fa-arrow-up", callback: (e, b, d) => read(d, 2) }
  ] : [
    { action: "go", label: L("IJ.Auto.confirm"), icon: "fa-solid fa-check", default: true, callback: (e, b, d) => read(d, 0) }
  ];
  return foundry.applications.api.DialogV2.wait({
    window: { title, icon: "fa-solid fa-dice-d20" },
    classes: ["imperiodejade", "ij-dialog"],
    position: { width: 460 },
    content,
    rejectClose: false,
    buttons
  });
}

/**
 * Pick one option (or a value) for an ability with variants ("Orientação: Aviso, Conselho...").
 * @param {string} title
 * @param {Array<{id: string, label: string, hint?: string}>} choices
 * @param {object} [variable]   { min, max, label } a number to spend (PM, dice)
 * @returns {Promise<{choice: string|null, spent: number}|null>}
 */
export async function askActivation(title, choices = [], variable = null) {
  const list = choices.map((c, i) => `<li><label><input type="radio" name="choice" value="${esc(c.id)}" ${i === 0 ? "checked" : ""}>
    <span class="ij-opt-name">${esc(c.label)}</span>${c.hint ? `<span class="ij-opt-tag">${esc(c.hint)}</span>` : ""}</label></li>`).join("");
  const spend = variable ? `<label class="ij-opt-bonus">${esc(variable.label ?? "PM")}
    <input type="number" name="spent" value="${variable.min ?? 1}" min="${variable.min ?? 0}" max="${variable.max ?? 99}" step="1" autofocus></label>` : "";
  const content = `<div class="ij-dialog-mod ij-options">${list ? `<ul class="ij-opt-list">${list}</ul>` : ""}${spend}</div>`;
  return foundry.applications.api.DialogV2.wait({
    window: { title, icon: "fa-solid fa-hand-sparkles" },
    classes: ["imperiodejade", "ij-dialog"],
    position: { width: 440 },
    content,
    rejectClose: false,
    buttons: [{
      action: "go", label: L("IJ.Auto.use"), icon: "fa-solid fa-hand-sparkles", default: true,
      callback: (e, b, dialog) => {
        const el = dialog.element;
        const choice = el.querySelector("input[name=choice]:checked")?.value ?? null;
        const raw = Number(el.querySelector("input[name=spent]")?.value);
        const spent = variable ? Math.clamp(Number.isFinite(raw) ? raw : (variable.min ?? 0), variable.min ?? 0, variable.max ?? 99) : 0;
        return { choice, spent };
      }
    }]
  });
}
