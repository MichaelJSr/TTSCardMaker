// Editing: staged in a batch, published as one commit to the card repo.
import { esc } from "./text.js";
import { decode as decodeDeck, encode as encodeDeck } from "./deck.js";
import { validateProfile, profileFile, sameProfile, deckCode, profileHtml, LIMITS, PICKS, ITEM_KINDS, LOGIN_RE } from "./profile.js";
import * as pick from "./pick.js";
import * as decks from "./decks.js";
import * as auth from "./login.js";
import * as live from "./live.js";
import * as draft from "./drafts.js";
import { current as ratingNow } from "./ratings.js";
import { soon } from "./fresh.js";
import * as P from "./parts.js";

const API = "https://api.github.com";
// token: the plain-text token before 2026-10-23 (sealed on the next load); last: the login a password last signed in
const K = { token: "edit-token", stage: "edit-stage", sent: "edit-sent", hidden: "edit-show-hidden", buckets: "edit-buckets", last: "edit-last-login", drafts: draft.DRAFT_KEY };
// same fields as build_site.py and the bot's CardEdits
const FIELDS = { name: "str", type: "str", subtype: "str", series: "str", subseries: "str", stars: "int", types: "list", hp: "int", def: "int",
  atk: "int", spd: "int", ability: "str", parts: "parts", note: "str", art: "str", ability_art: "str", aliases: "list", dup_of: "str", hidden: "bool", problems_ok: "bool", allow_high_stats: "bool",
  creatures: "creatures" };
const ORDER = Object.keys(FIELDS);
const isBot = by => String(by || "").toLowerCase() === "autocroissant";   // the bot's _by (changes.js BOT)
const STATS = ["hp", "def", "atk", "spd"];
const LABEL = { name: "Name", type: "Kind", subtype: "Item type", series: "Series", subseries: "Subseries", stars: "Stars", types: "Types", hp: "HP", def: "DEF",
  atk: "ATK", spd: "SPD", ability: "Ability", parts: "Text boxes", note: "Note", art: "Artwork source", ability_art: "Ability artwork source", aliases: "Aliases",
  dup_of: "Duplicate of", hidden: "Hidden", problems_ok: "Parser notes checked", allow_high_stats: "Stats over 10 OK", author: "Author", ban: "Constructed ban", creatures: "Creatures",
  "rate-favorability": "Favorability", "rate-power": "Power" };
// artwork sources (main, ability): free text, each entry its own (build_site.py ART_MAX, the bot's card_edits.ART_MAX)
export const ART_FIELDS = ["art", "ability_art"], ART_MAX = 500;
/** An artwork source's error ("" when fine): at most ART_MAX characters, an emoji counts one (Python's len). */
export const artError = (f, v) => (ART_FIELDS.includes(f) && typeof v === "string" && [...v].length > ART_MAX ? `${LABEL[f]}: at most ${ART_MAX} characters` : "");
// item types: the Items/ folders (fixed; a new one needs its folder first)
export const ITEM_TYPES = ["active", "attack", "counter", "deploy", "equip", "heal", "infliction", "negation", "support"];
const ABOUT = "Card data fixes from the website's Edit button. Keyed by card file name; each field overrides the PSD. _site: the card-image fields that are website only (never baked into the card image). _rename: true beside a name: the bake also renames the card's files to it. art, ability_art: where the card's main and ability artwork come from (a URL, an artist, a game; at most 500 characters), each entry its own, duplicates too. Read by the website and the card sync.";
// true beside a name: the bake renames the card's files to it (owner 2026-10-25; build_site.py RENAME_KEY, the bot's card_edits.RENAME)
export const RENAME_KEY = "_rename", RENAME_LABEL = "Also rename the card's files";
/** An entry's `_rename` after an op: ticked or unticked (op.rename), and gone without a name or with a website-only one. */
export function renameFlag(cur, op) {
  if (op.rename === true) cur[RENAME_KEY] = true; else if (op.rename === false) delete cur[RENAME_KEY];
  if (cur.name == null || (Array.isArray(cur[SITE]) && cur[SITE].includes("name"))) delete cur[RENAME_KEY];
  return cur;
}
/** op.rename from the form's tick, for a card whose name is edited once published (b: its published base). */
export function renameTick(op, b, ticked) {
  const named = "name" in op.set ? op.set.name != null : !op.unset.includes("name") && !!b.edited?.includes("name");
  if (named && ticked !== !!b.renameFiles) op.rename = ticked; else delete op.rename;
  return op;
}
// an entry's website-only fields (build_site.py SITE_KEY, the bot's card_edits.SITE): differ from the card image on purpose, never baked
export const SITE = "_site", SITE_FIELDS = ["name", "stars", "types", "hp", "def", "atk", "spd", "ability"];
const SITE_LABEL = "Website only (don't change the card image)";
/** The website-only fields after an op's ticks (op.site: {field: true | false}) over the published ones. */
export function siteAfter(op, b = {}) {
  const s = new Set(b.siteOnly || []);
  for (const [f, on] of Object.entries(op?.site || {})) if (on) s.add(f); else s.delete(f);
  for (const f of op?.unset || []) s.delete(f);
  return SITE_FIELDS.filter(f => s.has(f));
}
// site/Card Ratings.json (AutoCroissant card_edits.CardRatings.ABOUT, for a new file)
export const RATINGS_ABOUT = "Card ratings, 1 to 10. favorability: how much players like the card; power: 1 weak, 5.5 balanced, 10 too strong. Keyed by card file name; entries oldest first. by: \"group\" (a TTS session) or a GitHub login. Read by the website only.";
const RATE = ["favorability", "power"], RATE_SOURCES = ["TTS session", "website"], RATE_RANGE = "Ratings go from 1 to 10";
/** A typed rating: one decimal, or null when empty; NaN when not 1-10. */
const rateValue = t => { t = String(t ?? "").trim(); if (t === "") return null; const v = Math.round(Number(t) * 10) / 10; return v >= 1 && v <= 10 ? v : NaN; };
let pacific = null;                                // one formatter: the Pacific day of a rating
const pacificDay = d => (pacific ||= new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" })).format(d);

const cardKey = s => (s || "").replace(/_/g, " ").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const alnum = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** same() for field f: types in any order, as the bake compares them (psd_edit.same_types); the toggles list them sorted. */
export const sameField = (f, a, b) => (f === "types" && Array.isArray(a) && Array.isArray(b) ? same([...a].sort(), [...b].sort()) : same(a, b));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
// where a field's unedited value comes from: the PSD (the set also in build_site.py PSD_FIELDS, app.js FIELD_LABEL, the bot's
// CardEdits.KIND and psd_edit STAT_FIELDS/TEXT_FIELDS/NOT_YET), the card's folder, or nowhere (a database-only default; creatures too)
const FROM = { name: "PSD", stars: "PSD", types: "PSD", hp: "PSD", def: "PSD", atk: "PSD", spd: "PSD", ability: "PSD", parts: "PSD",
  type: "folder", subtype: "folder", series: "folder" };
const show = v => (v == null || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.map(x => (typeof x === "object" ? STATS.map(k => x[k] ?? "—").join("/") : x)).join(", ") : "—")
  : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));
const clip = s => (s.length > 48 ? `${s.slice(0, 45).trimEnd()}…` : s);
const tidy = (f, v) => (FIELDS[f] === "bool" ? !!v : FIELDS[f] === "list" ? v || [] : f === "dup_of" ? v || ""
  : f === "creatures" ? (v?.length > 1 ? v.map(x => Object.fromEntries(STATS.map(k => [k, x[k] ?? null]))) : null) : v ?? null);
/** A card's value of field f as the form shows it (byId resolves dup_of to the original's key). */
export function value(c, f, byId) {
  if (f === "aliases") return c.webAliases || [];
  if (f === "dup_of") return c.dup ? byId?.get(c.dup)?.key || "" : "";
  return tidy(f, c[f]);
}
/** What the PSD (or folder) says: the pre-edit value when the field was edited, else the value itself. */
export const psdValue = (b, f, byId) => tidy(f, b.edited?.includes(f) ? (f === "aliases" ? [] : b.orig?.[f]) : value(b, f, byId));
export const isPsd = f => FROM[f] === "PSD";
export const opEmpty = op => !Object.keys(op.set).length && !(op.unset || []).length && !Object.keys(op.site || {}).length && op.author === undefined && !op.ban && !op.rate && op.rename === undefined;

// ---- single-field ops (inline editing; the same rule readForm applies to the whole form)
/** An inline input's text as field f's value: trimmed, "" -> null (the name falls back to `name`), ints >= 0. */
export const fromInput = (f, v, name) => (FIELDS[f] === "int" ? (v === "" || v == null ? null : Math.max(0, Math.round(Number(v))))
  : FIELDS[f] === "str" ? (String(v ?? "").replace(/\r/g, "").trim() || (f === "name" ? name : null)) : v);
/** op with field f = v, relative to the published card: base = {pub, psd, edited}. Equal to the published value: no entry;
 *  equal to the PSD's on an edited field: unset; else set. The name follows (op.name is the batch's label for the card). */
export function mergeField(op, base, f, v) {
  const set = { ...op.set }, unset = (op.unset || []).filter(k => k !== f);
  delete set[f];
  const asPub = sameField(f, v, base.pub) || (typeof v === "string" && typeof base.pub === "string" && v === base.pub.replace(/\r/g, "").trim());
  if (!asPub) { if (sameField(f, v, base.psd) && base.edited) unset.push(f); else set[f] = v; }
  return { ...op, set, unset, ...(f === "name" ? { name: v } : {}) };
}
// ---- series, subseries and author names: one spelling per name
export const NAME_MAX = 60;                        // characters, an emoji counts one
/** A name's comparison key: case and spacing don't count. */
export const nameKey = s => String(s ?? "").toLowerCase().replace(/\s+/g, "");
const NOUN = { series: "Series", subseries: "Subseries", author: "Author" };
/** A subseries drop: the cards in `series` (case and spaces don't count) and the rest, refused. */
export const splitBySeries = (cards, series) => ({ ok: cards.filter(c => nameKey(c.series) === nameKey(series)), refused: cards.filter(c => nameKey(c.series) !== nameKey(series)) });
/** A typed series, subseries or author name: trimmed, spaces collapsed, and the known spelling when one has its nameKey.
 *  known: [spelling, shown, rank]; the highest rank wins (a [people] line, else the most cards). null when empty,
 *  {error} for a new name over NAME_MAX, else {name, existed, typed}. */
export function canonName(kind, raw, known = []) {
  const typed = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!typed) return null;
  const k = nameKey(typed);
  let best = null;
  for (const [s, shown, rank = 0] of known) if (shown && nameKey(s) === k && (!best || rank > best[1])) best = [shown, rank];
  if (best) return { name: best[0], existed: true, typed };
  if ([...typed].length > NAME_MAX) return { error: `${NOUN[kind] || "Names"} names are at most ${NAME_MAX} characters` };
  return { name: typed, existed: false, typed };
}
/** The toast when a typed name is a known one; series: the picked series of an existing subseries. */
export const sameName = (kind, typed, name, series = "") => (kind === "author" ? (typed === name ? `“${name}” is already an author` : `“${typed}” is shown as ${name}`)
  : series ? (typed === name ? `“${name}” is already a subseries of ${series}` : `“${typed}” is already the subseries ${name} of ${series}`)
  : typed === name ? `“${name}” is already a ${kind}` : `“${typed}” is already the ${kind} ${name}`);
/** sessionStorage's buckets, checked: {series: [name], subseries: [[series, name]], author: [name]}. */
export function readBuckets(text) {
  let b; try { b = JSON.parse(text); } catch { b = null; }
  const strs = a => (Array.isArray(a) ? a.filter(x => typeof x === "string" && x) : []);
  return { series: strs(b?.series), author: strs(b?.author),
    subseries: Array.isArray(b?.subseries) ? b.subseries.filter(x => Array.isArray(x) && x.length === 2 && strs(x).length === 2) : [] };
}

// ---- Rename everywhere (edit mode): a value renamed on every card carrying it, one edit per card
export const RENAME = { series: "series", subseries: "subseries", author: "author", subtype: "item type" };
/** The cards carrying `from` as key (case and spacing don't count); a subseries: in `series` too. */
export const carrying = (cards, key, from, series = "") => cards.filter(c => c[key] && nameKey(c[key]) === nameKey(from)
  && (key !== "subseries" || nameKey(c.series) === nameKey(series)));
/** A list's filter after a rename ({key, from, to, series}): {param: values} on the new name, or null (no filter on it;
 *  a subseries: not one in the renamed series, or shared, a name another series' cards keep). */
export function renamedFilter(params, { key, from, to, series = "" }, shared = false) {
  const pk = key === "subtype" ? "sub" : key, cur = params.get(pk), s = params.get("series");
  if (!cur?.split(",").some(v => nameKey(v) === nameKey(from))) return null;
  if (key === "subseries" && (s ? nameKey(s) !== nameKey(series) : shared)) return null;
  return { [pk]: [...new Set(cur.split(",").map(v => (nameKey(v) === nameKey(from) ? to : v)))] };
}
/** The authors [people] lines ({git: shown}, staged over base) move: lowercase shown name -> new name, for a name that
 *  has its own line and whose every line moves alike (cards credited to it follow: build_site person(), CardAuthors.resolve). */
export function peopleMoves(base, people) {
  const low = o => new Map(Object.entries(o).map(([g, v]) => [g.toLowerCase(), v]));
  const was = low(base), now = new Map([...was, ...low(people)]), out = new Map();
  for (const [g, v] of Object.entries(people)) {
    const old = String(was.get(g.toLowerCase()) ?? g).toLowerCase();
    if (now.get(old) === v && [...was].every(([k, x]) => x.toLowerCase() !== old || now.get(k) === v)) out.set(old, v);
  }
  return out;
}
/** The Rename button of a listed value (filter bar, pinned box, card tag): cls its class, text its label. */
export const renameButton = (key, v, series = "", cls = "ghost", text = "⇄") => `<button type="button" class="${cls}" data-action="rename-value" data-rename-k="${key}" data-rename-v="${esc(v)}"${
  series ? ` data-rename-s="${esc(series)}"` : ""} aria-label="${esc(`Rename the ${RENAME[key]} ${v} everywhere`)}" title="Rename everywhere">${esc(text)}</button>`;

/** op with the author set to v ("" -> from git), or without an author entry when v is the published author. */
export function mergeAuthor(op, v, published) {
  const o = { ...op }; v = String(v ?? "").trim();
  if (v === (published || "")) delete o.author; else o.author = v || null;
  return o;
}
/** op without one item: a field, "author", "ban" or a rating ("rate-power"; a reverted name goes back to the published one).
 *  "parts": the boxes, and the name/ability derived from them (fields: theirs, else the staged boxes' own). */
export function withoutItem(op, item, name, fields = null) {
  const o = { ...op, set: { ...op.set }, unset: (op.unset || []).filter(k => k !== item) };
  if (item === "rename" || item === "name") delete o.rename;     // the files' rename goes with the name
  if (item === "rename") return o;
  const unsite = f => { if (o.site && f in o.site) { o.site = { ...o.site }; delete o.site[f]; if (!Object.keys(o.site).length) delete o.site; } };
  if (item.startsWith("site-")) { unsite(item.slice(5)); return o; }
  unsite(item);
  if (item === "author") delete o.author; else if (item === "ban") delete o.ban;
  else if (item.startsWith("rate-")) { const r = { ...o.rate }; delete r[item.slice(5)]; if (Object.keys(r).length) o.rate = r; else delete o.rate; }
  else if (item === "parts") {
    const derived = fields || [...new Set(Object.values(o.set.parts || {}).map(p => p.field))];
    delete o.set.parts; delete o.partsBase; o.unset = o.unset.filter(k => !k.startsWith(P.PART) && !derived.includes(k));
    for (const f of derived) { delete o.set[f]; if (f === "name") o.name = name; }
  } else {
    delete o.set[item]; if (item === "name") o.name = name;
    if ((item === "name" || item === "ability") && o.set.parts) {     // the boxes behind a derived field go with it
      const keep = Object.fromEntries(Object.entries(o.set.parts).filter(([, p]) => p.field !== item));
      if (Object.keys(keep).length) o.set.parts = keep; else delete o.set.parts;
    }
  }
  return o;
}
/** The review lines of an op against its published base b: [{item, text, short, psd}]; text is the review dialog's line,
 *  short the batch bar's ("SPD 4 → 5"), psd marks fields printed on the card image. rule: a rulebook page. */
export function describeItems(op, b = {}, { byId, rule = false } = {}) {
  const src = k => (rule ? "the page" : FROM[k] ? `the ${FROM[k]}` : "the default");
  const items = Object.entries(op.set).filter(([k]) => k !== "parts").map(([k, v]) => { const from = show(value(b, k, byId)), to = show(v);
    return { item: k, text: `${LABEL[k]}: ${from} → ${to}`, short: `${LABEL[k]} ${clip(from)} → ${clip(to)}` }; });
  const boxes = Object.keys(op.set.parts || {}).length, back = (op.unset || []).filter(k => k.startsWith(P.PART)).length;
  if (boxes || back) { const t = `Text boxes: ${[boxes && `${boxes} changed`, back && `${back} back to the PSD`].filter(Boolean).join(", ")}`; items.push({ item: "parts", text: t, short: t }); }
  for (const k of (op.unset || []).filter(k => !k.startsWith(P.PART))) { const p = show(psdValue(b, k, byId)); items.push({ item: k, text: `${LABEL[k]}: back to ${src(k)} (${p})`, short: `${LABEL[k]} back to ${src(k)} (${clip(p)})` }); }
  if (op.author !== undefined) { const t = `Author → ${op.author || "(from git)"}`; items.push({ item: "author", text: t, short: t }); }
  if (op.ban) { const t = op.ban.banned ? `Banned: ${op.ban.group}, ${op.ban.reason || "no reason"}` : "Unbanned"; items.push({ item: "ban", text: t, short: t }); }
  for (const k of RATE) if (op.rate?.[k] != null) { const l = LABEL[`rate-${k}`]; items.push({ item: `rate-${k}`, text: `${l}: rated ${op.rate[k]}`, short: `${l} ${op.rate[k]}` }); }
  for (const [k, on] of Object.entries(op.site || {})) { const t = `${LABEL[k]}: ${on ? "website only (the card image keeps its text)" : "on the card image too"}`; items.push({ item: `site-${k}`, text: t, short: t }); }
  if (op.rename !== undefined) { const t = op.rename ? "Files: renamed to the name" : "Files: keep their name"; items.push({ item: "rename", text: t, short: t }); }
  const site = siteAfter(op, b);
  return items.map(x => ({ ...x, psd: isPsd(x.item) && !site.includes(x.item) }));
}
/** The batch bar's lines, one per pending edit: cards (id, name, item, text, psd), then admins, people, profiles
 *  (kind, login) and decks (kind, key); describe(op) gives a card op's items. */
export function barItems(stage, describe) {
  const out = [];
  for (const op of Object.values(stage.cards)) for (const x of describe(op)) out.push({ id: op.id, name: op.name, item: x.item, text: x.short, psd: x.psd });
  if (stage.admins) out.push({ kind: "admins", text: `Admins: ${stage.admins.join(", ")}` });
  const people = Object.entries(stage.people);
  if (people.length) out.push({ kind: "people", text: `People: ${people.map(([g, d]) => `${g} shown as ${d}`).join(", ")}` });
  for (const [login, p] of Object.entries(stage.profiles)) out.push({ kind: "profile", login, text: `${login}'s profile ${p ? "changed" : "removed"}` });
  for (const [key, f] of Object.entries(stage.decks || {})) out.push({ kind: "deck", key, text: f ? `Deck: ${deckName(stage, key, f)} (${f.private ? "private" : "public"})` : `Deck removed: ${key}` });
  return out;
}
/** A staged deck's name: the file's for a public one; a private file keeps it only in stage.deckNames (local, never published). */
export const deckName = (stage, key, f) => (f && !f.private && f.name) || (stage.deckNames || {})[key] || key.split("/")[1] || key;
export const sentence = x => (x.name ? `${x.name}: ${x.text}` : x.text);

// Card Edits.json with the ops applied: keys sorted, fields in ORDER, one line per card
export function editsFile(text, ops, at, by, path = "site/Card Edits.json", onConflict = null) {   // onConflict(op, keys): boxes someone else edited meanwhile
  let data;
  try { data = text ? JSON.parse(text) : { about: ABOUT, cards: {} }; }
  catch (e) { throw new Error(`${path} isn't valid JSON (${e.message}). Fix it on GitHub, then publish again.`); }
  data.cards ||= {};
  for (const op of ops) {
    if (!Object.keys(op.set).length && !op.unset.length && !Object.keys(op.site || {}).length && op.rename === undefined) continue;
    const k = Object.keys(data.cards).find(x => cardKey(x) === cardKey(op.key)) ?? op.key;
    const cur = { ...(data.cards[k] || {}) };
    if (isBot(cur._by) && !isBot(by)) cur._bot = ORDER.filter(f => f in cur);   // the bot's entry: its fields stay nobody's edit
    if (op.partsBase && onConflict) { const keys = P.partConflicts(cur.parts, op.partsBase); if (keys.length) onConflict(op, keys, cur.parts); }
    const { parts, ...set } = op.set, unsetParts = op.unset.filter(f => f.startsWith(P.PART)).map(f => f.slice(P.PART.length));
    for (const f of op.unset) if (!f.startsWith(P.PART)) delete cur[f];
    Object.assign(cur, set);
    if (parts || unsetParts.length) { const m = P.mergeParts(cur.parts, parts, unsetParts); if (m) cur.parts = m; else delete cur.parts; }   // per layer
    const site = new Set(Array.isArray(cur[SITE]) ? cur[SITE] : []);       // website-only fields: ticked, unticked; one without a value goes
    for (const [f, on] of Object.entries(op.site || {})) if (on) site.add(f); else site.delete(f);
    const kept = SITE_FIELDS.filter(f => site.has(f) && cur[f] != null);
    if (kept.length) cur[SITE] = kept; else delete cur[SITE];
    renameFlag(cur, op);                           // after _site: a website-only name renames nothing
    delete cur._by; delete cur._at; delete data.cards[k];
    if (Array.isArray(cur._bot)) {                 // the bot's migration fields (_bot): one this op sets or unsets is the editor's now
      cur._bot = cur._bot.filter(f => !(f in op.set) && !op.unset.includes(f) && f in cur);
      if (!cur._bot.length) delete cur._bot;
    }
    const fields = [...ORDER.filter(f => f in cur), ...Object.keys(cur).filter(f => !(f in FIELDS))];
    if (fields.length) data.cards[k] = { ...Object.fromEntries(fields.map(f => [f, cur[f]])), _by: by, _at: at };
  }
  return cardsText(data);
}
// the files' layout: the other top-level keys first, cards sorted, one line per card (card_edits.dump_edits)
function cardsText(data) {
  const keys = Object.keys(data.cards).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const rest = Object.entries(data).filter(([k]) => k !== "cards").map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const body = keys.map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(data.cards[k])}`).join(",\n");
  return `{\n${rest.join("\n")}${rest.length ? "\n" : ""}  "cards": {${keys.length ? `\n${body}\n  ` : ""}}\n}\n`;
}
const rank = (list, v) => (list.includes(v) ? list.indexOf(v) : list.length);
const lower = s => String(s ?? "").toLowerCase();
/** Card Ratings.json with the ops' ratings added: one entry per scale, dated day, by the login; your entry of that day
 *  is replaced. Lists oldest first (date, source, by, scale: card_edits.CardRatings.order). */
export function ratingsFile(text, ops, day, by, path = "site/Card Ratings.json") {
  let data;
  try { data = text ? JSON.parse(text) : { about: RATINGS_ABOUT, cards: {} }; }
  catch (e) { throw new Error(`${path} isn't valid JSON (${e.message}). Fix it on GitHub, then publish again.`); }
  data.cards ||= {};
  for (const op of ops) {
    if (!op.rate) continue;
    const k = Object.keys(data.cards).find(x => cardKey(x) === cardKey(op.key)) ?? op.key;
    let list = Array.isArray(data.cards[k]) ? data.cards[k] : [];
    for (const scale of RATE) {
      const v = op.rate[scale];
      if (v == null) continue;
      if (typeof v !== "number" || !(v >= 1 && v <= 10)) throw new Error(RATE_RANGE);
      list = list.filter(e => !(e?.date === day && e.scale === scale && e.source === "website" && lower(e.by) === lower(by)));
      list.push({ date: day, scale, value: Math.round(v * 10) / 10, by, source: "website" });
    }
    data.cards[k] = list.map((e, i) => [e, i]).sort(([a, i], [b, j]) => {
      const x = [String(a?.date ?? ""), rank(RATE_SOURCES, a?.source), lower(a?.by), rank(RATE, a?.scale)];
      const y = [String(b?.date ?? ""), rank(RATE_SOURCES, b?.source), lower(b?.by), rank(RATE, b?.scale)];
      for (let n = 0; n < 4; n++) if (x[n] !== y[n]) return x[n] < y[n] ? -1 : 1;
      return i - j;
    }).map(([e]) => e);
  }
  return cardsText(data);
}

/** The profile page's form state (what its inputs hold) for a profile; validateProfile({login, ...state}) gives the profile back. */
export const profileState = p => ({ author: p.author || "", motto: p.motto || "", series: p.series || "", ...Object.fromEntries(PICKS.map(([k]) => [k, p[k] || ""])),
  deck: p.deck || "", facts: (p.facts || []).map(f => ({ label: f.label, value: f.value })) });
/** The deck builder's saved hands as the profile page offers them: [{id, name, n (cards, the field card included)}]. */
export const savedHands = decks => decks.map(d => ({ id: d.id, name: d.name, n: d.cards.length + (d.field ? 1 : 0) }));

export function createEditor(app) {
  const { S } = app;
  // the token: in memory; kept sealed under this browser's device key (login.js vault), never in plain text
  const device = auth.vault();
  const legacy = () => localStorage.getItem(K.token) || sessionStorage.getItem(K.token) || "";
  let token = "";
  let me = null;                                   // { login, admin, push }
  let scopes = null;                               // the token's classic scopes (x-oauth-scopes); null: unknown (fine-grained)
  // profiles: login -> profile, or null to remove the file; decks: "<owner>/<slug>" -> the deck file object (decks.js fileOf /
  // encrypt), or null to remove it; deckNames: the same keys -> name, for the bar (a private file holds its name encrypted)
  const emptyStage = () => ({ cards: {}, people: {}, admins: null, profiles: {}, decks: {}, deckNames: {} });
  let stage = { ...emptyStage(), ...load(K.stage, {}) };
  // new series, subseries and authors made in the filter bar: this tab only, never published (a card carrying one is)
  let buckets = readBuckets(sessionStorage.getItem(K.buckets));
  // what the Edit dialog and the inline editors hold before it goes into the batch, per card id (drafts.js)
  const cardDrafts = draft.draftStore(localStorage, K.drafts);
  let formDraft = null;                           // the open form's draft: {flush (now, when the tab closes), discard (Cancel)}
  window.addEventListener("pagehide", () => formDraft?.flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") formDraft?.flush(); });
  let previewOpen = false;                         // narrow screens: the preview bar opened
  const pristine = new Map();                      // id -> card as built
  const based = new Map();                         // id -> card with published-but-not-built edits
  let pristineBan = null;
  const files = () => ({ edits: "site/Card Edits.json", authors: "site/Card Authors.txt", banlist: "site/Constructed Ban List.txt", admins: "site/Website Admins.txt", profiles: "site/profiles", decks: "site/decks", logins: "site/logins", ratings: "site/Card Ratings.json", ...S.data.files });
  const isAdmin = login => (S.data.admins || []).some(a => a.toLowerCase() === login.toLowerCase());
  const find = id => S.byId.get(id) || (S.rules || []).find(r => r.id === id);

  // ---- GitHub API
  async function gh(path, { method = "GET", body, raw = false, full = false, anon = false } = {}) {     // anon: no token (signed out)
    const r = await fetch(API + path, {
      method, cache: "no-store", body: body && JSON.stringify(body),
      headers: { ...(anon ? {} : { Authorization: `Bearer ${token}` }), Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!r.ok) {
      let msg = ""; try { msg = (await r.json()).message || ""; } catch { /* no body */ }
      const e = new Error(`GitHub ${r.status}${msg ? `: ${msg}` : ""}`); e.status = r.status; throw e;
    }
    const data = raw ? await r.text() : r.status === 204 ? null : await r.json();
    return full ? { data, headers: r.headers } : data;
  }
  const repoPath = p => p.split("/").map(encodeURIComponent).join("/");
  async function readFile(path, ref) {
    try { return await gh(`/repos/${S.data.repo}/contents/${repoPath(path)}?ref=${ref}`, { raw: true }); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  // files: {path: oldText => newText | null (leave it) | false (delete it)}; retried on top if someone pushed meanwhile
  async function commitFiles(edits, message, got = {}) {   // got.date: the commit's date (GitHub's clock)
    const repo = S.data.repo, branch = S.data.branch || "main";
    for (let attempt = 0; ; attempt++) {
      const head = (await gh(`/repos/${repo}/git/ref/heads/${branch}`)).object.sha;
      const base = await gh(`/repos/${repo}/git/commits/${head}`);
      const tree = [];
      for (const [path, edit] of Object.entries(edits)) {
        const old = await readFile(path, head), next = edit(old);
        if (next === false) { if (old != null) tree.push({ path, mode: "100644", type: "blob", sha: null }); }
        else if (next != null && next !== old) tree.push({ path, mode: "100644", type: "blob", content: next });
      }
      if (!tree.length) return null;
      const t = await gh(`/repos/${repo}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree } });
      const c = await gh(`/repos/${repo}/git/commits`, { method: "POST", body: { message, tree: t.sha, parents: [head] } });
      try { await gh(`/repos/${repo}/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: c.sha } }); got.date = c.committer?.date; return c.sha; }
      catch (e) { if (e.status !== 422 || attempt >= 3) throw e; }
    }
  }

  // ---- sign in: a token, or a login + password (the token sealed in site/logins/<login>.json); kept on this browser sealed
  // under its device key: localStorage until Sign out (keep), else sessionStorage (this tab)
  let keptHere = false;                            // this sign-in lasts until Sign out (else this tab)
  async function signIn(t, keep, { expect = "", store = true } = {}) {
    token = t.trim();
    const { data: user, headers } = await gh("/user", { full: true });
    if (expect && user.login.toLowerCase() !== expect.toLowerCase()) throw new Error(`That password file holds ${user.login}'s token, not ${expect}'s.`);
    const has = headers.get("x-oauth-scopes");
    if (has != null && !/\b(public_)?repo\b/.test(has)) throw new Error("This token can't write: give it the public_repo scope.");
    const p = (await gh(`/repos/${S.data.repo}`)).permissions || {};
    if (!p.push) throw new Error(`${user.login} can't push to ${S.data.repo}. Ask an admin to add you.`);
    me = { login: user.login, admin: !!p.admin || isAdmin(user.login), push: true }; scopes = has;
    keptHere = !!keep;
    if (store) await remember(keep);
    app.onAuth();
  }
  async function remember(keep) {                  // seal the token on this browser; the plain-text one of before goes
    localStorage.removeItem(K.token); sessionStorage.removeItem(K.token);
    try { await device.save(token, keep); }
    catch { keptHere = false; if (keep) app.toast("This browser can't keep you signed in safely: you'll sign in again next time"); }
  }
  let offerOnBoot = false;                         // a plain-text token was sealed on this load: offer a password once
  async function restore() {                       // the boot's silent sign-in
    const old = legacy(), kept = old ? null : await device.load();
    if (!old && !kept) return;
    const keep = old ? !!localStorage.getItem(K.token) : kept.keep;
    token = old ? old.trim() : kept.token;
    if (old) { await remember(keep); offerOnBoot = true; }
    try { await signIn(token, keep, { store: false }); }
    catch (e) { if (e.status === 401) await device.clear(); throw e; }      // a revoked token isn't kept
  }
  function signOut() {
    token = ""; me = null; scopes = null; pwKnown = null; keptHere = false;
    localStorage.removeItem(K.last); localStorage.removeItem(K.token); sessionStorage.removeItem(K.token); device.clear().catch(() => {});
    sessionStorage.removeItem(K.buckets); buckets = readBuckets(null); app.onAuth();
  }

  // ---- the password file: site/logins/<login>.json (own; admins may remove one), published at once as its own commit
  const loginPath = l => `${files().logins}/${l}.json`;
  const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
  let pwKnown = null;                              // {login, file | null}: the signed-in login's published file
  async function ownPassword(fresh = false) {      // the file, null when none, {damaged} when unreadable
    if (!fresh && pwKnown?.login === me.login) return pwKnown.file;
    const text = await readFile(loginPath(me.login), S.data.branch || "main");
    let file = null;
    if (text != null) { try { file = auth.checkFile(JSON.parse(text), me.login).file || { damaged: true }; } catch { file = { damaged: true }; } }
    pwKnown = { login: me.login, file };
    return file;
  }
  /** Signed out: the login's file, from GitHub (fresh right after a publish; 60 requests an hour per address without a
   *  token), else the site's copy data/logins/<login>.json (as new as the last build). -> {found: [{file, login}], stale}:
   *  several when files differ only in case (the build publishes none of them); stale: the site's copy was used. */
  async function fetchPassword(typed) {
    if (!LOGIN_RE.test(typed)) throw new Error("That isn't a GitHub login.");
    const lower = typed.toLowerCase(), repo = S.data.repo, ref = S.data.branch || "main", dir = files().logins;
    let built = null;
    try { const r = await fetch(`data/logins/${encodeURIComponent(lower)}.json`, { cache: "no-cache" }); if (r.ok) built = await r.json(); } catch { /* not built */ }
    const api = n => gh(`/repos/${repo}/contents/${repoPath(`${dir}/${n}.json`)}?ref=${ref}`, { raw: true, anon: true }).catch(e => (e.status === 404 ? null : Promise.reject(e)));
    const parse = text => { try { return JSON.parse(text); } catch { return null; } };
    const spelled = typeof built?.login === "string" && built.login.toLowerCase() === lower ? built.login : typed;
    let raws = [], stale = false;                  // [[file name's login, raw]]
    try {
      const text = await api(spelled);
      if (text !== null) raws.push([spelled, parse(text)]);
      else if (!built) {                           // typed in another case than the file's: find it (them) in the folder
        const list = await gh(`/repos/${repo}/contents/${repoPath(dir)}?ref=${ref}`, { anon: true }).catch(e => (e.status === 404 ? [] : Promise.reject(e)));
        for (const x of Array.isArray(list) ? list : []) {
          const name = String(x.name);
          if (name.toLowerCase() !== `${lower}.json` || name === `${spelled}.json`) continue;
          const t = await api(name.slice(0, -5));
          if (t !== null) raws.push([name.slice(0, -5), parse(t)]);
        }
      }
      if (!raws.length) throw Object.assign(new Error(`${typed} has no password: sign in with the token, then set one.`), { none: true });
    } catch (e) {
      if (e.none || !built) throw e.none ? e : new Error(`Couldn't reach GitHub (${e.message}). Try again in a few minutes, or sign in with the token.`);
      raws = [[built.login, built]]; stale = true; // GitHub unreachable or rate-limited: the site's copy
    }
    const found = raws.map(([stem, raw]) => auth.checkFile(raw, stem).file).filter(Boolean).map(file => ({ file, login: file.login }));
    if (!found.length) throw new Error(`${typed}'s password file is damaged: sign in with the token, then set a new password.`);
    return { found, stale };
  }
  let afterPw = null;                              // what "Not now" / "Continue" opens
  const later = () => { const next = afterPw; afterPw = null; if (next) next(); else app.closeModal(); };
  /** The set / change dialog. mode: "set" | "new" (forgot) | "change"; offer: after a token sign-in, with Not now -> next. */
  function openPassword(mode = "set", { offer = false, next = null } = {}) {
    if (!me) { openHub("Sign in with your token first."); return; }
    const login = me.login, path = loginPath(login);
    afterPw = next;
    app.showDialog(auth.passwordFormHtml({ mode, login, path, offer }));
    const form = app.modal.querySelector("#pw-form"), q = sel => form.querySelector(sel), status = q("#pw-status");
    const update = () => {
      const p = q("#pw-new").value, a = q("#pw-again").value, r = auth.checkPassword(p, login, token);
      q("#pw-checks").innerHTML = auth.checksHtml(r, a && p && a !== p ? false : null);
      return { r, p, same: a === p };
    };
    form.addEventListener("input", () => { update(); status.textContent = ""; });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const { r, p, same } = update(), btn = q("[type=submit]");
      if (!r.ok) { status.innerHTML = `<span class="err">${esc(r.problems[0])}</span>`; return; }
      if (!same) { status.innerHTML = `<span class="err">The two passwords don't match</span>`; return; }
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) { status.textContent = "Encrypting needs a secure page (https or localhost)"; return; }
      btn.disabled = true; status.textContent = "Encrypting (about a second)…";
      try {
        const file = { ...(await auth.seal(subtle, p, login, token)), at: stamp() };
        status.textContent = "Publishing…";
        const sha = await commitFiles({ [path]: () => auth.fileText(file) }, `Website: ${login}'s password`);
        pwKnown = { login, file }; localStorage.setItem(K.last, login);
        app.showDialog(`<h3>Password ${mode === "change" ? "changed" : "set"}</h3><p>${sha ? `Commit <a href="https://github.com/${esc(S.data.repo)}/commit/${sha}" target="_blank" rel="noopener">${sha.slice(0, 7)}</a>. ` : ""}On any device: <b>Sign in</b> → <b>Password</b>, then <b>${esc(login)}</b> and your password. ${keptHere ? "This browser stays signed in until you sign out." : "This tab stays signed in until it closes."}</p>
          <div class="actions"><button type="button" class="primary" data-action="pw-later">${afterPw ? "Continue" : "OK"}</button></div>`);
      } catch (err) { btn.disabled = false; status.innerHTML = `<span class="err">Not saved: ${esc(err.message)}</span>`; }
    });
    q("#pw-new").focus();
  }
  async function removePassword(target) {         // own file, or (admins) anyone's
    if (!me) return;
    const own = mine(target), path = loginPath(target);
    if (!own && !me.admin) { app.toast("Only admins can remove someone else's password"); return; }
    if (!confirm(own ? `Remove your password? ${path} is deleted now. This browser stays signed in; signing in elsewhere (or after Sign out) takes the token again.` : `Remove ${target}'s password? ${path} is deleted now.`)) return;
    try {
      const sha = await commitFiles({ [path]: old => (old == null ? null : false) }, `Website: ${target}'s password removed`);
      if (own) { pwKnown = { login: me.login, file: null }; localStorage.removeItem(K.last); }
      app.showDialog(`<h3>Password removed</h3><p>${sha ? `Commit <a href="https://github.com/${esc(S.data.repo)}/commit/${sha}" target="_blank" rel="noopener">${sha.slice(0, 7)}</a>. ` : "There was no file. "}${esc(path)} is gone, but the old file stays in the git history: whoever knows the old password can still read the token from it.</p>
        <p class="note">To be safe, <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">regenerate the token on GitHub</a> (or delete it and make a new one with <code>public_repo</code>), then sign in with the new one${own ? "" : ` (${esc(target)}'s token: tell them)`}.</p>
        <div class="actions"><button type="button" data-action="edit-hub">Back</button></div>`);
    } catch (err) { app.toast(`Not removed: ${err.message}`); }
  }
  function pwHubHtml(file) {                       // the signed-in hub's Password section
    if (!file || file.damaged) return `<p class="muted">${file ? "Your password file can't be read." : `Sign in on any device with <b>${esc(me.login)}</b> and a password instead of the token.`}</p>
      <div class="actions"><button type="button" data-action="pw-set">${file ? "Set a new password" : "Set a password"}</button></div>`;
    return `<p class="muted">You can sign in on any device with <b>${esc(me.login)}</b> and your password${file.at ? ` (set ${esc(file.at.slice(0, 10))})` : ""}.</p>
      <div class="actions"><button type="button" data-action="pw-change">Change password</button><button type="button" class="ghost danger" data-action="pw-remove" data-login="${esc(me.login)}">Remove my password</button></div>`;
  }
  async function listPasswords() {                 // admins: every password file, each with Remove
    const el = document.getElementById("pw-list");
    if (!el) return;
    el.textContent = "Loading…";
    try {
      const list = await gh(`/repos/${S.data.repo}/contents/${repoPath(files().logins)}?ref=${S.data.branch || "main"}`).catch(e => (e.status === 404 ? [] : Promise.reject(e)));
      const logins = (Array.isArray(list) ? list : []).map(x => String(x.name)).filter(n => n.endsWith(".json")).map(n => n.slice(0, -5));
      el.innerHTML = logins.length ? `<ul class="pw-files">${logins.map(l => `<li><a href="#/u/${encodeURIComponent(l)}">${esc(l)}</a> <button type="button" class="ghost danger" data-action="pw-remove" data-login="${esc(l)}">Remove</button></li>`).join("")}</ul>` : `<p class="muted">Nobody has a password.</p>`;
    } catch (err) { el.textContent = `Couldn't list them: ${err.message}`; }
  }

  // ---- preview: staged and just-published changes applied to the loaded cards
  const snap = c => { if (c && !pristine.has(c.id)) pristine.set(c.id, structuredClone(c)); };
  const baseOf = c => based.get(c.id) || pristine.get(c.id) || c;
  const byKey = k => S.all.find(c => cardKey(c.key) === cardKey(k)) || S.all.find(c => cardKey(c.name) === cardKey(k));
  const val = (c, f) => value(c, f, S.byId), psdVal = (b, f) => psdValue(pristine.get(b.id) || b, f, S.byId);   // as built: edited/orig aren't updated by a publish
  function banOf(id, banlist = S.data.banlist) {
    for (const g of banlist.groups) for (const e of g.entries) if (e.id === id) return { banned: true, group: g.title, reason: e.reason };
    return { banned: false, group: "", reason: "" };
  }
  function setField(c, f, v) {
    const b = baseOf(c);
    if (f === "aliases") {
      const bot = (b.aliases || []).filter(a => !(b.webAliases || []).includes(a));
      c.webAliases = v || []; c.aliases = [...bot, ...(v || []).filter(a => !bot.includes(a))];
    } else if (f === "dup_of") {
      const old = S.byId.get(c.dup);
      if (old) { snap(old); old.dups = (old.dups || []).filter(x => x !== c.id); }
      delete c.dup;
      const t = v && byKey(v);
      if (t && t !== c) { snap(t); c.dup = t.id; t.dups = [...(t.dups || []), c.id]; }
    } else if (f === "problems_ok") { c.problems_ok = !!v; c.problems = v ? [] : b.problems; }
    else if (f === "allow_high_stats") { c.allow_high_stats = !!v; c.problems = (c.problems || []).filter(p => !v || !p.startsWith("STATS TOO HIGH")); }
    else if (f === "creatures") { if (v?.length > 1) { c.creatures = v; for (const k of STATS) c[k] = v[0][k] ?? undefined; } else delete c.creatures; }
    else if (v == null || (FIELDS[f] === "bool" && !v)) delete c[f];
    else c[f] = Array.isArray(v) ? [...v] : v;
  }
  function applyOp(op) {
    const c = find(op.id);
    if (!c) return;
    snap(c);
    const b = baseOf(c);
    for (const f of op.unset || []) setField(c, f, psdVal(b, f));
    for (const [f, v] of Object.entries(op.set || {})) setField(c, f, v);
    if (op.site || c.siteOnly) {                   // website only: never "PSD pending"; unticked, a pending edit again
      const site = siteAfter(op, c), pend = new Set(c.pending || []);
      for (const [f, on] of Object.entries(op.site || {})) if (!on && c[f] != null && !sameField(f, c[f], psdVal(b, f))) pend.add(f);
      for (const f of site) pend.delete(f);
      if (site.length) c.siteOnly = site; else delete c.siteOnly;
      if (pend.size) c.pending = [...pend].sort(); else delete c.pending;
    }
    if (op.author !== undefined) c.author = op.author || b.author;
    if (op.rename !== undefined) { if (op.rename) c.renameFiles = true; else delete c.renameFiles; }
    if (c.renameFiles && (c.name === b.name && !b.edited?.includes("name") || (op.unset || []).includes("name"))) delete c.renameFiles;
    if (op.ban) {
      for (const g of S.data.banlist.groups) g.entries = g.entries.filter(e => e.id !== c.id);
      if (op.ban.banned) {
        let g = S.data.banlist.groups.find(x => x.title.toLowerCase() === op.ban.group.toLowerCase());
        if (!g) S.data.banlist.groups.push(g = { title: op.ban.group, entries: [] });
        g.entries.push({ name: c.name, reason: op.ban.reason, id: c.id });
      }
    }
    if (op.rate) {                                 // dashed dots until the rebuild; _rate: the form's start values (drafts.js rawOf)
      const day = pacificDay(new Date(op._sent ? sentRecord()?.at || Date.now() : Date.now())), login = me?.login.toLowerCase();
      const own = login && (c.ratings || []).find(e => !e._staged && !e._sent && e.by !== "group" && (e.login || e.by).toLowerCase() === login);   // rated before: one rater
      c.ratings = [...(c.ratings || []), ...RATE.filter(k => op.rate[k] != null).map(k => ({ date: day, scale: k, value: op.rate[k], by: "you", ...(own ? { rater: own.by } : {}), source: "website", [op._sent ? "_sent" : "_staged"]: true }))];
      if (!op._sent) c._rate = Object.fromEntries(Object.entries(op.rate).map(([k, v]) => [k, String(v)]));
    }
    c[op._sent ? "_sent" : "_staged"] = true;
  }
  function sentRecord() {                          // {at, committed, sha, ops, profiles, decks, deckNames}: published, until the site has rebuilt with it
    const sent = load(K.sent, null);
    if (!sent) return null;
    // built from its commit or a later one (commit dates, GitHub's); before 2026-10-25: the build's clock
    if (S.data.source && sent.committed ? Date.parse(S.data.source) >= Date.parse(sent.committed) : new Date(S.data.generated) > new Date(sent.at)) { localStorage.removeItem(K.sent); app.toast("Live now: your published edits are on the site"); return null; }
    return sent;
  }
  const sentOps = () => sentRecord()?.ops || [];
  const sentProfiles = () => sentRecord()?.profiles || {};
  const sentDecks = () => sentRecord()?.decks || {};
  const sentPeople = () => sentRecord()?.people || {};
  function movePeople(base, people, mark) {       // cards whose author a [people] line moves (peopleMoves)
    const m = peopleMoves(base, people); if (!m.size) return;
    for (const c of S.all) { const to = m.get(String(c.author || "").toLowerCase()); if (to !== undefined && to !== c.author) { snap(c); c.author = to; c[mark] = true; } }
  }
  function preview() {
    for (const [id, p] of pristine) { const c = find(id); if (!c) continue; for (const k of Object.keys(c)) delete c[k]; Object.assign(c, structuredClone(p)); }
    pristine.clear(); based.clear();
    if (pristineBan) S.data.banlist = structuredClone(pristineBan); else pristineBan = structuredClone(S.data.banlist);
    for (const op of sentOps()) applyOp({ ...op, _sent: true });
    movePeople(S.data.peopleMap || {}, sentPeople(), "_sent");
    for (const id of pristine.keys()) based.set(id, structuredClone(S.byId.get(id)));
    for (const op of Object.values(stage.cards)) applyOp(op);
    movePeople({ ...S.data.peopleMap, ...sentPeople() }, stage.people, "_staged");
    app.derive();
    renderBar();
  }
  const save = () => { localStorage.setItem(K.stage, JSON.stringify(stage)); preview(); };
  const count = () => Object.keys(stage.cards).length + Object.keys(stage.people).length + (stage.admins ? 1 : 0) + Object.keys(stage.profiles).length + Object.keys(stage.decks).length;

  // ---- the edit form
  const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
  const uniq = f => [...new Set(S.all.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // the known names, buckets included; a bucket no card carries yet is pending ("no cards yet")
  const carries = (f, v, series) => S.all.some(c => nameKey(c[f]) === nameKey(v) && (series === undefined || nameKey(c.series) === nameKey(series)));
  const pending = () => ({ series: buckets.series.filter(v => !carries("series", v)), author: buckets.author.filter(v => !carries("author", v)),
    subseries: buckets.subseries.filter(([s, v]) => !carries("subseries", v, s)) });
  const ownSubseries = series => [...new Set([...uniq(x => (x.series === series ? x.subseries : null)), ...buckets.subseries.filter(([s]) => s === series).map(([, v]) => v)])];
  const seriesList = () => [...new Set([...uniq(c => c.series), ...buckets.series])].sort((a, b) => a.localeCompare(b));
  const authorList = () => [...new Set([...(S.data.people || []), ...S.all.map(c => c.author).filter(Boolean), ...buckets.author])].sort((a, b) => a.localeCompare(b));
  // the name autofill's entries (tokens.js suggestNames): [{value, n (cards), note, own (in `series`), kind, series}]
  function nameEntries(kind, series = "") {
    const cards = n => (n ? `${n} card${n === 1 ? "" : "s"}` : "no cards yet"), count = new Map();
    if (kind === "subseries") {                     // every [series, subseries] pair: a name in two series is two rows
      for (const c of S.all) if (c.subseries) { const k = JSON.stringify([c.series || "", c.subseries]); count.set(k, (count.get(k) || 0) + 1); }
      for (const pair of buckets.subseries) { const k = JSON.stringify(pair); if (!count.has(k)) count.set(k, 0); }
      return [...count].map(([k, n]) => { const [s, value] = JSON.parse(k), own = !!series && nameKey(s) === nameKey(series);
        return { value, n, own, kind, series: s, note: own ? cards(n) : `${s || "no series"} · ${cards(n)}` }; });
    }
    if (kind === "subtype") {                      // the Items/ folders
      for (const c of S.all) if (c.subtype) count.set(c.subtype, (count.get(c.subtype) || 0) + 1);
      return ITEM_TYPES.map(value => ({ value, n: count.get(value) || 0, kind, note: cards(count.get(value) || 0) }));
    }
    if (kind !== "series" && kind !== "author") return [];
    for (const c of S.all) if (c[kind]) count.set(c[kind], (count.get(c[kind]) || 0) + 1);
    return (kind === "author" ? authorList() : seriesList()).map(value => ({ value, n: count.get(value) || 0, kind, note: cards(count.get(value) || 0) }));
  }
  function knownNames(kind, series = "", skip = "") {     // canonName's [spelling, shown, rank]: cards (skip: the one being edited, or a Set of ids), buckets, [people]
    const rank = new Map(), own = s => (kind === "subseries" && series && s === series ? 1e6 : 0);   // the picked series' own subseries first
    const add = (v, by) => { if (v) rank.set(v, (rank.get(v) || 0) + by); };
    const skipped = skip instanceof Set ? id => skip.has(id) : id => id === skip;
    for (const c of S.all) if (!skipped(c.id)) add(c[kind], 1 + own(c.series));
    if (kind === "subseries") for (const [s, v] of buckets.subseries) add(v, own(s));
    else for (const v of kind === "series" || kind === "author" ? buckets[kind] : []) add(v, 0);
    const out = [...rank].map(([v, r]) => [v, v, r]);
    if (kind === "author") {                       // a [people] line wins: the bot resolves a name through it the same way
      for (const p of S.data.people || []) out.push([p, p, 0]);
      for (const [git, shown] of Object.entries(S.data.peopleMap || {})) out.push([git, shown, Infinity]);
    }
    return out;
  }
  const canonical = (kind, v, series = "", skip = "") => canonName(kind, v, knownNames(kind, series, skip));
  function addBucket(kind, raw, series = "") {      // -> null (nothing typed), {error}, or {name, existed, note}
    if (!["series", "subseries", "author"].includes(kind)) return null;
    if (kind === "subseries" && !series) return { error: "Pick a series to add a subseries" };
    const r = canonical(kind, raw, series); if (!r || r.error) return r;
    const here = kind === "subseries" ? ownSubseries(series).some(v => nameKey(v) === nameKey(r.name)) : r.existed;   // a subseries of another series is made here too
    if (here) {                                     // shown nowhere in the filter bar: say why
      const on = list => list.some(c => nameKey(c[kind]) === nameKey(r.name) && (kind !== "subseries" || c.series === series));
      const why = on(S.cards) || (kind === "subseries" ? buckets.subseries.some(([s, v]) => s === series && v === r.name) : buckets[kind].includes(r.name)) ? ""
        : on(S.all) ? ", on hidden cards only" : kind === "author" ? ", with no cards yet" : "";
      return { name: r.name, existed: true, note: sameName(kind, r.typed, r.name, kind === "subseries" ? series : "") + why };
    }
    if (kind === "subseries") buckets.subseries.push([series, r.name]); else buckets[kind].push(r.name);
    try { sessionStorage.setItem(K.buckets, JSON.stringify(buckets)); } catch { /* storage full: kept for this page */ }
    return { name: r.name, existed: false, note: "" };
  }
  const isRule = c => (S.rules || []).includes(c);
  // ---- the parts editor (PARTS_EDITOR.md §5): one box per PSD text layer when the card's details record has parts
  const recs = new Map();                          // card id -> its details record (null: none or unreadable)
  const groupOf = c => { const first = (c.variantOf && S.byId.get(c.variantOf)) || c;     // one PSD's pictures, variant 1 first
    return first.variants?.length ? [first, ...first.variants.map(i => S.byId.get(i)).filter(Boolean)] : [c]; };
  /** Load the records the dialog needs (the card's, and its sibling pictures'), then run go. */
  function withRecs(c, go, quiet = false) {
    const need = [c, ...groupOf(c)].filter(x => x.details && !recs.has(x.id) && app.loadDetails);
    if (!need.length) return go();
    let failed = false;                            // unreadable now: the joined fields this time, tried again on the next open
    Promise.all(need.map(x => app.loadDetails(x).then(d => recs.set(x.id, d), () => { failed = true; }))).then(() => {
      if (failed && !quiet) app.toast("Couldn't load the card's text layers: editing the joined text");
      go(failed ? need : null);
    });
  }
  /** The card's boxes, or null (no parts in its record: the joined fields as before). */
  function partsView(c) {
    const built = recs.get(c.id);
    if (!P.partsOf(built)) return null;
    const first = groupOf(c)[0], has = o => o && (o.set?.parts || o.unset?.some(k => k.startsWith(P.PART)));
    const rec = { ...built, partEdits: { ...built.partEdits }, partState: { ...built.partState } };
    for (const o of sentOps().filter(o => o.id === first.id && has(o))) {      // published, not built yet: as Card Edits.json holds them
      for (const k of o.unset.filter(k => k.startsWith(P.PART)).map(k => k.slice(P.PART.length))) { delete rec.partEdits[k]; delete rec.partState[k]; }
      for (const [k, v] of Object.entries(o.set.parts || {})) { rec.partEdits[k] = v; rec.partState[k] = "pending"; }
    }
    const list = P.boxes(rec, isRule(c)), so = stage.cards[first.id];
    let added = P.addedEdit(rec);
    if (has(so)) {                                 // the boxes open with the batch's text; readForm compares with the published
      for (const b of list) {
        const p = so.set.parts?.[b.key];
        if (p) { b.start = p.delete ? b.part.text : p.text; b.deleted = !!p.delete; }
        else if (so.unset.includes(P.PART + b.key)) { b.start = b.part.text; b.deleted = false; }
      }
      if (so.set.parts?.[P.ADD]) added = { text: so.set.parts[P.ADD].text, state: "pending" };
      else if (so.unset.includes(P.PART + P.ADD)) added = null;
    }
    return list.length ? { rec, list, added, rule: isRule(c), picture: built.picture || null } : null;
  }
  let partForm = null;                             // the open dialog's box state: {c, view, deleted, drops, added (shown), last (focused box)}
  const partEl = key => document.getElementById(`ef-part:${key}`);
  function partValues() {                          // the dialog's boxes -> readParts' form
    const f = partForm, values = Object.fromEntries(f.view.list.map(b => [b.key, partEl(b.key)?.value ?? b.start]));
    const add = partEl(P.ADD), added = f.added && add ? add.value : null;
    return { values, deleted: f.deleted, added, drops: f.drops };
  }
  const rowsOf = t => Math.min(10, Math.max(1, String(t ?? "").split("\n").length));
  function boxHtml(b, view, many) {
    const fx = b.kind === "ability" ? P.fxOf(view.rec, b.part) : [], k = esc(b.key);
    const warn = b.state === "stale" && b.edit ? `<div class="part-warn">⚠ Photoshop changed this layer after your edit: it will be skipped. Photoshop now: “${esc(b.part.text)}” Yours: “${esc(b.edit.delete ? "(delete the layer)" : b.edit.text)}”
        <span class="actions"><button type="button" class="ghost" data-part-ps="${k}">Start from Photoshop's text</button>${b.edit.delete ? "" : `<button type="button" class="ghost" data-part-redo="${k}">Redo mine over it</button>`}</span></div>`
      : b.skipped ? `<div class="part-warn">⚠ Not applied${b.skipped.at ? ` (${esc(P.when(b.skipped.at))})` : ""}: ${esc(b.label.split(" · ")[0])} changed in Photoshop since this edit. Redo it on the website if still wanted.
        <span class="actions"><button type="button" class="ghost" data-part-skipped="${k}">Redo</button></span></div>` : "";
    const follow = P.followHtml(b.part);
    return `<div class="part-box${b.deleted ? " deleted" : ""}" data-part-box="${k}" data-kind="${b.kind}">
      <div class="part-head"><label for="ef-part:${k}">${esc(b.label)}</label>${P.sharedHtml(b.part, view.picture)}${many ? `<button type="button" class="ghost part-del" data-part-del="${k}">Delete layer</button>` : ""}</div>
      <textarea id="ef-part:${k}" class="part-text" rows="${rowsOf(b.start)}" spellcheck="true"${b.kind === "title" ? "" : " data-tokens"} data-part="${k}" aria-label="${esc(b.label)}">${esc(b.start)}</textarea>
      <p class="part-gone">Will be DELETED from the PSD${fx.length ? `, with ${esc(fx.map(x => `‘${x.split("/").pop()}’`).join(", "))}` : ""}. <button type="button" class="ghost" data-part-undo="${k}">Undo</button></p>
      ${warn}${follow ? `<p class="muted part-note">${follow}</p>` : ""}</div>`;
  }
  /** The boxes of one kind (title, ability, block), with their notes. */
  function boxesHtml(view, kind) {
    const list = view.list.filter(b => b.kind === kind), many = kind !== "block" && list.length > 1;
    return list.map(b => boxHtml(b, view, many)).join("");
  }
  function addHtml(view, c) {                      // + Add an ability: a card with no Ability layer (never a rule page)
    if (view.rule || view.list.some(b => b.kind === "ability")) return "";
    const t = view.rec.template, was = view.added, file = t?.file ? t.file.split("/").pop().replace(/\.psd$/i, "") : "its kind's template";
    return `<div class="part-box part-add" data-part-box="${P.ADD}"${was ? "" : " hidden"}><div class="part-head"><label for="ef-part:${P.ADD}">New ability</label><button type="button" class="ghost" data-part-add-remove>Remove</button></div>
      <textarea id="ef-part:${P.ADD}" class="part-text" rows="3" spellcheck="true" data-tokens data-part="${P.ADD}">${esc(was?.text || "")}</textarea>
      <p class="muted part-note">New layer ‘Ability’ from ${esc(file)} (box, font, size); the bake flags it for a look.${was?.state === "stale" ? " ⚠ The card has an Ability layer now (added in Photoshop): this one will be skipped." : ""}</p></div>
      <button type="button" class="ghost" data-part-add${was ? " hidden" : ""}>+ Add an ability</button>`;
  }
  function partsTop(view, c) {                     // above the boxes: the data's age, the variant pictures, edits for gone layers
    const pic = view.picture, first = pic?.cards?.[0], gone = P.goneEdits(view.rec);
    return [view.rec.stale ? `<p class="part-warn">⚠ The card changed since this data was built: an edit made now may be skipped.</p>` : "",
      pic ? `<p class="part-variant">Edit ${esc(c.name)}${pic.n > 1 && first ? ` · a variant of ${esc(first.name)}` : ""} · picture ${pic.n} of ${pic.cards.length} ${pic.cards.map(x => `<button type="button" class="ghost${x.n === pic.n ? " on" : ""}" data-part-pic="${esc(x.id)}"${x.n === pic.n ? ' aria-current="true"' : ""}>${esc(x.name)}</button>`).join("")}</p>` : "",
      ...gone.map(g => `<p class="part-warn" data-part-gone="${esc(g.key)}">⚠ An edit waits for a layer that's gone from the PSD (${esc(g.edit.layer || g.key)}): the bake skips it. <button type="button" class="ghost" data-part-drop="${esc(g.key)}">Drop it</button></p>`)].join("");
  }
  /** readForm's part: op.set.parts, the part unsets and the derived name/ability (only for a field whose boxes changed). */
  function readParts(c, b, want, op, site = []) {
    const view = partForm?.c === c ? partForm.view : partsView(c);
    const form = partForm?.c === c ? partValues() : {}, off = k => site.includes(view.list.find(x => x.key === k)?.field);
    if (site.length && form.values) {              // a website-only field: its boxes as they opened, its part edits go
      for (const x of view.list) if (site.includes(x.field)) form.values[x.key] = x.start;
      form.deleted = new Set([...form.deleted].filter(k => !off(k)));
      if (site.includes("ability")) form.added = null;
    }
    const r = P.readParts(view.rec, view.list, form);
    const used = (k, f) => groupOf(c).some(x => x !== c && !siteAfter(stage.cards[x.id], baseOf(x)).includes(f)    // another picture's normal edit
      && (k === P.ADD || !!partsView(x)?.list.some(bx => bx.key === k)));
    for (const [k, p] of Object.entries(view.rec.partEdits || {})) if (site.includes(p.field) && !used(k, p.field)) { delete r.set[k]; if (!r.unset.includes(k)) r.unset.push(k); }
    const dv = P.derived(view.list, r.texts, r.added), fieldOf = k => (k === P.ADD ? "ability" : view.list.find(x => x.key === k)?.field || view.rec.partEdits?.[k]?.field);
    const left = P.mergeParts(Object.fromEntries(Object.entries(view.rec.partEdits || {}).filter(([k]) => view.rec.partState?.[k] !== "gone")), r.set, r.unset) || {};
    for (const f of ["name", "ability"]) {
      if (site.includes(f) || (!Object.keys(r.set).some(k => fieldOf(k) === f) && !r.unset.some(k => fieldOf(k) === f))) continue;
      if (Object.values(left).some(p => p.field === f)) want[f] = f === "name" ? dv.name || b.name : dv.ability;
      else if (b.edited?.includes(f)) op.unset.push(f);          // no box of it left: the derived field goes
    }
    if (Object.keys(r.set).length) op.set.parts = r.set;
    op.unset.push(...r.unset.map(k => P.PART + k));
    if (Object.keys(r.set).length || r.unset.length) op.partsBase = Object.fromEntries([...Object.keys(r.set), ...r.unset].map(k => [k, view.rec.partEdits?.[k] ?? null]));
    return { error: r.error, notes: r.notes, texts: r.texts, added: r.added, derived: dv };
  }
  /** Where an op's fields go on a PSD with several pictures: part edits, stars, types and stats into the PSD's entry
   *  (variant 1's); each picture's derived name/ability into its own. -> [[card, op]] to stage (c's first). */
  function routeOps(c, op, read) {
    const group = groupOf(c), first = group[0];
    if (group.length < 2 || !read) return [[c, op]];
    const out = new Map([[c.id, [c, op]]]);
    const opOf = x => out.get(x.id)?.[1] || (out.set(x.id, [x, opFor(x)]), out.get(x.id)[1]);
    if (first !== c) {                              // the PSD-kind fields go to the PSD's entry
      const to = opOf(first);
      for (const f of ["stars", "types", ...STATS, "creatures"]) {
        if (f in op.set) { to.set[f] = op.set[f]; delete op.set[f]; }
        if (op.unset.includes(f)) { to.unset = [...new Set([...(to.unset || []), f])]; op.unset = op.unset.filter(x => x !== f); }
        if (op.site && f in op.site) { to.site = { ...to.site, [f]: op.site[f] }; delete op.site[f]; if (!Object.keys(op.site).length) delete op.site; }
      }
      const mine = new Set(partsView(c)?.list.map(x => x.key) || []);      // this picture's boxes: the form's word on them is the last
      const kept = Object.fromEntries(Object.entries(to.set.parts || {}).filter(([k]) => !mine.has(k)));
      if (op.set.parts || Object.keys(kept).length !== Object.keys(to.set.parts || {}).length) {
        const all = { ...kept, ...op.set.parts }; if (Object.keys(all).length) to.set.parts = all; else delete to.set.parts;
      }
      delete op.set.parts;
      const pu = op.unset.filter(x => x.startsWith(P.PART));
      if (pu.length) { to.unset = [...new Set([...(to.unset || []), ...pu])]; op.unset = op.unset.filter(x => !x.startsWith(P.PART)); }
      if (op.partsBase) { to.partsBase = { ...to.partsBase, ...op.partsBase }; delete op.partsBase; }
    }
    for (const x of group) {                        // the other pictures' derived fields, where an edited layer shows
      if (x === c) continue;
      const v = partsView(x); if (!v) continue;
      const edited = v.list.filter(bx => bx.key in read.texts && read.texts[bx.key] !== (bx.deleted ? null : bx.start));
      if (!edited.length) continue;
      const dv = P.derived(v.list, P.viewTexts(v.list, read.texts)), bx = baseOf(x), o = opOf(x), off = siteAfter(o, bx);
      for (const f of ["name", "ability"]) {
        if (!edited.some(e => e.field === f) || off.includes(f)) continue;    // its website-only text stays
        const now = f === "name" ? dv.name || bx.name : dv.ability;
        if (!sameField(f, now, val(bx, f))) o.set[f] = now;
        if (f === "name") o.name = now;
      }
    }
    return [...out.values()];
  }
  function ruleBoxesHtml(view, c) {                // a rule page: a jump list, the page with the focused block marked, one box per block
    const blocks = view.list, cw = view.rec.canvas?.w, ch = view.rec.canvas?.h;
    return `<div class="part-rule"><nav class="part-jump" aria-label="Blocks">${blocks.map(b => `<button type="button" class="ghost" data-part-jump="${esc(b.key)}">${esc(b.label)}</button>`).join("")}</nav>
      <div class="part-rule-cols"><div class="part-page"${cw && ch ? ` data-w="${cw}" data-h="${ch}" style="aspect-ratio:${cw}/${ch}"` : ""}><img src="${esc(app.imageOf(c, 720))}" alt=""><i class="part-hl" hidden></i></div>
      <div class="part-list">${boxesHtml(view, "block")}</div></div></div>`;
  }
  function ruleFormHtml(c) {
    const b = baseOf(c), view = partsView(c);
    const reset = f => { const p = psdVal(b, f); return same(val(c, f), p) ? "" : `<button type="button" class="ghost reset" data-reset="${f}" title="Back to what the page says">↺ Page: ${esc(show(p))}</button>`; };
    const row = (f, label, input) => `<div class="erow" data-row="${f}"><label for="ef-${f}">${label}</label><div class="ein">${input}${reset(f)}</div></div>`;
    return `<div class="dialog edit-dialog" role="dialog" aria-modal="true" aria-label="Edit ${esc(c.name)}">
      <button type="button" class="ghost icon close" data-action="edit-cancel" aria-label="Cancel">✕</button>
      <h2>Edit rulebook page</h2><p class="muted">Goes into your batch. <span class="kbd">${esc(c.key)}</span></p>
      <form id="edit-form" class="edit-form" autocomplete="off"><fieldset><legend>Page</legend>
        ${row("name", "Title", `<input id="ef-name" value="${esc(c.name)}">`)}
        ${view ? `${partsTop(view, c)}<div class="erow" data-row="ability"><span class="elabel">Text</span><div class="ein parts"><p class="muted part-note">One box per text block on the page (Title and Note are database only).</p>${ruleBoxesHtml(view, c)}<p class="muted part-join">On the site:</p><div class="ability preview" id="ef-preview"></div></div></div>`
          : row("ability", "Text", `<textarea id="ef-ability" rows="14" spellcheck="true" data-tokens>${esc(c.ability || "")}</textarea><div class="ability preview" id="ef-preview"></div>`)}
        ${row("note", "Note", `<textarea id="ef-note" rows="2" placeholder="Shown under the page" data-tokens>${esc(c.note || "")}</textarea>`)}
      </fieldset><div class="edit-summary muted" id="ef-summary" aria-live="polite"></div>
      <div class="actions"><button type="submit" class="primary">Add to batch</button><button type="button" data-action="edit-cancel">Cancel</button></div></form></div>`;
  }
  /** "Also rename the card's files" under the name (off by default): a card with its own PSD, its first picture. */
  function renameRow(c, b) {
    if (b.dup || (c.variant || 1) > 1 || !c.psd) return "";
    return `<div class="erow" data-row="rename"><span class="elabel"></span><div class="ein"><label class="check"><input id="ef-rename" type="checkbox"${c.renameFiles ? " checked" : ""}> ${RENAME_LABEL}</label>
      <p class="muted part-note">With a new name: the PSD and its pictures take it when the card image is updated.</p></div></div>`;
  }
  function formHtml(c) {
    if (isRule(c)) return ruleFormHtml(c);
    const b = baseOf(c), isDup = !!b.dup, ban = banOf(c.id), admin = me?.admin, view = partsView(c);
    const kinds = Object.entries(app.KIND_LABEL).filter(([k]) => k !== "unknown" || k === c.type);
    if (!app.KIND_LABEL[c.type]) kinds.push([c.type, c.type]);
    const typeNames = [...new Set(Object.values(S.icons).filter(i => i.kind === "type").map(i => i.name))].sort();
    const reset = f => { const p = psdVal(b, f), src = FROM[f]; return same(val(c, f), p) ? "" : `<button type="button" class="ghost reset" data-reset="${f}" title="${src ? `Back to what the ${src} says` : "Remove the edit"}">↺ ${src ? src[0].toUpperCase() + src.slice(1) : "Default"}: ${esc(show(p))}</button>`; };
    const on = f => (c.siteOnly || []).includes(f);
    const psdNote = f => (b.pending?.includes(f) && !on(f) ? `<span class="fact pending" data-tip="${app.PSD_TIP}">PSD pending</span>` : "");   // website only: its ticked box says so
    const siteBox = f => `<label class="check site-box"><input id="ef-site-${f}" type="checkbox" data-site="${f}"${on(f) ? " checked" : ""}> ${SITE_LABEL}</label>`;
    // a field edited as boxes (one per PSD layer): website only, one plain input instead, the boxes greyed
    const plain = (f, input) => `<div class="site-plain"${on(f) ? "" : " hidden"}>${input}<p class="muted part-note">The card image keeps its text.</p></div>${siteBox(f)}`;
    const row = (f, input) => `<div class="erow" data-row="${f}"><label for="ef-${f}">${LABEL[f]}${psdNote(f)}</label><div class="ein">${input}${reset(f)}${SITE_FIELDS.includes(f) ? siteBox(f) : ""}</div></div>`;
    const num = f => `<input id="ef-${f}" type="number" min="0" max="99" step="1" value="${c[f] ?? ""}" placeholder="—">`;
    return `<div class="dialog edit-dialog has-preview" role="dialog" aria-modal="true" aria-label="Edit ${esc(c.name)}">
      <button type="button" class="ghost icon close" data-action="edit-cancel" aria-label="Cancel">✕</button>
      <h2>Edit ${esc(c.name)}</h2>
      <p class="muted">Changes go into your batch; publish the batch when you're done. <span class="kbd">${esc(c.key)}</span></p>
      <div class="edit-cols">
      <form id="edit-form" class="edit-form" autocomplete="off">
        <h3 class="egroup">On the card image</h3><p class="muted egroup-note">Printed on the card, read from the PSD; an edit shows as “PSD pending” until the card image is regenerated, unless it's website only.${b.refused ? ` The last image update was refused: ${esc(b.refused)}.` : ""}</p>
        ${view ? partsTop(view, c) : ""}
        <fieldset><legend>Card</legend>
          ${view?.list.some(x => x.kind === "title") ? `<div class="erow" data-row="name"><span class="elabel">${LABEL.name}${psdNote("name")}</span><div class="ein parts" data-site-of="name"><div class="site-boxes">${boxesHtml(view, "title")}
            <p class="muted part-join" id="ef-name-join"></p></div>${plain("name", `<input id="ef-name" value="${esc(c.name)}">`)}</div></div>` : row("name", `<input id="ef-name" value="${esc(c.name)}">`)}
          ${renameRow(c, b)}
          ${row("stars", num("stars"))}${view ? `<p class="muted part-note" id="ef-stars-note"></p>` : ""}
          ${row("types", `<div class="icon-toggles" id="ef-types">${typeNames.map(t => { const ic = app.iconFor(t), on = (c.types || []).includes(t);
            return `<button type="button" class="icon-toggle${on ? " on" : ""}" data-type="${esc(t)}" aria-pressed="${on}" data-tip="${esc(t.replace(/_/g, " "))}">${ic ? `<img src="${esc(ic.file)}" alt="${esc(t)}">` : esc(t.slice(0, 2))}</button>`; }).join("")}</div>`)}
          ${view && !(psdVal(b, "types") || []).length ? `<p class="muted part-note">No type icon yet: the first goes at ${esc(view.rec.template?.file ? view.rec.template.file.split("/").pop().replace(/\.psd$/i, "") : "the template")}'s spot (flagged).</p>` : ""}
        </fieldset>
        <fieldset><legend>Stats</legend>
          <div class="estats" id="ef-single"${c.creatures?.length > 1 ? " hidden" : ""}>${STATS.map(f => row(f, num(f))).join("")}</div>
          <div id="ef-creatures-box"${c.creatures?.length > 1 ? "" : " hidden"}><table class="creature-table"><thead><tr><th></th>${STATS.map(k => `<th>${LABEL[k]}</th>`).join("")}</tr></thead>
            <tbody id="ef-creatures">${(c.creatures?.length > 1 ? c.creatures : []).map((x, i) => creatureRow(x, i)).join("")}</tbody></table>${reset("creatures")}</div>
          <div class="actions"><button type="button" class="ghost" data-creature="split" ${c.creatures?.length > 1 ? "hidden" : ""}>Split into creatures</button>
            <button type="button" class="ghost" data-creature="add" ${c.creatures?.length > 1 ? "" : "hidden"}>+ Creature</button>
            <button type="button" class="ghost" data-creature="remove" ${c.creatures?.length > 1 ? "" : "hidden"}>− Creature</button></div>
        </fieldset>
        <fieldset><legend>Text</legend>
          ${view ? `<div class="erow" data-row="ability"><span class="elabel">${LABEL.ability}${psdNote("ability")}</span><div class="ein parts" data-site-of="ability"><div class="site-boxes">${boxesHtml(view, "ability")}${addHtml(view, c)}</div>
            ${plain("ability", `<textarea id="ef-ability" rows="6" spellcheck="true" data-tokens>${esc(c.ability || "")}</textarea>`)}
            <div class="token-bar" aria-label="Insert an icon">${typeNames.map(t => { const ic = app.iconFor(t); return ic ? `<button type="button" class="ghost" data-insert="[${esc(t)}]" data-tip="[${esc(t)}]"><img src="${esc(ic.file)}" alt="${esc(t)}"></button>` : ""; }).join("")}</div>
            <p class="muted part-join">On the site:</p><div class="ability preview" id="ef-preview"></div></div></div>`
          : row("ability", `<textarea id="ef-ability" rows="6" spellcheck="true" data-tokens>${esc(c.ability || "")}</textarea>
            <div class="token-bar" aria-label="Insert an icon">${typeNames.map(t => { const ic = app.iconFor(t); return ic ? `<button type="button" class="ghost" data-insert="[${esc(t)}]" data-tip="[${esc(t)}]"><img src="${esc(ic.file)}" alt="${esc(t)}"></button>` : ""; }).join("")}</div>
            <div class="ability preview" id="ef-preview"></div>`)}
        </fieldset>
        <h3 class="egroup">Database only</h3><p class="muted egroup-note">Not on the card image: from the card's folder, or set only here.</p>
        <fieldset><legend>Kind and series</legend>
          ${row("type", `<select id="ef-type">${opts(kinds, c.type)}</select>`)}
          ${row("subtype", `<select id="ef-subtype">${opts([["", "—"], ...ITEM_TYPES.map(t => [t, t[0].toUpperCase() + t.slice(1)]),
            ...[...new Set([c.subtype, psdVal(b, "subtype")])].filter(t => t && !ITEM_TYPES.includes(t)).map(t => [t, t])], c.subtype || "")}</select>`)}
          ${row("series", `<input id="ef-series" data-suggest="series" autocomplete="off" value="${esc(c.series || "")}" placeholder="—">`)}
          ${row("subseries", `<input id="ef-subseries" data-suggest="subseries" data-series-from="ef-series" autocomplete="off" value="${esc(c.subseries || "")}" placeholder="—">`)}
        </fieldset>
        <fieldset><legend>Notes, names and credit</legend>
          ${row("note", `<textarea id="ef-note" rows="2" placeholder="Rulings or errata, shown on the card page" data-tokens>${esc(c.note || "")}</textarea>`)}
          ${ART_FIELDS.map(k => row(k, `<input id="ef-${k}" value="${esc(c[k] || "")}" placeholder="${k === "art" ? "the card's artwork: a link, an artist or a game" : "the ability's artwork"}">`)).join("")}
          ${row("aliases", `<input id="ef-aliases" value="${esc((c.webAliases || []).join(", "))}" placeholder="comma separated">${(c.aliases || []).filter(a => !(c.webAliases || []).includes(a)).length ? `<span class="muted">Bot aliases: ${esc(c.aliases.filter(a => !(c.webAliases || []).includes(a)).join(", "))}</span>` : ""}`)}
          <div class="erow" data-row="author"><label for="ef-author">Author</label><div class="ein">${isDup ? `<span class="muted">Same as the original</span>` : `<input id="ef-author" data-suggest="author" autocomplete="off" value="${esc(c.author || "")}">`}</div></div>
          ${row("dup_of", `<input id="ef-dup_of" list="dl-cards" value="${esc(val(c, "dup_of"))}" placeholder="not a duplicate"><datalist id="dl-cards">${S.all.filter(x => x.id !== c.id && !x.dup).map(x => `<option value="${esc(x.key)}">${esc(x.name)}</option>`).join("")}</datalist>`)}
        </fieldset>
        ${isDup ? "" : `<fieldset><legend>Ratings</legend>
          ${RATE.map(k => { const now = ratingNow((b.ratings || []).filter(e => !e._staged), k), v = stage.cards[c.id]?.rate?.[k];
            return `<div class="erow" data-row="rate-${k}"><label for="ef-rate-${k}">${LABEL[`rate-${k}`]}</label><div class="ein"><input id="ef-rate-${k}" type="number" min="1" max="10" step="0.1" placeholder="1–10" value="${v ?? ""}"><span class="muted">${now ? `${now.value} now` : "not rated"}</span></div></div>`; }).join("")}
          <p class="muted">Adds your dated rating; empty adds none.</p>
        </fieldset>`}
        <fieldset><legend>Checks</legend>
          ${row("allow_high_stats", `<label class="check"><input id="ef-allow_high_stats" type="checkbox"${c.allow_high_stats ? " checked" : ""}> above 10 is intended</label>`)}
          ${c.problems?.length || c.problems_ok ? row("problems_ok", `<label class="check"><input id="ef-problems_ok" type="checkbox"${c.problems_ok ? " checked" : ""}> checked, hide them</label> <span class="muted">${esc((b.problems || []).join(" · "))}</span>`) : ""}
        </fieldset>
        <fieldset${admin ? "" : " disabled"}><legend>Admin${admin ? "" : " (admins only)"}</legend>
          <div class="erow" data-row="ban"><label>Banned</label><div class="ein"><label class="check"><input id="ef-banned" type="checkbox"${ban.banned ? " checked" : ""}> in constructed</label>
            <select id="ef-ban-group">${opts(S.data.banlist.groups.map(g => [g.title, g.title]), ban.group)}</select>
            <input id="ef-ban-reason" value="${esc(ban.reason)}" placeholder="reason"></div></div>
          ${row("hidden", `<label class="check"><input id="ef-hidden" type="checkbox"${c.hidden ? " checked" : ""}> hide from the website</label>`)}
        </fieldset>
        <div class="edit-summary muted" id="ef-summary" aria-live="polite"></div>
        <div class="actions"><button type="submit" class="primary">Add to batch</button><button type="button" data-action="edit-cancel">Cancel</button></div>
      </form>${live.paneHtml(previewOpen, { viewer: app.imageOf(c, 720), ar: c.tw && c.th ? `${c.tw}/${c.th}` : "" })}</div></div>`;
  }
  const creatureRow = (x, i) => `<tr><th>${i + 1}</th>${STATS.map(k => `<td><input type="number" min="0" max="99" data-ck="${k}" value="${x[k] ?? ""}" placeholder="—" aria-label="Creature ${i + 1} ${LABEL[k]}"></td>`).join("")}</tr>`;
  function creatureAction(kind) {
    const box = document.getElementById("ef-creatures-box"), body = document.getElementById("ef-creatures");
    const rows = () => [...body.querySelectorAll("tr")].map(tr => Object.fromEntries([...tr.querySelectorAll("[data-ck]")].map(i => [i.dataset.ck, i.value === "" ? null : +i.value])));
    const single = Object.fromEntries(STATS.map(k => { const v = document.getElementById(`ef-${k}`).value; return [k, v === "" ? null : +v]; }));
    let list = kind === "split" ? [single, { ...single }] : rows();
    if (kind === "add") list.push({ ...list[list.length - 1] });
    if (kind === "remove") list.pop();
    if (list.length < 2) {                               // back to one creature
      for (const k of STATS) document.getElementById(`ef-${k}`).value = list[0]?.[k] ?? "";
      list = [];
    }
    body.innerHTML = list.map(creatureRow).join("");
    box.hidden = !list.length; document.getElementById("ef-single").hidden = !!list.length;
    for (const b of document.querySelectorAll("[data-creature]")) b.hidden = b.dataset.creature === "split" ? !!list.length : !list.length;
  }
  // form -> {set, unset, author, ban}, relative to the published card
  function readForm(c) {
    const b = baseOf(c), f = id => document.getElementById(`ef-${id}`);
    const int = id => (f(id).value.trim() === "" ? null : Math.max(0, Math.round(Number(f(id).value))));
    const str = id => (f(id).value.trim() || null);
    let error = "";                                  // a new name too long: shown in the summary, refused on submit
    const named = (k, series = "") => {             // a changed series or subseries as its known spelling
      const v = str(k); if (v === val(b, k)) return v;
      const r = canonical(k, v, series, c.id); if (r?.error) { error = r.error; return val(b, k); }
      return r ? r.name : null;
    };
    let seriesRead;                                  // named("series") once: the subseries getter needs it too
    const seriesName = () => (seriesRead === undefined ? (seriesRead = named("series")) : seriesRead);
    const all = {
      name: () => f("name").value.trim() || b.name, type: () => f("type").value, subtype: () => str("subtype"), series: seriesName, subseries: () => named("subseries", seriesName() || ""), stars: () => int("stars"),
      types: () => [...document.querySelectorAll("#ef-types .on")].map(x => x.dataset.type),
      ...Object.fromEntries(STATS.map(s => [s, () => int(s)])),
      ability: () => f("ability").value.replace(/\r/g, "").trim() || null, note: () => f("note").value.trim() || null,
      ...Object.fromEntries(ART_FIELDS.map(k => [k, () => { const v = f(k).value.replace(/\s+/g, " ").trim() || null; error ||= artError(k, v); return v; }])),
      aliases: () => f("aliases").value.split(",").map(s => s.trim()).filter(Boolean),
      dup_of: () => { const v = f("dup_of").value.trim(); return v ? (byKey(v)?.key || v) : ""; },
      hidden: () => f("hidden").checked, allow_high_stats: () => f("allow_high_stats").checked, problems_ok: () => f("problems_ok").checked,
    };
    const want = Object.fromEntries(Object.entries(all).filter(([k]) => f(k === "types" ? "types" : k)).map(([k, get]) => [k, get()]));
    const box = document.getElementById("ef-creatures-box");
    if (box) {
      want.creatures = box.hidden ? null : [...document.querySelectorAll("#ef-creatures tr")].map(tr =>
        Object.fromEntries([...tr.querySelectorAll("[data-ck]")].map(i => [i.dataset.ck, i.value === "" ? null : Math.max(0, Math.round(+i.value))])));
      if (!box.hidden) for (const k of STATS) delete want[k];          // creature 1 is the card's stats
      want.creatures = tidy("creatures", want.creatures);
    }
    const siteOn = k => !!f(`site-${k}`)?.checked, site = SITE_FIELDS.filter(siteOn);
    for (const k of ["name", "ability"]) if (!siteOn(k) && document.querySelector(`#edit-form [data-site-of="${k}"]`)) delete want[k];   // its boxes speak for it
    const op = { id: c.id, key: c.key, name: want.name, set: {}, unset: [] };
    lastRead = null;
    if (partsView(c)) {                              // one box per layer: parts, and the derived fields of the boxes changed
      lastRead = readParts(c, b, want, op, site);
      if (lastRead.error) error = lastRead.error;
      op.name = want.name || b.name;
    }
    for (const [k, v] of Object.entries(want)) {
      const pub = val(b, k);
      if (sameField(k, v, pub) || (typeof v === "string" && typeof pub === "string" && v === pub.replace(/\r/g, "").trim())) continue;   // as published
      if (sameField(k, v, psdVal(b, k)) && b.edited?.includes(k)) op.unset.push(k);
      else op.set[k] = v;
    }
    if (f("author") && f("author").value.trim() !== (b.author || "")) {
      const r = canonical("author", f("author").value, "", c.id), a = r?.name || "";
      if (r?.error) error = r.error; else if (a !== (b.author || "")) op.author = a || null;
    }
    if (f("banned")) {
      const ban = { banned: f("banned").checked, group: f("ban-group").value, reason: f("ban-reason").value.trim() };
      const was = banOf(c.id, pristineBan || S.data.banlist);
      if (ban.banned !== was.banned || (ban.banned && (ban.group !== was.group || ban.reason !== was.reason))) op.ban = ban;
    }
    if (f("rate-favorability")) {
      const rate = {};
      for (const k of RATE) { const v = rateValue(f(`rate-${k}`).value); if (Number.isNaN(v)) error = RATE_RANGE; else if (v != null) rate[k] = v; }
      if (Object.keys(rate).length) op.rate = rate;
    }
    for (const k of SITE_FIELDS) {                  // ticked or unticked: for a field with a value once published
      const has = k in op.set ? op.set[k] != null : !op.unset.includes(k) && !!b.edited?.includes(k) && b[k] != null;
      if (f(`site-${k}`) && has && siteOn(k) !== (b.siteOnly || []).includes(k)) op.site = { ...op.site, [k]: siteOn(k) };
    }
    if (f("rename")) renameTick(op, b, f("rename").checked && !siteOn("name"));   // a website-only name renames nothing
    if (error) op.error = error;
    op.unset = [...new Set(op.unset)];
    return op;
  }
  let lastRead = null;                             // readForm's parts reading (texts, derived), for routeOps
  const items = op => { const c = find(op.id); return describeItems(op, c ? baseOf(c) : {}, { byId: S.byId, rule: isRule(c) }); };
  const describe = op => items(op).map(x => x.text);
  // ---- single fields, staged in place (inline.js): merged into the card's op, so the form and the bar see one batch
  const opFor = c => (stage.cards[c.id] ? structuredClone(stage.cards[c.id]) : { id: c.id, key: c.key, name: baseOf(c).name, set: {}, unset: [] });
  const put = (id, op) => { if (opEmpty(op)) delete stage.cards[id]; else stage.cards[id] = op; };
  // a typed series, subseries or author as its known spelling ("mario" -> Mario), with a toast; undefined when refused
  function spell(kind, v, series, id) {
    const r = canonical(kind, v, series, id);
    if (r?.error) { app.toast(r.error); return undefined; }
    if (r?.existed && r.name !== r.typed) app.toast(kind === "author" ? sameName(kind, r.typed, r.name) : `“${r.typed}” saved as ${r.name}, its known spelling`);
    return r ? r.name : v;
  }
  // defer: from stageMany, which has spelled the value already and saves once after; no toasts
  function stageField(id, f, v, defer = false) {
    const c = find(id); if (!c || !(f in FIELDS)) return null;
    const b = baseOf(c);
    const one = (f === "name" || f === "ability") && !(c.siteOnly || []).includes(f) && partsView(c), n = one ? one.list.filter(x => x.field === f).length : 0;
    if (one && !one.rule && n === 1) return stagePart(c, one, f, v, defer);
    if (one && (f === "ability" || !one.rule)) { if (!defer) app.toast(`${LABEL[f]}: edit its boxes in Edit`); return null; }   // several layers (or none): never the joined field
    let x = fromInput(f, v, b.name);
    if (ART_FIELDS.includes(f) && x != null) { x = x.replace(/\s+/g, " "); if (artError(f, x)) { if (!defer) app.toast(artError(f, x)); return null; } }
    if ((f === "series" || f === "subseries") && x != null && !defer && (x = spell(f, x, f === "subseries" ? c.series || "" : "", c.id)) === undefined) return null;
    const op = mergeField(opFor(c), { pub: val(b, f), psd: psdVal(b, f), edited: !!b.edited?.includes(f) }, f, x);
    put(c.id, op); if (!defer) save();
    return op;
  }
  // an inline edit of a card's one title or ability layer, as a part edit (the parts format whenever the record has parts)
  function stagePart(c, view, f, v, defer) {
    const box = view.list.find(x => x.field === f), b = baseOf(c), text = (f === "name" ? P.keepBreaks(box.start, P.tidyText(String(v ?? "").replace(/\s+/g, " "))) : P.tidyText(v)) || (f === "name" ? box.start : "");
    const r = P.readParts(view.rec, view.list, { values: { [box.key]: text } });
    if (r.error) { app.toast(r.error); return null; }
    let op = opFor(c);
    const parts = { ...op.set.parts }; delete parts[box.key];
    if (r.set[box.key]) parts[box.key] = r.set[box.key];
    if (Object.keys(parts).length) op.set.parts = parts; else delete op.set.parts;
    op.unset = (op.unset || []).filter(k => k !== P.PART + box.key).concat(r.unset.includes(box.key) ? [P.PART + box.key] : []);
    if (r.set[box.key] || r.unset.includes(box.key)) op.partsBase = { ...op.partsBase, [box.key]: view.rec.partEdits?.[box.key] ?? null };
    const now = f === "name" ? P.joinTitle([text]) : r.texts[box.key] ?? "";
    const stillPart = r.set[box.key] || (view.rec.partEdits?.[box.key] && !r.unset.includes(box.key));
    op = stillPart ? mergeField(op, { pub: val(b, f), psd: psdVal(b, f), edited: !!b.edited?.includes(f) }, f, now || null)
      : { ...op, set: Object.fromEntries(Object.entries(op.set).filter(([k]) => k !== f)), unset: [...new Set([...op.unset.filter(k => k !== f), ...(b.edited?.includes(f) ? [f] : [])])] };
    for (const [x, o] of routeOps(c, op, { texts: { [box.key]: r.texts[box.key] } })) put(x.id, o);
    if (!defer) save();
    return op;
  }
  function stageAuthor(id, v, defer = false) {
    const c = find(id); if (!c) return null;
    const b = baseOf(c);
    if (b.dup) { if (!defer) app.toast("A duplicate's author follows the original"); return null; }
    const a = defer ? String(v ?? "").trim() : spell("author", String(v ?? "").trim(), "", c.id); if (a === undefined) return null;
    const op = mergeAuthor(opFor(c), a, b.author);
    put(c.id, op); if (!defer) save();
    return op;
  }
  // the card page's Rate it: {favorability, power} as typed ("" = none) -> the op, or null (refused: a toast says why)
  function stageRating(id, values) {
    const c = find(id); if (!c) return null;
    const op = opFor(c), rate = {};
    for (const k of RATE) { const v = rateValue(values[k]); if (Number.isNaN(v)) { app.toast(RATE_RANGE); return null; } if (v != null) rate[k] = v; }
    if (!Object.keys(rate).length && !op.rate) { app.toast("Type a rating, 1 to 10"); return null; }
    if (Object.keys(rate).length) op.rate = rate; else delete op.rate;
    put(c.id, op); save();
    app.toast(op.rate ? `Added to the batch: ${count()} unpublished` : "Rating removed from the batch");
    return op;
  }
  // one save for the lot -> {changed (a card already at v doesn't count), dups (an author drop leaves duplicates alone),
  // kept (a series drop: cards keeping a subseries the new series lacks), refused (a subseries drop: cards not in its
  // series, as staged), value, error}. v is spelled once, here: a drop chip's value (the lists mountGrid's chips come
  // from) stays as it is, so cards can join either of two spellings of a name; other text goes through canonical().
  // series: a subseries' series (a pinned box's), else the first card's (the filter bar's list is all in one series)
  function stageMany(ids, key, v, { series: ser = "" } = {}) {
    const series = key === "subseries" ? ser || find(ids[0])?.series || "" : "";
    let refused = 0;
    if (key === "subseries") { const r = splitBySeries(ids.map(find).filter(Boolean), series); refused = r.refused.length; ids = r.ok.map(c => c.id); }
    const chips = key === "series" ? seriesList() : key === "subseries" ? ownSubseries(series) : key === "author" ? authorList() : [];
    const r = chips.includes(v) ? { name: v } : canonical(key, v, series);
    if (r?.error) return { changed: 0, dups: 0, kept: 0, refused: 0, value: v, error: r.error };
    const value = r ? r.name : v, moved = [], own = key === "series" ? ownSubseries(value) : [];   // before the drop
    let changed = 0, dups = 0;
    for (const id of ids) {
      const was = JSON.stringify(stage.cards[id] ?? null);
      if (key === "author" && find(id) && baseOf(find(id)).dup) { dups++; continue; }
      if ((key === "author" ? stageAuthor(id, value, true) : stageField(id, key, value, true)) && JSON.stringify(stage.cards[id] ?? null) !== was) { changed++; moved.push(id); }
    }
    save();
    const kept = key === "series" ? moved.filter(id => { const s = find(id)?.subseries; return s && !own.includes(s); }).length : 0;
    return { changed, dups, kept, refused, value, series };
  }
  function revert(id, item) {
    const c = find(id), op = stage.cards[id]; if (!c || !op) return;
    if (item === "parts") {                        // the boxes, and every picture's name/ability derived from them
      const keys = [...Object.keys(op.set.parts || {}), ...(op.unset || []).filter(k => k.startsWith(P.PART)).map(k => k.slice(P.PART.length))];
      for (const x of groupOf(c)) {
        const v = partsView(x), o = stage.cards[x.id]; if (!o) continue;
        const shown = k => x === c || k === P.ADD || v?.list.some(b => b.key === k);   // another picture: the layers it shows
        const fields = [...new Set(keys.filter(shown).map(k => (k === P.ADD ? "ability" : op.set.parts?.[k]?.field || v?.list.find(b => b.key === k)?.field || v?.rec.partEdits?.[k]?.field)).filter(Boolean))];
        if (x === c) put(x.id, withoutItem(o, "parts", baseOf(x).name, fields));
        else if (fields.length) put(x.id, fields.reduce((a, f) => withoutItem(a, f, baseOf(x).name), o));
      }
      save(); return;
    }
    put(id, withoutItem(op, item, baseOf(c).name)); save();
  }
  // ---- Rename everywhere: `from` -> the typed name on every card carrying it (hidden ones too), each card's own edit
  // (stageField / stageAuthor). Onto a known name: merged, in its spelling; an item type: an Items/ folder; a duplicate's
  // author follows its original; an author's [people] lines move too (replace_author did), cards they carry need no edit.
  // -> null (nothing typed), {error}, or {name, change (ids to edit), cards (changing), people {git: name}, others, dups}
  function renamePlan(key, from, typed, series = "") {
    const cards = carrying(S.all, key, from, series), ids = new Set(cards.map(c => c.id));
    let name;
    if (key === "subtype") {
      name = String(typed ?? "").trim().toLowerCase();
      if (!name) return null;
      if (!ITEM_TYPES.includes(name)) return { error: `Item types are the Items folders: ${ITEM_TYPES.join(", ")}` };
    } else {
      const r = canonName(key, typed, knownNames(key, series, ids).filter(([, shown]) => nameKey(shown) !== nameKey(from)));   // from's own spelling can change
      if (!r || r.error) return r;
      name = r.name;
    }
    const dups = key === "author" ? cards.filter(c => baseOf(c).dup) : [], moved = cards.filter(c => !dups.includes(c) && c[key] !== name);
    let change = moved, people = {};
    if (key === "author") {                        // every line showing from, and "from = name" when from is a name without one
      const lines = { ...S.data.peopleMap, ...sentPeople(), ...stage.people }, low = from.toLowerCase();
      for (const [g, v] of Object.entries(lines)) if (nameKey(v) === nameKey(from) && v !== name) people[g] = name;
      if (!Object.keys(lines).some(g => g.toLowerCase() === low) && (S.data.people || []).some(x => x.toLowerCase() === low)) people[from] = name;
      const now = new Map(Object.entries({ ...lines, ...people }).map(([g, v]) => [g.toLowerCase(), v]));
      const raw = c => (stage.cards[c.id]?.author !== undefined ? stage.cards[c.id].author : baseOf(c).author);   // the name its line credits
      change = moved.filter(c => !raw(c) || now.get(raw(c).toLowerCase()) !== name);
    }
    return { name, change: change.map(c => c.id), cards: moved.length, people, dups: dups.length,
      others: carrying(S.all, key, name, series).filter(c => !ids.has(c.id)).length };
  }
  const idle = p => !p || !!p.error || (!p.change.length && !Object.keys(p.people).length);
  function renameAll(key, from, typed, series = "") {      // stages the plan, one save
    const p = renamePlan(key, from, typed, series);
    if (idle(p)) return p;
    const was = { ...S.data.peopleMap, ...sentPeople() };
    for (const [g, v] of Object.entries(p.people)) if (was[g] === v) delete stage.people[g]; else stage.people[g] = v;
    for (const id of p.change) if (key === "author") stageAuthor(id, p.name, true); else stageField(id, key, p.name, true);
    save();
    return p;
  }
  const cardsN = n => `${n} card${n === 1 ? "" : "s"}`;
  function openRename(key, from, series = "") {
    if (!RENAME[key] || !from) return;
    if (!me) { openHub(`Sign in to rename ${from}.`); return; }
    const noun = RENAME[key], back = app.currentCard();
    app.showDialog(`<h3>Rename the ${noun} “${esc(from)}” everywhere</h3>
      <form id="rename-form" autocomplete="off"><p class="muted">Every card with it${key === "subseries" ? ` in ${esc(series || "no series")}` : ""}, hidden ones too, gets its own edit in your batch, published with the rest in one commit. A name that exists merges them into it.</p>
        <input id="rn-to" class="wide" data-suggest="${key}"${key === "subseries" ? ` data-series="${esc(series)}"` : ""} value="${esc(from)}" aria-label="New ${noun}">
        <p class="edit-summary muted" id="rn-summary" aria-live="polite"></p>
        <div class="actions"><button type="submit" class="primary">Add to batch</button><button type="button" data-action="rename-cancel">Cancel</button></div></form>`);
    const form = app.modal.querySelector("#rename-form"), input = form.querySelector("#rn-to"), btn = form.querySelector("[type=submit]");
    const update = () => {
      const p = renamePlan(key, from, input.value, series);
      const ppl = Object.keys(p?.people || {});
      btn.disabled = idle(p);
      form.querySelector("#rn-summary").innerHTML = !p ? "Type the new name." : p.error ? `<span class="err">${esc(p.error)}</span>`
        : idle(p) ? `Nothing changes: ${p.dups ? "duplicates follow their originals" : `every card has ${esc(p.name)}`}.`
        : [p.cards ? `<b>${cardsN(p.cards)} change${p.cards === 1 ? "s" : ""}</b>: ${noun} → ${esc(p.name)}` : "", p.others ? `merges with the ${cardsN(p.others)} already there` : "",
          ppl.length ? `[people]: ${esc(ppl.join(", "))} shown as ${esc(p.name)} (rulebook pages and new cards follow)` : "",
          p.dups ? `${p.dups === 1 ? "1 duplicate keeps its original's" : `${p.dups} duplicates keep their originals'`} author` : ""].filter(Boolean).join(" · ");
    };
    input.addEventListener("input", update);
    form.addEventListener("submit", e => {
      e.preventDefault();
      const p = renameAll(key, from, input.value, series);
      if (idle(p)) { update(); return; }
      app.toast(`${cardsN(p.cards)}: ${noun} → ${p.name} · ${count()} unpublished`);
      const detail = { key, from, to: p.name, series }, shared = carrying(S.all, key, from).length > 0;   // a subseries other series keep
      document.dispatchEvent(new CustomEvent("value-renamed", { detail }));   // the pinned boxes follow (tray.js)
      if (back) {                                  // the list under the card: its filter follows
        const [path, q = ""] = S.listHash.split("?"), params = new URLSearchParams(q), u = /^#?\/?(cards)?$/.test(path) && renamedFilter(params, detail, shared);
        if (u) { for (const [k, v] of Object.entries(u)) params.set(k, v.join(",")); S.listHash = `${path}?${params}`; }
        app.goCard(back); return;
      }
      app.closeModal();
      const r = app.route(), u = r.name === "cards" && renamedFilter(r.params, detail, shared);   // a filter on the old name follows it
      if (u) app.setParams(u); else app.rerender();
    });
    update();
    input.focus(); input.select();
  }
  // the live preview: the card as it will look once published, from the form's op (live.js)
  const previewCtx = { render: (t, n) => app.render(t, n), statBars: p => app.statBars(p), iconFor: n => app.iconFor(n), kindLabel: app.KIND_LABEL, image: () => "" };   // the card's image: the viewer above
  function paintPreview(c, op) {
    const body = app.modal.querySelector("#lp-body"); if (!body) return;
    const b = baseOf(c), values = { ...op.set, ...Object.fromEntries((op.unset || []).map(f => [f, psdVal(b, f)])) };
    body.innerHTML = live.previewHtml(live.previewCard(b, values, op.author, f => psdVal(b, f), siteAfter(op, b)), live.changedFields(b, values, op.author), previewCtx);
    for (const a of body.querySelectorAll("a")) a.tabIndex = -1;    // a picture of the page: its links don't leave the form
  }
  // restored: a draft's fields, from the card page's offer; focus: "name" | "ability" | a layer id (inline.js on a card of several boxes)
  function openForm(id, { draft: restored = null, focus = null, skipRecs = false } = {}) {
    const c = find(id);
    if (!c) return;
    if (!me) { openHub(`Sign in to edit ${c.name}.`, () => openForm(id, { draft: restored, focus })); return; }
    if (!skipRecs && [c, ...groupOf(c)].some(x => x.details && !recs.has(x.id) && app.loadDetails)) { withRecs(c, failed => openForm(id, { draft: restored, focus, skipRecs: !!failed })); return; }
    const view = partsView(c);
    partForm = view ? { c, view, deleted: new Set(view.list.filter(x => x.deleted).map(x => x.key)), drops: new Set(), added: !!view.added, last: null } : null;
    app.modal.innerHTML = formHtml(c);
    app.modal.hidden = false; document.body.style.overflow = "hidden"; app.modal.scrollTop = 0;
    const form = app.modal.querySelector("#edit-form"), ta = document.getElementById("ef-ability");
    const first = () => (focus && view ? (/^\d+$/.test(focus) ? partEl(focus) : form.querySelector(`.part-box[data-kind="${focus === "name" ? "title" : focus === "ability" ? "ability" : "block"}"] [data-part]`)) : null)
      || [document.getElementById(isRule(c) ? "ef-ability" : "ef-name")].find(el => el && !el.closest("[hidden]")) || form.querySelector("[data-part]");
    const siteOn = f => !!document.getElementById(`ef-site-${f}`)?.checked;
    const paintSite = () => {                      // a website-only field edited as boxes: the plain input, the boxes greyed
      for (const wrap of form.querySelectorAll("[data-site-of]")) {
        const on = siteOn(wrap.dataset.siteOf);
        wrap.classList.toggle("site-on", on); wrap.querySelector(".site-plain").hidden = !on;
        for (const el of wrap.querySelectorAll(".site-boxes textarea, .site-boxes button")) el.disabled = on;
      }
    };
    const paintBoxes = () => {                     // the deleted boxes, the added one, the rule page's mark
      if (!partForm) return;
      for (const el of form.querySelectorAll(".part-box[data-part-box]")) el.classList.toggle("deleted", partForm.deleted.has(el.dataset.partBox));
      const add = form.querySelector(".part-add"); if (add) { add.hidden = !partForm.added; form.querySelector("[data-part-add]").hidden = partForm.added; }
      for (const el of form.querySelectorAll("[data-part-gone]")) el.classList.toggle("dropped", partForm.drops.has(el.dataset.partGone));
    };
    const mark = key => {                          // a rule page: the focused block's box on the page
      const page = form.querySelector(".part-page"), hl = page?.querySelector(".part-hl"), part = view?.list.find(x => x.key === key)?.part;
      if (!hl) return;
      const w = +page.dataset.w, h = +page.dataset.h;
      if (!part?.box || !w || !h) { hl.hidden = true; return; }
      const [x0, y0, x1, y1] = part.box;
      Object.assign(hl.style, { left: `${(x0 / w) * 100}%`, top: `${(y0 / h) * 100}%`, width: `${((x1 - x0) / w) * 100}%`, height: `${((y1 - y0) / h) * 100}%` });
      hl.hidden = false;
    };
    const update = () => {
      paintSite();
      const op = readForm(c), lines = describe(op), text = partForm && !siteOn("ability") ? lastRead?.derived.ability || "" : ta.value;
      document.getElementById("ef-preview").innerHTML = text.trim() ? app.render(text, c.name) : `<span class="muted">No ability text.</span>`;
      if (partForm) {
        const join = document.getElementById("ef-name-join"); if (join) join.textContent = `Name on the site: “${lastRead?.derived.name || ""}”`;
        const sn = document.getElementById("ef-stars-note"), st = document.getElementById("ef-stars");
        const mv = sn && st ? P.starMove(c.psd, st.value === "" ? null : +st.value, S.all.map(x => x.psd)) : null;
        if (sn) sn.textContent = mv ? `Moves the PSD and its PNGs to ‘${mv.to}’${mv.created ? " (created)" : ""}${partForm.view.rec.header?.stars ? " and redraws the printed stars" : ""}.` : "";
        paintBoxes();
      }
      const notes = lastRead?.notes || [];
      document.getElementById("ef-summary").innerHTML = (op.error ? `<span class="err">${esc(op.error)}.</span> ` : "") + (lines.length ? `<b>${lines.length} change${lines.length > 1 ? "s" : ""}:</b> ${lines.map(esc).join(" · ")}` : "No changes yet.")
        + (notes.length ? ` <span class="part-warn">${notes.map(esc).join(" · ")}</span>` : "");
      form.dataset.dirty = lines.length || op.error ? "1" : "";       // a refused name is typed text too: Cancel and leaving still ask
      paintPreview(c, op);
      const f = document.activeElement?.closest?.("#edit-form [id^='ef-'], #ef-types, #ef-creatures-box")?.id.slice(3);
      if (f) live.reveal(app.modal.querySelector(".lp-pane"), f === "creatures-box" ? "creatures" : f);
    };
    // drafts: the inputs that differ from how the form opened, a moment after each key; an older one is offered first
    const start = draft.readValues(form), setCreatures = rows => {
      if (!rows) { if (!document.getElementById("ef-creatures-box").hidden) creatureAction("remove"); return; }
      document.getElementById("ef-creatures").innerHTML = rows.map((r, i) => creatureRow(Object.fromEntries(STATS.map((k, j) => [k, r[j] === "" ? null : r[j]])), i)).join("");
      if (document.getElementById("ef-creatures-box").hidden) { document.getElementById("ef-creatures-box").hidden = false; document.getElementById("ef-single").hidden = true;
        for (const b of document.querySelectorAll("[data-creature]")) b.hidden = b.dataset.creature === "split"; }
    };
    let keepOld = null;                             // an unanswered offer's draft: what is typed joins it, never replaces it
    const autosave = draft.later(() => {
      if (!form.isConnected) return;
      const typed = draft.changed(draft.readValues(form), start), base = Object.fromEntries(Object.keys(typed).map(f => [f, start[f]]));
      if (keepOld) cardDrafts.put(c.id, { ...keepOld.fields, ...typed }, true, { ...keepOld.base, ...base });
      else if (Object.keys(typed).length) cardDrafts.put(c.id, typed, true, base); else cardDrafts.drop(c.id);
    });
    const typing = () => autosave.run();
    const kept = (restored || cardDrafts.get(c.id)?.fields) || {}, boxed = f => !!form.querySelector(`[data-site-of="${f}"]`) && !kept[`site-${f}`];
    const joined = partForm && Object.keys(kept).filter(f => (f === "name" || f === "ability") && (!(f in start) || boxed(f)));
    if (joined?.length && restored) restored = Object.fromEntries(Object.entries(restored).filter(([f]) => !joined.includes(f)));
    if (joined?.length) { cardDrafts.drop(c.id, joined); app.toast(`An older unsaved ${joined.map(f => LABEL[f]).join(" and ")} edit can't go into the boxes: dropped`); }   // a joined draft of a card of several layers
    const older = !restored && cardDrafts.get(c.id), offered = older && draft.restorable(older.fields, start);
    if (restored) draft.fillValues(form, restored, { creatures: setCreatures });
    else if (offered && Object.keys(offered).length) { form.insertAdjacentHTML("afterbegin", draft.offerHtml(offered, older.at, Date.now(), draft.movedSince(older, start))); keepOld = older; }
    else if (older) cardDrafts.drop(c.id);                                 // the batch has it already
    let found = cardDrafts.snap(c.id);              // the draft as the dialog found it: Cancel puts it back (only Discard, a save or a publish lose it)
    formDraft = { flush: () => autosave.flush(), discard: () => { autosave.cancel(); cardDrafts.back(c.id, found); } };
    form.addEventListener("input", e => {
      const box = e.target.closest?.("[data-part]");
      if (!e.isComposing && e.target.matches?.("[data-part], #ef-name, #ef-ability, #ef-note")) P.straighten(e.target);   // straight apostrophes as typed or pasted (owner 10-25)
      if (box) box.rows = rowsOf(box.value);      // the box grows with its lines
      update(); typing();
    });
    form.addEventListener("focusin", e => { const box = e.target.closest?.("[data-part]"); if (box && partForm) { partForm.last = box; mark(box.dataset.part); } });
    form.addEventListener("change", e => {
      const box = e.target.closest?.("[data-site]"), f = box?.dataset.site, el = f && document.getElementById(`ef-${f}`);
      if (box?.checked && el && form.querySelector(`[data-site-of="${f}"]`) && lastRead?.derived?.[f] != null) el.value = lastRead.derived[f];   // the boxes' text to start from
      update(); typing();
    });
    app.modal.querySelector(".lp-toggle")?.addEventListener("click", e => {
      previewOpen = !previewOpen;
      const pane = e.currentTarget.closest(".lp-pane"); pane.classList.toggle("open", previewOpen);
      e.currentTarget.setAttribute("aria-expanded", String(previewOpen)); e.currentTarget.querySelector(".lp-caret").textContent = previewOpen ? "▾" : "▸";
    });
    form.addEventListener("click", e => {
      const ans = e.target.closest(".draft-offer [data-draft]");
      if (ans) {
        form.querySelector(".draft-offer").remove(); keepOld = null;
        if (ans.dataset.draft === "restore") { draft.fillValues(form, offered, { creatures: setCreatures }); form.dispatchEvent(new Event("input", { bubbles: true })); }   // as typed: the image previews follow too
        else { autosave.cancel(); found = null; cardDrafts.drop(c.id); autosave.run(); app.toast("Unsaved edit discarded"); }   // what was typed meanwhile stays a draft
        first()?.focus();
        return;
      }
      const pb = partForm && e.target.closest("[data-part-del], [data-part-undo], [data-part-ps], [data-part-redo], [data-part-skipped], [data-part-add], [data-part-add-remove], [data-part-drop], [data-part-pic], [data-part-jump]");
      if (pb) {
        const d = pb.dataset, box = k => view.list.find(x => x.key === k), set = (k, t) => { const el = partEl(k); if (el) { el.value = t; el.rows = rowsOf(t); el.focus(); } };
        if (d.partPic) { if (d.partPic !== c.id) { autosave.flush(); openForm(d.partPic); } return; }
        if (d.partJump) { const el = partEl(d.partJump); el?.scrollIntoView({ block: "nearest" }); el?.focus(); return; }
        if (d.partDel) partForm.deleted.add(d.partDel);
        else if (d.partUndo) { partForm.deleted.delete(d.partUndo); partEl(d.partUndo)?.focus(); }
        else if (d.partPs) { partForm.drops.add(d.partPs); set(d.partPs, box(d.partPs).part.text); pb.closest(".part-warn")?.remove(); }
        else if (d.partRedo) { set(d.partRedo, box(d.partRedo).edit.text); pb.closest(".part-warn")?.remove(); }
        else if (d.partSkipped) set(d.partSkipped, box(d.partSkipped).skipped.text || "");
        else if (pb.hasAttribute("data-part-add")) { partForm.added = true; paintBoxes(); partEl(P.ADD)?.focus(); }
        else if (pb.hasAttribute("data-part-add-remove")) { partForm.added = false; const el = partEl(P.ADD); if (el) el.value = ""; }
        else if (d.partDrop) partForm.drops.add(d.partDrop);
        update(); typing(); return;
      }
      if (e.target.closest("[data-type], [data-insert], [data-reset], [data-creature]")) typing();
      const t = e.target.closest("[data-type]");
      if (t) { const on = !t.classList.contains("on"); t.classList.toggle("on", on); t.setAttribute("aria-pressed", on); update(); return; }
      const ins = e.target.closest("[data-insert]");
      if (ins) { const box = siteOn("ability") && ta ? ta : partForm?.last?.isConnected ? partForm.last : (ta?.closest("[hidden]") ? null : ta) || form.querySelector(".part-box[data-kind=ability] [data-part]"); if (!box) return;
        const s = box.selectionStart, end = box.selectionEnd; box.setRangeText(ins.dataset.insert, s, end, "end"); box.focus(); update(); return; }
      const r = e.target.closest("[data-reset]");
      if (r) { resetField(c, r.dataset.reset); update(); return; }
      const cr = e.target.closest("[data-creature]");
      if (cr) { creatureAction(cr.dataset.creature); update(); }
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const op = readForm(c);
      if (op.error) { app.toast(op.error); return; }
      autosave.cancel(); cardDrafts.drop(c.id); formDraft = null;          // in the batch now
      const routed = routeOps(c, op, lastRead);    // a picture's PSD fields: the PSD's entry
      for (const [x, o] of routed) { if (opEmpty(o)) delete stage.cards[x.id]; else stage.cards[x.id] = o; }
      save();
      app.toast(routed.every(([, o]) => opEmpty(o)) ? "No changes" : `Added to the batch: ${count()} unpublished`);
      if (isRule(c)) { app.closeModal(); app.rerender(); } else app.goCard(c.id);
    });
    update();
    if (!isRule(c)) app.formOpened?.({ form, card: c, read: () => readForm(c), base: baseOf(c) });   // the image previews (preview.js)
    if (partForm) paintBoxes();
    first()?.focus();
    if (restored) autosave.run();
    form.querySelector(".draft-offer [data-draft=restore]")?.focus();   // an offer: a stray key can't throw the draft away
  }
  function resetField(c, f) {
    const p = psdVal(baseOf(c), f), el = document.getElementById(`ef-${f}`);
    if (f === "types") { for (const t of document.querySelectorAll("#ef-types [data-type]")) { const on = (p || []).includes(t.dataset.type); t.classList.toggle("on", on); t.setAttribute("aria-pressed", on); } return; }
    if (f === "creatures") { document.getElementById("ef-creatures").innerHTML = (p || []).map(creatureRow).join(""); if (!p) creatureAction("remove"); return; }
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!p;
    else el.value = Array.isArray(p) ? p.join(", ") : p ?? "";
  }

  // ---- profiles: site/profiles/<login>.json, one more file in the batch (your own; admins anyone's), edited on the page
  // #/u/<login>/edit: the form left, a live preview of the profile right. The draft stays in memory per login while the page
  // is loaded; the browser asks before leaving while it's dirty (the card dialog too).
  const PLABEL = { author: "Cards as", motto: "Motto", series: "Series", ...Object.fromEntries(PICKS), deck: "Featured hand", facts: "Pairs" };
  const profileCtx = () => ({ cards: new Map(S.cards.map(c => [c.id, c])), series: new Set(S.cards.map(c => c.series).filter(Boolean)), people: S.data.people || [] });
  const mine = login => login.toLowerCase() === me.login.toLowerCase();
  const findKey = (obj, login) => Object.keys(obj).find(k => k.toLowerCase() === login.toLowerCase());
  const drafts = new Map();                        // login (lower) -> form state, while the form differs from the profile
  let carry = null;                                // {key, link, slot, picker}: what the draft doesn't hold, kept over a rebuild
  const forget = login => { drafts.delete(login.toLowerCase()); if (carry?.key === login.toLowerCase()) carry = null; };
  function keep() {                                // the page's form, before profilePage replaces it: the link box's text, the open picker
    const form = app.view.querySelector("#edit-form[data-login]");
    if (!form) return;
    const panel = form.querySelector("#pf-picker");
    carry = { key: form.dataset.login.toLowerCase(), link: form.querySelector("#pf-deck-link").value,
      slot: panel.hidden ? "" : panel.dataset.slot || "", picker: panel.hidden ? null : pick.read(panel) };
  }
  let booting = device.has() || !!legacy();        // the kept token's sign-in hasn't settled yet
  let pageRun = 0;                                 // profilePage calls: a newer one aborts the older
  window.addEventListener("beforeunload", e => { if (document.querySelector('#edit-form[data-dirty="1"]')) { e.preventDefault(); e.returnValue = ""; } });
  function profileOf(login) {                      // unpublished state: {profile | null (removed), state: "staged" | "sent"}, or null
    let k = findKey(stage.profiles, login);
    if (k !== undefined) return { profile: stage.profiles[k], state: "staged" };
    const sent = sentProfiles(); k = findKey(sent, login);
    return k === undefined ? null : { profile: sent[k], state: "sent" };
  }
  const pendingProfiles = () => new Map([...Object.entries(sentProfiles()).map(([k, p]) => [k.toLowerCase(), { profile: p, state: "sent" }]),
    ...Object.entries(stage.profiles).map(([k, p]) => [k.toLowerCase(), { profile: p, state: "staged" }])]);
  function describeProfile(p) {
    const show = k => (k === "facts" ? p.facts.map(f => `${f.label} = ${f.value}`).join(", ") : k === "deck" ? decodeDeck(p.deck)?.name || "a hand"
      : PICKS.some(([x]) => x === k) ? S.byId.get(p[k])?.name || p[k] : p[k]);
    return Object.keys(PLABEL).filter(k => p[k]).map(k => `${PLABEL[k]}: ${show(k)}`);
  }
  function openProfile(login = "") {               // go to the profile's page editor: your own, or anyone's for admins
    if (!me) { openHub("Sign in to make your profile.", () => openProfile(login)); return; }
    login ||= me.login;
    app.closeModal();
    if (!mine(login) && !me.admin) {                 // signed in from the editor's placeholder without the right: back to the person
      app.toast("Only admins can edit someone else's profile");
      if (app.route().edit) location.replace(`#/u/${encodeURIComponent(login)}`);
      return;
    }
    app.goEdit(login);
  }
  const factRow = (f = { label: "", value: "" }) => `<div class="frow"><input data-fl maxlength="${LIMITS.label}" value="${esc(f.label)}" placeholder="Label" aria-label="Label"><input data-fv maxlength="${LIMITS.value}" value="${esc(f.value)}" placeholder="Value" aria-label="Value"><button type="button" class="ghost icon" data-fact="remove" aria-label="Remove this pair">✕</button></div>`;
  const slotHtml = ([k, label], id = "") => {      // a card slot: the chosen card's tile, or an empty slot; Pick opens the picker
    const c = id ? S.byId.get(id) : null;
    return `<div class="pslot" data-slot="${k}"><div class="pick-label">${esc(label)}</div>
      ${c ? app.tile(c) : `<div class="slot">${id ? "Unknown card" : k.endsWith("Item") ? "No item" : "No card"}</div>`}
      <div class="actions"><button type="button" class="ghost" data-pf-pick="${k}">Pick</button>${id ? `<button type="button" class="ghost" data-pf-clear="${k}">Clear</button>` : ""}</div>
      <input type="hidden" id="pf-${k}" value="${esc(id)}"></div>`;
  };
  const handHtml = code => {                       // the featured hand as stored: its name and size
    if (!code) return `<span class="muted">No featured hand.</span>`;
    const d = decodeDeck(code);
    return `${d ? `<b>${esc(d.name)}</b> <span class="muted">${d.cards.length + (d.field ? 1 : 0)} cards</span>` : `<span class="err">Not a deck builder share link</span>`} <button type="button" class="ghost" data-hand="">Clear</button>`;
  };
  const handsHtml = decks => savedHands(decks).map(h => `<button type="button" data-hand="${esc(h.id)}"${h.n ? "" : " disabled"} title="Use this saved hand">${esc(h.name)} <span class="muted">${h.n}</span></button>`).join("");
  function profilePageHtml(p, st, exists) {
    const row = (f, label, input) => `<div class="erow" data-row="${f}"><label for="pf-${f}">${label}</label><div class="ein">${input}</div></div>`;
    const own = mine(p.login), series = [...profileCtx().series].sort((a, b) => a.localeCompare(b));
    return `<div class="profile-edit">
      <form id="edit-form" class="edit-form panel" autocomplete="off" data-login="${esc(p.login)}" aria-label="Edit profile">
        <h2>${own ? "Your profile" : `${esc(p.login)}'s profile`}</h2>
        <p class="muted">Everything is optional. Goes into your batch as <span class="kbd">${esc(files().profiles)}/${esc(p.login)}.json</span>; the page is u/${esc(p.login)}/.</p>
        <fieldset><legend>About</legend>
          ${row("author", "Cards as", `<input id="pf-author" data-suggest="author" autocomplete="off" value="${esc(st.author)}" placeholder="the name on your cards"><span class="muted">Links the profile to your cards (the name in Card Authors.txt).</span>`)}
          ${row("motto", "Motto", `<input id="pf-motto" maxlength="${LIMITS.motto}" value="${esc(st.motto)}" placeholder="one line">`)}
          ${row("series", "Series", `<select id="pf-series"><option value="">—</option>${opts(series.map(x => [x, x]), st.series)}</select>`)}
        </fieldset>
        <fieldset><legend>Cards</legend>
          <div class="pslots">${PICKS.map(x => slotHtml(x, st[x[0]])).join("")}</div>
          <div id="pf-picker" class="pick-panel" hidden><div class="toolbar"><b id="pf-picker-title"></b><button type="button" class="ghost" data-pf-pickclose>Close</button></div><div id="pf-picker-body"></div></div>
        </fieldset>
        <fieldset><legend>Featured hand</legend>
          <div id="pf-hand" class="hand-now">${handHtml(st.deck)}</div><input type="hidden" id="pf-deck" value="${esc(st.deck)}">
          <div class="actions">${handsHtml(app.savedDecks())}</div>
          <input id="pf-deck-link" class="wide" placeholder="…or paste a deck builder share link" aria-label="Share link">
          <p class="muted egroup-note">The hand is stored as it is now: later changes in the deck builder don't follow.</p>
        </fieldset>
        <fieldset><legend>More</legend><p class="muted egroup-note">Up to ${LIMITS.facts} label/value pairs, anything you like.</p>
          <div id="pf-facts">${(st.facts.length ? st.facts : [undefined]).map(f => factRow(f)).join("")}</div>
          <div class="actions"><button type="button" class="ghost" data-fact="add">+ Pair</button></div>
        </fieldset>
        <div class="edit-summary muted" id="pf-summary" aria-live="polite"></div>
        <div class="actions"><button type="submit" class="primary">Add to batch</button><button type="button" data-action="edit-cancel">Cancel</button>
          ${exists ? `<button type="button" class="ghost danger" data-action="profile-remove" data-login="${esc(p.login)}" style="margin-left:auto">Remove profile</button>` : ""}</div>
      </form>
      <aside class="edit-preview" aria-label="Preview"><h3 class="egroup">Preview</h3><div id="pf-preview"></div></aside></div>`;
  }
  function readState(form) {                       // the form -> profileState's shape (the pasted link moves into #pf-deck once it decodes)
    const v = id => form.querySelector(`#pf-${id}`).value;
    return { author: v("author"), motto: v("motto"), series: v("series"), ...Object.fromEntries(PICKS.map(([k]) => [k, v(k)])), deck: v("deck"),
      facts: [...form.querySelectorAll("#pf-facts .frow")].map(r => ({ label: r.querySelector("[data-fl]").value, value: r.querySelector("[data-fv]").value })) };
  }
  async function profilePage(login) {              // the route #/u/<login>/edit
    // still the page to show after the await: no newer call, and the view's route (S.listHash: a card dialog above keeps it) unchanged
    const run = ++pageRun, start = S.listHash, here = () => run === pageRun && S.listHash === start;
    keep();
    if (!me) {
      app.view.innerHTML = `<div class="profile"><div class="empty">${booting ? "Signing in…" : `Sign in to edit this profile.<p><button type="button" class="primary" data-action="profile-signin" data-login="${esc(login)}">Sign in</button></p>`}</div></div>`;
      if (!booting) openHub(`Sign in to edit ${login}'s profile.`, () => openProfile(login));
      return;
    }
    if (!mine(login) && !me.admin) { app.toast("Only admins can edit someone else's profile"); location.replace(`#/u/${encodeURIComponent(login)}`); return; }
    if (!S.userBy) app.view.innerHTML = `<div class="loading">Loading the profile…</div>`;
    const published = (await app.users().catch(() => new Map())).get(login.toLowerCase()) || null;
    if (!here()) return;
    const pending = profileOf(login), live = pending?.state === "sent" ? pending.profile : published;   // the file in the repo (null: none)
    const p = (pending ? pending.profile : published) || { login: live?.login || (mine(login) ? me.login : login) };   // the file's own spelling
    const base = (pending ? pending.profile : published) || { login: p.login };        // what an untouched form reads as
    const key = p.login.toLowerCase(), own = mine(p.login);
    keep();
    const kept = carry?.key === key ? carry : null; carry = null;
    app.view.innerHTML = profilePageHtml(p, drafts.get(key) || profileState(p), !!live);   // in the repo: it can be removed
    const form = app.view.querySelector("#edit-form"), q = sel => form.querySelector(sel), previewEl = app.view.querySelector("#pf-preview");
    const update = () => {
      const st = readState(form), r = validateProfile({ login: p.login, ...st }, profileCtx()), lines = describeProfile(r.profile);
      if (q("#pf-deck-link").value.trim()) r.errors.unshift("Featured hand: not a deck builder share link");   // the box only keeps text that didn't decode
      q("#pf-summary").innerHTML = r.errors.length ? `<span class="err">${r.errors.map(esc).join(" · ")}</span>` : lines.length ? lines.map(esc).join(" · ") : "Nothing but your login yet.";
      const dirty = !sameProfile(r.profile, base);
      form.dataset.dirty = dirty ? "1" : "";
      if (dirty) drafts.set(key, st); else drafts.delete(key);
      previewEl.innerHTML = profileHtml({ login: p.login, profile: r.profile, own, byId: S.byId, cards: S.cards, tile: app.tile, preview: true });
      return r;
    };
    const setSlot = (k, id) => { q(`[data-slot="${k}"]`).outerHTML = slotHtml(PICKS.find(([x]) => x === k), id); };
    const setHand = code => { q("#pf-deck").value = code; q("#pf-deck-link").value = ""; q("#pf-hand").innerHTML = handHtml(code); };
    const closePicker = () => { q("#pf-picker").hidden = true; q("#pf-picker").dataset.slot = ""; q("#pf-picker-body").innerHTML = ""; };
    const openPicker = (k, initial = null, focus = true) => {
      const [, label] = PICKS.find(([x]) => x === k), item = k.endsWith("Item");
      q("#pf-picker").hidden = false; q("#pf-picker").dataset.slot = k; q("#pf-picker-title").textContent = `${label}: pick a card`;
      pick.mount(q("#pf-picker-body"), { cards: S.cards, filter: item ? c => ITEM_KINDS.has(c.type) : null, tile: app.tile, kinds: app.kinds, kindOf: app.kindOf,
        initial, focus,
        onChoose: id => { setSlot(k, id); closePicker(); update(); q(`[data-pf-pick="${k}"]`).focus(); } });
    };
    const outsidePicker = e => !e.target.closest("#pf-picker");
    form.addEventListener("input", e => { if (outsidePicker(e)) update(); });
    form.addEventListener("change", e => { if (outsidePicker(e)) update(); });
    form.addEventListener("click", e => {
      const t = sel => e.target.closest(sel);
      if (t("[data-pf-pick]")) { openPicker(t("[data-pf-pick]").dataset.pfPick); return; }
      if (t("[data-pf-clear]")) { setSlot(t("[data-pf-clear]").dataset.pfClear, ""); update(); return; }
      if (t("[data-pf-pickclose]")) { closePicker(); return; }
      if (t("[data-hand]")) { const d = app.savedDecks().find(x => x.id === t("[data-hand]").dataset.hand); setHand(d ? encodeDeck(d) : ""); update(); return; }
      const fact = t("[data-fact]")?.dataset.fact;
      if (fact === "add") { q("#pf-facts").insertAdjacentHTML("beforeend", factRow()); q("#pf-facts .frow:last-child input").focus(); }
      else if (fact === "remove") { t(".frow").remove(); update(); }
    });
    q("#pf-deck-link").addEventListener("input", e => { const code = deckCode(e.target.value); if (e.target.value.trim() && decodeDeck(code)) { setHand(code); update(); } });
    q("#pf-deck-link").addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });   // not the form's submit
    form.addEventListener("submit", e => {
      e.preventDefault();
      const { profile, errors } = update();
      if (errors.length) { app.toast(errors[0]); return; }
      if (sameProfile(profile, live)) delete stage.profiles[p.login]; else stage.profiles[p.login] = profile;
      save();
      forget(key); form.dataset.dirty = "";
      app.toast(stage.profiles[p.login] ? `Added to the batch: ${count()} unpublished` : "Same as the published profile");
      app.goUser(p.login);
    });
    if (kept?.link) q("#pf-deck-link").value = kept.link;   // text that didn't decode: update() still refuses it
    update();
    if (kept?.slot && PICKS.some(([x]) => x === kept.slot)) openPicker(kept.slot, kept.picker, app.modal.hidden);   // the picker stays open
    else if (app.modal.hidden) q("#pf-author").focus();   // not when rebuilt under a dialog (a rerender from the review or a card)
  }

  // ---- published decks: site/decks/<owner>/<slug>.json, one more file in the batch (your own; admins anyone's). The dialog
  // (decks.js publishFormHtml) stages the FILE object: a public one in clear, a private one encrypted here and now, so the
  // passphrase is never stored. Keys are "<owner>/<slug>" with the owner as GitHub spells it; lookups ignore case.
  function deckOf(owner, slug) {                   // unpublished state: {file | null (removed), state, key}, or null
    const want = decks.keyOf(owner, slug), k = Object.keys(stage.decks).find(x => x.toLowerCase() === want);
    if (k !== undefined) return { file: stage.decks[k], state: "staged", key: k };
    const sent = sentDecks(), k2 = Object.keys(sent).find(x => x.toLowerCase() === want);
    return k2 === undefined ? null : { file: sent[k2], state: "sent", key: k2 };
  }
  const pendingDecks = () => new Map([...Object.entries(sentDecks()).map(([k, f]) => [k.toLowerCase(), { file: f, state: "sent" }]),
    ...Object.entries(stage.decks).map(([k, f]) => [k.toLowerCase(), { file: f, state: "staged" }])]);
  const dropDeck = key => { delete stage.decks[key]; delete stage.deckNames[key]; };
  function describeDeck(key, f) {
    if (f.private) return [`Private: encrypted with its passphrase · ${files().decks}/${key}.json`];
    const cards = (f.cards || []).map(id => S.byId.get(id)?.name).filter(Boolean);
    return [`${f.private ? "Private" : "Public"} · ${decks.countOf(f)} cards · ${files().decks}/${key}.json`, ...(f.description ? [f.description] : []),
      cards.join(", ") + (f.field ? ` · field card ${S.byId.get(f.field)?.name || f.field}` : "")];
  }
  /** The publish dialog for a saved hand. opts: owner and slug (fixed) with the visibility when replacing a published deck. */
  async function openPublish(id, { owner = "", slug = "", visibility = "" } = {}) {
    const hand = app.savedDecks().find(d => d.id === id);
    if (!hand) { app.toast("That hand isn't in My decks any more"); return; }
    if (!me) { openHub("Sign in to publish a hand.", () => openPublish(id, { owner, slug, visibility })); return; }
    owner ||= me.login;
    if (!mine(owner) && !me.admin) { app.toast("Only admins can publish someone else's deck"); return; }
    const { deck: hand0, dropped } = decks.validateDeck(hand, { byId: S.byId });
    const list = (await app.decks().catch(() => [])).filter(d => d.owner.toLowerCase() === owner.toLowerCase());   // the owner's decks, pending included
    const published = new Map(list.map(d => [d.slug, d]));
    app.showDialog(decks.publishFormHtml({ name: hand.name, visibility: visibility || "public", lock: !!slug, n: decks.countOf(hand0), dropped: dropped.length }));
    const form = app.modal.querySelector("#edit-form"), q = sel => form.querySelector(sel);
    let keepBoth = false;
    const slugNow = () => { const base = decks.slugOf(q("#pd-name").value); return slug || (keepBoth && published.has(base) ? decks.uniqueSlug(base, published.keys()) : base); };
    const read = () => ({ visibility: form.querySelector("[name=pd-vis]:checked")?.value === "private" ? "private" : "public", pass: q("#pd-pass").value, pass2: q("#pd-pass2").value,
      ...decks.validateDeck({ name: q("#pd-name").value, description: q("#pd-desc").value, cards: hand0.cards, field: hand0.field }, { byId: S.byId }) });
    const update = (dirty = true) => {
      const r = read(), s = slugNow(), base = decks.slugOf(q("#pd-name").value), was = published.get(s), clash = !slug && published.get(base);
      q("#pd-private").hidden = r.visibility !== "private";
      if (r.visibility === "private") {
        if (r.pass.length < decks.LIMITS.passphrase) r.errors.push(`Passphrase: at least ${decks.LIMITS.passphrase} characters`);
        else if (r.pass !== r.pass2) r.errors.push("Passphrase: the two don't match");
      }
      q("#pd-path").innerHTML = `<span class="kbd">${esc(`${files().decks}/${owner}/${s}.json`)}</span>${was ? ` · replaces <b>${esc(was.private ? "a private deck" : was.name)}</b>` : ""}` +
        (clash ? ` <button type="button" class="ghost" data-pd-keep>${keepBoth ? "Replace it instead" : "Keep both"}</button>` : "");
      q("#pd-summary").innerHTML = r.errors.length ? `<span class="err">${r.errors.map(esc).join(" · ")}</span>` : `${r.visibility === "private" ? "Encrypted in this browser; the batch holds only the ciphertext." : "Everyone can open it."}`;
      if (dirty) form.dataset.dirty = "1";
      return { ...r, slug: s };
    };
    form.addEventListener("input", () => update());
    form.addEventListener("change", () => update());
    form.addEventListener("click", e => { if (e.target.closest("[data-pd-keep]")) { keepBoth = !keepBoth; update(); } });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const r = update(false);
      if (r.errors.length) { app.toast(r.errors[0]); return; }
      const btn = form.querySelector("[type=submit]"); btn.disabled = true;
      try {
        let file;
        if (r.visibility === "private") {
          const subtle = globalThis.crypto?.subtle;
          if (!subtle) throw new Error("Encrypting needs a secure page (https or localhost)");
          q("#pd-summary").textContent = "Encrypting…";
          file = await decks.encrypt(subtle, r.pass, owner, r.slug, r.deck);
        } else file = decks.fileOf({ owner, ...r.deck });
        file.updated = new Date().toISOString().replace(/\.\d+Z$/, "Z");           // publish() stamps the real time
        if (decks.fileText(file).length > decks.LIMITS.file) throw new Error("The deck file would be over 16 KB");
        const key = findKey(stage.decks, `${owner}/${r.slug}`) ?? `${owner}/${r.slug}`;
        dropDeck(key); stage.decks[key] = file; stage.deckNames[key] = r.deck.name;
        save(); form.dataset.dirty = "";
        app.closeModal(); app.toast(`Added to the batch: ${count()} unpublished`); app.rerender();
      } catch (err) { btn.disabled = false; q("#pd-summary").innerHTML = `<span class="err">${esc(err.message)}</span>`; }
    });
    update(false);
    q("#pd-name").focus();
  }

  // ---- publishing
  function section(lines, name) {
    const s = lines.findIndex(l => l.trim().toLowerCase() === `[${name}]`);
    if (s < 0) return null;
    let e = s + 1; while (e < lines.length && !/^\s*\[.+\]\s*$/.test(lines[e])) e++;
    return [s + 1, e];
  }
  const GROUP = /^# --- credited to (.+) \((\d+)\) ---$/;
  function bump(lines, who, by) {
    const i = lines.findIndex(l => GROUP.exec(l.trim())?.[1] === who);
    if (i >= 0) { const m = GROUP.exec(lines[i].trim()); lines[i] = `# --- credited to ${who} (${Math.max(0, +m[2] + by)}) ---`; }
    return i;
  }
  function authorsFile(text, ops, people) {
    const lines = (text ?? "[people]\n\n[cards]\n").split("\n");
    if (!section(lines, "people")) lines.unshift("[people]", "");
    if (!section(lines, "cards")) lines.push("", "[cards]");
    for (const [git, shown] of Object.entries(people)) {
      const [s, e] = section(lines, "people");
      const i = lines.slice(s, e).findIndex(l => !l.trim().startsWith("#") && l.split("=")[0].trim().toLowerCase() === git.toLowerCase());
      if (i >= 0) lines[s + i] = `${lines[s + i].split("=")[0].trim()} = ${shown}`;
      else { let j = e; while (j > s && !lines[j - 1].trim()) j--; lines.splice(j, 0, `${git} = ${shown}`); }
    }
    for (const op of ops) {
      if (op.author === undefined) continue;
      let [s, e] = section(lines, "cards");
      const i = lines.slice(s, e).findIndex(l => !l.trim().startsWith("#") && l.includes("=") && cardKey(l.split("=")[0]) === cardKey(op.key));
      if (i >= 0) { bump(lines, lines[s + i].split("=").slice(1).join("=").trim(), -1); lines.splice(s + i, 1); [s, e] = section(lines, "cards"); }
      if (!op.author) continue;
      const line = `${op.key} = ${op.author}`;
      let g = bump(lines, op.author, 1);
      if (g < 0) {                                   // new group, before the rulebook pages
        const rb = lines.findIndex((l, j) => j >= s && j < e && l.trim() === "# --- rulebook pages ---");
        let at = rb >= 0 ? rb : e; while (at > s && !lines[at - 1].trim()) at--;
        lines.splice(at, 0, "", `# --- credited to ${op.author} (1) ---`, line);
        continue;
      }
      let j = g + 1;                                 // alphabetical within the group
      while (j < lines.length && lines[j].trim() && !lines[j].trim().startsWith("#") && lines[j].localeCompare(line, undefined, { sensitivity: "base" }) < 0) j++;
      lines.splice(j, 0, line);
    }
    return lines.join("\n");
  }
  function banFile(text, ops) {
    const lines = (text ?? "").split("\n");
    const isHead = l => l.trim().endsWith(":");
    const entryName = l => l.split(" - ")[0];
    for (const op of ops) {
      if (!op.ban) continue;
      const names = new Set([op.name, op.key, S.byId.get(op.id)?.name].filter(Boolean).map(alnum));
      const line = `${op.name} - ${op.ban.reason || "banned"}`;
      const i = lines.findIndex(l => l.trim() && !isHead(l) && (names.has(alnum(entryName(l))) || names.has(alnum(entryName(l).replace(/\(.*?\)/g, "")))));
      if (i >= 0) {
        let h = i; while (h >= 0 && !isHead(lines[h])) h--;
        if (op.ban.banned && h >= 0 && lines[h].trim().slice(0, -1).trim().toLowerCase() === op.ban.group.toLowerCase()) { lines[i] = line; continue; }
        lines.splice(i, 1);
      }
      if (!op.ban.banned) continue;
      let h = lines.findIndex(l => isHead(l) && l.trim().slice(0, -1).trim().toLowerCase() === op.ban.group.toLowerCase());
      if (h < 0) { while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); lines.push("", `${op.ban.group}:`); h = lines.length - 1; }
      let j = h + 1; while (j < lines.length && lines[j].trim() && !isHead(lines[j])) j++;
      lines.splice(j, 0, line);
    }
    return lines.join("\n");
  }
  // the drafted fields an op covers: other fields' drafts (a card a rename reached) stay
  const opFields = op => [...Object.keys(op.set || {}), ...Object.keys(op.set?.parts || {}).map(k => P.PART + k), ...(op.unset || []), ...(op.author !== undefined ? ["author"] : []),
    ...(op.ban ? ["banned", "ban-group", "ban-reason"] : []), ...(op.rate ? RATE.map(k => `rate-${k}`) : []), ...(op.rename !== undefined ? ["rename"] : [])];
  const dropDrafts = ops => { for (const op of ops) cardDrafts.drop(op.id, opFields(op)); };
  async function publish(message) {
    const ops = Object.values(stage.cards), people = stage.people, F = files();
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const edits = {};
    const clashes = new Map();                     // boxes someone else edited since they were staged: "op name: layer"
    const clash = (op, keys, theirs) => { for (const k of keys) clashes.set(`${op.name}: ${op.set.parts?.[k]?.layer || theirs?.[k]?.layer || k}`, theirs?.[k]?.text ?? (theirs?.[k]?.delete ? "(delete)" : "(none)")); };
    if (ops.some(o => Object.keys(o.set).length || o.unset.length || o.rename !== undefined)) edits[F.edits] = t => editsFile(t, ops, at, me.login, F.edits, clash);
    if (ops.some(o => o.author !== undefined) || Object.keys(people).length) edits[F.authors] = t => authorsFile(t, ops, people);
    if (ops.some(o => o.ban)) edits[F.banlist] = t => banFile(t, ops);
    if (ops.some(o => o.rate)) edits[F.ratings] = t => ratingsFile(t, ops, pacificDay(new Date(at)), me.login, F.ratings);
    if (stage.admins) edits[F.admins] = t => [...(t ?? "").split("\n").filter(l => l.trim().startsWith("#")), ...stage.admins].join("\n") + "\n";
    const foreign = Object.keys(stage.profiles).filter(l => !mine(l));
    if (foreign.length && !me.admin) throw new Error(`Only admins can publish someone else's profile (${foreign.join(", ")}): discard it from the batch.`);
    const profiles = Object.fromEntries(Object.entries(stage.profiles).map(([l, p]) => [l, p && { ...p, updated: at }]));
    for (const [login, p] of Object.entries(profiles)) edits[`${F.profiles}/${login}.json`] = t => (p ? profileFile(p) : t == null ? null : false);   // new, replaced or deleted
    const others = Object.keys(stage.decks).filter(k => !mine(k.split("/")[0]));
    if (others.length && !me.admin) throw new Error(`Only admins can publish someone else's deck (${others.join(", ")}): discard it from the batch.`);
    const decksOut = Object.fromEntries(Object.entries(stage.decks).map(([k, f]) => [k, f && { ...f, updated: at }]));
    for (const [key, f] of Object.entries(decksOut)) edits[`${F.decks}/${key}.json`] = t => (f ? decks.fileText(f) : t == null ? null : false);   // site/decks/<owner>/<slug>.json
    const names = ops.map(o => o.name);
    const what = [...names, ...(Object.keys(people).length ? ["people"] : []), ...(stage.admins ? ["admins"] : []), ...Object.keys(profiles).map(l => `${l}'s profile`),
      ...Object.entries(decksOut).map(([k, f]) => (f ? (f.private ? `private deck ${k}` : `deck ${f.name || k}`) : `deck ${k} removed`))];   // a private deck's name stays out of the public commit message
    const got = {}, sha = await commitFiles(edits, message || (what.length > 3 ? `Website edits: ${what.length} changes` : `Website edit: ${what.join(", ")}`), got);
    if (sha && clashes.size) app.toast(`Someone else edited ${clashes.size === 1 ? "this box" : "these boxes"} meanwhile; yours replaced theirs: ${[...clashes].map(([w, t]) => `${w} (theirs: “${t.length > 40 ? `${t.slice(0, 38)}…` : t}”)`).join(" · ")}`);
    const sent = sentRecord() || {};
    if (sha) localStorage.setItem(K.sent, JSON.stringify({ at, committed: got.date, sha, ops: [...sentOps(), ...ops], profiles: { ...sentProfiles(), ...profiles },
      decks: { ...sentDecks(), ...decksOut }, people: { ...sentPeople(), ...people }, deckNames: { ...(sent.deckNames || {}), ...stage.deckNames } }));   // no commit: no rebuild to wait for (the site already has it)
    if (sha) soon();                                   // reloads when its build is live (fresh.js)
    if (stage.admins) S.data.admins = stage.admins;
    dropDrafts(ops);                                     // published: their fields' drafts are done with
    stage = emptyStage();
    save();
    return sha;
  }

  // ---- batch tray and hub
  // the batch bar: every pending edit as a sentence, each with a revert; one line (ellipsised) when long, with a toggle
  let barOpen = false;
  function renderBar() {
    let bar = document.getElementById("edit-bar");
    const n = count(), sending = !!sentRecord();
    if (!n && !sending) { bar?.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "edit-bar"; bar.className = "edit-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Unpublished edits"); document.body.append(bar); }
    if (!n) {
      bar.className = "edit-bar";
      bar.innerHTML = `<div class="bar-head"><span class="muted">Published edits show here until the site rebuilds (a few minutes).</span><button type="button" class="ghost" data-action="edit-dismiss-sent">OK</button></div>`;
      return;
    }
    const list = barItems(stage, items), m = list.length, open = barOpen || m <= 3, seen = new Set();
    const revertOf = x => (x.id ? `data-id="${esc(x.id)}" data-item="${esc(x.item)}"` : `data-item="${x.kind}"${x.login ? ` data-login="${esc(x.login)}"` : ""}${x.key ? ` data-key="${esc(x.key)}"` : ""}`);
    const li = x => {
      const first = x.id && !seen.has(x.id); if (x.id) seen.add(x.id);
      return `<li><span class="txt">${x.id ? `<a href="#/card/${esc(x.id)}">${esc(x.name)}</a>: ` : ""}${esc(x.text)}${x.psd ? ` <span class="muted" data-tip="${esc(app.PSD_TIP)}">· on the card image</span>` : ""}</span>
        <button type="button" class="ghost icon" data-action="edit-revert" ${revertOf(x)} aria-label="Revert ${esc(x.name ? `${x.name} ${LABEL[x.item] || x.item}` : x.kind)}" title="Revert">↺</button>
        ${first ? `<button type="button" class="ghost" data-action="edit-card" data-id="${esc(x.id)}">All fields</button>` : ""}</li>`;
    };
    bar.className = `edit-bar${open ? " open" : ""}`;
    bar.innerHTML = `<div class="bar-head"><span class="bar-line">✎ <b>${m}</b> unpublished change${m > 1 ? "s" : ""}${open ? "" : ` · ${list.map(x => esc(sentence(x))).join(" · ")}`}</span>
      ${m > 3 ? `<button type="button" class="ghost icon" data-action="edit-bar-toggle" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} the list">${open ? "▾" : "▸"}</button>` : ""}
      <button type="button" class="primary" data-action="edit-review">Review and publish</button><button type="button" class="ghost" data-action="edit-discard-all">Discard</button></div>
      ${open ? `<ul class="bar-list">${list.map(li).join("")}</ul>` : ""}`;
  }
  function reviewHtml(note = "") {
    const ops = Object.values(stage.cards), people = Object.entries(stage.people);
    return `<h3>Unpublished changes</h3>
      ${ops.map(op => `<div class="review-item"><div><a href="#/card/${op.id}"><b>${esc(op.name)}</b></a><ul>${describe(op).map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>
        <div class="actions"><button type="button" class="ghost" data-action="edit-card" data-id="${op.id}">Edit</button><button type="button" class="ghost" data-action="edit-discard" data-id="${op.id}">Discard</button></div></div>`).join("")}
      ${stage.admins ? `<div class="review-item"><div><b>Admins</b><ul><li>${esc(stage.admins.join(", "))}</li></ul></div><div class="actions"><button type="button" class="ghost" data-action="edit-discard-admins">Discard</button></div></div>` : ""}
      ${people.length ? `<div class="review-item"><div><b>People</b><ul>${people.map(([g, d]) => `<li>${esc(g)} shown as ${esc(d)}</li>`).join("")}</ul></div><div class="actions"><button type="button" class="ghost" data-action="edit-discard-people">Discard</button></div></div>` : ""}
      ${Object.entries(stage.profiles).map(([login, p]) => `<div class="review-item"><div><a href="#/u/${encodeURIComponent(login)}"><b>${esc(login)}'s profile</b></a><ul>${(p ? describeProfile(p) : ["Removed"]).map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>
        <div class="actions">${p ? `<button type="button" class="ghost" data-action="profile-edit" data-login="${esc(login)}">Edit</button>` : ""}<button type="button" class="ghost" data-action="edit-discard-profile" data-login="${esc(login)}">Discard</button></div></div>`).join("")}
      ${Object.entries(stage.decks).map(([key, f]) => { const [owner, slug] = key.split("/");
        return `<div class="review-item"><div><a href="${decks.deckHash(owner, slug)}"><b>Deck: ${esc(deckName(stage, key, f))}</b></a><ul>${(f ? describeDeck(key, f) : [`Removed: ${files().decks}/${key}.json`]).map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>
        <div class="actions"><button type="button" class="ghost" data-action="edit-discard-deck" data-key="${esc(key)}">Discard</button></div></div>`; }).join("")}
      ${count() ? `<label class="muted" for="edit-msg">Commit message (optional)</label><input id="edit-msg" class="wide" placeholder="Website edits">
        <div class="actions"><button type="button" class="primary" data-action="edit-publish">Publish ${count()} change${count() > 1 ? "s" : ""}</button></div>
        <p class="muted">One commit to ${esc(S.data.repo)} (${esc(S.data.branch || "main")}). The site rebuilds in a few minutes; the card sync brings it to the bot within minutes and to the PSDs within about 30 minutes.</p>` : `<p class="muted">Nothing to publish.</p>`}
      <p class="muted" id="edit-status" aria-live="polite">${esc(note)}</p>`;
  }
  let forgot = false;                              // Forgot password: after the token sign-in, set a new one
  function hubHtml(note = "") {
    if (!me) return auth.signInHtml({ mode: !forgot && (localStorage.getItem(K.last) || S.data.passwords) ? "password" : "token", last: localStorage.getItem(K.last) || "",
      note, repo: S.data.repo, logins: files().logins, forgot });
    return `<h3>Editing as ${esc(me.login)} <span class="fact">${me.admin ? "Admin" : "Editor"}</span></h3>${note ? `<p>${esc(note)}</p>` : ""}
      <p class="muted">Open a card and change it in place, or press All fields (e). Changes wait in your batch until you publish them.</p>
      <div class="actions"><button type="button" data-action="edit-review"${count() ? "" : " disabled"}>Review batch (${count()})</button>
        <label class="check"><input type="checkbox" data-action="edit-show-hidden"${S.showHidden ? " checked" : ""}> show hidden cards</label></div>
      <h4>Profile</h4><p class="muted">Your page, u/${esc(me.login)}/, shows your cards, edits and card commits; a profile adds the name on your cards, a motto, favourite cards and a featured hand.</p>
      <div class="actions"><button type="button" data-action="profile-edit">Edit profile</button><a class="fact" href="#/u/${encodeURIComponent(me.login)}">Your profile</a><a class="fact" href="#/users">All people</a></div>
      <h4>Password</h4><div id="hub-pw"><p class="muted">Checking for your password…</p></div>
      ${me.admin ? `<h4>People</h4><p class="muted">How each git name is shown.</p><form id="people-form" class="people">${peopleRows()}<div class="actions"><button type="submit">Add to batch</button></div></form>
        <h4>Admins</h4><p class="muted">GitHub logins, one per line. The repo owner is always an admin.</p>
        <form id="admins-form"><textarea id="admins-list" class="wide" rows="4">${esc((stage.admins || S.data.admins || []).join("\n"))}</textarea><div class="actions"><button type="submit">Add to batch</button></div></form>
        <h4>Password files</h4><p class="muted">Admins may remove anyone's (${esc(files().logins)}/).</p><div class="actions"><button type="button" class="ghost" data-action="pw-list">Show them</button></div><div id="pw-list"></div>` : ""}
      <p class="muted"><a href="https://github.com/${esc(S.data.repo)}/commits/${esc(S.data.branch || "main")}/${esc(files().edits)}" target="_blank" rel="noopener">Edit history</a> ·
        <a href="https://github.com/${esc(S.data.repo)}/blob/${esc(S.data.branch || "main")}/${esc(files().edits)}" target="_blank" rel="noopener">${esc(files().edits)}</a></p>
      <div class="actions"><button type="button" class="ghost" data-action="edit-signout">Sign out</button></div>`;
  }
  function peopleRows() {
    const map = S.data.peopleMap || {};
    return Object.keys(map).map(g => `<label class="erow"><span>${esc(g)}</span><input data-git="${esc(g)}" value="${esc(stage.people[g] ?? map[g])}"></label>`).join("");
  }
  function openHub(note = "", then = null) {         // then: what to open once signed in
    app.showDialog(hubHtml(note));
    const form = document.getElementById("signin-form"), pwForm = document.getElementById("signin-pw-form");
    const next = () => (then ? then() : openHub());
    if (form) {
      const box = document.getElementById("signin-token-box"), focus = () => (box.hidden ? document.getElementById(document.getElementById("signin-login").value ? "signin-password" : "signin-login") : document.getElementById("signin-token")).focus();
      const mode = m => {                          // Password | Token
        pwForm.hidden = m !== "password"; box.hidden = m === "password";
        for (const b of app.modal.querySelectorAll("[data-signin-mode]")) { const on = b.dataset.signinMode === m; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
        focus();
      };
      app.modal.querySelector(".dialog").addEventListener("click", async e => {
        const m = e.target.closest("[data-signin-mode]");
        if (m) { mode(m.dataset.signinMode); return; }
        if (e.target.closest("[data-pw-forgot]")) {    // this browser forgets; the token signs in, then a new password replaces the file
          forgot = true; localStorage.removeItem(K.last); await device.clear().catch(() => {});
          openHub(note, then);
        }
      });
      focus();
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const status = document.getElementById("signin-status");
        status.textContent = "Checking…";
        try {
          await signIn(document.getElementById("signin-token").value, document.getElementById("signin-remember").checked);
          app.toast(`Signed in as ${me.login}`);
          app.rerender();                          // the view behind the hub goes into edit mode (draggable tiles, drop lists)
          if (forgot) { forgot = false; openPassword("new", { offer: true, next }); return; }
          const file = await ownPassword(true).catch(() => undefined);     // none yet: offer one (unknown: don't)
          if (file === null) openPassword("set", { offer: true, next }); else next();
        } catch (err) { token = ""; me = null; status.textContent = err.message; }
      });
      pwForm.addEventListener("submit", async e => {
        e.preventDefault();
        const status = document.getElementById("signin-pw-status"), btn = pwForm.querySelector("[type=submit]"), pass = document.getElementById("signin-password");
        const subtle = globalThis.crypto?.subtle;
        if (!subtle) { status.textContent = "Signing in with a password needs a secure page (https or localhost)."; return; }
        btn.disabled = true;
        try {
          status.textContent = "Getting your password file…";
          const { found, stale } = await fetchPassword(document.getElementById("signin-login").value.trim());
          status.textContent = "Unlocking (about a second)…";
          let t = null, file = null, login = "";
          for (const f of found) {                 // one file, or each of those differing only in case
            try { t = await auth.unseal(subtle, pass.value, f.login, f.file); ({ file, login } = f); break; } catch (err) { if (err.code !== "wrong") throw err; }
          }
          if (t === null) throw new Error(stale ? "Wrong password. GitHub couldn't be reached, so this used the site's copy of your password file, which is a few minutes behind a change: try again later, or sign in with the token." : "Wrong password");
          status.textContent = "Checking with GitHub…";
          try { await signIn(t, document.getElementById("signin-pw-remember").checked, { expect: login }); }
          catch (err) { throw err.status === 401 ? new Error(`The token in ${login}'s password file no longer works (expired or deleted on GitHub): sign in with a new token, then set your password again.`) : err; }
          localStorage.setItem(K.last, me.login); pwKnown = { login: me.login, file }; forgot = false;
          app.toast(`Signed in as ${me.login}`);
          app.rerender();
          next();
        } catch (err) { token = ""; me = null; btn.disabled = false; status.textContent = err.message; pass.select(); }
      });
    }
    if (me && document.getElementById("hub-pw")) {
      ownPassword().then(file => { const el = document.getElementById("hub-pw"); if (el && me) el.innerHTML = pwHubHtml(file); },
        err => { const el = document.getElementById("hub-pw"); if (el) el.innerHTML = `<p class="muted">Couldn't check for your password (${esc(err.message)}).</p>`; });
    }
    document.getElementById("admins-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const list = [...new Set(document.getElementById("admins-list").value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean))];
      stage.admins = same(list, S.data.admins || []) ? null : list;
      save(); openHub(`${count()} unpublished change${count() === 1 ? "" : "s"}`);
    });
    document.getElementById("people-form")?.addEventListener("submit", e => {
      e.preventDefault();
      for (const input of e.target.querySelectorAll("[data-git]")) {
        const g = input.dataset.git, v = input.value.trim() || g, was = (S.data.peopleMap || {})[g] ?? g;
        if (v === was) delete stage.people[g]; else stage.people[g] = v;
      }
      save(); openHub(`${count()} unpublished change${count() === 1 ? "" : "s"}`);
    });
  }

  async function offerAfterBoot() {                // a plain-text token was sealed on this load: offer a password once
    offerOnBoot = false;
    const file = await ownPassword().catch(() => undefined);
    if (file !== null || !me) return;
    if (app.modal.hidden && !document.getElementById("edit-form")) openPassword("set", { offer: true });
    else app.toast("Your sign-in is now kept encrypted. Set a password in the Sign in menu (top right)");
  }

  const actions = {
    "edit-hub": () => openHub(),
    "edit-card": el => openForm(el.dataset.id || app.currentCard()),
    "edit-cancel": () => {                       // the card dialog's form, else the profile page's
      const form = app.modal.querySelector("#edit-form") || document.getElementById("edit-form");
      if (form?.dataset.dirty && !confirm("Discard these changes?")) return;
      if (form && !app.modal.contains(form)) { forget(form.dataset.login); form.dataset.dirty = ""; location.replace(`#/u/${encodeURIComponent(form.dataset.login)}`); return; }
      const id = app.currentCard();
      if (form) { formDraft?.discard(); formDraft = null; }      // what was typed goes; a draft from before the dialog stays
      if (id) app.goCard(id); else app.closeModal();
    },
    "edit-review": () => app.showDialog(reviewHtml()),
    "edit-discard": el => { delete stage.cards[el.dataset.id]; cardDrafts.drop(el.dataset.id); save(); app.showDialog(reviewHtml("Discarded.")); app.rerender(); },
    "edit-discard-people": () => { stage.people = {}; save(); app.showDialog(reviewHtml("Discarded.")); },
    "edit-discard-admins": () => { stage.admins = null; save(); app.showDialog(reviewHtml("Discarded.")); },
    "edit-discard-all": () => { if (!confirm(`Discard ${count()} unpublished change${count() > 1 ? "s" : ""}?`)) return; dropDrafts(Object.values(stage.cards)); stage = emptyStage(); save(); app.rerender(); },
    "edit-discard-profile": el => { delete stage.profiles[el.dataset.login]; save(); app.showDialog(reviewHtml("Discarded.")); app.rerender(); },
    "edit-discard-deck": el => { dropDeck(el.dataset.key); save(); app.showDialog(reviewHtml("Discarded.")); app.rerender(); },
    // published decks: Publish… on a saved hand, Unpublish and Replace with… on a deck page (own decks; admins any)
    "deck-unpublish": el => {
      const { owner, slug } = el.dataset;
      if (!me) { openHub("Sign in to unpublish a deck."); return; }
      if (!mine(owner) && !me.admin) { app.toast("Only admins can unpublish someone else's deck"); return; }
      if (!confirm(`Unpublish this deck? ${files().decks}/${owner}/${slug}.json goes with your next publish.`)) return;
      const key = findKey(stage.decks, `${owner}/${slug}`) ?? `${owner}/${slug}`;
      dropDeck(key); stage.decks[key] = null; save();
      app.toast(`Removal added to the batch: ${count()} unpublished`); app.rerender();
    },
    "deck-replace": el => { const id = el.value; el.value = ""; if (id) openPublish(id, { owner: el.dataset.owner, slug: el.dataset.slug, visibility: el.dataset.private ? "private" : "public" }); },
    "profile-edit": el => openProfile(el?.dataset?.login || ""),
    "profile-signin": el => openHub(`Sign in to edit ${el.dataset.login}'s profile.`, () => openProfile(el.dataset.login)),
    "profile-remove": el => {
      const login = el.dataset.login, form = document.getElementById("edit-form");
      if (!confirm(`Remove ${login}'s profile? The file goes with your next publish.`)) return;
      stage.profiles[login] = null; save(); forget(login); if (form) form.dataset.dirty = "";
      app.toast(`Removal added to the batch: ${count()} unpublished`); app.goUser(login);
    },
    "edit-revert": el => {                       // one line of the batch bar
      const { id, item, login } = el.dataset;
      if (id) revert(id, item);
      else { if (item === "admins") stage.admins = null; else if (item === "people") stage.people = {}; else if (item === "profile") delete stage.profiles[login]; else if (item === "deck") dropDeck(el.dataset.key); save(); }
      app.rerender();
    },
    "edit-bar-toggle": () => { barOpen = !barOpen; renderBar(); },
    "edit-dismiss-sent": () => { localStorage.removeItem(K.sent); preview(); app.rerender(); },
    "edit-publish": async el => {
      if (!me) { openHub("Sign in to publish."); return; }
      const status = document.getElementById("edit-status"), msg = document.getElementById("edit-msg")?.value.trim();
      el.disabled = true; status.textContent = "Publishing…";
      try {
        const sha = await publish(msg);
        app.showDialog((sha ? `<h3>Published</h3><p>Commit <a href="https://github.com/${esc(S.data.repo)}/commit/${sha}" target="_blank" rel="noopener">${sha.slice(0, 7)}</a>. The website rebuilds in a few minutes; the card sync brings it to the bot within minutes and to the PSDs within about 30 minutes.</p>`
          : "<h3>Nothing to publish</h3><p>GitHub already has these edits: nothing changed.</p>"));
        app.rerender();
      } catch (err) { el.disabled = false; status.textContent = `Not published: ${err.message}`; }
    },
    "edit-signout": () => { signOut(); app.closeModal(); app.toast("Signed out"); app.rerender(); },
    "pw-set": () => openPassword("set", { next: () => openHub() }),
    "pw-change": () => openPassword("change", { next: () => openHub() }),
    "pw-remove": el => removePassword(el.dataset.login || me?.login || ""),
    "pw-later": () => later(),
    "pw-list": () => listPasswords(),
    "rate-add": el => { const id = el.dataset.id, v = k => document.getElementById(`rate-${k}`)?.value ?? "";   // a duplicate's page: its original's id
      if (!stageRating(id, { favorability: v("favorability"), power: v("power") })) return;
      const top = app.modal.scrollTop; app.goCard(app.currentCard() || id); app.modal.scrollTop = top; },
    "rename-value": el => openRename(el.dataset.renameK, el.dataset.renameV, el.dataset.renameS || ""),
    "rename-cancel": () => { const id = app.currentCard(); if (id) app.goCard(id); else app.closeModal(); },
    "edit-show-hidden": el => { S.showHidden = el.checked; localStorage.setItem(K.hidden, el.checked ? "1" : ""); app.derive(); app.rerender(); },
  };

  return {
    actions,
    get me() { return me; },
    staged: id => !!stage.cards[id],
    init() {
      S.showHidden = !!localStorage.getItem(K.hidden);
      preview();
      const sent = sentRecord(); if (sent) soon(Date.parse(sent.at));   // still waiting for its build
      if (booting) restore().then(() => app.derive(), () => { token = ""; me = null; }).finally(() => { booting = false; app.rerender(); if (offerOnBoot && me) offerAfterBoot(); });
    },
    open: openForm,
    refresh: preview,
    touches: ids => [...sentOps(), ...Object.values(stage.cards)].some(op => ids.has(op.id)),   // a staged or published-not-built edit on one of ids
    profileOf, pendingProfiles, profilePage, leave: () => { carry = null; },   // another page rendered: a later editor starts fresh
    // published decks: the publish dialog for a saved hand, and the staged or just-published files for the pages
    publishDeck: id => openPublish(id), deckOf, pendingDecks,
    // inline editing (inline.js): single fields into the same batch, and the known values for its lists; the drafts
    stageField, stageAuthor, stageMany, value: val, drafts: cardDrafts,
    // new series, subseries and authors from the filter bar (buckets: pending = no card carries it yet)
    options: () => ({ series: seriesList(), ownSubseries, authors: authorList(), buckets: pending() }),
    addBucket,
    // image previews (preview.js): GitHub calls with the token, its scopes, and what the PSD prints of a card's fields
    github: (path, opts) => gh(path, opts), get scopes() { return scopes; },
    psdOf: id => { const c = find(id); return c ? Object.fromEntries(Object.keys(FROM).filter(isPsd).map(f => [f, psdVal(baseOf(c), f)])) : null; },
    // the fields the card's Card Edits.json entry would hold once published: the built ones, the published-not-built and
    // the staged ops' (or op: the open form's, relative to the published card)
    entryFields: (id, op = stage.cards[id]) => { const f = new Set(find(id)?.edited || []);
      for (const o of [...sentOps().filter(x => x.id === id), op].filter(Boolean)) { for (const k of Object.keys(o.set || {})) f.add(k); for (const k of o.unset || []) f.delete(k); }
      const c = find(id), off = c ? siteAfter(op, baseOf(c)) : [];     // website only: never baked
      return [...f].filter(k => !off.includes(k)); },
    siteFields: (id, op = stage.cards[id]) => { const c = find(id); return c ? siteAfter(op, baseOf(c)) : []; },
    stageRating,
    // the parts editor: a card's boxes per field once its record is loaded ({title, ability, rule} or null: no parts), and
    // the parts its Card Edits.json entry (its PSD's: variant 1's) would hold once published, for the previews
    partsFor: c => new Promise(ok => withRecs(c, () => { const v = partsView(c); ok(v && { rule: v.rule, title: v.list.filter(x => x.kind === "title").length, ability: v.list.filter(x => x.kind === "ability").length }); })),
    partsLoaded: c => [c, ...groupOf(c)].every(x => !x.details || recs.has(x.id) || !app.loadDetails),
    loadParts: c => new Promise(ok => withRecs(c, ok, true)),        // the previews: the records entryParts reads
    entryParts(id, op = null) {
      const c = find(id); if (!c) return null;
      const first = groupOf(c)[0], v = partsView(first) || partsView(c); if (!v) return null;
      const o = op && op.id === first.id ? op : stage.cards[first.id], mine = op && op.id !== first.id ? op : null;
      let parts = P.mergeParts(Object.fromEntries(Object.entries(v.rec.partEdits || {}).filter(([k]) => v.rec.partState?.[k] === "pending")), o?.set?.parts, (o?.unset || []).filter(k => k.startsWith(P.PART)).map(k => k.slice(P.PART.length)));
      if (mine) parts = P.mergeParts(parts, mine.set?.parts, (mine.unset || []).filter(k => k.startsWith(P.PART)).map(k => k.slice(P.PART.length)));
      return parts;
    },
    myRating: id => stage.cards[id]?.rate || null,
    names: nameEntries,
    canonical: (kind, v, series) => canonical(kind, v, series),
    renamePlan, renameAll,
  };
}
