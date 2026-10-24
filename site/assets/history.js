// A card's text over time on its page (app.js): the History block, the image versions' "Text then", the Recently updated
// feed's diff, and the site's dates. Dates are Pacific time, the bot's TIMEZONE (balance.js, changes.js, /query as_of),
// so every viewer sees the same day. DOM-free: every function returns HTML or data.
import { esc, diffWords, dateFmt } from "./text.js";

export const TZ = "America/Los_Angeles";
/** "Oct 21, 2026" in Pacific time */
const DATE = dateFmt({ year: "numeric", month: "short", day: "numeric", timeZone: TZ }), MONTH = dateFmt({ year: "numeric", month: "short", timeZone: TZ });
export const date = ts => (ts ? DATE(new Date(ts * 1000)) : "");
/** "Oct 2026" in Pacific time */
export const month = ts => (ts ? MONTH(new Date(ts * 1000)) : "");
const ym = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", timeZone: TZ });
/** "2026-10" in Pacific time */
export const monthKey = ts => { const p = Object.fromEntries(ym.formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value])); return `${p.year}-${p.month}`; };
const ymd = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });
/** "2026-10-21" in Pacific time */
export const dayOf = ts => { const p = Object.fromEntries(ymd.formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
/** "2026" in Pacific time */
export const yearOf = ts => dayOf(ts).slice(0, 4);

/** When the current text started (build_site since: the bot's carried start), else the last PSD commit (ts) */
export const textSince = c => c.since ?? c.ts;
/** Did the card's last PSD commit change its text? Not when the text is older (that commit changed the art or stats only) */
export const textChanged = c => !(c.since && c.ts && c.since < c.ts);
/** The texts oldest first (history.json's), the current one dated by textSince */
const textsOf = c => (c.history || []).concat(c.ability ? [{ ts: textSince(c), ability: c.ability, current: true }] : []);
/** The text at an image version's commit time: the latest text at or before it (an hour's slack), else null */
export function textAt(c, ts) {
  const then = textsOf(c).filter(t => t.ts && t.ts <= ts + 3600);
  return then.length ? then[then.length - 1].ability : null;
}
/** The History block: each text, newest first, its changes from the one before highlighted ("" with one text or none) */
export function historyHtml(c) {
  if (!c.hv) return "";
  if (!c.history) return `<h3>History</h3><p class="muted">Loading ${c.hv} earlier version${c.hv > 1 ? "s" : ""}…</p>`;
  const versions = textsOf(c);
  if (versions.length < 2) return "";
  return `<h3>History</h3><div class="history">${versions.slice().reverse().map((v, k, arr) => `<div class="ver"><div class="muted">${v.current ? "Current" : "Earlier"}${v.ts ? ` · ${date(v.ts)}` : ""}</div>
    <div>${k < arr.length - 1 ? diffWords(arr[k + 1].ability, v.ability) : esc(v.ability).replace(/\n/g, "<br>")}</div></div>`).join("")}</div>`;
}
