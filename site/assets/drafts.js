// Drafts: what the editors hold before it goes into the batch, kept per card id and field in localStorage, offered
// back when the card opens again. NOTES.md §21.
import { esc } from "./text.js";

export const DRAFT_KEY = "edit-drafts";
export const DELAY = 400;                          // ms after the last key
const STATS = ["hp", "def", "atk", "spd"];
const CHECKS = new Set(["hidden", "allow_high_stats", "problems_ok", "banned"]);
// the offer's words for the form's keys (edit.js LABEL, plus the ban row's three inputs)
const NAMES = { name: "Name", type: "Kind", subtype: "Item type", series: "Series", subseries: "Subseries", stars: "Stars", types: "Types", hp: "HP",
  def: "DEF", atk: "ATK", spd: "SPD", ability: "Ability", note: "Note", aliases: "Aliases", dup_of: "Duplicate of", hidden: "Hidden",
  problems_ok: "Parser notes checked", allow_high_stats: "Stats over 10 OK", author: "Author", banned: "Ban", "ban-group": "Ban", "ban-reason": "Ban",
  creatures: "Creatures" };

const text = v => String(v ?? "").replace(/\r/g, "");
/** A field's value as the Edit dialog's input shows it for card c (edit.js formHtml): text for inputs, a boolean for a
 *  checkbox, the sorted type names, creature rows of text or null. dupKey: the original's key of a duplicate. */
export function rawOf(c, f, dupKey = "") {
  if (f === "types") return [...(c.types || [])].sort();
  if (f === "creatures") return c.creatures?.length > 1 ? c.creatures.map(x => STATS.map(k => text(x[k]))) : null;
  if (f === "aliases") return (c.webAliases || []).join(", ");
  if (f === "dup_of") return dupKey;
  if (f === "type") return text(c.type);
  if (CHECKS.has(f)) return !!c[f];
  return text(c[f]);
}
/** Two raw values alike: text compared trimmed and without \r (what the form and the inline editors save). */
export function sameRaw(a, b) {
  if (typeof a === "string" && typeof b === "string") return text(a).trim() === text(b).trim();
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
/** The fields of `now` that differ from `start`: what was typed since the editor opened. */
export const changed = (now, start) => Object.fromEntries(Object.entries(now).filter(([f, v]) => !sameRaw(v, start[f])));
/** The draft's fields that `current` (the values the card shows now) doesn't hold yet: what Restore brings back. A field
 *  `current` doesn't know (the ban row on the card page) counts as one to bring back. */
export const restorable = (fields, current) => Object.fromEntries(Object.entries(fields || {}).filter(([f, v]) => !(f in current) || !sameRaw(v, current[f])));
/** The offer's words for the fields: "Ability, HP" (each name once). */
export const fieldNames = fields => [...new Set(Object.keys(fields).map(f => NAMES[f] || f))].join(", ");
/** When, roughly: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(at, now = Date.now()) {
  const m = Math.max(0, Math.round((now - at) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
/** The offer: Restore and Discard buttons (data-draft="restore" | "discard"), the fields and when. */
export const offerHtml = (fields, at, now = Date.now()) => `<div class="draft-offer" role="group" aria-label="Unsaved edit">
  <span>Restore your unsaved edit? <span class="muted">${esc(fieldNames(fields))} · ${esc(ago(at, now))}</span></span>
  <span class="actions"><button type="button" class="primary" data-draft="restore">Restore</button><button type="button" class="ghost" data-draft="discard">Discard</button></span></div>`;

const clean = v => (typeof v === "string" || typeof v === "boolean" || v === null ? true
  : Array.isArray(v) && v.every(x => typeof x === "string" || (Array.isArray(x) && x.every(y => typeof y === "string"))));
/** The drafts in a Storage (localStorage): read on every call, so tabs and modules share them. clock: for the tests. */
export function draftStore(storage, key = DRAFT_KEY, clock = () => Date.now()) {
  const read = () => {
    let d; try { d = JSON.parse(storage?.getItem(key) ?? "null"); } catch { d = null; }
    if (!d || typeof d !== "object" || Array.isArray(d)) return {};
    const out = {};
    for (const [id, e] of Object.entries(d)) {
      const fields = e && typeof e.fields === "object" && !Array.isArray(e.fields) ? Object.fromEntries(Object.entries(e.fields).filter(([, v]) => clean(v))) : {};
      if (Object.keys(fields).length) out[id] = { at: Number(e.at) || 0, fields };
    }
    return out;
  };
  const write = d => { try { if (Object.keys(d).length) storage.setItem(key, JSON.stringify(d)); else storage.removeItem(key); } catch { /* full or blocked: kept for this page only */ } };
  return {
    /** card id -> {at, fields}, or null */
    get: id => read()[id] || null,
    ids: () => Object.keys(read()),
    /** fields typed for card id. whole: they are the card's whole draft (the Edit dialog's changed inputs), else they join
     *  it (one inline field). Nothing typed (whole, or an empty fields) drops what there was. */
    put(id, fields, whole = false) {
      const d = read(), next = { ...(whole ? {} : d[id]?.fields), ...fields };
      if (Object.keys(fields).length || whole) {
        if (Object.keys(next).length) d[id] = { at: clock(), fields: next }; else delete d[id];
        write(d);
      }
    },
    /** drop card id's draft, or only some of its fields */
    drop(id, fields = null) {
      const d = read(); if (!d[id]) return;
      if (fields) { for (const f of fields) delete d[id].fields[f]; if (!Object.keys(d[id].fields).length) delete d[id]; } else delete d[id];
      write(d);
    },
    /** drop several cards' drafts (a publish, Discard all); none given: every draft */
    dropAll(ids = null) { const d = read(); for (const id of ids || Object.keys(d)) delete d[id]; write(d); },
  };
}
/** fn once ms after the last run(); flush() runs a pending one now, cancel() forgets it. */
export function later(fn, ms = DELAY) {
  let t = null;
  const fire = () => { t = null; fn(); };
  return { run() { clearTimeout(t); t = setTimeout(fire, ms); }, flush() { if (t !== null) { clearTimeout(t); fire(); } }, cancel() { clearTimeout(t); t = null; } };
}

// ---- the Edit dialog's inputs (#edit-form): every #ef-<field> input, select and textarea, the type toggles and the
// creature rows (null while the single stats show)
/** {field: raw value} of the form. */
export function readValues(form) {
  const out = {};
  for (const el of form.querySelectorAll("input[id^='ef-'], select[id^='ef-'], textarea[id^='ef-']")) {
    const f = el.id.slice(3);
    out[f] = el.type === "checkbox" ? el.checked : text(el.value);
  }
  const types = form.querySelector("#ef-types");
  if (types) out.types = [...types.querySelectorAll("[data-type]")].filter(b => b.classList.contains("on")).map(b => b.dataset.type).sort();
  const box = form.querySelector("#ef-creatures-box");
  if (box) out.creatures = box.hidden ? null : [...form.querySelectorAll("#ef-creatures tr")].map(tr => [...tr.querySelectorAll("[data-ck]")].map(i => text(i.value)));
  return out;
}
/** Put fields into the form. creatures(rows): edit.js shows the creature table with those rows (null: the single stats). */
export function fillValues(form, fields, { creatures = null } = {}) {
  for (const [f, v] of Object.entries(fields)) {
    if (f === "types") {
      for (const b of form.querySelectorAll("#ef-types [data-type]")) { const on = Array.isArray(v) && v.includes(b.dataset.type); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    } else if (f === "creatures") creatures?.(v);
    else {
      const el = form.querySelector(`#ef-${f}`);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
    }
  }
}
