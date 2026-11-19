/**
 * Optional "book text": the original wording of a rule (ability, feat, jutsu, item, creature), supplied by a LOCAL
 * module that each player builds from their own copy of the book. This system ships no book text: it only keeps the
 * texts a module registers and shows them on the sheets.
 *
 * A module registers once, at setup:
 *   game.imperiodejade.bookText.register({ "<compendium uuid>": "<html>", "<type>:<name>": "<html>", ... });
 */
const texts = new Map();

const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A hosted game can't take a new module without a server restart, so the same texts can also come from a JSON file
 * uploaded through the file browser: the world setting "bookTextFile" holds its path and every client reads it at setup.
 */
export function registerBookTextSetting() {
  game.settings.register("imperiodejade", "bookTextFile", {
    name: "IJ.BookText.setting",
    hint: "IJ.BookText.settingHint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    filePicker: "any",
    requiresReload: true
  });
}

export async function loadBookTextFile() {
  const path = game.settings.get("imperiodejade", "bookTextFile");
  if (!path) return;
  try {
    const response = await fetch(foundry.utils.getRoute(path.replace(/^\/+/, "")));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    bookText.register(await response.json());
    console.log(`imperiodejade | ${bookText.size} textos do livro carregados de ${path}`);
  } catch (err) {
    console.warn(`imperiodejade | não foi possível ler o texto do livro em ${path}:`, err);
  }
}

export const bookText = {
  /** Add (or replace) texts, keyed by compendium uuid or by "type:name". */
  register(entries = {}) {
    for (const [key, html] of Object.entries(entries)) {
      if (typeof html !== "string" || !html) continue;
      texts.set(key.includes(":") && !key.startsWith("Compendium.") ? `${key.split(":")[0]}:${norm(key.slice(key.indexOf(":") + 1))}` : key, html);
    }
    Hooks.callAll("imperiodejade.bookTextReady", texts.size);
  },

  /** How many texts are registered (0 without the local module). */
  get size() {
    return texts.size;
  },

  /**
   * The text of a document: by the compendium it came from, then by type and name.
   * @param {Item|Actor} doc
   * @returns {string|null} HTML
   */
  of(doc) {
    if (!texts.size || !doc) return null;
    const sources = [
      doc.pack ? doc.uuid : null,
      doc._stats?.compendiumSource,
      doc.flags?.imperiodejade?.sourceUuid
    ].filter(Boolean);
    for (const uuid of sources) if (texts.has(uuid)) return texts.get(uuid);
    return texts.get(`${doc.type}:${norm(doc.name)}`) ?? null;
  }
};
