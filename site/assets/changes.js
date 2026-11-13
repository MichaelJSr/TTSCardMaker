// The card dialog's and the tiles' share of the Changes page (the Edited badge, its tip, the archive tags People shows);
// the tabs' renderers are changelog.js, loaded with a tab's data (app.js loadChangelog). DOM-free.
import { esc } from "./text.js";

export const FIELD = { hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", stars: "stars", name: "title", card_type: "kind", type: "kind", subtype: "item type",
  dup_of: "duplicate of", problems_ok: "parser notes checked", allow_high_stats: "high stats allowed", names_ok: "names differ on purpose", art: "artwork sources",
  ability_art: "ability artwork source" };   // October changelog lines
/** A field's name as the Changes page writes it (profile.js) */
export const fieldName = k => FIELD[k] || k.replace(/_/g, " ");
export const BOT = "AutoCroissant";                       // the bot's _by (build_site.BOT_AUTHOR): nobody's edit
export const isBot = name => String(name || "").toLowerCase() === BOT.toLowerCase();
/** The fields of a card's Card Edits.json entry its editor (editBy) changed: none in the bot's own entries, and not the
    fields in the entry's _bot (botEdited: the 2026-10-22 migration's) */
export const editorFields = c => (!c?.edited || isBot(c.editBy) ? [] : c.edited.filter(f => !(c.botEdited || []).includes(f)));
/** A card's edits by editor, [{by, at, fields}]: the entry's editor (editorFields), never the bot */
export function fieldEditors(c) {
  const mine = editorFields(c);
  return mine.length ? [{ by: c.editBy || "", at: c.editAt || "", fields: mine }] : [];
}
/** The Edited badge's tooltip: the editor's fields, name and day */
export function editedTip(c) {
  const line = r => `${r.fields.join(", ")}${r.by ? ` · ${r.by}` : ""}${r.at ? ` · ${r.at.slice(0, 10)}` : ""}`;
  return `Changed on the website: ${fieldEditors(c).map(line).join("; ")}`;
}
/** Does the chosen tab take the focus after a redraw? Only when a tab had it from the keyboard (:focus-visible): a
    mouse click hands it none, so no focus ring */
export function keepsTabFocus(el) {
  if (!el?.closest?.(".change-tabs")) return false;
  return el.matches(":focus-visible");
}
export const folder = p => String(p || "").split("/").slice(0, -1).join("/");
// an archived card's tag: [key, label]
export const ARCHIVE_TAGS = [["renamed", "Renamed"], ["retired", "Retired"], ["unfinished", "Unfinished"], ["deleted", "Deleted"]];
/** The tag's key from the fields (renamed_to, moved_to: its PSD moved into MDW) */
export const archiveTag = r => (r.renamed_to ? "renamed"
  : (r.moved_to || "").startsWith("MDW/Unfinished/") ? "unfinished" : r.moved_to ? "retired" : "deleted");
/** The tag as a pill; its tip: where the PSD was (and went) */
export function archiveTagHtml(r) {
  const t = archiveTag(r), label = ARCHIVE_TAGS.find(([k]) => k === t)[1];
  const tip = r.moved_to ? `${r.path ? `${r.path} → ` : "Moved to "}${folder(r.moved_to) || r.moved_to}` : r.path || "";   // no path: a person's rows
  return `<span class="fact arch ${t}"${tip ? ` data-tip="${esc(tip)}"` : ""}>${label}</span>`;
}
