/**
 * Formulas of the automation data (`system.auto` of items).
 *
 * A value is a number or a string with @references (the actor's roll data plus @rank, @classe and the values of the
 * moment, like @spent), Math functions (floor, ceil, max, min, abs) and three macros:
 *   rank(2, 5, 10, 15)    the value for the ability's rank: how many of its levels the class has reached (rank 1 → 2)
 *   lvl(1:2, 8:4, 14:6)   the value for the class level (the highest threshold reached; 0 below the first)
 *   dice(1d6, 1d8, 2d6)   a dice expression picked by rank (only where a dice formula is expected)
 * rank() and lvl() expand to plain arithmetic, so the same strings also work inside active effects, where Foundry
 * evaluates them with the effect's replacement data (documents/active-effect.mjs adds @rank and @classe).
 */

/** 1 when `ref` is at least `k` (integers), else 0. */
const step = (ref, k) => `min(1, max(0, ${ref} - ${k - 1}))`;

/** [[threshold, value], ...] ascending → v1·step(t1) + (v2 − v1)·step(t2) + ... */
function table(ref, pairs) {
  let prev = 0;
  const terms = [];
  for (const [threshold, value] of pairs) {
    if (!Number.isFinite(threshold) || !Number.isFinite(value)) continue;
    const delta = value - prev;
    if (delta) terms.push(`${delta} * ${step(ref, threshold)}`);
    prev = value;
  }
  return terms.length ? `(${terms.join(" + ")})` : "0";
}

/**
 * Expand rank(), lvl() and from() into arithmetic.
 *   from(5, @int)   the value only from class level 5 on (0 before)
 */
export function expandMacros(expr) {
  return String(expr ?? "")
    .replace(/\brank\(([^()]*)\)/g, (m, args) => table("@rank", args.split(",").map((v, i) => [i + 1, Number(v)])))
    .replace(/\blvl\(([^()]*)\)/g, (m, args) => table("@classe", args.split(",").map(p => p.split(":").map(Number))))
    .replace(/\bfrom\(\s*(\d+)\s*,\s*([^()]+)\)/g, (m, level, inner) => `((${inner}) * ${step("@classe", Number(level))})`);
}

/** Pick dice(...) by rank and dlvl(2:1d4, 8:1d6, ...) by class level. */
function expandDice(expr, data) {
  return String(expr ?? "")
    .replace(/\bdice\(([^()]*)\)/g, (m, args) => {
      const list = args.split(",").map(s => s.trim()).filter(Boolean);
      const rank = Math.max(1, Number(data?.rank) || 1);
      return list[Math.min(rank, list.length) - 1] ?? "0";
    })
    .replace(/\bdlvl\(([^()]*)\)/g, (m, args) => {
      const level = Number(data?.classe) || 1;
      let pick = "0";
      for (const pair of args.split(",")) {
        const [t, v] = pair.split(":").map(s => s.trim());
        if (Number(t) <= level) pick = v;
      }
      return pick;
    });
}

/** Replace @references (missing ones count as 0; true/false, like an open chakra, count as 1/0). */
function replaceData(expr, data) {
  return foundry.dice.Roll.defaultImplementation.replaceFormulaData(String(expr), data ?? {}, { missing: "0" })
    .replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
}

/**
 * A number from a formula. Booleans count as 1/0; anything that fails to evaluate is `fallback`.
 * @param {number|string|boolean|null} expr
 * @param {object} data    Roll data (see context.mjs dataFor)
 * @param {number} [fallback=0]
 */
export function evaluate(expr, data = {}, fallback = 0) {
  if ((expr === null) || (expr === undefined) || (expr === "")) return fallback;
  if (typeof expr === "number") return Number.isFinite(expr) ? expr : fallback;
  if (typeof expr === "boolean") return expr ? 1 : 0;
  try {
    const resolved = replaceData(expandMacros(expandDice(expr, data)), data);
    const value = foundry.dice.Roll.safeEval(resolved);
    return Number.isFinite(value) ? value : fallback;
  } catch (err) {
    console.warn(`imperiodejade | fórmula inválida "${expr}"`, err);
    return fallback;
  }
}

/** An integer from a formula (rounded down, as every rule of the book). */
export function evaluateInt(expr, data = {}, fallback = 0) {
  return Math.floor(evaluate(expr, data, fallback));
}

/**
 * A dice formula ready for a Roll: dice() picked, @references resolved, and "(expression)d6" counts computed
 * ("(@rank)d6" with rank 3 → "3d6"). Plain numbers come back as strings.
 */
export function resolveFormula(expr, data = {}) {
  if ((expr === null) || (expr === undefined) || (expr === "")) return "";
  if (typeof expr === "number") return String(expr);
  let out = replaceData(expandMacros(expandDice(expr, data)), data);
  // "(1 + 2)d6" → "3d6" (balanced parentheses, so expanded macros inside work too)
  out = countDice(out);
  // A dice-free expression is computed now ("2 * 3" → "6")
  if (!/d\d/i.test(out)) {
    try {
      const n = foundry.dice.Roll.safeEval(out);
      if (Number.isFinite(n)) return String(Math.floor(n));
    } catch { /* keep the text */ }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Compute every "(expression)dN" dice count, innermost parentheses included. */
function countDice(text) {
  let out = text;
  for (let guard = 0; guard < 20; guard++) {
    const m = /\)d(\d+)/.exec(out);
    if (!m) break;
    // Walk back to the "(" that opens the group before "d"
    let depth = 0;
    let start = -1;
    for (let i = m.index; i >= 0; i--) {
      if (out[i] === ")") depth++;
      else if (out[i] === "(") { depth--; if (depth === 0) { start = i; break; } }
    }
    if (start < 0) break;
    const inner = out.slice(start + 1, m.index);
    let n;
    try { n = Math.max(0, Math.floor(foundry.dice.Roll.safeEval(inner))); } catch { break; }
    out = `${out.slice(0, start)}${n}d${m[1]}${out.slice(m.index + m[0].length)}`;
  }
  return out;
}

/** Whether a formula has dice in it (after resolving). */
export const hasDice = formula => /\d*d\d/i.test(String(formula ?? ""));

/** "+3", "−2" for chat labels. */
export function signedValue(n) {
  const v = Number(n) || 0;
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}
