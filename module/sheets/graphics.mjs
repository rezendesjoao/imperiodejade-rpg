/**
 * The drawings of the character sheet, as numbers for its templates: the katana that measures Honor and the lotus of
 * the six chakras. Pure functions (no Foundry), so the geometry can be checked outside the game.
 */

const round = n => Math.round(n * 10) / 10;
const clamp01 = n => Math.min(1, Math.max(0, n));
const pt = (x, y) => `${round(x)},${round(y)}`;

/* -------------------------------------------- */
/*  The katana of Honor                         */
/* -------------------------------------------- */

/** The drawing board of the katana (an SVG viewBox). */
export const KATANA = {
  width: 1000, top: 8, height: 78,
  // The whole sword follows one shallow curve (edge down): the ends sit `sag` above the middle
  base: 34, sag: 9,
  hilt: [12, 138], guard: [140, 149], collar: [149, 164],
  // Where the blade carries the scale of Honor (0 to `max`), and where its point ends
  scale: [176, 946], max: 25, yokote: 952, tip: 992
};

/** Height of the sword's center line at x. */
const center = x => KATANA.base + (KATANA.sag * (1 - (((x - 500) / 500) ** 2)));

/** Half the thickness of the blade at x: it thins towards the point. */
const half = x => 8.6 - (2.2 * clamp01((x - KATANA.collar[1]) / (KATANA.yokote - KATANA.collar[1])));

/** Sample a curve as a polyline. */
function sample(from, to, fn, step = 12) {
  const points = [];
  for (let x = from; x < to; x += step) points.push(pt(x, fn(x)));
  points.push(pt(to, fn(to)));
  return points;
}

/** Where a score of Honor falls on the blade. */
export function honorX(score) {
  const [from, to] = KATANA.scale;
  return from + ((to - from) * clamp01(score / KATANA.max));
}

/**
 * Everything the template draws of the katana.
 * @param {number} score               The Honor score
 * @param {{min: number, key: string, label: string}[]} tiers   Measures of Honor, lowest first (min of the lowest: 0)
 */
export function katana(score, tiers) {
  const { hilt, guard, collar, yokote, tip } = KATANA;
  const top = x => center(x) - half(x);
  const bottom = x => center(x) + half(x);

  // Blade: along the back to the point, then back along the edge (the point sits on the back, the edge curves up to it)
  const tipY = top(tip) + 1.2;
  const blade = `M${sample(collar[1], yokote, top).join(" L")} L${pt(tip, tipY)} `
    + `C${pt(tip - 8, tipY + 6)} ${pt(yokote + 16, bottom(yokote) - .6)} ${pt(yokote, bottom(yokote))} `
    + `L${sample(collar[1], yokote, bottom).reverse().join(" L")} Z`;
  // The ridge (shinogi) and the temper line (hamon), which waves near the edge
  const ridge = `M${sample(collar[1] + 2, yokote, x => center(x) - (half(x) * .32)).join(" L")}`;
  const hamonY = x => center(x) + (half(x) * .42) + (1.1 * Math.sin(x / 7.5)) + (.7 * Math.sin(x / 2.9));
  const hamon = `M${sample(collar[1] + 2, yokote, hamonY, 4).join(" L")} `
    + `L${sample(collar[1] + 2, yokote, x => bottom(x) - .5).reverse().join(" L")} Z`;

  // Hilt: the wrapped grip with its diamonds, the pommel cap, the guard seen from the side and the collar
  const grip = x => 8.8 - (.6 * clamp01((x - hilt[0]) / (hilt[1] - hilt[0])));
  const hiltPath = `M${sample(hilt[0], hilt[1], x => center(x) - grip(x), 14).join(" L")} `
    + `L${sample(hilt[0], hilt[1], x => center(x) + grip(x), 14).reverse().join(" L")} Z`;
  const diamonds = [];
  for (let x = hilt[0] + 17; x < hilt[1] - 6; x += 12.4) {
    const y = center(x);
    diamonds.push(`M${pt(x - 4.6, y)} L${pt(x, y - 4.4)} L${pt(x + 4.6, y)} L${pt(x, y + 4.4)} Z`);
  }
  const cap = { x: hilt[0] - 4, y: round(center(hilt[0]) - 9.6), w: 9, h: 19.2 };
  const guardBox = { x: guard[0], y: round(center(guard[0]) - 21), w: guard[1] - guard[0], h: 42 };
  const collarPath = `M${pt(collar[0], center(collar[0]) - 10)} L${pt(collar[1], top(collar[1]) - .4)} `
    + `L${pt(collar[1], bottom(collar[1]) + .4)} L${pt(collar[0], center(collar[0]) + 10)} Z`;

  // The scale: one mark where each measure begins, the names between the marks
  const marks = [];
  const names = [];
  const current = [...tiers].reverse().find(t => score >= t.min) ?? tiers[0];
  tiers.forEach((tier, i) => {
    const from = Math.max(0, tier.min);
    const to = tiers[i + 1]?.min ?? KATANA.max;
    const x = honorX(from);
    if (i > 0) {
      const y = bottom(x);
      marks.push({ x: round(x), y1: round(top(x) + 1.6), y2: round(y - 1.6), y3: round(y + 4), y4: round(y + 9), y5: round(y + 19), value: from });
    }
    const name = { label: tier.label, key: tier.key, current: tier.key === current.key, anchor: "" };
    if (i === tiers.length - 1) {
      // The highest measure is a short stretch at the point: its name ends where the blade ends
      names.push({ ...name, x: tip - 2, y: round(bottom(yokote) + 27), anchor: "end" });
    } else if (to - from > 1) {
      const mid = honorX((from + to) / 2);
      names.push({ ...name, x: round(mid), y: round(bottom(mid) + 27) });
    } else if (name.current) {
      // The lowest measure is one point wide: its name shows only when it is the character's, under the hilt
      const mid = (hilt[0] + hilt[1]) / 2;
      names.push({ ...name, x: round(mid), y: round(center(mid) + 36) });
    }
  });

  const x = honorX(score);
  const by = top(x) - 7;
  return {
    viewBox: `0 ${KATANA.top} ${KATANA.width} ${KATANA.height}`,
    blade, ridge, hamon, hilt: hiltPath, diamonds: diamonds.join(" "), cap, guard: guardBox, collar: collarPath,
    yokote: { x: yokote, y1: round(top(yokote) + 1), y2: round(bottom(yokote) - 1) },
    marks, names,
    // How far the blade shines, and the bead that marks the score on its back
    shine: round(x),
    bead: {
      x: round(x), y1: round(top(x) - 1.5), y2: round(bottom(x) + 1.5),
      path: `M${pt(x, by - 5)} L${pt(x + 4.6, by)} L${pt(x, by + 5)} L${pt(x - 4.6, by)} Z`
    },
    // A star on the point of a blade that shines whole
    glint: `M${pt(tip - 10, tipY - 9)} l2.2,5.8 l5.8,2.2 l-5.8,2.2 l-2.2,5.8 l-2.2,-5.8 l-5.8,-2.2 l5.8,-2.2 Z`,
    full: score >= KATANA.max
  };
}

/* -------------------------------------------- */
/*  The lotus of the chakras                    */
/* -------------------------------------------- */

/** The drawing board of the lotus. */
export const LOTUS = { width: 440, height: 336, cx: 220, cy: 168, inner: 47, kanji: 89, tip: 131, label: 140 };

/** A petal that points up from the center, from radius `r0` to `r1`, `w` wide at its belly. */
function petal(r0, r1, w) {
  const belly = r0 + ((r1 - r0) * .44);
  return `M0,${-r0} C${round(w * .44)},${-round(r0 + 5)} ${round(w * .64)},${-round(belly)} 0,${-r1} `
    + `C${-round(w * .64)},${-round(belly)} ${-round(w * .44)},${-round(r0 + 5)} 0,${-r0} Z`;
}

/** Where each chakra sits around the lotus, clockwise from the top: spirit above, legs below, as on a seated body. */
export const LOTUS_ORDER = ["sab", "int", "for", "des", "con", "car"];

/**
 * The six petals with what each one shows.
 * @param {Object<string, object>} chakras   key → what the template needs of that chakra (label, kanji, open...)
 * @param {{value: number, max: number}} pm
 */
export function lotus(chakras, pm = { value: 0, max: 0 }) {
  const { cx, cy, inner, kanji, tip, label } = LOTUS;
  const petals = LOTUS_ORDER.map((key, i) => {
    const angle = i * 60;
    const rad = (angle - 90) * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Names go beyond the tip: above and below for the two on the axis, to the side for the others
    const side = Math.abs(cos) < .01 ? "middle" : (cos > 0 ? "start" : "end");
    const lx = cx + (label * cos) + (side === "start" ? 3 : side === "end" ? -3 : 0);
    const ly = cy + (label * sin) + (side === "middle" ? (sin < 0 ? -5 : 16) : (sin < 0 ? -2 : 12));
    return {
      key, angle, ...chakras[key],
      kx: round(cx + (kanji * cos)), ky: round(cy + (kanji * sin) + 10.5),
      lx: round(lx), ly: round(ly), side
    };
  });
  // The ring around the heart of the flower empties as the PM are spent
  const r = inner - 7;
  const circumference = 2 * Math.PI * r;
  const pct = pm.max ? clamp01(pm.value / pm.max) : 0;
  return {
    viewBox: `0 0 ${LOTUS.width} ${LOTUS.height}`, cx, cy, inner,
    petal: petal(inner + 3, tip, 76),
    back: petal(inner + 12, tip + 15, 94),
    backs: [30, 90, 150, 210, 270, 330],
    petals,
    ring: { r, dash: `${round(circumference * pct)} ${round(circumference)}` }
  };
}
