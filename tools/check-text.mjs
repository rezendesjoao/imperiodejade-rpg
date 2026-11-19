/**
 * Copy check: no compendium text may reproduce the book. Compares every description in src/data/*.json (and the short
 * texts of the automation blocks in src/auto, and every interface string of lang/pt-BR.json) with the
 * book's text (extracted from your own PDF; it never goes into the repository) and lists the entries that share a
 * long run of identical words with it.
 *
 *   node tools/check-text.mjs <book.txt> [--min 10] [--json report.json]
 *
 * A run of `--min` (default 10) or more identical consecutive words is reported; short rule phrases ("teste de
 * Reflexos reduz à metade") are expected and stay below that.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "data");
const args = process.argv.slice(2);
const bookPath = args.find(a => !a.startsWith("--"));
if (!bookPath || !fs.existsSync(bookPath)) {
  console.error("Uso: node tools/check-text.mjs <texto-do-livro.txt> [--min 10] [--json saida.json]");
  process.exit(1);
}
const minRun = Number(args[args.indexOf("--min") + 1]) || 10;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const K = 6; // shingle size (words)

/** Lowercase words without accents, hyphenation or punctuation. */
function words(text) {
  return String(text)
    .replace(/­\s*/g, "")                // soft hyphens of the PDF
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")     // words split at the end of a line
    .replace(/<[^>]+>/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const book = words(fs.readFileSync(bookPath, "utf8").replace(/=== PAGE \d+ ===/g, " "));
const shingles = new Set();
for (let i = 0; i + K <= book.length; i++) shingles.add(book.slice(i, i + K).join(" "));

/** Longest run of consecutive words shared with the book, and the share of shingles found in it. */
function compare(text) {
  const w = words(text);
  let longest = 0;
  let run = 0;
  let hits = 0;
  let longestAt = 0;
  for (let i = 0; i + K <= w.length; i++) {
    if (shingles.has(w.slice(i, i + K).join(" "))) {
      hits++;
      run = run ? run + 1 : K;
      if (run > longest) { longest = run; longestAt = i - (run - K); }
    } else run = 0;
  }
  const total = Math.max(1, w.length - K + 1);
  return { longest, ratio: hits / total, sample: w.slice(longestAt, longestAt + longest).join(" "), words: w.length };
}

/** Every text field of an entry, with a label. */
function textsOf(entry) {
  const out = [];
  const push = (label, value) => { if (value && typeof value === "string") out.push([label, value]); };
  push("description", entry.description);
  push("summary", entry.summary);
  push("notes", entry.notes);
  if (Array.isArray(entry.enhancements)) entry.enhancements.forEach((e, i) => push(`enhancement ${i + 1}`, e.text));
  for (const key of ["features", "specials"]) {
    if (Array.isArray(entry[key])) entry[key].forEach(f => push(`${key}: ${f.name}`, f.description));
  }
  return out;
}

const report = [];
for (const file of fs.readdirSync(DATA).filter(f => f.endsWith(".json")).sort()) {
  const entries = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  for (const entry of entries) {
    for (const [label, text] of textsOf(entry)) {
      const r = compare(text);
      if (r.longest >= minRun) report.push({ file, name: entry.name, field: label, longest: r.longest, ratio: Math.round(r.ratio * 100), sample: r.sample });
    }
  }
}
// The automation blocks (src/auto): labels, notes and hints are our own short texts too
const AUTO = path.join(ROOT, "src", "auto");
const autoTexts = (node, where, out) => {
  if (Array.isArray(node)) node.forEach((n, i) => autoTexts(n, where, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if ((typeof v === "string") && ["label", "notes", "note", "hint", "text"].includes(k)) out.push([`${where} · ${k}`, v]);
      else autoTexts(v, where, out);
    }
  }
  return out;
};
if (fs.existsSync(AUTO)) {
  for (const file of fs.readdirSync(AUTO).filter(f => f.endsWith(".json")).sort()) {
    const blocks = JSON.parse(fs.readFileSync(path.join(AUTO, file), "utf8"));
    for (const [key, block] of Object.entries(blocks)) {
      for (const [label, text] of autoTexts(block, key, [])) {
        const r = compare(text);
        if (r.longest >= minRun) report.push({ file, name: key, field: label, longest: r.longest, ratio: Math.round(r.ratio * 100), sample: r.sample });
      }
    }
  }
}
// The interface (lang/pt-BR.json): the rule notes of the wizards and the hints are our own words too
const LANG = path.join(ROOT, "lang", "pt-BR.json");
const langTexts = (node, key) => {
  if (typeof node === "string") {
    const r = compare(node);
    if (r.longest >= minRun) report.push({ file: "pt-BR.json", name: key, field: "lang", longest: r.longest, ratio: Math.round(r.ratio * 100), sample: r.sample });
  } else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) langTexts(v, key ? `${key}.${k}` : k);
};
if (fs.existsSync(LANG)) langTexts(JSON.parse(fs.readFileSync(LANG, "utf8")), "");
report.sort((a, b) => b.longest - a.longest);
for (const r of report) console.log(`${r.file} · ${r.name} · ${r.field}: ${r.longest} palavras seguidas (${r.ratio}%) — "${r.sample}"`);
console.log(`\n${report.length} trecho(s) com ${minRun}+ palavras iguais ao livro.`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exitCode = report.length ? 1 : 0;
