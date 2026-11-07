// Card flags: what a card needs from a developer. checks: {"hand": "note", "bars": "note"}, the bot's automatic ones (the
// card data's card_checks.json), each with its note. flags: a person's (Card Edits.json {"hand": "reason", "bars": "",
// "psd": "1a2b3c4d"}), each with an optional reason; psd: the PSD blob it was set on, it goes once the PSD changes and the
// checks are clean. Database only, never baked. NOTES.md §46.
import { linked } from "./art.js";
import { esc } from "./text.js";

export const FLAG_MAX = 300;                           // characters a reason (build_site FLAG_MAX, the bot's card_edits.FLAG_MAX)
// [key, label]: build_site FLAGS, the bot's card_edits.FLAGS
export const CARD_FLAGS = [["hand", "Needs doing by hand"], ["bars", "Special stat bars"]];
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
/** The flags' error ("" when fine): at most FLAG_MAX characters a reason, an emoji counting one (Python's len). */
export const flagError = flags => { const k = CARD_FLAGS.find(([f]) => [...(flags?.[f] || "")].length > FLAG_MAX);
  return k ? `${k[1]}: at most ${FLAG_MAX} characters` : ""; };
/** "Needs doing by hand: the reason; Special stat bars" ("" for none). */
export const flagsText = flags => CARD_FLAGS.filter(([k]) => typeof flags?.[k] === "string").map(([k, l]) => (flags[k] ? `${l}: ${flags[k]}` : l)).join("; ");
/** What changed from flags a to b: "Special stat bars cleared; Needs doing by hand: the reason". */
export const flagsChange = (a, b) => CARD_FLAGS.filter(([k]) => a?.[k] !== b?.[k]).map(([k, l]) => (typeof b?.[k] !== "string" ? `${l} cleared` : b[k] ? `${l}: ${b[k]}` : l)).join("; ");
/** A card's flag lines: the checks' note, then a person's reason (data-flag: its key, inline.js edits it in place); "" when it has none. */
export const flagsHtml = c => (flagged(c) ? `<div class="card-flags">${CARD_FLAGS.filter(([k]) => hasFlag(c, k)).map(([k, l]) =>
  `<div class="card-flag"><b>${esc(l)}</b>${c.checks?.[k] ? `<span class="flag-note">${esc(c.checks[k])}</span>` : ""}${ownFlag(c, k) ? `<span class="flag-why" data-flag="${k}">${linked(c.flags[k])}</span>` : ""}</div>`).join("")}</div>` : "");
