/**
 * Compile the compendium sources (src/packs/<pack>/*.json, made by tools/build-data.mjs) into the LevelDB packs that
 * Foundry reads (packs/<pack>). Foundry must not have the packs open: close the world (or the server) first.
 *
 *   node tools/build-data.mjs && node tools/packs.mjs build
 *
 * Uses @foundryvtt/foundryvtt-cli from this repository's node_modules (npm install) or, if missing, from a sibling
 * checkout given by FVTT_CLI (path to the package folder).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "packs");
const DEST = path.join(ROOT, "packs");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));

async function loadCli() {
  const candidates = [
    path.join(ROOT, "node_modules", "@foundryvtt", "foundryvtt-cli", "index.mjs"),
    process.env.FVTT_CLI && path.join(process.env.FVTT_CLI, "index.mjs"),
    path.resolve(ROOT, "..", "..", "Eternia", "eternia", "node_modules", "@foundryvtt", "foundryvtt-cli", "index.mjs")
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return import(pathToFileURL(c).href);
  throw new Error("@foundryvtt/foundryvtt-cli não encontrado: rode npm install (ou defina FVTT_CLI)");
}

const { compilePack } = await loadCli();
for (const pack of manifest.packs) {
  const src = path.join(SRC, pack.name);
  if (!fs.existsSync(src)) {
    console.warn(`- ${pack.name}: sem fontes`);
    continue;
  }
  const dest = path.join(DEST, pack.name);
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(src, dest, { recursive: true, log: false });
  console.log(`+ ${pack.name}`);
}
