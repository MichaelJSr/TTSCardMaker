// The parts editor (AutoCroissant docs/Future/PARTS_EDITOR.md §3, §5): one text box per PSD layer the parser reads as a
// title, ability or rule-page block, from data/details/<id>.json's VERSION 2 `parts` (build_site details_parts). Edits
// publish per layer to Card Edits.json's `parts` (keyed by layer id, or +ability) with the derived name/ability. A card
// whose record has no parts edits as before. Pure: edit.js draws the boxes.
import { esc } from "./text.js";

export const PART = "part:";                       // an op's unset item and a draft's key: part:<layer id>
export const ADD = "+ability";                     // the key of an ability added to a card that has none
const arr = v => (Array.isArray(v) ? v : []);
/** A box's text as published: no \r, straight apostrophes (owner 10-25), blank ends gone. */
export const tidyText = t => String(t ?? "").replace(/\r/g, "").replace(/[‘’]/g, "'").trim();

/** The record's parts when it has boxes ({title, ability, blocks, follow}), else null (the editor works as before). */
export function partsOf(d) {
  const p = d?.parts;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const out = { title: arr(p.title), ability: arr(p.ability), blocks: arr(p.blocks), follow: arr(p.follow) };
  return out.title.length || out.ability.length || out.blocks.length ? out : null;
}
/** The card's name from its title boxes: each line break read as a space (the name stays one line). */
export const joinTitle = texts => texts.map(t => String(t).split("\n").map(s => s.trim()).filter(Boolean).join(" ")).filter(Boolean).join(" ");
/** A one-line name typed over a title box with line breaks: each break stays where the text around it is unchanged. */
export function keepBreaks(was, now) {
  const lines = String(was ?? "").split("\n").map(s => s.trim()).filter(Boolean), old = lines.join(" "), n = String(now ?? "");
  if (lines.length < 2) return n;
  let pre = 0, suf = 0, at = -1;
  while (pre < old.length && pre < n.length && old[pre] === n[pre]) pre++;
  while (suf < Math.min(old.length, n.length) - pre && old[old.length - 1 - suf] === n[n.length - 1 - suf]) suf++;
  const out = [...n];
  for (const l of lines.slice(0, -1)) {
    at += l.length + 1;                            // the space that was a break
    const j = at < pre ? at : at >= old.length - suf ? at + n.length - old.length : -1;
    if (j >= 0 && out[j] === " ") out[j] = "\n";
  }
  return out.join("");
}
/** The ability from its boxes, in reading order (the parser's join, without its type and padding clean-up). */
export const joinAbility = texts => texts.map(t => String(t).trim()).filter(Boolean).join("\n");
const baseName = layer => String(layer || "").split("/").pop().replace(/ #\d{1,2}(,\d{1,2})*$/, "").trim();
/** A box's label: "Title"; "Title 1/2 · Text/Name", "2/2 · Text/Druid  (not named Name)"; "Ability 3/5"; a block's role or layer. */
export function labelOf(kind, i, n, part) {
  if (kind === "block") return part.role === "header" ? "Header" : part.role === "page" ? "Page number" : baseName(part.layer) || `Block ${i + 1}`;
  if (kind === "ability") return n > 1 ? `Ability ${i + 1}/${n}` : "Ability";
  if (n === 1) return `Title${part.named === false ? `  (not named Name: ${part.layer})` : ""}`;
  return `${i ? "" : "Title "}${i + 1}/${n} · ${part.layer}${part.named === false ? "  (not named Name)" : ""}`;
}
/** The boxes of a dialog: [{key, kind (title | ability | block), field (name | ability), label, part, start (the box's
 *  text when it opens: a pending edit's, else the PSD's), deleted (a pending delete), state (pending | stale | null), edit
 *  (Card Edits.json's part edit), skipped (_psd.skipped's)}]. rule: a rulebook page (its blocks only). */
export function boxes(d, rule = false) {
  const p = partsOf(d);
  if (!p) return [];
  const st = d.partState || {}, ed = d.partEdits || {}, sk = d.skipped || {}, out = [];
  const add = (kind, list) => list.forEach((part, i) => {
    const key = String(part.id), e = ed[key] || null, state = st[key] || null, pending = state === "pending" && e;
    out.push({ key, kind, field: kind === "title" ? "name" : "ability", label: labelOf(kind, i, list.length, part), part,
      start: pending && !e.delete ? e.text : part.text, deleted: !!(pending && e.delete), state, edit: e, skipped: sk[key] || null });
  });
  if (rule) add("block", p.blocks);
  else { add("title", p.title); add("ability", p.ability); }
  return out;
}
/** The part edits waiting for a layer that's gone from the PSD (partState gone): [{key, edit}]. */
export const goneEdits = d => Object.entries(d?.partState || {}).filter(([k, s]) => s === "gone" && d.partEdits?.[k]).map(([key]) => ({ key, edit: d.partEdits[key] }));
/** The pending added ability ({text, state}) or null. */
export const addedEdit = d => (d?.partEdits?.[ADD] ? { text: d.partEdits[ADD].text || "", state: d.partState?.[ADD] || null } : null);

/**
 * What the boxes publish, relative to Card Edits.json (the record's partEdits). form: {values: {key: text}, deleted: Set,
 * added: text | null (the + Add an ability box), drops: Set (gone or stale edits to remove)}.
 * -> {set: {key: part edit}, unset: [key], texts: {key: text | null (deleted)}, added, error, notes}. A box back at the
 * PSD's text drops its edit; an emptied ability box deletes its layer (the last one too: the card then has no ability,
 * flagged); a title or rule-page box can't be emptied.
 */
export function readParts(d, list, { values = {}, deleted = new Set(), added = null, drops = new Set() } = {}) {
  const set = {}, unset = [], texts = {}, notes = [], psd = String(d?.psdBlob || "").slice(0, 8);
  let error = "";
  for (const b of list) {
    let typed = tidyText(b.key in values ? values[b.key] : b.start);
    if (typed === tidyText(b.start)) typed = b.start.trim();                // untouched: as it opened (its curly apostrophes too)
    const empty = typed === "" && b.part.text !== "";                         // an empty layer's box left empty: no edit
    let del = deleted.has(b.key) || (empty && b.kind === "ability");
    if (empty && !del) error = b.kind === "title" ? "A title box can't be empty: type the title, or delete the box" : "A rule page's text box can't be empty";
    if (del && b.kind === "block") del = false;
    const now = del ? null : empty ? b.part.text : typed;
    texts[b.key] = now;
    const pub = b.state === "pending" && b.edit ? (b.edit.delete ? null : b.edit.text) : b.part.text;
    if (now === b.part.text) { if (b.edit && (b.state !== "stale" || drops.has(b.key))) unset.push(b.key); continue; }   // the PSD's text: no edit (a stale one stays until dropped: the bake skips it)
    if (now === pub && b.state === "pending" && !drops.has(b.key)) continue;   // as published
    set[b.key] = { field: b.field, ...(now == null ? { delete: true } : { text: now }), was: b.part.text, sha: b.part.sha, psd, layer: b.part.layer };
  }
  for (const k of ["title", "ability"]) {
    const all = list.filter(b => b.kind === k);
    if (all.length && all.every(b => texts[b.key] == null)) {
      if (k === "title") error = "The title can't be deleted: keep one title box";
      else if (!added) notes.push("every Ability layer is deleted: the card will have no ability");
    }
  }
  for (const k of drops) if (!list.some(b => b.key === k)) unset.push(k);     // gone layers' edits
  const was = addedEdit(d), add = added == null ? null : tidyText(added);
  if (add) { if (!(was && was.text === add && was.state === "pending")) set[ADD] = { field: "ability", text: add, was: null, sha: null, psd }; }
  else if (was) unset.push(ADD);
  return { set, unset: [...new Set(unset)], texts, added: add || null, error, notes };
}
/** The derived name and ability of a card from its boxes' texts (null: deleted) and an added ability. */
export function derived(list, texts, added = null) {
  const pick = kind => list.filter(b => b.kind === kind && texts[b.key] != null).map(b => texts[b.key]);
  const titles = pick("title");
  return { name: titles.length ? joinTitle(titles) : null, ability: joinAbility([...pick("ability"), ...pick("block"), ...(added ? [added] : [])]) || null };
}
/** A sibling picture's texts with the edited layers' texts (by layer id) put in. */
export const viewTexts = (list, texts) => Object.fromEntries(list.map(b => [b.key, b.key in texts ? texts[b.key] : b.deleted ? null : b.start]));

/** The part edits the file now holds that differ from what the editor staged over (base: key -> the entry's part then,
 *  or null): someone else edited those boxes meanwhile. */
export function partConflicts(fileParts, base = {}) {
  return Object.entries(base).filter(([k, v]) => JSON.stringify(fileParts?.[k] ?? null) !== JSON.stringify(v ?? null)).map(([k]) => k);
}
/** Card Edits.json's `parts` with an op's applied: set per layer, unset by key; null when none is left. */
export function mergeParts(cur, set = {}, unset = []) {
  const out = { ...(cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}) };
  for (const k of unset) delete out[k];
  Object.assign(out, set);
  return Object.keys(out).length ? out : null;
}

// ---- notes
const STAR_FOLDER = /^((?:Creatures|Items)\/[^/]+\/|Field\/)(\d+) Stars\//i;
/** A stars edit on a card whose stars come from its folder moves it (owner 10-25): {to (the folder), created} or null. */
export function starMove(path, stars, paths = []) {
  const m = STAR_FOLDER.exec(String(path || ""));
  if (!m || stars == null || +m[2] === +stars) return null;
  const to = `${m[1]}${stars} Stars/`, low = to.toLowerCase();
  return { to, created: !paths.some(p => String(p || "").toLowerCase().startsWith(low)) };
}
/** "Also printed by Text/Name copy (they follow)." and "The watermark images/Name follows the title." for a box's part. */
export function followHtml(part) {
  const f = arr(part.follow), copies = f.filter(x => x.how === "copy").map(x => x.layer), marks = f.filter(x => x.how === "watermark").map(x => x.layer);
  const relaid = f.filter(x => x.how === "relaid").map(x => x.layer);
  return [copies.length ? `Also printed by ${esc(copies.join(", "))} (${copies.length > 1 ? "they follow" : "it follows"}).` : "",
    marks.length ? `The watermark ${esc(marks.join(", "))} follows the title.` : "",
    relaid.length ? `The hidden ${esc(relaid.join(", "))} follows.` : ""].filter(Boolean).join(" ");
}
/** A box's variant line: "only in this picture" or "⚠ shared: changes every variant (A snack, Breakfast, Supper)". */
export function sharedHtml(part, picture) {
  if (!picture) return "";
  const shared = arr(part.shared);
  if (!shared.length) return `<span class="muted">only in this picture</span>`;
  const names = arr(picture.cards).filter(c => c.n === picture.n || shared.includes(c.name)).map(c => c.name);   // in picture order
  return `<span class="part-shared">⚠ shared: changes ${names.length === arr(picture.cards).length ? "every variant" : "these pictures"} (${esc(names.join(", "))})</span>`;
}
/** The FX layers that go with a deleted box's layer (the record's fx list: "Ability FX: Blazing"). */
export const fxOf = (rec, part) => arr(rec?.fx).map(x => (typeof x === "string" ? x : x?.layer)).filter(x => typeof x === "string" && x.split(" FX: ")[0].split("/").pop() === baseName(part.layer) && x.includes(" FX: "));
/** When, for a skipped edit's note, Pacific time like the rest of the site: "10-25 14:30". */
export const when = at => { const d = new Date(at); if (Number.isNaN(+d)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`; };
/** The per-layer outcomes of a preview's result.json v2 ({key: baked | redundant | skipped | deleted | added}) in words. */
export function partsLine(parts) {
  const n = {};
  for (const how of Object.values(parts || {})) if (typeof how === "string") n[how] = (n[how] || 0) + 1;
  const words = { baked: "baked", redundant: "already so", deleted: "deleted", added: "added", skipped: "skipped (changed in Photoshop)" };
  return Object.entries(n).map(([how, k]) => `${k} box${k > 1 ? "es" : ""} ${words[how] || how}`).join(" · ");
}
