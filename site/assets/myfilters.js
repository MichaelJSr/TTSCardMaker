// My filters (owner 2026-10-25): searches saved in this browser only (localStorage), toggled in the cards grid's sidebar.
// In the address one param per filter, its search text as typed: cf=<search> keeps the cards it matches, xcf=<search> drops
// them (repeated params, never a comma list, so any search round-trips); a link applies them for anyone.
import { compile } from "./search.js";

export const KEY = "custom-filters";
const MAX = 50, LEN = 300;
export const MULTI = new Set(["cf", "xcf"]);

/** localStorage text -> [search]: strings, trimmed, non-empty, no repeats, at most MAX */
export function readSaved(text) {
  let v; try { v = JSON.parse(text || "[]"); } catch { return []; }
  const out = [];
  for (const s of Array.isArray(v) ? v : []) { const q = typeof s === "string" ? s.trim().slice(0, LEN) : ""; if (q && !out.includes(q)) out.push(q); }
  return out.slice(0, MAX);
}
let mem = [];                                            // storage blocked: this page only
export function saved() { try { return readSaved(localStorage.getItem(KEY)); } catch { return mem.slice(); } }
function write(list) { mem = list; try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* this page only */ } }
/** saves q (at index `at`, else last); the same search already saved (any case): that one, nothing added */
export function add(q, at = -1) {
  q = String(q || "").trim().slice(0, LEN);
  const list = saved(), had = list.find(x => x.toLowerCase() === q.toLowerCase());
  if (!q || had) return had || "";
  list.splice(at < 0 ? list.length : at, 0, q); write(list.slice(0, MAX));
  return "";
}
/** forgets q; its index, -1 if it wasn't saved */
export function remove(q) { const list = saved(), i = list.indexOf(q); if (i >= 0) { list.splice(i, 1); write(list); } return i; }

/** a cf / xcf param's searches: trimmed, non-empty, once each */
export const vals = (p, k) => [...new Set(p.getAll(k).map(s => s.trim()).filter(Boolean))];
const preds = new Map();
/** the search's test (search.js compile), null for one that matches everything */
export const pred = q => { if (!preds.has(q)) preds.set(q, compile(q)); return preds.get(q); };
/** list narrowed by the params: every cf search must match, no xcf one may */
export function apply(list, p) {
  for (const q of vals(p, "cf")) { const f = pred(q); if (f) list = list.filter(f); }
  for (const q of vals(p, "xcf")) { const f = pred(q); if (f) list = list.filter(c => !f(c)); }
  return list;
}
