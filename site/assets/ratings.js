// Card ratings: favorability and power, 1 to 10, dated (site/Card Ratings.json, as cards.json `ratings`). Pure helpers
// for the card page, Stats and People; build_site.py rating_now and tier_of are the Python twins. NOTES.md §25.
import { esc } from "./text.js";

export const SCALES = [["favorability", "Favorability", "How much players like this card, 1 to 10"],
  ["power", "Power", "How strong players find it: 1 weak, 5.5 balanced, 10 too strong"]];
// the TTS boards' category labels (the import matches the saves' own, "Plz buff :(" included)
export const TIERS = { power: ["Plz buff", "Below Average", "Balens", "Above Average", "Too Stronk"],
  favorability: ["Pain", "Dislike", "Bogstandard", "Like", "Nut on you"] };
/** A value's category 0-4: edges 2.5, 4.5, 6.5, 8.5 (bands 1-2, 3-4, …). */
export const tierOf = v => Math.max(0, Math.min(4, Math.floor((v - 0.5) / 2)));
const round1 = v => Math.round(v * 10) / 10;
const skipSet = skip => new Set(skip == null ? [] : typeof skip === "string" ? [skip] : [...skip]);
let fmt = null;                                   // one formatter, made on first use
export const dayLabel = ymd => (fmt ||= new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })).format(new Date(`${ymd}T12:00:00Z`));

/** by -> that rater's latest entry of scale (on or before day; skip: a rater or raters left out). The list is oldest
 *  first, so a later entry of the same date replaces. "group" is one rater. */
export function latestBy(list = [], scale, { day = null, skip = null } = {}) {
  const out = new Map(), no = skipSet(skip);
  for (const e of list || []) {
    if (e.scale !== scale || (day && e.date > day) || no.has(e.by)) continue;
    const was = out.get(e.by);
    if (!was || e.date >= was.date) out.set(e.by, e);
  }
  return out;
}
/** {value (the mean of each rater's latest, one decimal), raters, date (the newest)} or null. */
export function current(list, scale, opts = {}) {
  const latest = [...latestBy(list, scale, opts).values()];
  if (!latest.length) return null;
  return { value: round1(latest.reduce((s, e) => s + e.value, 0) / latest.length), raters: latest.length,
    date: latest.reduce((d, e) => (e.date > d ? e.date : d), "") };
}
/** The distinct dates of scale's entries, oldest first. */
export const ratingDates = (list, scale) => [...new Set((list || []).filter(e => e.scale === scale).map(e => e.date))].sort();
/** Any card rated by a person (not only the group), published; scale: of that scale only. */
export const hasPersonal = (cards, scale = null) => cards.some(c => (c.ratings || []).some(r => r.by !== "group" && (!scale || r.scale === scale) && !r._staged && !r._sent));

const byText = e => (e.by === "group" ? "group, TTS session" : e._staged || e._sent ? "you, unpublished" : e.by);
/** One scale over time: y fixed 1-10, dots per entry (group filled, a person hollow, unpublished dashed), the line
 *  through each date's consensus (current() as of that day). */
export function chartSvg(list, scale) {
  const rows = (list || []).filter(e => e.scale === scale), [, label] = SCALES.find(([k]) => k === scale) || [scale, scale];
  const W = 260, H = 84, L = 22, R = scale === "power" ? 52 : 12, T = 6, B = 16, ph = H - T - B;
  const dates = ratingDates(rows, scale), t = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const t0 = dates.length ? t(dates[0]) : 0, t1 = dates.length ? t(dates[dates.length - 1]) : 0;
  const X = d => (t1 > t0 ? L + ((t(d) - t0) / (t1 - t0)) * (W - L - R) : (L + W - R) / 2), Y = v => T + ((10 - v) / 9) * ph;
  const grid = [1, 10].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 5}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join("");
  const mid = scale === "power" ? `<line class="mid" x1="${L}" x2="${W - R}" y1="${Y(5.5)}" y2="${Y(5.5)}"/><text class="ax" x="${W - R + 5}" y="${Y(5.5) + 4}">balanced</text>` : "";
  const years = dates.length ? [...new Set([dates[0], dates[dates.length - 1]].map(d => d.slice(0, 4)))] : [];
  const xl = years.length > 1 ? `<text class="ax" x="${L}" y="${H - 3}">${years[0]}</text><text class="ax" x="${W - R}" y="${H - 3}" text-anchor="end">${years[1]}</text>`
    : years.length ? `<text class="ax" x="${X(dates[0])}" y="${H - 3}" text-anchor="middle">${years[0]}</text>` : "";
  const line = dates.length > 1 ? `<path class="line" d="${dates.map((d, i) => `${i ? "L" : "M"}${X(d)},${Y(current(rows, scale, { day: d }).value)}`).join("")}"/>` : "";
  const dots = rows.map(e => { const cls = e.by === "group" ? "end" : "person", un = e._staged || e._sent ? " unpub" : "";
    return `<g data-v="${esc(String(e.value))}" data-l="${esc(`${dayLabel(e.date)} · ${byText(e)}`)}"><circle class="hit" cx="${X(e.date)}" cy="${Y(e.value)}" r="10"/><circle class="${cls}${un}" cx="${X(e.date)}" cy="${Y(e.value)}" r="4"/></g>`; }).join("");
  const aria = `${label} over time: ${rows.map(e => `${e.value} on ${dayLabel(e.date)}`).join(", ")}`;
  return `<svg class="spark rate-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${grid}${mid}${xl}${line}${dots}</svg>`;
}

function panelHtml(list, [scale, label, tip]) {
  const cur = current(list, scale);
  if (!cur) return `<div class="rate-panel"><div class="rate-head" data-tip="${esc(tip)}"><span>${label}</span></div><p class="muted">Not rated yet.</p></div>`;
  const one = cur.raters === 1 ? [...latestBy(list, scale).values()][0] : null;
  const sub = one ? `${one.by === "group" ? "group" : one._staged || one._sent ? "you" : one.by} · ${dayLabel(cur.date)}` : `${cur.raters} raters · latest ${dayLabel(cur.date)}`;
  return `<div class="rate-panel"><div class="rate-head" data-tip="${esc(tip)}"><span>${label}</span> <b>${cur.value}</b><span class="muted">/10 · ${esc(TIERS[scale][tierOf(cur.value)])}</span></div>
    <div class="muted rate-sub">${esc(sub)}</div>${chartSvg(list, scale)}</div>`;
}
/** The card page's Ratings block: "" when the card has none and nobody signed in may add one. editing: the Rate it row,
 *  mine: the staged {favorability, power} it starts with. */
export function blockHtml(c, { editing = false, mine = null } = {}) {
  const list = c.ratings || [];
  if (!list.length && !editing) return "";
  const rows = [...list].reverse().map(e => `<tr><td>${esc(dayLabel(e.date))}</td><td>${esc(SCALES.find(([k]) => k === e.scale)?.[1] || e.scale)}</td><td class="num">${esc(String(e.value))}</td><td>${esc(e.by === "group" ? "group (TTS session)" : e._staged || e._sent ? "you (unpublished)" : e.by)}</td></tr>`).join("");
  const input = ([k, label]) => `<input type="number" id="rate-${k}" min="1" max="10" step="0.1" placeholder="${label}" aria-label="${label}, 1 to 10" value="${esc(mine?.[k] ?? "")}">`;
  return `<h3>Ratings</h3><div class="ratings">${SCALES.map(s => panelHtml(list, s)).join("")}</div>
    ${list.length ? `<details class="rate-table"><summary>All ratings <span class="muted">${list.length}</span></summary><table class="data"><thead><tr><th>Date</th><th>Rating</th><th class="num">Value</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></details>` : ""}
    ${editing ? `<div class="rate-add"><span>Rate it</span>${SCALES.map(input).join("")}<button type="button" data-action="rate-add" data-id="${esc(c.id)}">Add to batch</button></div>` : ""}`;
}
