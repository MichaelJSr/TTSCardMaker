// Card flags (Card Edits.json flags: {"hand": "reason", "bars": ""}): what a card needs from a developer, each with an
// optional reason. Database only, never baked. NOTES.md §46.
import { linked } from "./art.js";
import { esc } from "./text.js";

export const FLAG_MAX = 300;                           // characters a reason (build_site FLAG_MAX, the bot's card_edits.FLAG_MAX)
// [key, label]: build_site FLAGS, the bot's card_edits.FLAGS
export const CARD_FLAGS = [["hand", "Needs doing by hand"], ["bars", "Special stat bars"]];
export const flagLabel = k => CARD_FLAGS.find(([f]) => f === k)?.[1] || k;
export const hasFlag = (c, k) => typeof c.flags?.[k] === "string";
export const flagged = c => CARD_FLAGS.some(([k]) => hasFlag(c, k));
/** Flags as an entry stores them: known keys in order, whitespace collapsed; null for none. */
export function cleanFlags(v) {
  const out = {};
  for (const [k] of CARD_FLAGS) if (typeof v?.[k] === "string") out[k] = v[k].replace(/\s+/g, " ").trim();
  return Object.keys(out).length ? out : null;
}
/** flags with k's reason set, null clearing the flag. */
export const withFlag = (flags, k, reason) => cleanFlags({ ...flags, [k]: reason });
/** The flags' error ("" when fine): at most FLAG_MAX characters a reason, an emoji counting one (Python's len). */
export const flagError = flags => { const k = CARD_FLAGS.find(([f]) => [...(flags?.[f] || "")].length > FLAG_MAX);
  return k ? `${k[1]}: at most ${FLAG_MAX} characters` : ""; };
/** "Needs doing by hand: the reason; Special stat bars" ("" for none). */
export const flagsText = flags => CARD_FLAGS.filter(([k]) => typeof flags?.[k] === "string").map(([k, l]) => (flags[k] ? `${l}: ${flags[k]}` : l)).join("; ");
/** What changed from flags a to b: "Special stat bars cleared; Needs doing by hand: the reason". */
export const flagsChange = (a, b) => CARD_FLAGS.filter(([k]) => a?.[k] !== b?.[k]).map(([k, l]) => (typeof b?.[k] !== "string" ? `${l} cleared` : b[k] ? `${l}: ${b[k]}` : l)).join("; ");
/** A card's flag lines (data-flag: its key, inline.js edits the reason in place); "" when it has none. */
export const flagsHtml = c => (flagged(c) ? `<div class="card-flags">${CARD_FLAGS.filter(([k]) => hasFlag(c, k)).map(([k, l]) =>
  `<div class="card-flag"><b>${esc(l)}</b><span class="flag-why" data-flag="${k}">${linked(c.flags[k])}</span></div>`).join("")}</div>` : "");
