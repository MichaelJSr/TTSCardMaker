// Editing: staged in a batch, published as one commit to the card repo.
import { esc } from "./text.js";
import { decode as decodeDeck, encode as encodeDeck } from "./deck.js";
import { validateProfile, profileFile, sameProfile, deckCode, profileHtml, LIMITS, PICKS, ITEM_KINDS } from "./profile.js";
import * as pick from "./pick.js";
import * as decks from "./decks.js";

const API = "https://api.github.com";
const K = { token: "edit-token", stage: "edit-stage", sent: "edit-sent", hidden: "edit-show-hidden", buckets: "edit-buckets" };
// same fields as build_site.py and the bot's CardEdits
const FIELDS = { name: "str", type: "str", subtype: "str", series: "str", subseries: "str", stars: "int", types: "list", hp: "int", def: "int",
  atk: "int", spd: "int", ability: "str", note: "str", aliases: "list", dup_of: "str", hidden: "bool", problems_ok: "bool", allow_high_stats: "bool",
  creatures: "creatures" };
const ORDER = Object.keys(FIELDS);
const STATS = ["hp", "def", "atk", "spd"];
const LABEL = { name: "Name", type: "Kind", subtype: "Item type", series: "Series", subseries: "Subseries", stars: "Stars", types: "Types", hp: "HP", def: "DEF",
  atk: "ATK", spd: "SPD", ability: "Ability", note: "Note", aliases: "Aliases", dup_of: "Duplicate of", hidden: "Hidden",
  problems_ok: "Parser notes checked", allow_high_stats: "Stats over 10 OK", author: "Author", ban: "Constructed ban", creatures: "Creatures" };
const ABOUT = "Card data fixes from the website's Edit button. Keyed by card file name; each field overrides the PSD. Read by the website and the bot (/update_stats).";

const cardKey = s => (s || "").replace(/_/g, " ").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const alnum = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
// where a field's unedited value comes from: the PSD (the set also in build_site.py PSD_FIELDS, app.js FIELD_LABEL, the bot's
// CardEdits.KIND and psd_edit STAT_FIELDS/TEXT_FIELDS/NOT_YET), the card's folder, or nowhere (a database-only default; creatures too)
const FROM = { name: "PSD", stars: "PSD", types: "PSD", hp: "PSD", def: "PSD", atk: "PSD", spd: "PSD", ability: "PSD",
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
export const opEmpty = op => !Object.keys(op.set).length && !(op.unset || []).length && op.author === undefined && !op.ban;

// ---- single-field ops (inline editing; the same rule readForm applies to the whole form)
/** An inline input's text as field f's value: trimmed, "" -> null (the name falls back to `name`), ints >= 0. */
export const fromInput = (f, v, name) => (FIELDS[f] === "int" ? (v === "" || v == null ? null : Math.max(0, Math.round(Number(v))))
  : FIELDS[f] === "str" ? (String(v ?? "").replace(/\r/g, "").trim() || (f === "name" ? name : null)) : v);
/** op with field f = v, relative to the published card: base = {pub, psd, edited}. Equal to the published value: no entry;
 *  equal to the PSD's on an edited field: unset; else set. The name follows (op.name is the batch's label for the card). */
export function mergeField(op, base, f, v) {
  const set = { ...op.set }, unset = (op.unset || []).filter(k => k !== f);
  delete set[f];
  const asPub = same(v, base.pub) || (typeof v === "string" && typeof base.pub === "string" && v === base.pub.replace(/\r/g, "").trim());
  if (!asPub) { if (same(v, base.psd) && base.edited) unset.push(f); else set[f] = v; }
  return { ...op, set, unset, ...(f === "name" ? { name: v } : {}) };
}
// ---- series, subseries and author names: one spelling per name
export const NAME_MAX = 60;                        // characters, an emoji counts one
/** A name's comparison key: case and spacing don't count. */
export const nameKey = s => String(s ?? "").toLowerCase().replace(/\s+/g, "");
const NOUN = { series: "Series", subseries: "Subseries", author: "Author" };
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

/** op with the author set to v ("" -> from git), or without an author entry when v is the published author. */
export function mergeAuthor(op, v, published) {
  const o = { ...op }; v = String(v ?? "").trim();
  if (v === (published || "")) delete o.author; else o.author = v || null;
  return o;
}
/** op without one item: a field, "author" or "ban" (a reverted name goes back to the published one). */
export function withoutItem(op, item, name) {
  const o = { ...op, set: { ...op.set }, unset: (op.unset || []).filter(k => k !== item) };
  if (item === "author") delete o.author; else if (item === "ban") delete o.ban; else { delete o.set[item]; if (item === "name") o.name = name; }
  return o;
}
/** The review lines of an op against its published base b: [{item, text, short, psd}]; text is the review dialog's line,
 *  short the batch bar's ("SPD 4 → 5"), psd marks fields printed on the card image. rule: a rulebook page. */
export function describeItems(op, b = {}, { byId, rule = false } = {}) {
  const src = k => (rule ? "the page" : FROM[k] ? `the ${FROM[k]}` : "the default");
  const items = Object.entries(op.set).map(([k, v]) => { const from = show(value(b, k, byId)), to = show(v);
    return { item: k, text: `${LABEL[k]}: ${from} → ${to}`, short: `${LABEL[k]} ${clip(from)} → ${clip(to)}` }; });
  for (const k of op.unset || []) { const p = show(psdValue(b, k, byId)); items.push({ item: k, text: `${LABEL[k]}: back to ${src(k)} (${p})`, short: `${LABEL[k]} back to ${src(k)} (${clip(p)})` }); }
  if (op.author !== undefined) { const t = `Author → ${op.author || "(from git)"}`; items.push({ item: "author", text: t, short: t }); }
  if (op.ban) { const t = op.ban.banned ? `Banned: ${op.ban.group}, ${op.ban.reason || "no reason"}` : "Unbanned"; items.push({ item: "ban", text: t, short: t }); }
  return items.map(x => ({ ...x, psd: isPsd(x.item) }));
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
export function editsFile(text, ops, at, by, path = "site/Card Edits.json") {
  let data;
  try { data = text ? JSON.parse(text) : { about: ABOUT, cards: {} }; }
  catch (e) { throw new Error(`${path} isn't valid JSON (${e.message}). Fix it on GitHub, then publish again.`); }
  data.cards ||= {};
  for (const op of ops) {
    if (!Object.keys(op.set).length && !op.unset.length) continue;
    const k = Object.keys(data.cards).find(x => cardKey(x) === cardKey(op.key)) ?? op.key;
    const cur = { ...(data.cards[k] || {}) };
    for (const f of op.unset) delete cur[f];
    Object.assign(cur, op.set);
    delete cur._by; delete cur._at; delete data.cards[k];
    if (Array.isArray(cur._bot)) {                 // the bot's migration fields (_bot): one this op sets or unsets is the editor's now
      cur._bot = cur._bot.filter(f => !(f in op.set) && !op.unset.includes(f) && f in cur);
      if (!cur._bot.length) delete cur._bot;
    }
    const fields = [...ORDER.filter(f => f in cur), ...Object.keys(cur).filter(f => !(f in FIELDS))];
    if (fields.length) data.cards[k] = { ...Object.fromEntries(fields.map(f => [f, cur[f]])), _by: by, _at: at };
  }
  const keys = Object.keys(data.cards).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const rest = Object.entries(data).filter(([k]) => k !== "cards").map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const body = keys.map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(data.cards[k])}`).join(",\n");
  return `{\n${rest.join("\n")}${rest.length ? "\n" : ""}  "cards": {${keys.length ? `\n${body}\n  ` : ""}}\n}\n`;
}

/** The profile page's form state (what its inputs hold) for a profile; validateProfile({login, ...state}) gives the profile back. */
export const profileState = p => ({ author: p.author || "", motto: p.motto || "", series: p.series || "", ...Object.fromEntries(PICKS.map(([k]) => [k, p[k] || ""])),
  deck: p.deck || "", facts: (p.facts || []).map(f => ({ label: f.label, value: f.value })) });
/** The deck builder's saved hands as the profile page offers them: [{id, name, n (cards, the field card included)}]. */
export const savedHands = decks => decks.map(d => ({ id: d.id, name: d.name, n: d.cards.length + (d.field ? 1 : 0) }));

export function createEditor(app) {
  const { S } = app;
  let token = localStorage.getItem(K.token) || sessionStorage.getItem(K.token) || "";
  let me = null;                                   // { login, admin, push }
  // profiles: login -> profile, or null to remove the file; decks: "<owner>/<slug>" -> the deck file object (decks.js fileOf /
  // encrypt), or null to remove it; deckNames: the same keys -> name, for the bar (a private file holds its name encrypted)
  const emptyStage = () => ({ cards: {}, people: {}, admins: null, profiles: {}, decks: {}, deckNames: {} });
  let stage = { ...emptyStage(), ...load(K.stage, {}) };
  // new series, subseries and authors made in the filter bar: this tab only, never published (a card carrying one is)
  let buckets = readBuckets(sessionStorage.getItem(K.buckets));
  const pristine = new Map();                      // id -> card as built
  const based = new Map();                         // id -> card with published-but-not-built edits
  let pristineBan = null;
  const files = () => ({ edits: "site/Card Edits.json", authors: "site/Card Authors.txt", banlist: "site/Constructed Ban List.txt", admins: "site/Website Admins.txt", profiles: "site/profiles", decks: "site/decks", ...S.data.files });
  const isAdmin = login => (S.data.admins || []).some(a => a.toLowerCase() === login.toLowerCase());
  const find = id => S.byId.get(id) || (S.rules || []).find(r => r.id === id);

  // ---- GitHub API
  async function gh(path, { method = "GET", body, raw = false, full = false } = {}) {
    const r = await fetch(API + path, {
      method, cache: "no-store", body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
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
  async function commitFiles(edits, message) {
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
      try { await gh(`/repos/${repo}/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: c.sha } }); return c.sha; }
      catch (e) { if (e.status !== 422 || attempt >= 3) throw e; }
    }
  }

  // ---- sign in
  async function signIn(t, remember) {
    token = t.trim();
    const { data: user, headers } = await gh("/user", { full: true });
    const scopes = headers.get("x-oauth-scopes");
    if (scopes != null && !/\b(public_)?repo\b/.test(scopes)) throw new Error("This token can't write: give it the public_repo scope.");
    const p = (await gh(`/repos/${S.data.repo}`)).permissions || {};
    if (!p.push) throw new Error(`${user.login} can't push to ${S.data.repo}. Ask an admin to add you.`);
    me = { login: user.login, admin: !!p.admin || isAdmin(user.login), push: true };
    localStorage.removeItem(K.token); sessionStorage.removeItem(K.token);
    (remember ? localStorage : sessionStorage).setItem(K.token, token);
    app.onAuth();
  }
  function signOut() { token = ""; me = null; localStorage.removeItem(K.token); sessionStorage.removeItem(K.token); sessionStorage.removeItem(K.buckets); buckets = readBuckets(null); app.onAuth(); }

  // ---- preview: staged and just-published changes applied to the loaded cards
  const snap = c => { if (c && !pristine.has(c.id)) pristine.set(c.id, structuredClone(c)); };
  const baseOf = c => based.get(c.id) || pristine.get(c.id) || c;
  const byKey = k => S.all.find(c => cardKey(c.key) === cardKey(k)) || S.all.find(c => cardKey(c.name) === cardKey(k));
  const val = (c, f) => value(c, f, S.byId), psdVal = (b, f) => psdValue(b, f, S.byId);
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
    if (op.author !== undefined) c.author = op.author || b.author;
    if (op.ban) {
      for (const g of S.data.banlist.groups) g.entries = g.entries.filter(e => e.id !== c.id);
      if (op.ban.banned) {
        let g = S.data.banlist.groups.find(x => x.title.toLowerCase() === op.ban.group.toLowerCase());
        if (!g) S.data.banlist.groups.push(g = { title: op.ban.group, entries: [] });
        g.entries.push({ name: c.name, reason: op.ban.reason, id: c.id });
      }
    }
    c[op._sent ? "_sent" : "_staged"] = true;
  }
  function sentRecord() {                          // {at, sha, ops, profiles, decks, deckNames}: published, until the site has rebuilt with it
    const sent = load(K.sent, null);
    if (!sent) return null;
    if (new Date(S.data.generated) > new Date(sent.at)) { localStorage.removeItem(K.sent); return null; }   // live now
    return sent;
  }
  const sentOps = () => sentRecord()?.ops || [];
  const sentProfiles = () => sentRecord()?.profiles || {};
  const sentDecks = () => sentRecord()?.decks || {};
  function preview() {
    for (const [id, p] of pristine) { const c = find(id); if (!c) continue; for (const k of Object.keys(c)) delete c[k]; Object.assign(c, structuredClone(p)); }
    pristine.clear(); based.clear();
    if (pristineBan) S.data.banlist = structuredClone(pristineBan); else pristineBan = structuredClone(S.data.banlist);
    for (const op of sentOps()) applyOp({ ...op, _sent: true });
    for (const id of pristine.keys()) based.set(id, structuredClone(S.byId.get(id)));
    for (const op of Object.values(stage.cards)) applyOp(op);
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
  const subseriesList = series => {          // that series' subseries first, then all
    const own = ownSubseries(series);
    return [...own, ...new Set([...uniq(x => x.subseries), ...buckets.subseries.map(([, v]) => v)].filter(v => !own.includes(v)))];
  };
  const seriesList = () => [...new Set([...uniq(c => c.series), ...buckets.series])].sort((a, b) => a.localeCompare(b));
  const authorList = () => [...new Set([...(S.data.people || []), ...S.all.map(c => c.author).filter(Boolean), ...buckets.author])].sort((a, b) => a.localeCompare(b));
  function knownNames(kind, series = "", skip = "") {     // canonName's [spelling, shown, rank]: cards (skip: the one being edited), buckets, [people]
    const rank = new Map(), own = s => (kind === "subseries" && series && s === series ? 1e6 : 0);   // the picked series' own subseries first
    const add = (v, by) => { if (v) rank.set(v, (rank.get(v) || 0) + by); };
    for (const c of S.all) if (c.id !== skip) add(c[kind], 1 + own(c.series));
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
  const subseriesOpts = series => subseriesList(series).map(v => `<option value="${esc(v)}">`).join("");
  const isRule = c => (S.rules || []).includes(c);
  function ruleFormHtml(c) {
    const b = baseOf(c);
    const reset = f => { const p = psdVal(b, f); return same(val(c, f), p) ? "" : `<button type="button" class="ghost reset" data-reset="${f}" title="Back to what the page says">↺ Page: ${esc(show(p))}</button>`; };
    const row = (f, label, input) => `<div class="erow" data-row="${f}"><label for="ef-${f}">${label}</label><div class="ein">${input}${reset(f)}</div></div>`;
    return `<div class="dialog edit-dialog" role="dialog" aria-modal="true" aria-label="Edit ${esc(c.name)}">
      <button type="button" class="ghost icon close" data-action="edit-cancel" aria-label="Cancel">✕</button>
      <h2>Edit rulebook page</h2><p class="muted">Goes into your batch. <span class="kbd">${esc(c.key)}</span></p>
      <form id="edit-form" class="edit-form" autocomplete="off"><fieldset><legend>Page</legend>
        ${row("name", "Title", `<input id="ef-name" value="${esc(c.name)}">`)}
        ${row("ability", "Text", `<textarea id="ef-ability" rows="14" spellcheck="true">${esc(c.ability || "")}</textarea><div class="ability preview" id="ef-preview"></div>`)}
        ${row("note", "Note", `<textarea id="ef-note" rows="2" placeholder="Shown under the page">${esc(c.note || "")}</textarea>`)}
      </fieldset><div class="edit-summary muted" id="ef-summary" aria-live="polite"></div>
      <div class="actions"><button type="submit" class="primary">Add to batch</button><button type="button" data-action="edit-cancel">Cancel</button></div></form></div>`;
  }
  function formHtml(c) {
    if (isRule(c)) return ruleFormHtml(c);
    const b = baseOf(c), isDup = !!b.dup, ban = banOf(c.id), admin = me?.admin;
    const kinds = Object.entries(app.KIND_LABEL).filter(([k]) => k !== "unknown" || k === c.type);
    if (!app.KIND_LABEL[c.type]) kinds.push([c.type, c.type]);
    const typeNames = [...new Set(Object.values(S.icons).filter(i => i.kind === "type").map(i => i.name))].sort();
    const reset = f => { const p = psdVal(b, f), src = FROM[f]; return same(val(c, f), p) ? "" : `<button type="button" class="ghost reset" data-reset="${f}" title="${src ? `Back to what the ${src} says` : "Remove the edit"}">↺ ${src ? src[0].toUpperCase() + src.slice(1) : "Default"}: ${esc(show(p))}</button>`; };
    const psdNote = f => (b.pending?.includes(f) ? `<span class="fact pending" data-tip="${app.PSD_TIP}">PSD pending</span>` : "");
    const row = (f, input) => `<div class="erow" data-row="${f}"><label for="ef-${f}">${LABEL[f]}${psdNote(f)}</label><div class="ein">${input}${reset(f)}</div></div>`;
    const num = f => `<input id="ef-${f}" type="number" min="0" max="99" step="1" value="${c[f] ?? ""}" placeholder="—">`;
    return `<div class="dialog edit-dialog" role="dialog" aria-modal="true" aria-label="Edit ${esc(c.name)}">
      <button type="button" class="ghost icon close" data-action="edit-cancel" aria-label="Cancel">✕</button>
      <h2>Edit ${esc(c.name)}</h2>
      <p class="muted">Changes go into your batch; publish the batch when you're done. <span class="kbd">${esc(c.key)}</span></p>
      <form id="edit-form" class="edit-form" autocomplete="off">
        <h3 class="egroup">On the card image</h3><p class="muted egroup-note">Printed on the card, read from the PSD; an edit shows as “PSD pending” until the card image is regenerated.${b.refused ? ` The last image update was refused: ${esc(b.refused)}.` : ""}</p>
        <fieldset><legend>Card</legend>
          ${row("name", `<input id="ef-name" value="${esc(c.name)}">`)}
          ${row("stars", num("stars"))}
          ${row("types", `<div class="icon-toggles" id="ef-types">${typeNames.map(t => { const ic = app.iconFor(t), on = (c.types || []).includes(t);
            return `<button type="button" class="icon-toggle${on ? " on" : ""}" data-type="${esc(t)}" aria-pressed="${on}" data-tip="${esc(t.replace(/_/g, " "))}">${ic ? `<img src="${esc(ic.file)}" alt="${esc(t)}">` : esc(t.slice(0, 2))}</button>`; }).join("")}</div>`)}
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
          ${row("ability", `<textarea id="ef-ability" rows="6" spellcheck="true">${esc(c.ability || "")}</textarea>
            <div class="token-bar" aria-label="Insert an icon">${typeNames.map(t => { const ic = app.iconFor(t); return ic ? `<button type="button" class="ghost" data-insert="[${esc(t)}]" data-tip="[${esc(t)}]"><img src="${esc(ic.file)}" alt="${esc(t)}"></button>` : ""; }).join("")}</div>
            <div class="ability preview" id="ef-preview"></div>`)}
        </fieldset>
        <h3 class="egroup">Database only</h3><p class="muted egroup-note">Not on the card image: from the card's folder, or set only here.</p>
        <fieldset><legend>Kind and series</legend>
          ${row("type", `<select id="ef-type">${opts(kinds, c.type)}</select>`)}
          ${row("subtype", `<input id="ef-subtype" list="dl-sub" value="${esc(c.subtype || "")}" placeholder="—"><datalist id="dl-sub">${uniq(x => x.subtype).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`)}
          ${row("series", `<input id="ef-series" list="dl-series" value="${esc(c.series || "")}" placeholder="—"><datalist id="dl-series">${seriesList().map(v => `<option value="${esc(v)}">`).join("")}</datalist>`)}
          ${row("subseries", `<input id="ef-subseries" list="dl-subseries" value="${esc(c.subseries || "")}" placeholder="—"><datalist id="dl-subseries">${subseriesOpts(c.series)}</datalist>`)}
        </fieldset>
        <fieldset><legend>Notes, names and credit</legend>
          ${row("note", `<textarea id="ef-note" rows="2" placeholder="Rulings or errata, shown on the card page">${esc(c.note || "")}</textarea>`)}
          ${row("aliases", `<input id="ef-aliases" value="${esc((c.webAliases || []).join(", "))}" placeholder="comma separated">${(c.aliases || []).filter(a => !(c.webAliases || []).includes(a)).length ? `<span class="muted">Bot aliases: ${esc(c.aliases.filter(a => !(c.webAliases || []).includes(a)).join(", "))}</span>` : ""}`)}
          <div class="erow" data-row="author"><label for="ef-author">Author</label><div class="ein">${isDup ? `<span class="muted">Same as the original</span>` : `<input id="ef-author" list="dl-people" value="${esc(c.author || "")}"><datalist id="dl-people">${authorList().map(p => `<option value="${esc(p)}">`).join("")}</datalist>`}</div></div>
          ${row("dup_of", `<input id="ef-dup_of" list="dl-cards" value="${esc(val(c, "dup_of"))}" placeholder="not a duplicate"><datalist id="dl-cards">${S.all.filter(x => x.id !== c.id && !x.dup).map(x => `<option value="${esc(x.key)}">${esc(x.name)}</option>`).join("")}</datalist>`)}
        </fieldset>
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
      </form></div>`;
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
    const op = { id: c.id, key: c.key, name: want.name, set: {}, unset: [] };
    for (const [k, v] of Object.entries(want)) {
      const pub = val(b, k);
      if (same(v, pub) || (typeof v === "string" && typeof pub === "string" && v === pub.replace(/\r/g, "").trim())) continue;   // as published
      if (same(v, psdVal(b, k)) && b.edited?.includes(k)) op.unset.push(k);
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
    if (error) op.error = error;
    return op;
  }
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
    let x = fromInput(f, v, b.name);
    if ((f === "series" || f === "subseries") && x != null && !defer && (x = spell(f, x, f === "subseries" ? c.series || "" : "", c.id)) === undefined) return null;
    const op = mergeField(opFor(c), { pub: val(b, f), psd: psdVal(b, f), edited: !!b.edited?.includes(f) }, f, x);
    put(c.id, op); if (!defer) save();
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
  // one save for the lot -> {changed (a card already at v doesn't count), dups (an author drop leaves duplicates alone),
  // kept (a series drop: cards keeping a subseries the new series lacks), value, error}. v is spelled once, here: a drop
  // chip's value (the lists mountGrid's chips come from) stays as it is, so cards can join either of two spellings of a
  // name; other text goes through canonical()
  function stageMany(ids, key, v) {
    const series = key === "subseries" ? find(ids[0])?.series || "" : "";
    const chips = key === "series" ? seriesList() : key === "subseries" ? ownSubseries(series) : key === "author" ? authorList() : [];
    const r = chips.includes(v) ? { name: v } : canonical(key, v, series);
    if (r?.error) return { changed: 0, dups: 0, kept: 0, value: v, error: r.error };
    const value = r ? r.name : v, moved = [], own = key === "series" ? ownSubseries(value) : [];   // before the drop
    let changed = 0, dups = 0;
    for (const id of ids) {
      const was = JSON.stringify(stage.cards[id] ?? null);
      if (key === "author" && find(id) && baseOf(find(id)).dup) { dups++; continue; }
      if ((key === "author" ? stageAuthor(id, value, true) : stageField(id, key, value, true)) && JSON.stringify(stage.cards[id] ?? null) !== was) { changed++; moved.push(id); }
    }
    save();
    const kept = key === "series" ? moved.filter(id => { const s = find(id)?.subseries; return s && !own.includes(s); }).length : 0;
    return { changed, dups, kept, value };
  }
  function revert(id, item) {
    const c = find(id), op = stage.cards[id]; if (!c || !op) return;
    put(id, withoutItem(op, item, baseOf(c).name)); save();
  }
  function openForm(id) {
    const c = find(id);
    if (!c) return;
    if (!me) { openHub(`Sign in to edit ${c.name}.`, () => openForm(id)); return; }
    app.modal.innerHTML = formHtml(c);
    app.modal.hidden = false; document.body.style.overflow = "hidden"; app.modal.scrollTop = 0;
    const form = app.modal.querySelector("#edit-form"), ta = document.getElementById("ef-ability");
    const ser = document.getElementById("ef-series"), dl = document.getElementById("dl-subseries");
    if (ser && dl) ser.addEventListener("input", () => { dl.innerHTML = subseriesOpts(ser.value.trim()); });
    const update = () => {
      document.getElementById("ef-preview").innerHTML = ta.value.trim() ? app.render(ta.value, c.name) : `<span class="muted">No ability text.</span>`;
      const op = readForm(c), lines = describe(op);
      document.getElementById("ef-summary").innerHTML = (op.error ? `<span class="err">${esc(op.error)}.</span> ` : "") + (lines.length ? `<b>${lines.length} change${lines.length > 1 ? "s" : ""}:</b> ${lines.map(esc).join(" · ")}` : "No changes yet.");
      form.dataset.dirty = lines.length || op.error ? "1" : "";       // a refused name is typed text too: Cancel and leaving still ask
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("click", e => {
      const t = e.target.closest("[data-type]");
      if (t) { const on = !t.classList.contains("on"); t.classList.toggle("on", on); t.setAttribute("aria-pressed", on); update(); return; }
      const ins = e.target.closest("[data-insert]");
      if (ins) { const s = ta.selectionStart, end = ta.selectionEnd; ta.setRangeText(ins.dataset.insert, s, end, "end"); ta.focus(); update(); return; }
      const r = e.target.closest("[data-reset]");
      if (r) { resetField(c, r.dataset.reset); update(); return; }
      const cr = e.target.closest("[data-creature]");
      if (cr) { creatureAction(cr.dataset.creature); update(); }
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const op = readForm(c);
      if (op.error) { app.toast(op.error); return; }
      if (opEmpty(op)) delete stage.cards[c.id]; else stage.cards[c.id] = op;
      save();
      app.toast(opEmpty(op) ? "No changes" : `Added to the batch: ${count()} unpublished`);
      if (isRule(c)) { app.closeModal(); app.rerender(); } else app.goCard(c.id);
    });
    update();
    document.getElementById(isRule(c) ? "ef-ability" : "ef-name").focus();
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
  let booting = !!token;                           // the stored token's sign-in hasn't settled yet
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
          ${row("author", "Cards as", `<input id="pf-author" list="dl-people" value="${esc(st.author)}" placeholder="the name on your cards"><datalist id="dl-people">${(S.data.people || []).map(x => `<option value="${esc(x)}">`).join("")}</datalist><span class="muted">Links the profile to your cards (the name in Card Authors.txt).</span>`)}
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
  async function publish(message) {
    const ops = Object.values(stage.cards), people = stage.people, F = files();
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const edits = {};
    if (ops.some(o => Object.keys(o.set).length || o.unset.length)) edits[F.edits] = t => editsFile(t, ops, at, me.login, F.edits);
    if (ops.some(o => o.author !== undefined) || Object.keys(people).length) edits[F.authors] = t => authorsFile(t, ops, people);
    if (ops.some(o => o.ban)) edits[F.banlist] = t => banFile(t, ops);
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
    const sha = await commitFiles(edits, message || (what.length > 3 ? `Website edits: ${what.length} changes` : `Website edit: ${what.join(", ")}`));
    const sent = sentRecord() || {};
    localStorage.setItem(K.sent, JSON.stringify({ at, sha, ops: [...sentOps(), ...ops], profiles: { ...sentProfiles(), ...profiles },
      decks: { ...sentDecks(), ...decksOut }, deckNames: { ...(sent.deckNames || {}), ...stage.deckNames } }));
    if (stage.admins) S.data.admins = stage.admins;
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
        <p class="muted">One commit to ${esc(S.data.repo)} (${esc(S.data.branch || "main")}). The site rebuilds in a few minutes; the bot reads it on /update_stats.</p>` : `<p class="muted">Nothing to publish.</p>`}
      <p class="muted" id="edit-status" aria-live="polite">${esc(note)}</p>`;
  }
  function hubHtml(note = "") {
    if (!me) return `<h3>Sign in to edit</h3>${note ? `<p>${esc(note)}</p>` : ""}
      <p class="muted">Anyone with write access to ${esc(S.data.repo)} can edit cards and make a profile. Edits are batched and published as one commit, which the website and the bot both read.</p>
      <ol class="muted"><li><a href="https://github.com/settings/tokens/new?scopes=public_repo&description=Impossibility%20Simulator%20card%20browser" target="_blank" rel="noopener">Create a GitHub token</a> with only <code>public_repo</code> ticked.</li><li>Paste it here.</li></ol>
      <form id="signin-form"><input id="signin-token" class="wide" type="password" placeholder="ghp_…" autocomplete="off" required>
        <label class="check"><input id="signin-remember" type="checkbox" checked> remember on this device</label>
        <div class="actions"><button type="submit" class="primary">Sign in</button></div><p class="muted" id="signin-status" aria-live="polite"></p></form>
      <p class="muted">The token stays in this browser and is only sent to api.github.com.</p>`;
    return `<h3>Editing as ${esc(me.login)} <span class="fact">${me.admin ? "Admin" : "Editor"}</span></h3>${note ? `<p>${esc(note)}</p>` : ""}
      <p class="muted">Open a card and change it in place, or press All fields (e). Changes wait in your batch until you publish them.</p>
      <div class="actions"><button type="button" data-action="edit-review"${count() ? "" : " disabled"}>Review batch (${count()})</button>
        <label class="check"><input type="checkbox" data-action="edit-show-hidden"${S.showHidden ? " checked" : ""}> show hidden cards</label></div>
      <h4>Profile</h4><p class="muted">Your page, u/${esc(me.login)}/, shows your cards, edits and card commits; a profile adds the name on your cards, a motto, favourite cards and a featured hand.</p>
      <div class="actions"><button type="button" data-action="profile-edit">Edit profile</button><a class="fact" href="#/u/${encodeURIComponent(me.login)}">Your profile</a><a class="fact" href="#/users">All people</a></div>
      ${me.admin ? `<h4>People</h4><p class="muted">How each git name is shown.</p><form id="people-form" class="people">${peopleRows()}<div class="actions"><button type="submit">Add to batch</button></div></form>
        <h4>Admins</h4><p class="muted">GitHub logins, one per line. The repo owner is always an admin.</p>
        <form id="admins-form"><textarea id="admins-list" class="wide" rows="4">${esc((stage.admins || S.data.admins || []).join("\n"))}</textarea><div class="actions"><button type="submit">Add to batch</button></div></form>` : ""}
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
    const form = document.getElementById("signin-form");
    if (form) {
      document.getElementById("signin-token").focus();
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const status = document.getElementById("signin-status");
        status.textContent = "Checking…";
        try {
          await signIn(document.getElementById("signin-token").value, document.getElementById("signin-remember").checked);
          app.toast(`Signed in as ${me.login}`);
          app.rerender();                          // the view behind the hub goes into edit mode (draggable tiles, drop lists)
          if (then) then(); else openHub();
        } catch (err) { token = ""; status.textContent = err.message; }
      });
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

  const actions = {
    "edit-hub": () => openHub(),
    "edit-card": el => openForm(el.dataset.id || app.currentCard()),
    "edit-cancel": () => {                       // the card dialog's form, else the profile page's
      const form = app.modal.querySelector("#edit-form") || document.getElementById("edit-form");
      if (form?.dataset.dirty && !confirm("Discard these changes?")) return;
      if (form && !app.modal.contains(form)) { forget(form.dataset.login); form.dataset.dirty = ""; location.replace(`#/u/${encodeURIComponent(form.dataset.login)}`); return; }
      const id = app.currentCard(); if (id) app.goCard(id); else app.closeModal();
    },
    "edit-review": () => app.showDialog(reviewHtml()),
    "edit-discard": el => { delete stage.cards[el.dataset.id]; save(); app.showDialog(reviewHtml("Discarded.")); app.rerender(); },
    "edit-discard-people": () => { stage.people = {}; save(); app.showDialog(reviewHtml("Discarded.")); },
    "edit-discard-admins": () => { stage.admins = null; save(); app.showDialog(reviewHtml("Discarded.")); },
    "edit-discard-all": () => { if (!confirm(`Discard ${count()} unpublished change${count() > 1 ? "s" : ""}?`)) return; stage = emptyStage(); save(); app.rerender(); },
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
        app.showDialog(`<h3>Published</h3><p>${sha ? `Commit <a href="https://github.com/${esc(S.data.repo)}/commit/${sha}" target="_blank" rel="noopener">${sha.slice(0, 7)}</a>.` : "Nothing changed on GitHub."} The website rebuilds in a few minutes; the bot reads it on /update_stats.</p>`);
        app.rerender();
      } catch (err) { el.disabled = false; status.textContent = `Not published: ${err.message}`; }
    },
    "edit-signout": () => { signOut(); app.closeModal(); app.toast("Signed out"); app.rerender(); },
    "edit-show-hidden": el => { S.showHidden = el.checked; localStorage.setItem(K.hidden, el.checked ? "1" : ""); app.derive(); app.rerender(); },
  };

  return {
    actions,
    get me() { return me; },
    staged: id => !!stage.cards[id],
    init() {
      S.showHidden = !!localStorage.getItem(K.hidden);
      preview();
      if (token) signIn(token, !!localStorage.getItem(K.token)).then(() => app.derive(), () => {}).finally(() => { booting = false; app.rerender(); });
    },
    open: openForm,
    refresh: preview,
    profileOf, pendingProfiles, profilePage, leave: () => { carry = null; },   // another page rendered: a later editor starts fresh
    // published decks: the publish dialog for a saved hand, and the staged or just-published files for the pages
    publishDeck: id => openPublish(id), deckOf, pendingDecks,
    // inline editing (inline.js): single fields into the same batch, and the known values for its lists
    stageField, stageAuthor, stageMany, value: val,
    // new series, subseries and authors from the filter bar (buckets: pending = no card carries it yet)
    options: () => ({ series: seriesList(), subseries: subseriesList, ownSubseries, authors: authorList(), buckets: pending() }),
    addBucket,
  };
}
