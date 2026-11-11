// Card flags: what a card needs from a developer. checks: {"hand": "note", "bars": "note", "name": "note"}, the bot's
// automatic ones (the card data's card_checks.json), each with its note. flags: a person's (Card Edits.json {"hand": "reason",
// "bars": "", "psd": "1a2b3c4d"}), each with a reason (a hand flag must have one); psd: the PSD blob it was set on, it goes once the
// PSD changes and the checks are clean. Database only, never baked. Flags only filter (owner 2026-11-11): nothing on a card's
// page or its preview, the lists their labels alone. NOTES.md §46, §52, §53.
import { esc } from "./text.js";

export const FLAG_MAX = 300;                           // characters a reason (build_site FLAG_MAX, the bot's card_edits.FLAG_MAX)
// [key, label]: build_site FLAGS, the bot's card_edits.FLAGS
export const CARD_FLAGS = [["hand", "Needs doing by hand"], ["bars", "Special stat bars"], ["name", "Names differ"]];
export const flagLabel = k => CARD_FLAGS.find(([f]) => f === k)?.[1] || k;
export const ownFlag = (c, k) => typeof c.flags?.[k] === "string";      // a person's: the one an editor changes
export const hasFlag = (c, k) => ownFlag(c, k) || !!c.checks?.[k];
export const flagged = c => CARD_FLAGS.some(([k]) => hasFlag(c, k));
/** Flags as an entry stores them: known keys in order, whitespace collapsed, the PSD they were set on last; null for none. */
export function cleanFlags(v) {
  const out = {};
  for (const [k] of CARD_FLAGS) if (typeof v?.[k] === "string") out[k] = v[k].replace(/\s+/g, " ").trim();
  if (!Object.keys(out).length) return null;
  if (v.psd) out.psd = v.psd;
  return out;
}
/** flags with k's reason set on PSD blob psd, null clearing the flag. */
export const withFlag = (flags, k, reason, psd) => cleanFlags({ ...flags, [k]: reason, psd });
/** The flags' error ("" when fine): a hand flag says what its issue is (owner 11-07); at most FLAG_MAX characters a reason, an emoji counting one (Python's len). */
export const flagError = flags => { const k = CARD_FLAGS.find(([f]) => [...(flags?.[f] || "")].length > FLAG_MAX);
  return flags?.hand === "" ? `${flagLabel("hand")}: say what the issue is` : k ? `${k[1]}: at most ${FLAG_MAX} characters` : ""; };
/** "Needs doing by hand: the reason; Special stat bars" ("" for none). */
export const flagsText = flags => CARD_FLAGS.filter(([k]) => typeof flags?.[k] === "string").map(([k, l]) => (flags[k] ? `${l}: ${flags[k]}` : l)).join("; ");
/** What changed from flags a to b: "Special stat bars cleared; Needs doing by hand: the reason". */
export const flagsChange = (a, b) => CARD_FLAGS.filter(([k]) => a?.[k] !== b?.[k]).map(([k, l]) => (typeof b?.[k] !== "string" ? `${l} cleared` : b[k] ? `${l}: ${b[k]}` : l)).join("; ");
/** A card's flags as labels (the Needs handling list); "" when it has none. No note: flags only filter, and a card's page and its preview show none. */
export const flagsHtml = c => (flagged(c) ? `<div class="card-flags">${CARD_FLAGS.filter(([k]) => hasFlag(c, k)).map(([, l]) =>
  `<div class="card-flag"><b>${esc(l)}</b></div>`).join("")}</div>` : "");
// the name flag's "intended" (owner 2026-11-11): Card Edits names_ok, [website name, printed title, file stem] as a person
// marked them; the checks leave the flag off until one changes (the bot's card_checks.name_note, card_edits.NAMES_OK)
export const fileStem = c => (c.psd || "").split("/").pop().replace(/\.psd$/i, "");
/** The printed title: the PSD's under a website name, else the name shown. */
export const printedName = c => (c.edited?.includes("name") ? c.orig?.name ?? c.name : c.name);
/** names_ok's value for card c (b: its published card) with the website name `name`. */
export const namesNow = (c, b = c, name = c.name) => [name, printedName(b), fileStem(b)];
/** Whether c's names are as a person marked them intended. */
export const namesOk = (c, b = c) => Array.isArray(c.names_ok) && JSON.stringify(c.names_ok) === JSON.stringify(namesNow(c, b));
