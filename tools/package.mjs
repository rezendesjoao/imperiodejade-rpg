/**
 * Release package: dist/imperiodejade.zip with what Foundry needs (manifest, license, code, templates, styles,
 * languages, assets) and a copy of system.json next to it, for the GitHub release.
 *
 *   node tools/package.mjs
 *   gh release create vX.Y.Z dist/system.json dist/imperiodejade.zip --repo rezendesjoao/imperiodejade-rpg ...
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, manifest.id);
const FILES = ["system.json", "LICENSE", "CREDITOS.md", "README.md", "module", "templates", "styles", "lang", "assets", "packs"];

// The download must be this version's zip on the GitHub release
const expected = `https://github.com/rezendesjoao/imperiodejade-rpg/releases/download/v${manifest.version}/${manifest.id}.zip`;
if (manifest.download !== expected) throw new Error(`system.json "download" should be ${expected}`);

// Every compendium of the manifest, compiled (npm run build)
for (const pack of manifest.packs ?? []) {
  if (!fs.existsSync(path.join(ROOT, pack.path, "CURRENT"))) throw new Error(`${pack.path} não foi compilado: npm run build`);
}

fs.rmSync(DIST, { recursive: true, force: true });
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) throw new Error(`Missing ${f}`);
  fs.cpSync(src, path.join(STAGE, f), { recursive: true, filter: file => path.basename(file) !== "LOCK" });
}
const zip = path.join(DIST, `${manifest.id}.zip`);
// Windows' own tar (bsdtar) writes a real zip with forward slashes; tar -a picks the format from the extension
const tar = (process.platform === "win32") ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-a", "-c", "-f", path.relative(STAGE, zip), ...FILES], { cwd: STAGE, stdio: "inherit" });
fs.copyFileSync(path.join(STAGE, "system.json"), path.join(DIST, "system.json"));
fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`${path.relative(ROOT, zip)}: ${(fs.statSync(zip).size / 1024).toFixed(0)} KB (${manifest.id} ${manifest.version})`);
