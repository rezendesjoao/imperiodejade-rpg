/**
 * Pieces of page the creation and level-up wizards share: the rich tooltip, the rows of the feat and jutsu lists
 * (templates/creation/feats.hbs and jutsus.hbs), a picked feat with its choice, and the lists the texts of the choices
 * offer.
 */
import { SKILLS } from "../config.mjs";
import { checkPrerequisites, prerequisitesFail } from "./rules.mjs";
import { whoFor } from "./plan.mjs";

const L = key => game.i18n.localize(key);
const W = key => L(`IJ.Wizard.${key}`);
const WF = (key, data) => game.i18n.format(`IJ.Wizard.${key}`, data);
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

/** A rich tooltip: a picture, a name, a line and a text. */
export function tipHtml({ name, img, meta = "", html = "", text = "" }) {
  return `<div class="ij-wz-tipbox">${img ? `<img src="${escape(img)}" alt="">` : ""}<div><strong>${escape(name)}</strong>`
    + `${meta ? `<em>${escape(meta)}</em>` : ""}</div></div>${html ? `<div class="ij-wz-tiptext">${html}</div>` : (text ? `<p>${escape(text)}</p>` : "")}`;
}

/** The names the texts of the choices offer: weapons, skills, jutsus. */
export function choiceLists(catalog) {
  return {
    weaponNames: catalog.weaponNames,
    skillNames: Object.values(SKILLS).map(s => L(s.label)),
    jutsuNames: catalog.jutsus.map(j => j.name)
  };
}

/**
 * A feat in its pool: its problems and the choice it asks (a list of options or a text). `taken`: options another copy
 * of the feat already has (they can't be chosen again).
 */
export function featPickView({ pick, feat, problems }, catalog, taken = new Set()) {
  const choice = feat?.choice ?? null;
  const options = choice?.options ?? [];
  const count = choice ? Math.max(1, Number(choice.count) || 1) : 0;
  return {
    key: pick.key, uuid: pick.uuid, name: feat?.name ?? "—", img: feat?.img, problems, ok: !problems.length,
    tip: feat ? tipHtml({ name: feat.name, img: feat.img, meta: feat.categoryLabel, html: feat.html }) : "",
    choice: choice ? {
      label: choice.label ?? "", text: choice.text ?? "", textValue: pick.text ?? "",
      weapons: (choice.text && /arma/i.test(choice.text)) ? catalog.weaponNames : null,
      skills: (choice.text && /per[ií]cia/i.test(choice.text)) ? Object.values(SKILLS).map(s => L(s.label)) : null,
      jutsus: (choice.text && /jutsu/i.test(choice.text)) ? catalog.jutsus.map(j => j.name) : null,
      select: options.length > 6,
      options: options.map(o => {
        const on = (pick.choices ?? []).includes(o.id);
        return { id: o.id, label: o.label ?? o.id, on, taken: !on && taken.has(o.id) };
      }),
      multi: count > 1
    } : null
  };
}

/**
 * The rows of the feat list, each checked against the character (featContext of plan.mjs), and the filter chips.
 * @param {object} options
 * @param {object} options.catalog
 * @param {object} options.ctx                 featContext()
 * @param {Function} options.hasRoom           feat => a pool with room takes it
 * @param {Function} [options.violation]       feat, owned => the violation tag of taking it, or null
 * @param {Set<string>} [options.expanded]     Rows whose text is open
 * @param {string} [options.active]            The filter chip in use
 */
export function featRows({ catalog, ctx, hasRoom, violation = () => null, expanded = new Set(), active = "" }) {
  const cats = new Map();
  const feats = catalog.feats.map(feat => {
    const results = checkPrerequisites(feat.checks, whoFor(ctx, feat, false));
    const owned = ctx.featCounts.get(feat.key) ?? 0;
    let reason = "";
    if (owned && !feat.repeatable) reason = W("Feats.owned");
    else if (prerequisitesFail(results)) reason = W("Feats.blocked");
    else if (feat.honorMin && ((ctx.abilities.hon ?? 0) < feat.honorMin)) reason = WF("Feats.honor", { n: feat.honorMin });
    else if (!hasRoom(feat)) reason = W("Feats.full");
    cats.set(feat.category, { id: feat.category, label: feat.categoryLabel, count: (cats.get(feat.category)?.count ?? 0) + 1 });
    return {
      uuid: feat.uuid, name: feat.name, img: feat.img, category: feat.category, categoryLabel: feat.categoryLabel,
      prereqs: results.map(r => ({ text: r.text, ok: r.ok === true, fail: r.ok === false, unknown: r.ok === null })),
      honorMin: feat.honorMin, cost: feat.cost, owned, html: feat.html, text: feat.text,
      reason, pickable: !reason, available: !prerequisitesFail(results) && !(owned && !feat.repeatable),
      violation: (owned && !feat.repeatable) ? null : violation(feat),
      expanded: expanded.has(feat.uuid),
      search: feat.search
    };
  });
  const filters = [
    { id: "", label: W("Feats.all"), count: feats.length },
    { id: "available", label: W("Feats.available"), count: feats.filter(f => f.available).length },
    ...cats.values()
  ].map(f => ({ ...f, active: f.id === active }));
  return { feats, filters };
}

/**
 * The rows of the jutsu list (the jutsus some pool takes) and the chakra chips.
 * @param {object} options
 * @param {object[]} options.jutsus            Catalog jutsus some pool takes
 * @param {Set<string>} options.owned          Uuids the character already knows
 * @param {Set<string>} options.picked         Uuids picked in the draft
 * @param {Function} options.roomFor           jutsu => a pool with room takes it
 * @param {Function} [options.violation]       jutsu => its violation tag, or null
 * @param {Set<string>} [options.expanded]
 * @param {string} [options.active]
 */
export function jutsuRows({ jutsus, owned, picked, roomFor, violation = () => null, expanded = new Set(), active = "" }) {
  const chakras = new Map();
  const rows = jutsus.map(j => {
    const isPicked = picked.has(j.uuid);
    chakras.set(j.chakra, { id: j.chakra, label: j.chakraLabel, kanji: j.kanji, count: (chakras.get(j.chakra)?.count ?? 0) + 1 });
    let reason = "";
    if (owned.has(j.uuid)) reason = W("Jutsus.owned");
    else if (!isPicked && !roomFor(j)) reason = W("Jutsus.full");
    return {
      ...j, picked: isPicked, reason, pickable: !reason && !isPicked,
      violation: violation(j),
      expanded: expanded.has(j.uuid),
      line: [j.gradeLabel, j.execution, j.range, j.duration, j.resistance].filter(Boolean).join(" · ")
    };
  });
  const filters = [{ id: "", label: W("Jutsus.all"), count: rows.length }, ...chakras.values()].map(f => ({ ...f, active: f.id === active }));
  return { jutsus: rows, filters };
}
