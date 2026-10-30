import { compile, suggest, total, exactOf, exactFirst, SEARCH_HELP } from "./search.js";
import { esc, norm, dateFmt, makeRenderer, diffWords, tagInfo, badgeHtml, GROUP_NAMES, legendHtml, hasBadges, commitAfter, noted } from "./text.js";
import * as D from "./deck.js";
import * as details from "./details.js";
import { tipController, wireTips } from "./tip.js";
import * as decks from "./decks.js";
import * as pick from "./pick.js";
import * as changes from "./changes.js";
import { date, month, TZ, textAt, textChanged, historyHtml } from "./history.js";
import { deckPasses, SEALED } from "./login.js";
import * as ratings from "./ratings.js";
import * as fresh from "./fresh.js";
import * as G from "./grid.js";
import * as CF from "./myfilters.js";
import { KIND_LABEL, FIELD_LABEL, PSD_TIP, pendingList, stars, isDesc } from "./grid.js";
import { artHtml } from "./art.js";

// pin <base> so share URLs (c/<id>/, d/) in the address bar don't move asset paths
const baseEl = document.querySelector("base");
if (baseEl) baseEl.setAttribute("href", new URL(baseEl.getAttribute("href"), location.href).href);
const ROOT = new URL("./", document.baseURI).href;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view"), modal = $("#modal"), tip = $("#tooltip"), toastEl = $("#toast"), qInput = $("#q");
const store = (() => { try { return sessionStorage; } catch { return null; } })();   // storage blocked: the Details dropdown just forgets its state

const S = {
  data: null, cards: [], rules: [], byId: new Map(), banned: new Map(), icons: {}, renderer: null,
  mentions: new Map(), mentionedBy: new Map(), list: [], decks: [], compare: [],
  renderedHash: null, listHash: "#/cards", shared: null, rev: 0,   // rev: bumped by derive()
  selected: new Set(),                                     // tiles picked in the cards grid (edit mode: drag them onto a series or author)
  distPage: {},                                            // the Stats distributions' page per stat (this session)
  selecting: false,                                        // the Select toggle (phones): a tap on a tile selects it
  toTop: false,                                            // a Stats chart link was followed: the grid opens at its top
  notPick: new Set(),                                      // series, subseries, author: ≠ pressed with nothing picked yet
  fontUse: null,                                           // card id -> its fonts (data/cardfonts.json), once the Font filter loads it
  fontKept: [],                                            // the Font chips listed, in order: picked, excluded, or clicked off (this page only)
};
// The game's names (rulebook "04 Table": creature and item decks, field cards, N.M.E. items, the auxiliary decks)
const KINDS = [["creature", "Creatures"], ["item", "Items"], ["field", "Field cards"], ["minion", "Minions"], ["nme", "N.M.E. items"],
  ["aux item", "Auxiliary items"], ["status", "Status effects"], ["creatures", "Auxiliary creatures"]];
const KIND_PLURAL = { debuff: "Debuffs", buff: "Buffs", unknown: "Other" };   // kind= values the chips don't have (the Stats links)
const FLAGS = [["history", "Text history"], ["alias", "Aliases"], ["dup", "Duplicates"], ["unused", "Unused status effects"], ["edited", "Edited on the website"],
  ["pending", "PSD pending or refused"], ["unparsed", "Not parsed yet"], ["problems", "Parse problems"],
  ["banned", "Banned (constructed)"]];
const STAT_COLORS = { hp: "#2fbf3a", def: "#3d63ff", atk: "#ff3b3b", spd: "#ffd21f" };   // the game's own stat colors
const sortOf = p => (p.get("sort") === "created" && !S.created ? "" : p.get("sort")) || "name";   // a shallow build: Name

const urlPath = p => p.split("/").map(encodeURIComponent).join("/");
const BUILD = document.querySelector('meta[name="build"]')?.content || "";
const V = /^[0-9a-f]+$/.test(BUILD) ? `?v=${BUILD}` : "";            // same URLs as the preload hints in index.html
const img = (c, w) => G.thumb(S.data.thumbs, c, w);   // card images: 240 / 360 / 720 px wide (tag: their settings)
const thumbUrl = c => img(c, 360);
/** <img> attributes for a card image shown about `css` px wide: the browser picks 240 or 360 (or 720) px by screen density */
const imgAttrs = (c, css, big = false) => G.imgAttrs(S.data.thumbs, c, css, big);
const fullUrl = c => (c.png ? S.data.raw + urlPath(c.png) : "");
const DAY = dateFmt({ year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const day = d => (d ? DAY(new Date(`${d}T12:00:00Z`)) : "");
const CREATED_TIP = { discord: "First posted on Discord", git: "First uploaded to the card repo", hand: "Creation date set by hand" };
/** "about 13 Oct 2023" for a date a Discord post awaiting review may still move */
const createdText = c => (c.created ? `${c.createdAbout ? "about " : ""}${day(c.created)}` : "");
const createdTip = c => `${CREATED_TIP[c.createdFrom] || "Created"}${c.createdAbout ? "; provisional: a Discord post awaiting review may still move it" : ""}`;
const isStatus = c => c.type === "debuff" || c.type === "buff";
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : "");             // item types read "Support", as in the rulebook
const kindOf = c => (isStatus(c) ? "status" : c.type);
const shareUrl = id => `${ROOT}c/${encodeURIComponent(id)}/`;
const userUrl = login => `${ROOT}u/${encodeURIComponent(login)}/`;
const deckUrl = d => `${ROOT}d/#/deck/${D.encode(d)}`;
const iconFor = name => S.icons[norm(name)];
const iconImg = (name, cls = "tok") => G.iconImg(S.icons, name, cls);
const psdBadges = c => [
  c.refused ? `<span class="fact refused" data-tip="The last try to regenerate the card image was refused; change the edit or the PSD">Image update refused: ${esc(c.refused)}</span>`
    : c.pending?.length ? `<span class="fact pending" data-tip="${PSD_TIP}">PSD pending: ${esc(pendingList(c))}</span>` : "",
  c.siteOnly?.length ? `<span class="fact site-only" data-tip="${esc(`Website only: ${c.siteOnly.map(f => FIELD_LABEL[f] || f).join(", ")}. The card image keeps its printed value`)}">Website only</span>` : "",
  c.reparsePending ? `<span class="fact" data-tip="The PSD changed since the card data was built; the next card sync reads it">Re-parse pending</span>` : "",
  c.baked && !c.refused ? `<span class="fact" data-tip="The bot regenerated the card image from the edit; its notes say what it drew best-effort">Image baked: ${esc(c.baked)}</span>` : "",
  c.partFlags ? `<span class="fact${c.partFlags.skipped ? " refused" : ""}" data-tip="The last bake, per text layer: a layer changed in Photoshop since the edit is skipped (redo it in Edit)">Text boxes: ${esc(Object.entries(c.partFlags).map(([k, n]) => `${n} ${k}`).join(", "))}</span>` : "",
  c.moved ? `<span class="fact" data-tip="A stars edit moved the card into its stars folder">moved to ${esc(c.moved.replace(/\/$/, "").split("/").pop())}</span>` : "",
].join("");
// beside PSD chips and parser notes: opens the card with Details open
const detailsLink = c => (c.details ? `<a class="fact details-link" href="#/card/${c.id}?details" data-tip="Open the card with its PSD details">Details</a>` : "");   // a plain link: Ctrl-click opens a tab
const psdChips = c => { const b = psdBadges(c); return b && b + detailsLink(c); };

// ---- boot ------------------------------------------------------------------------------------------
async function getJson(name) {
  const r = await fetch(`data/${name}${V}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}
// loaded on demand: the rulebook (data/rules.json: its chapters' text and its pictures' sizes; rulebook.js draws them), and
// older versions of card text
let historyP = null, versionsP = null, RB = null, bookP = null;
const loadBook = () => (bookP ||= Promise.all([getJson("rules.json"), (early("rulebook.js"), import("./rulebook.js"))]).then(([d, m]) => {
  RB = m; S.book = { images: d.images || {}, built: d.chapters || [] };
  bookChapters();
}).catch(e => { bookP = null; throw e; }));
const loadHistory = () => (historyP ||= getJson("history.json").then(h => {
  for (const c of S.cards) if (h[c.id]) c.history = h[c.id];
  S.history = h;
}).catch(e => { historyP = null; throw e; }));
const loadVersions = () => (versionsP ||= getJson("versions.json").then(d => { S.versions = d; }).catch(e => { versionsP = null; throw e; }));
// loaded on first use (esbuild chunks; without esbuild, the modules): charts.js (stats.js, balance.js, insights.js) for the Stats
// page, the cards' Balance blocks and the grid filters its charts link to; profile.js for the People tab and person pages.
// early(): a module's chunks all at once (index.html's meta chunks, build_site.py bundle), so the first open is one round trip
const CHUNKS = (() => { try { return JSON.parse(document.querySelector('meta[name="chunks"]')?.content || "{}"); } catch { return {}; } })();
const early = name => { for (const href of CHUNKS[name] || []) if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement("link"), { rel: "modulepreload", href })); };
let St = null, chartsP = null, Pf = null, profileP = null;
const loadCharts = () => (chartsP ||= (early("charts.js"), import("./charts.js")).then(m => { St = m; }).catch(e => { chartsP = null; throw e; }));
const loadProfile = () => (profileP ||= (early("profile.js"), import("./profile.js")).then(m => { Pf = m; }).catch(e => { profileP = null; throw e; }));
// balance analytics (data/analytics.json, with charts.js): the Stats page's Balance section and the cards' Balance blocks
let analyticsP = null;
const loadAnalytics = () => (analyticsP ||= Promise.all([getJson("analytics.json"), loadCharts()]).then(([d]) => { S.analytics = d; }).catch(e => { analyticsP = null; throw e; }));
// the Changes page's Changelog and Database edits tabs (data/changelog.json, changes.js)
let changelogP = null;
const loadChangelog = () => (changelogP ||= getJson("changelog.json").then(d => { S.changelog = d; }).catch(e => { changelogP = null; throw e; }));
let usersP = null, contribP = null;                     // profiles (data/users.json) and contributions (data/contributions.json): the People tab and person pages
const loadUsers = () => (usersP ||= getJson("users.json").then(d => { S.users = d.users || []; S.userBy = new Map(S.users.map(p => [p.login.toLowerCase(), p])); return S.userBy; }).catch(e => { usersP = null; throw e; }));
const loadContrib = () => (contribP ||= Promise.all([getJson("contributions.json"), loadProfile()]).then(([d]) => { S.contrib = d; S.titles = Pf.titlesOf(d.people || []); }).catch(e => { contribP = null; throw e; }));
// published decks (data/decks.json): the deck browser, deck pages and the person pages' Decks panel. A failed load leaves an
// empty set with the reason (the browser says so; person pages just show no decks) instead of breaking the page.
let decksP = null;
const loadDecks = () => (decksP ||= getJson("decks.json").then(d => { S.decksData = decks.normalizeData(d, S.byId); })
  .catch(e => { decksP = null; S.decksData = { generated: "", decks: [], private: [], error: e.message }; }));
// the Details dropdown on a card page: data/details/<id>.json, fetched on first open and kept for the session
const detailsP = new Map();
const loadDetails = c => detailsP.get(c.id) || detailsP.set(c.id, getJson(`details/${encodeURIComponent(c.id)}.json`).catch(e => { detailsP.delete(c.id); throw e; })).get(c.id);
// the Font filter: each card's fonts as its Details panel lists them (data/cardfonts.json: a name table, index lists per
// card id), loaded on the filter's first use or for a font= / xfont= link
let fontsP = null;
const loadFonts = () => (fontsP ||= getJson("cardfonts.json").then(d => { const names = d.fonts || [];
  S.fontUse = new Map(Object.entries(d.cards || {}).map(([id, ix]) => [id, ix.map(i => names[i]).filter(Boolean)])); }).catch(e => { fontsP = null; throw e; }));
const fontsOf = c => S.fontUse?.get(c.id) || [];
const needsFonts = p => p.has("font") || p.has("xfont");
// the name list under a data-suggest field (tokens.js): the Font box for everyone, the editor's name fields in edit mode
const tokenApi = { vocab: () => [], icon: (t, o) => S.renderer?.icon(t, o) ?? null,
  names: el => (el.dataset.suggest === "font" ? fontEntries() : editor.names?.(el.dataset.suggest, el) || []) };
let tokensMod = null, tokensP = null;
const useTokens = m => { if (!tokensMod) { tokensMod = m; m.install(tokenApi); } return m; };   // once: the editor imports the same module
const loadTokens = () => (tokensP ||= (early("tokens.js"), import("./tokens.js")).then(useTokens).catch(e => { tokensP = null; throw e; }));
// the Font box's suggestions: the fonts the searched cards use, counted as the Font chips count them (the search, not
// the sidebar filters); picked and excluded ones marked (picking an excluded one moves it back in)
function fontEntries() {
  if (!S.fontUse) return [];
  const n = new Map(), p = parseHash().params, on = new Set(vals(p, "font")), off = new Set(vals(p, "xfont"));
  for (const c of filterCards(p, { facets: false })) for (const f of fontsOf(c)) n.set(f, (n.get(f) || 0) + 1);
  return [...n].map(([value, k]) => ({ value, n: k, note: `${k} card${k === 1 ? "" : "s"}${on.has(value) ? ", picked" : off.has(value) ? ", excluded" : ""}` }));
}
function whenLoaded(promise, what, rerender) {
  promise.then(rerender, e => { view.innerHTML = `<div class="empty">Couldn't load ${esc(what)} (${esc(e.message)}). <a href="javascript:location.reload()">Reload</a></div>`; });
}

async function init() {
  try {
    S.data = await getJson("cards.json");
  } catch (e) {
    view.innerHTML = `<div class="empty">Couldn't load card data (${esc(e.message)}). <a href="javascript:location.reload()">Reload</a></div>`;
    return;
  }
  S.all = S.data.cards; S.icons = S.data.icons;
  S.created = S.all.some(c => c.created);                 // creation dates: none in a shallow build without the dates file
  for (const c of S.all) S.byId.set(c.id, c);
  for (const [old, id] of Object.entries(S.data.moved || {})) if (!S.byId.has(old) && S.byId.has(id)) S.byId.set(old, S.byId.get(id));   // a renamed card's old id: links, picks, share codes
  if (editorP) await editorP.catch(() => {});
  if (editor !== IDLE) { editor.init(); previews.init(); }  // applies staged edits, then derive()
  else derive();
  S.ready = true;
  S.decks = D.loadDecks();
  updateDeckCount();
  updatePeopleCount();
  window.addEventListener("hashchange", route);
  window.addEventListener("popstate", route);
  renderAccount();
  route();
}

// everything computed from the cards; re-run after an edit
function derive() {
  S.rev++;
  for (const c of S.all) { c.parsed = c.parsed !== false; delete c._banned; delete c._unused; }
  S.cards = S.all.filter(c => !c.hidden || S.showHidden);
  // stats can pass 10 (Sonic's speed is 20)
  S.statMax = Object.fromEntries(["hp", "def", "atk", "spd"].map(k => [k, Math.max(10, ...S.cards.map(c => c[k] ?? 0))]));
  S.banned = new Map();
  for (const g of S.data.banlist.groups) for (const e of g.entries) {
    if (!e.id) continue;
    S.banned.set(e.id, e.reason || "banned");
    const c = S.byId.get(e.id); if (c) c._banned = e.reason || "banned";
  }
  S.renderer = makeRenderer({ cards: S.cards, icons: S.icons, variants: S.data.iconVariants });
  S.mentions = new Map(); S.mentionedBy = new Map();
  for (const c of S.cards) {
    const m = S.renderer.mentions(c.ability, c.name);
    S.mentions.set(c.id, m);
    if (c.dup) continue;                                   // a duplicate counts once
    for (const id of m) { if (!S.mentionedBy.has(id)) S.mentionedBy.set(id, new Set()); S.mentionedBy.get(id).add(c.id); }
  }
  for (const c of S.cards) if ((c.type === "debuff" || c.type === "buff") && !S.mentionedBy.get(c.id)?.size) c._unused = true;
}
const currentCard = () => (parseHash().name === "card" && !modal.hidden ? parseHash().arg : "");
const goCard = id => { if (parseHash().name === "card" && parseHash().arg === id) openCard(id); else location.hash = `#/card/${id}`; };
const goUser = login => { const r = parseHash(); if (r.name === "u" && !r.edit && r.arg.toLowerCase() === login.toLowerCase()) { closeModal(); renderView(r, hashOf(r)); } else location.hash = `#/u/${encodeURIComponent(login)}`; };
const goEdit = login => { const r = parseHash(); if (r.name === "u" && r.edit && r.arg.toLowerCase() === login.toLowerCase()) renderView(r, hashOf(r)); else location.hash = `#/u/${encodeURIComponent(login)}/edit`; };
function rerender() {
  const onCard = parseHash().name === "card", base = onCard ? S.listHash : location.hash || hashOf(parseHash());
  if (S.renderedHash || !$(".detail", modal)) renderView(parseHash(base), base);   // a card from a link: the grid once its dialog is gone
  if (onCard && $(".detail", modal)) openCard(parseHash().arg);       // dialogs stay open
}
// ---- edit mode, loaded on first use (editing.js): a sign-in, an Edit button, or at boot when this browser keeps a sign-in, a
// staged or just-published edit, Show hidden or a card preview (edit.js K, login.js SEALED, preview.js KEY). Until then
// `editor` is IDLE: nobody signed in, nothing staged.
const IDLE = { me: null, touches: () => false, leave() {}, deckOf: () => null, pendingDecks: () => new Map(), profileOf: () => null,
  pendingProfiles: () => new Map(), myRating: () => null };
let editor = IDLE, previews = null, inline = null, tray = null, editorP = null;
const editing = () => !!editor.me;                      // edit mode = signed in: the card dialog and the grid edit in place
const kept = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k) || ""; } catch { return ""; } };
const holds = s => { try { const v = JSON.parse(s); return !!v && Object.values(v).some(x => x && (typeof x !== "object" || Object.keys(x).length)); } catch { return !!s; } };
const wantsEditor = () => !!(kept(SEALED) || kept("edit-sent") || kept("edit-show-hidden")) || holds(kept("edit-stage")) || holds(kept("card-previews"));
function loadEditor(say = false) {                       // say: "Loading…" while it comes (a click)
  const note = "Loading the editor…";
  if (!editorP && say) toast(note);
  return (editorP ||= (early("editing.js"), import("./editing.js")).then(M => {
    const ed = startEditor(M);
    if (S.ready) { ed.init(); previews.init(); }          // else init() does
    if (toastEl.textContent === note) toastEl.hidden = true;
    return ed;
  }).catch(e => { editorP = null; toast(`Couldn't load the editor (${e.message})`); throw e; }));
}
const withEditor = fn => loadEditor(true).then(fn, () => {});
function startEditor(M) {
  const ed = M.createEditor({
    S, KIND_LABEL, PSD_TIP, derive, rerender, goCard, currentCard, toast: m => toast(m), modal,
    openCard: id => openCard(id), closeModal: () => closeModal(), showDialog: h => showDialog(h),
    statBars: c => statBars(c), imageOf: (c, w = 360) => img(c, w),   // the form's live preview; 720: the Edit viewer
    iconFor: n => iconFor(n), render: (t, n) => S.renderer.render(t, n),
    users: () => loadUsers(), goUser, goEdit, onAuth: () => { renderAccount(); if (!editor.me) S.selected.clear(); previews.onAuth(); },
    // the profile page editor (#/u/<login>/edit) renders into the view and reuses the tiles, the kinds and the saved hands
    view, route: () => parseHash(), tile: (c, o) => tileHtml(c, { small: true, ...o }), kinds: KINDS, kindOf, savedDecks: () => S.decks,
    decks: () => loadDecks().then(() => deckList()),         // the published decks (with the pending ones): the publish dialog's "replaces"
    formOpened: x => previews.mountForm(x),                  // the Edit dialog's image previews
    loadDetails: c => loadDetails(c),                        // the parts editor's boxes (details/<id>.json)
    setParams: u => setParams(u),                            // Rename everywhere: a filter on the old name follows it
  });
  editor = ed;
  // image previews in edit mode (preview.js): the mock-up and the rendered dry-run bake, badges on the grid's tiles
  previews = M.createPreviews({ S, editor: ed, img, toast: m => toast(m), loadDetails: c => loadDetails(c), getJson: n => getJson(n),
    signIn: () => ed.actions["edit-hub"](), badges: () => { if (editing()) previews.mountTiles(view); } });
  // edit mode = signed in: the card dialog and the cards grid edit in place (inline.js), the form stays as "All fields"
  inline = M.inline; tray = M.tray;
  inline.install({ editor: ed, modal, selected: S.selected, goCard: id => goCard(id), rerender: () => rerender(), toast: m => toast(m) });
  tray.install({ view, editor: ed, selected: S.selected, drop: (ids, t) => inline.dropOn(ids, t), toast: m => toast(m), cards: () => S.all });   // the pinned boxes
  let vocab = null, vocabRev = -1;                         // the token picker's icons, the most used first (after each derive())
  const vocabOf = () => { if (vocabRev !== S.rev) { vocab = M.tokens.vocabulary(S.icons, S.all.map(c => c.ability)); vocabRev = S.rev; } return vocab; };
  tokenApi.vocab = () => (S.all ? vocabOf() : []);         // "[" or "(" in card text: suggestions; a name field: the known names (tokenApi)
  useTokens(M.tokens);
  M.palette.useSearch(M.palette.pickerSearch(M.tokens.suggest, () => (S.all ? vocabOf() : [])));    // the type palette ranks as the picker
  inline.extend({ hideTip, icons: () => S.icons, closePicker: M.tokens.dismiss });   // editors hide the tooltip and the list; the type palette's icons
  Object.assign(actions, ed.actions, tray.actions);
  renderAccount();
  return ed;
}
let selectAnchor = null;                                 // the last tile toggled: Shift-click selects from it
function toggleSelect(id, range) {
  if (range && selectAnchor) for (const x of inline.rangeIds(S.list.map(c => c.id), selectAnchor, id)) S.selected.add(x);
  else S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
  selectAnchor = id;
  inline.reflect(view, S.selected);
}
// top right: "Sign in", or the login; both open the editor hub
function renderAccount() {
  const b = $("#account"), me = editor.me;
  b.textContent = me ? me.login : "Sign in";
  b.title = me ? `${me.login}: edit cards, your profile, sign out` : "Sign in to edit cards and make a profile";
}

// ---- routing ---------------------------------------------------------------------------------------
const STATIC_PAGES = { c: "card", u: "u" };                  // share pages without a hash: c/<id>/, u/<login>/, decks/<owner>/<slug>/
function parseHash(hash = location.hash) {
  const h = hash.replace(/^#\/?/, "");
  if (!h && location.href.startsWith(ROOT)) {
    const rest = location.href.slice(ROOT.length), m = rest.match(/^([cu])\/([^/?#]+)/);
    if (m) return { name: STATIC_PAGES[m[1]], arg: decodeURIComponent(m[2]), params: new URLSearchParams(m[1] === "u" ? location.search : "") };   // u/<login>/?stars=<kind>
    const k = rest.match(/^decks\/([^/?#]+)\/([^/?#]+)/);
    if (k) return { name: "decks", arg: `${decodeURIComponent(k[1])}/${decodeURIComponent(k[2])}`, params: new URLSearchParams() };
  }
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "u" && parts.length === 3 && parts[2] === "edit") return { name: "u", arg: parts[1], edit: true, params: new URLSearchParams(query) };   // the profile editor
  return { name: parts[0] || "cards", arg: parts.slice(1).join("/"), params: new URLSearchParams(query) };
}
const hashOf = r => `#/${r.name}${r.arg ? `/${r.arg.split("/").map(encodeURIComponent).join("/")}` : ""}${r.edit ? "/edit" : ""}${r.name === "u" && !r.edit ? personQuery(r.params) : ""}`;     // the route's hash when the address bar has none
const personQuery = p => (p?.get("stars") ? `?stars=${encodeURIComponent(p.get("stars"))}` : "");   // a person page's view state: the Star levels' kind
// a published public deck (its share page exists): the entry, else null
const staticDeck = arg => { const [o, ...rest] = String(arg || "").split("/"), s = rest.join("/"); const d = S.decksData?.decks.find(x => x.slug === s && x.owner.toLowerCase() === o.toLowerCase()); return d && !editor.deckOf(o, s) ? d : null; };
// address bar shows the shareable URL: c/<id>/ for cards, u/<login>/ for profiles, decks/<owner>/<slug>/ for published decks, d/#/deck/… for shared hands;
// the profile editor stays a hash route
function syncUrl(r) {
  const sd = r.name === "decks" && r.arg ? staticDeck(r.arg) : null;
  const want = r.name === "card" ? shareUrl(r.arg) : r.name === "u" && r.arg && !r.edit ? userUrl(r.arg) + personQuery(r.params) : sd ? deckPageUrl(sd.owner, sd.slug)
    : r.name === "decks" && r.arg && !location.hash ? location.href                  // a deck's static path before decks.json is loaded (or a private, staged or missing deck): stay, never the bare root
    : `${ROOT}${r.name === "deck" && r.arg ? "d/" : ""}${location.hash}`;
  if (location.href !== want || !history.state?.drawn) history.replaceState({ ...history.state, drawn: true }, "", want);   // drawn: Back or Forward to it restores its scroll
}
let popped = null;                                       // a hash navigation fires popstate, then hashchange: route once
function route(e) {
  if (e?.type === "hashchange") { const dup = e.newURL === popped; popped = null; if (dup) return; }
  else if (e?.type === "popstate") popped = location.href;
  S.restoring = e?.type === "popstate" && !!history.state?.drawn;   // Back or Forward: the browser restores the scroll after this, so no chunks
  queueMicrotask(() => { S.restoring = false; });
  const r = parseHash();
  if (r.name === "card" && S.data?.moved?.[r.arg] && S.byId.has(r.arg)) r.arg = S.byId.get(r.arg).id;   // a renamed card: its new page
  syncUrl(r);
  hideTip();
  if (r.name === "card") {
    if (!S.renderedHash && !S.byId.has(r.arg)) renderView(parseHash(S.listHash), S.listHash);   // a dead link: the grid, then the toast
    else if (!S.renderedHash) {                          // from a link: the grid (and its pictures) when the dialog closes
      S.list = listOf(new URLSearchParams()); view.replaceChildren();
      $$(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === "cards"));
    }
    openCard(r.arg, r.params.has("details"));
    return;
  }
  const hash = location.hash || hashOf(r);
  if (hash === S.renderedHash && !modal.hidden && viewSig() === S.viewSig && !$(".loading", view)) { closeModal(); document.title = S.title = titleOf(r); return; }   // nothing changed (and nothing still loading): the view under it stays
  closeModal();
  renderView(r, hash);
}
function renderView(r, hash) {
  S.renderedHash = hash; S.listHash = hash;
  if (r.name !== "cards") { S.selected.clear(); S.selecting = false; }
  if (!(r.name === "u" && r.edit)) editor.leave();
  const tab = { compare: "cards", u: "users", decks: "deck" }[r.name] || r.name;
  $$(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  if (r.name !== "cards" && qInput.value && document.activeElement !== qInput) qInput.value = "";
  const views = { cards: renderCards, rules: renderRules, deck: renderDeck, stats: renderStatsView, changes: renderChanges, compare: renderCompare, users: renderUsers, u: renderUser, decks: renderDecks };
  (views[r.name] || renderCards)(r);
  if (S.toTop) { S.toTop = false; scrollTo(0, 0); }
  S.title = document.title = titleOf(r);
  S.viewSig = viewSig();
}
function titleOf(r) {
  const titles = { cards: "Cards", rules: "Rulebook", deck: "Deck builder", stats: "Stats", changes: "Changes", compare: "Compare", users: "People", u: r.edit ? "Edit profile" : r.arg || "People",
    decks: r.arg ? S.deckTitle || "Deck" : "Published decks" };
  return `${titles[r.name] || "Cards"} · Impossibility Simulator`;
}
// what a card dialog can change under it (edits, hands, the comparison, sign-in, the theme): a dialog closes without a redraw while this holds
function viewSig() { return `${S.rev}|${S.compare.join(",")}|${JSON.stringify(S.decks)}|${editor.me?.login || ""}|${document.documentElement.dataset.theme}`; }
function setParams(updates, { replace = true } = {}) {
  const r = parseHash();
  const p = r.params;
  for (const [k, v] of Object.entries(updates)) {
    if (MULTI.has(k)) { p.delete(k); for (const x of [].concat(v ?? [])) if (x) p.append(k, x); continue; }   // cf=a&cf=b: one param each
    (v === "" || v == null || (Array.isArray(v) && !v.length)) ? p.delete(k) : p.set(k, Array.isArray(v) ? v.join(",") : v);
  }
  const hash = `#/${r.name === "card" ? "cards" : r.name}${r.arg ? "/" + r.arg : ""}${p.toString() ? "?" + p : ""}`;
  if (replace) { history.replaceState(history.state, "", hash); renderView(parseHash(), hash); } else location.hash = hash;
}

// ---- cards (browse) --------------------------------------------------------------------------------
const csv = (p, k) => (p.get(k) ? p.get(k).split(",").filter(Boolean) : []);
const MULTI = new Set([...CF.MULTI, "font", "xfont"]);                   // repeated params, one value each (names may hold commas)
const vals = (p, k) => (MULTI.has(k) ? CF.vals(p, k) : csv(p, k));       // cf, xcf, font, xfont
function rangeOf(p, k) { const v = p.get(k); if (!v) return null; const [lo, hi] = v.split("-").map(Number); return [isNaN(lo) ? 0 : lo, isNaN(hi) ? 99 : hi]; }
// edited on the website: an editor's fields (changes.fieldEditors), never a _by AutoCroissant entry (the 2026-10-22
// migration's, the moved stat exclusions) nor the migration's fields in an editor's entry (botEdited)
const webEdited = c => changes.fieldEditors(c).length > 0;
function filterCards(p, { facets = true } = {}) {
  const pred = compile(p.get("q") || "");
  let list = pred ? S.cards.filter(pred) : S.cards.slice();
  if (!facets) return list;
  const kinds = csv(p, "kind"), st = csv(p, "stars").map(Number), subs = csv(p, "sub"), types = csv(p, "types"), flags = csv(p, "flags");
  const series = p.get("series"), subseries = p.get("subseries"), author = p.get("author");
  if (kinds.length) list = list.filter(c => kinds.includes(kindOf(c)) || kinds.includes(c.type));      // debuff, buff: a Stats link
  if (st.length) list = list.filter(c => st.includes(c.stars));
  if (subs.length) list = list.filter(c => subs.includes(c.subtype));
  if (types.length) list = list.filter(c => types.every(t => (c.types || []).includes(t)));
  if (series) list = list.filter(c => c.series === series);
  if (subseries) list = list.filter(c => c.subseries === subseries);
  if (author) list = list.filter(c => c.author === author);
  for (const k of ["hp", "def", "atk", "spd"]) { const r = rangeOf(p, k); if (r) list = list.filter(c => c[k] != null && c[k] >= r[0] && c[k] <= r[1]); }
  const flagFns = { history: c => !!c.hv, unparsed: c => !c.parsed, problems: c => !!(c.problems && c.problems.length), alias: c => !!(c.aliases && c.aliases.length),
    dup: c => !!(c.dup || c.dups), unused: c => !!c._unused, edited: c => !!(webEdited(c) || c._staged || c._sent),
    pending: c => !!((c.pending && c.pending.length) || c.refused),
    banned: c => !!c._banned };
  for (const f of flags) if (flagFns[f]) list = list.filter(flagFns[f]);
  const missing = G.MISSING.filter(([k]) => csv(p, "missing").includes(k));   // cards missing all of them
  if (missing.length) list = list.filter(c => missing.every(x => x[3](c)));
  list = G.dropExcluded(list, p, flagFns);                                     // xkind=…, xtypes=…: the sidebar's exclusions
  list = CF.apply(list, p);                                                    // cf=…, xcf=…: My filters
  const fin = vals(p, "font"), fout = vals(p, "xfont");                        // font=…: any of them; xfont=…: none (renderCards loads the data)
  if (fin.length || fout.length) list = !S.fontUse ? [] : list.filter(c => { const f = fontsOf(c); return (!fin.length || f.some(x => fin.includes(x))) && !f.some(x => fout.includes(x)); });
  for (const [k, , test] of LINKED) { const v = p.get(k); if (v) list = list.filter(test(v)); }
  const month = p.get("month"), change = p.get("change");
  if (month || change) list = S.analytics ? list.filter(c => St.balance.changedAs(S.analytics, c, month, change)) : [];   // renderCards loads it
  return list;
}
// filters the Stats charts link to (stats.js cardsHref), shown as chips: [param, chip label(v), test(v)]; bal, cohort,
// month and change read analytics.json (renderCards loads it)
const LINKED = [
  ["legal", () => "Legal in constructed", () => c => !c._banned && c.parsed !== false],
  ["shape", v => (v === "tied" ? "Tied highest stats" : `Highest stat ${v.toUpperCase()}`), v => c => !!St && St.stats.shapeOf(c) === v],
  ["cd", v => `(${v.replace("+", "")})${v.endsWith("+") ? "+" : ""}`, v => c => !!St && St.stats.cooldownCols(c).some(x => x.key === v)],
  ["tag", v => `(${v})`, v => c => !!St && St.stats.tagsOf(c).includes(v)],
  ["mentions", v => `Naming ${S.byId.get(v)?.name || v}`, v => c => !!S.mentionedBy.get(v)?.has(c.id)],
  ["fresh", v => `Text from ${v}`, v => c => !!St && St.insights.freshYear(c) === v],
  ["bal", v => `${v === "top" ? "Top" : "Bottom"} 10% for its star level`, v => c => !!S.analytics && St.balance.flagged(S.analytics, c, v)],
  ["cohort", v => (v === "any" ? "With all four stats" : St ? `${cap(St.balance.cohortName(v))} with all four stats` : v), v => c => !!S.analytics && St.balance.inCohort(S.analytics, c, v)],
  ["nodup", () => "Duplicates hidden", () => c => !c.dup],        // Stats counts a duplicate once
];
const needsAnalytics = p => ["bal", "cohort", "month", "change"].some(k => p.get(k));
const needsCharts = p => ["shape", "cd", "tag", "fresh"].some(k => p.get(k));   // charts.js: the other Stats links
const listOf = p => exactFirst(sortCards(filterCards(p), sortOf(p), p.get("dir") || ""), p.get("q"));   // the cards the grid shows, in order (search.js exactFirst)
function sortCards(list, sort = "name", dir = "") {
  const own = k => c => c[k] ?? null, low = v => v?.toLowerCase() || null;   // null: the card lacks it (last either way, G.byKey)
  const key = {
    name: G.nameKey, stars: c => c.stars || null, total: c => (["hp", "def", "atk", "spd"].every(k => c[k] == null) ? null : total(c)), hp: own("hp"), def: own("def"),
    atk: own("atk"), spd: own("spd"), new: own("ts"), series: [c => low(c.series), c => low(c.subseries)], type: c => (c.type && c.type !== "unknown" ? kindOf(c) : null),
    mentioned: c => (S.mentionedBy.get(c.id) || new Set()).size,
  }[sort] || G.nameKey;
  const desc = isDesc(sort, dir);
  if (sort === "created") {                                // no date last, by name; one day by first upload, then name
    const s = desc ? -1 : 1, cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    return list.sort((a, b) => (!a.created - !b.created) || (a.created ? s * cmp(a.created, b.created) || s * ((a.fs || 0) - (b.fs || 0)) : 0)
      || a.name.localeCompare(b.name));
  }
  return list.sort(G.byKey(key, desc));
}
// xs: the excluded values (red, struck through, the count = the cards they remove: removes(key, v)); del: a ✕ after each
function chipList(key, options, selected, counts, xs = [], removes = null, del = null) {
  return `<div class="chips">${options.map(([v, label]) => { const x = xs.includes(String(v)), n = x ? removes(key, String(v)) : counts?.get(String(v)) || 0;
    return `${del ? `<span class="chip-wrap">` : ""}<button type="button" class="chip${x ? " x" : selected.includes(String(v)) ? " on" : ""}" data-action="toggle-param" data-key="${key}" data-value="${esc(v)}"${x ? ` aria-label="${esc(label)}: excluded, removes ${n}"` : ""}>${esc(label)}${counts ? `<span class="n">${x ? `−${n}` : n}</span>` : ""}</button>${del ? `${del(v, label)}</span>` : ""}`; }).join("")}</div>`;
}
// the Font chips: chipList's, each with a ✕ that forgets it (a click turns it off and on, like Kind)
const fontChips = (...a) => chipList("font", S.fontKept.map(f => [f, f]), ...a,
  v => `<button type="button" class="ghost font-del" data-action="font-forget" data-value="${esc(v)}" title="Remove this font" aria-label="Remove the font ${esc(v)}">✕</button>`);
const XABLE = new Set(["kind", "stars", "sub", "types", "flags", "missing", "cf", "font"]);   // a right-click (long press) excludes
const NOT_KEYS = ["series", "subseries", "author"];                              // a select with a ≠ toggle
/** a sidebar control a right-click or long press on `t` excludes with, or null */
const xTarget = t => { const el = t?.closest?.('[data-action="toggle-param"]') || t?.closest?.("label.check")?.querySelector('[data-action="toggle-param"]');
  return el && XABLE.has(el.dataset.key) && el.closest(".browse .filters") ? el : null; };
const tileEnv = { get thumbs() { return S.data.thumbs; }, get icons() { return S.icons; }, dupName: id => S.byId.get(id)?.name, inDeck: id => deckHas(id) };
const tileHtml = (c, o) => G.tileHtml(c, o, tileEnv);
function renderCards(r) {
  const p = r.params, win = { y: scrollY, w: innerWidth, h: innerHeight, all: S.restoring };   // before the view goes: read after, they lay out the short page (the scroll clamps)
  if (document.activeElement !== qInput) qInput.value = p.get("q") || "";
  const base = filterCards(p, { facets: false });
  const list = listOf(p);
  S.list = list;
  if (S.selected.size) { const ids = new Set(list.map(c => c.id)); for (const id of S.selected) if (!ids.has(id)) S.selected.delete(id); }   // a drag carries only shown cards
  const count = (arr, f) => { const m = new Map(); for (const c of arr) for (const k of [].concat(f(c))) if (k != null) m.set(String(k), (m.get(String(k)) || 0) + 1); return m; };
  const kindCounts = count(base, kindOf), starCounts = count(base, c => c.stars), subCounts = count(base, c => c.subtype);
  const typeCounts = count(base, c => c.types || []);
  const xs = k => G.xvals(p, k), removed = new Map();
  const removes = (k, v) => { const id = `${k}\u0001${v}`; if (!removed.has(id)) { const q = new URLSearchParams(p); q.set(`x${k}`, xs(k).filter(x => x !== v).join(","));
    removed.set(id, Math.max(0, filterCards(q).length - list.length)); } return removed.get(id); };   // without it, less with it
  const miss = csv(p, "missing"), xmiss = xs("missing"), missCounts = new Map(G.MISSING.map(([k, , , test]) => [k, list.filter(test).length]));   // what ticking it would show
  const series = [...new Set(S.cards.map(c => c.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const pickOf = k => p.get(k) || p.get(`x${k}`) || "";                        // the select shows an excluded value too
  const subseries = [...new Set(S.cards.filter(c => c.subseries && (!p.get("series") || c.series === p.get("series"))).map(c => c.subseries))]   // each name once (a picked series: its own)
    .sort((a, b) => a.localeCompare(b));
  const subPicked = pickOf("subseries") && !subseries.includes(pickOf("subseries"));
  const notSel = (k, html) => { const x = !p.get(k) && (!!p.get(`x${k}`) || S.notPick.has(k));   // ≠: the select excludes
    return `<div class="sel-row${x ? " x" : ""}">${html}<button type="button" class="not" data-action="not-param" data-key="${k}" aria-pressed="${x}" title="Exclude this ${k}" aria-label="Exclude this ${k}">≠</button></div>`; };
  const authors = [...new Set(S.cards.map(c => c.author).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const starOpts = [...new Set(S.cards.map(c => c.stars).filter(Boolean))].sort((a, b) => a - b).map(s => [s, `${s}★`]);
  const subOpts = [...new Set(S.cards.map(c => c.subtype).filter(Boolean))].sort().map(s => [s, s[0].toUpperCase() + s.slice(1)]);
  const typeOpts = [...typeCounts.keys()].sort((a, b) => (typeCounts.get(b) || 0) - (typeCounts.get(a) || 0));
  const missOpts = G.MISSING.filter(([k]) => missCounts.get(k) || miss.includes(k) || xmiss.includes(k));      // none to show: hidden
  const mine = CF.saved(), cfIn = CF.vals(p, "cf"), cfOut = CF.vals(p, "xcf");                         // My filters (myfilters.js)
  const cfRemoves = v => { const q = new URLSearchParams(p); q.delete("xcf"); for (const x of cfOut) if (x !== v) q.append("xcf", x); return Math.max(0, filterCards(q).length - list.length); };
  const cfSave = v => (mine.includes(v) ? "" : `<button type="button" class="chip cf-save" data-action="cf-save" data-value="${esc(v)}" title="Save to My filters">Save</button>`);   // from a link
  const fontIn = vals(p, "font"), fontOut = vals(p, "xfont"), fontCounts = S.fontUse ? count(base, fontsOf) : null;   // the Font filter
  for (const f of [...fontIn, ...fontOut]) if (!S.fontKept.includes(f)) S.fontKept.push(f);   // a font off stays listed (owner 10-26), not in the address
  const fontRemoves = (k, v) => { const q = new URLSearchParams(p); q.delete("xfont"); for (const x of fontOut) if (x !== v) q.append("xfont", x); return Math.max(0, filterCards(q).length - list.length); };
  const view_ = p.get("view") || localStorage.getItem("view") || "grid", size = p.get("size") || localStorage.getItem("size") || "m";
  const active = [];
  if (p.get("q")) active.push(["q", `“${p.get("q")}”`]);
  for (const v of cfIn) active.push(["cf", v, v, false, cfSave(v)]);
  for (const v of cfOut) active.push(["xcf", `not ${v}`, v, true, cfSave(v)]);
  for (const k of csv(p, "kind")) active.push(["kind", (KINDS.find(x => x[0] === k) || [k, KIND_PLURAL[k] || k])[1], k]);
  for (const s of csv(p, "stars")) active.push(["stars", `${s}★`, s]);
  for (const s of csv(p, "sub")) active.push(["sub", cap(s), s]);
  for (const t of csv(p, "types")) active.push(["types", t.replace(/_/g, " "), t]);
  if (p.get("series")) active.push(["series", p.get("series")]);
  if (p.get("subseries")) active.push(["subseries", p.get("subseries")]);
  if (p.get("author")) active.push(["author", `by ${p.get("author")}`]);
  for (const v of fontIn) active.push(["font", v, v]);
  for (const v of fontOut) active.push(["xfont", `not ${v}`, v, true]);
  for (const k of ["hp", "def", "atk", "spd"]) if (p.get(k)) active.push([k, `${k.toUpperCase()} ${p.get(k)}`]);
  for (const f of csv(p, "flags")) { const x = FLAGS.find(x => x[0] === f); if (x) active.push(["flags", x[1], f]); }   // an old flag: ignored
  for (const [k, l] of G.MISSING) if (miss.includes(k)) active.push(["missing", l, k]);
  const xLabel = { kind: k => (KINDS.find(x => x[0] === k) || [k, KIND_PLURAL[k] || k])[1], stars: s => `${s}★`, sub: cap, types: t => t.replace(/_/g, " "),
    flags: f => FLAGS.find(x => x[0] === f)?.[1], missing: k => G.MISSING.find(x => x[0] === k)?.[1], series: v => v, subseries: v => v, author: v => `by ${v}` };
  for (const k of G.X_KEYS) for (const v of xs(k)) { const l = xLabel[k](v); if (l) active.push([`x${k}`, `not ${l}`, G.ONE.has(k) ? undefined : v, true]); }   // an old flag: ignored
  if (p.get("month")) active.push(["month", `Changed ${St ? St.balance.monthName(p.get("month")) : p.get("month")}`]);
  if (p.get("change")) active.push(["change", St?.balance.CHANGE_LABEL[p.get("change")] || p.get("change")]);
  for (const [k, label] of LINKED) if (p.get(k)) active.push([k, label(p.get(k))]);
  const rangeSel = (k, which) => { const r_ = rangeOf(p, k); const cur = r_ ? Math.min(r_[which], S.statMax[k]) : (which ? S.statMax[k] : 0);
    return `<select data-action="range" data-key="${k}" data-which="${which}" aria-label="${k} ${which ? "max" : "min"}">${Array.from({ length: S.statMax[k] + 1 }, (_, i) => `<option${i === cur ? " selected" : ""}>${i}</option>`).join("")}</select>`; };
  const suggestions = !list.length && p.get("q") ? suggest(p.get("q"), S.cards) : [];
  const changed = needsAnalytics(p) && !S.analytics, fontWait = needsFonts(p) && !S.fontUse;
  const waiting = changed || fontWait || (needsCharts(p) && !St);   // a Stats link's filters, a font link: the grid again once analytics.json (charts.js, cardfonts.json) is in
  if (waiting) (changed ? loadAnalytics() : fontWait ? loadFonts() : loadCharts()).then(() => { if (parseHash(S.renderedHash || "").name === "cards") rerender(); },
    () => { const el = $(".browse .loading", view); if (el) el.textContent = changed ? "Couldn't load the recorded changes." : "Couldn't load the filter."; });

  const browse = `<div class="browse">
    <aside class="filters${S.filtersOpen ? " open" : ""}" aria-label="Filters">
      ${mine.length ? `<h3>My filters</h3>${mine.map(v => { const x = cfOut.includes(v), f = CF.pred(v), n = x ? cfRemoves(v) : f ? list.filter(f).length : list.length;
        return `<div class="cf-row"><label class="check${x ? " x" : ""}"><input type="checkbox" data-action="toggle-param" data-key="cf" data-value="${esc(v)}"${!x && cfIn.includes(v) ? " checked" : ""}${x ? ` aria-label="${esc(v)}: excluded"` : ""}> <span class="cf-q">${esc(v)}</span><span class="n">${x ? `−${n}` : n}</span></label><button type="button" class="ghost cf-del" data-action="cf-delete" data-value="${esc(v)}" title="Remove this filter" aria-label="Remove the filter ${esc(v)}">✕</button></div>`; }).join("")}` : ""}
      <h3>Kind</h3>${chipList("kind", KINDS.filter(([k]) => kindCounts.get(k)), csv(p, "kind"), kindCounts, xs("kind"), removes)}
      <h3>Stars</h3>${chipList("stars", starOpts, csv(p, "stars"), starCounts, xs("stars"), removes)}
      ${subOpts.length ? `<h3>Item type</h3>${chipList("sub", subOpts, csv(p, "sub"), subCounts, xs("sub"), removes)}` : ""}
      ${typeOpts.length ? `<h3>Types</h3><div class="icon-toggles">${typeOpts.map(t => { const ic = iconFor(t), x = xs("types").includes(t), on = !x && csv(p, "types").includes(t), name = t.replace(/_/g, " ");
        return `<button type="button" class="icon-toggle${on ? " on" : ""}${x ? " x" : ""}" data-action="toggle-param" data-key="types" data-value="${esc(t)}" data-tip="${esc(x ? `not ${name} (removes ${removes("types", t)})` : `${name} (${typeCounts.get(t)})`)}" aria-pressed="${on}"${x ? ` aria-label="${esc(name)}: excluded"` : ""}>${ic ? `<img loading="lazy" src="${esc(ic.file)}" alt="${esc(t)}">` : esc(t.slice(0, 2))}</button>`; }).join("")}</div>` : ""}
      <h3>Series</h3>${notSel("series", `<select data-action="select-param" data-key="series"><option value="">All series</option>${series.map(s => `<option${s === pickOf("series") ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>`)}
      ${subseries.length || pickOf("subseries") ? `<h3>Subseries</h3>${notSel("subseries", `<select data-action="select-param" data-key="subseries"><option value="">All subseries</option>${subPicked ? `<option selected>${esc(pickOf("subseries"))}</option>` : ""}${subseries.map(s => `<option${s === pickOf("subseries") ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>`)}` : ""}
      <h3>Stats</h3>${["hp", "def", "atk", "spd"].map(k => `<div class="range-row"><span class="muted">${k.toUpperCase()}</span>${rangeSel(k, 0)}${rangeSel(k, 1)}</div>`).join("")}
      <h3>Author</h3>${notSel("author", `<select data-action="select-param" data-key="author"><option value="">Anyone</option>${authors.map(a => `<option${a === pickOf("author") ? " selected" : ""}>${esc(a)}</option>`).join("")}</select>`)}
      <h3>Font</h3><input type="text" class="font-box" data-suggest="font" autocomplete="off" spellcheck="false" placeholder="Type a font…" title="Cards using any picked font" aria-label="Font: cards using any picked font">
      ${S.fontKept.length ? `${fontChips(fontIn, fontCounts, fontOut, fontRemoves)}${fontIn.length > 1 ? `<p class="muted font-any">Cards with any of them.</p>` : ""}` : ""}
      <h3>Flags</h3>${FLAGS
        .map(([f, l]) => { const x = xs("flags").includes(f);
          return `<label class="check${x ? " x" : ""}"><input type="checkbox" data-action="toggle-param" data-key="flags" data-value="${f}"${!x && csv(p, "flags").includes(f) ? " checked" : ""}${x ? ` aria-label="${l}: excluded"` : ""}> ${l}${x ? `<span class="n">−${removes("flags", f)}</span>` : ""}</label>`; }).join("")}
      ${missOpts.length ? `<h3>Missing</h3>${missOpts.map(([k, l, tip]) => { const x = xmiss.includes(k);
        return `<label class="check${x ? " x" : ""}"${tip ? ` title="${esc(tip)}"` : ""}><input type="checkbox" data-action="toggle-param" data-key="missing" data-value="${k}"${!x && miss.includes(k) ? " checked" : ""}${x ? ` aria-label="${l}: excluded"` : ""}> ${l}<span class="n">${x ? `−${removes("missing", k)}` : missCounts.get(k)}</span></label>`; }).join("")}` : ""}
      <p class="muted x-hint">Right-click or long-press a filter to exclude it.</p>
      <p><button type="button" class="ghost" data-action="clear-filters">Clear all filters</button></p>
    </aside>
    <section>
      ${editing() && view_ === "grid" ? tray.html(S.selecting) : ""}
      ${G.toolbarHtml({ count: list.length, waiting, active: active.length, sort: sortOf(p), dir: p.get("dir"), created: S.created, view: view_, size,
        tail: `${editing() && view_ === "grid" ? `<button type="button" class="ghost" data-action="tray-add"${tray.pinned() ? " hidden" : ""}>Pin a box</button>
          <button type="button" class="ghost" data-action="select-mode" aria-pressed="${S.selecting}">${S.selecting ? "Done" : "Select"}</button>` : ""}
        ${S.compare.length ? `<a href="#/compare/${S.compare.join(",")}">Compare (${S.compare.length})</a>` : ""}` })}
      ${active.length ? `<div class="active-filters">${active.map(([k, l, v, x, more = ""]) => `<button type="button" class="chip${x ? " x" : ""}" data-action="remove-param" data-key="${k}"${v !== undefined ? ` data-value="${esc(v)}"` : ""}>${esc(l)} ✕</button>${more}`).join("")}</div>` : ""}
      <div id="deck-hits">${deckHits(p.get("q") || "")}</div>
      ${waiting ? `<p class="loading">${changed ? "Loading the recorded changes…" : "Loading…"}</p>` : !list.length ? `<div class="empty">No cards match.${suggestions.length ? ` Did you mean ${suggestions.map(c => `<a href="#/card/${c.id}">${esc(c.name)}</a>`).join(", ")}?` : ""}</div>`
        : view_ === "table" ? tableHtml(list, p, win) : `<div class="grid" style="--tile:${(G.TILE_SIZES[size] || G.TILE_SIZES.m)[0]}"></div>`}
    </section></div>`;
  const filters = $(".browse .filters", view), filtersTop = filters?.scrollTop || 0;   // a click there redraws it: keep its place
  const grid = keepGrid(browse) || (view.innerHTML = browse, $(GRID, view));
  if (filtersTop && $(".browse .filters", view) !== filters) $(".browse .filters", view).scrollTop = filtersTop;
  if (grid) fillGrid(grid, list, { css: (G.TILE_SIZES[size] || G.TILE_SIZES.m)[1], win });
  else if (list.length && view_ === "table") fillTable($(".browse table.data tbody", view));
  if (editing()) inline.mountGrid(view, p);
  if (editing()) previews.mountTiles(view);
}
// The grid stays in the page while the view stays a grid: Safari draws a picture again when its <img> leaves the page or
// comes back (the whole grid flashed at each redraw, e.g. the one entering edit mode after a kept sign-in). The filters
// are patched in place (morph: their icons stay), the rest of the browse is swapped in around the grid, and fillGrid
// reconciles the tiles. null: no grid before or now (the caller draws the view).
const GRID = ".browse > section > .grid";
function keepGrid(browse) {
  const old = $(":scope > .browse", view), oldGrid = old && $(":scope > section > .grid", old), oldAside = old && $(":scope > aside.filters", old);
  if (!oldGrid || !oldAside) return null;
  const tpl = document.createElement("template");
  tpl.innerHTML = browse;
  const fresh = tpl.content.firstElementChild, grid = $(":scope > section > .grid", fresh), aside = $(":scope > aside.filters", fresh);
  if (!grid || !aside) return null;
  for (const n of [...view.childNodes]) if (n !== old) n.remove();
  morph(oldAside, aside);
  const section = grid.parentElement, oldSection = oldGrid.parentElement;
  for (const n of [...oldSection.childNodes]) if (n !== oldGrid) n.remove();
  let before = true;
  for (const n of [...section.childNodes]) if (n === grid) before = false; else if (before) oldSection.insertBefore(n, oldGrid); else oldSection.append(n);
  for (const [a, b] of [[old, fresh], [oldSection, section], [oldGrid, grid]]) sameAttrs(a, b);
  return oldGrid;
}
const sameAttrs = (el, to) => {
  for (const { name } of [...el.attributes]) if (!to.hasAttribute(name)) el.removeAttribute(name);
  for (const { name, value } of to.attributes) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
};
// el made like to (its fresh copy), keeping el's nodes where the tags match; form controls as the markup says
function morph(el, to) {
  if (el.nodeName !== to.nodeName) { el.replaceWith(to); return; }
  if (el.nodeType !== 1) { if (el.nodeValue !== to.nodeValue) el.nodeValue = to.nodeValue; return; }
  sameAttrs(el, to);
  const pick = el.tagName === "SELECT" ? Math.max(0, [...to.options].findIndex(o => o.hasAttribute("selected"))) : -1;
  const a = [...el.childNodes], b = [...to.childNodes];
  b.forEach((n, i) => (i < a.length ? morph(a[i], n) : el.append(n)));
  for (const n of a.slice(b.length)) n.remove();
  if (pick >= 0) el.selectedIndex = pick;
  else if (el.tagName === "INPUT") el.checked = to.hasAttribute("checked");
}
// the grid's tiles by card id {html, el, ed, css}: html is the tile's markup without eager (its place doesn't change it),
// ed: last placed in edit mode, css: its picture's width for the tile size (another size sets sizes in place). A render
// reuses a tile while its markup is unchanged, so its picture stays loaded; entering edit mode too (its marks, draggable,
// data-selected and preview badges, are set after every render), leaving it makes the tiles anew. Code that changes a
// tile in place updates its markup here (refresh).
const gridTiles = new Map();
const GRID_FIRST = 96, GRID_CHUNK = 120, GRID_EAGER = 8;
let gridJob = 0;
// The grid's children become the list's tiles in place: a tile still shown keeps its element, and its place unless the
// order changed around it (the longest run already in the list's order stays, the others move); gone tiles leave first,
// new ones go in. The tiles that cover the window are placed now, the rest in later tasks (a newer render stops them;
// until then the old ones stay below), with the edit-mode marks.
function fillGrid(grid, list, { css, win }) {
  const ed = editing(), job = ++gridJob;
  adoptFirst(grid, css);
  const at = new Map(list.map((c, i) => [c.id, i])), shown = new Map();   // card id -> its tile in the grid now
  for (const el of [...grid.children]) { const id = el.dataset.open; if (!at.has(id) || shown.has(id)) el.remove(); else shown.set(id, el); }
  const now = [...shown.values()], stay = new Set([...longestRun(now.map(el => at.get(el.dataset.open)))].map(i => now[i]));
  let last = null;                                         // the last tile placed
  const put = (from, to, mark = false) => {
    to = Math.min(to, list.length);
    const els = [], made = [];
    for (let i = from; i < to; i++) {
      const c = list[i], html = tileHtml(c, { css }), t = gridTiles.get(c.id);
      if (t && t.css !== css && t.html.replace(`sizes="${t.css}px"`, `sizes="${css}px"`) === html) {   // another tile size: its picture's sizes only
        t.el.querySelector("img.art")?.setAttribute("sizes", `${css}px`); t.html = html; t.css = css;
      }
      if (t && t.html === html && (ed || !t.ed)) { t.ed = ed; els.push(t.el); } else { els.push(null); made.push([i, html]); }
    }
    if (made.length) {
      const tpl = document.createElement("template");
      tpl.innerHTML = made.map(([i, html]) => (i < GRID_EAGER ? tileHtml(list[i], { css, eager: true }) : html)).join("");
      const fresh = [...tpl.content.children];
      made.forEach(([i, html], k) => { els[i - from] = fresh[k]; gridTiles.set(list[i].id, { html, el: fresh[k], ed, css }); });
    }
    const add = els.filter(el => el.parentNode !== grid);   // new, or back from an earlier render
    if (mark && add.length) { const frag = document.createDocumentFragment(); frag.append(...add); inline.markTiles(frag, S.selected); previews.mountTiles(frag); }
    let next = last ? last.nextSibling : grid.firstChild;
    els.forEach((el, k) => {
      const old = shown.get(list[from + k].id);
      if (old && old !== el) { if (old === next) next = next.nextSibling; old.remove(); }   // made anew: its markup changed
      while (next && next !== el && !stay.has(next)) next = next.nextSibling;             // one that moves: placed in its turn
      if (next === el) next = el.nextSibling; else grid.insertBefore(el, next);
      last = el;
    });
    if (to === list.length) while (last?.nextSibling) last.nextSibling.remove();
  };
  // tiles are 200 px tall or more and 144 px wide or more (with the gap): enough to keep the scroll position
  const first = win.all ? list.length : Math.max(GRID_FIRST, (Math.floor(win.w / 144) + 1) * Math.ceil((win.y + 2 * win.h) / 200));
  put(0, first);
  if (first >= list.length) return;
  let k = first;
  const step = () => {
    if (job !== gridJob || !grid.isConnected) return;
    put(k, k += GRID_CHUNK, ed);
    if (k < list.length) setTimeout(step);
  };
  setTimeout(step);
}
// the positions in seq of a longest increasing run (patience sorting)
function longestRun(seq) {
  const tails = [], prev = new Array(seq.length);
  seq.forEach((v, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (seq[tails[m]] < v) lo = m + 1; else hi = m; }
    prev[i] = lo ? tails[lo - 1] : -1;
    tails[lo] = i;
  });
  const run = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) run.add(i);
  return run;
}
// index.html's first screen (build_site first_screen): link tiles whose pictures are already in. The first render makes
// each one that is its card's tile as the site draws it now the grid's tile in place: the flag, deck button and data-open
// added (every tile links to its card's page: owner 10-26; edit mode's markTiles drops the href). Any other (a staged
// edit, say) fillGrid replaces.
function adoptFirst(grid, css) {
  for (const a of grid.querySelectorAll(":scope > a.tile:not([data-open])")) {
    const c = S.byId.get(decodeURIComponent((a.getAttribute("href") || "").slice(2, -1))), t = document.createElement("template");
    if (!c) continue;
    t.innerHTML = tileHtml(c, { link: true, eager: !!$("img.art", a)?.hasAttribute("fetchpriority"), css });
    if (!t.content.firstElementChild?.isEqualNode(a)) continue;
    const html = tileHtml(c, { css }), meta = $(".meta", a);
    t.innerHTML = html;
    for (const el of [...t.content.firstElementChild.children]) if (!el.matches(".art, .meta")) a.insertBefore(el, meta);
    a.dataset.open = c.id;
    gridTiles.set(c.id, { html, el: a, ed: false, css });
  }
}
function tableHtml(list, p, win) {
  const cols = [["name", "Card"], ["type", "Kind"], ["series", "Series"], ["stars", "★"], ["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"], ["total", "Total"], ["", "Types"], ["", "Author"],
    ...(S.created ? [["created", "Created"]] : []), ["new", "Updated"]];
  const sort = sortOf(p);
  const first = win.all ? list.length : Math.max(TABLE_FIRST, Math.ceil((win.y + 2 * win.h) / 30));    // rows are 30 px or taller: the scroll position stays
  const rest = list.slice(first);
  tableRest = rest.map(rowHtml);
  return `<div class="scroll-x"><table class="data"><thead><tr><th></th>${cols.map(([k, l]) => `<th class="${["stars", "hp", "def", "atk", "spd", "total"].includes(k) ? "num" : ""}"${k ? ` data-action="sort-by" data-key="${k}"` : ""}>${l}${k && k === sort ? " ▾" : ""}</th>`).join("")}</tr></thead><tbody>
    ${list.slice(0, first).map(rowHtml).join("")}</tbody>${tableRest.length ? `<tbody class="sizer" aria-hidden="true" style="visibility:collapse">${sizerRows(rest, tableRest)}</tbody>` : ""}</table></div>`;
}
// hidden rows from the rest that hold the columns at their final widths while the rest comes in: per column the rows with
// the widest lines and the widest word, measured in the table's fonts (rows with PSD chips always); removed with the last rows
let measure = null, sized = new WeakMap(), sizedRev = -1;   // sized: a card's [line, word] per column, until derive() runs
function sizerRows(rest, rows) {
  if (sizedRev !== S.rev) { sized = new WeakMap(); sizedRev = S.rev; }
  if (!measure) {
    const ctx = document.createElement("canvas").getContext("2d"), family = getComputedStyle(document.body).fontFamily, seen = new Map();
    let px = 0;
    measure = (t, size) => { const k = size + t; let w = seen.get(k); if (w === undefined) { if (px !== size) ctx.font = `${px = size}px ${family}`; seen.set(k, w = ctx.measureText(t).width); } return w; };
  }
  const text = (...lines) => { let line = 0, word = 0; for (const [t, size = 13.5] of lines) { if (!t) continue; line = Math.max(line, measure(t, size));
    for (const x of t.split(/\s+|(?<=-)(?=\p{L})/u)) if (x) word = Math.max(word, measure(x, size)); } return [line, word]; };
  const len = v => { const n = String(v ?? "").length; return [n, n]; };
  const cols = c => [[0, 0], text([c.name]), text([`${KIND_LABEL[c.type] || c.type}${c.subtype ? ` · ${cap(c.subtype)}` : ""}`]),
    text([c.series], [c.subseries, 12]), len(c.stars), len(c.hp), len(c.def), len(c.atk), len(c.spd), len(c.hp != null ? total(c) : ""),
    [(c.types || []).filter(iconFor).length, 0], text([c.author]), ...(S.created ? [text([createdText(c)])] : []), text([date(c.ts)])];
  const top = [], pick = new Set();
  rest.forEach((c, i) => {
    if (psdChips(c)) pick.add(i);
    let cs = sized.get(c);
    if (!cs) sized.set(c, cs = cols(c));
    cs.forEach(([line, word], j) => {
      const b = top[j] ||= [[], []];
      for (const [arr, v, n] of [[b[0], line, 3], [b[1], word, 2]]) {
        if (!v || (arr.length === n && v <= arr[n - 1][0])) continue;
        arr.push([v, i]); arr.sort((x, y) => y[0] - x[0]); arr.length = Math.min(arr.length, n);
      }
    });
  });
  for (const b of top) for (const [, i] of [...b[0], ...b[1]]) pick.add(i);
  return [...pick].sort((x, y) => x - y).map(i => rows[i].replace(/^<tr class="row" data-open="[^"]*">/, "<tr>")
    .replace(/<img class="thumb"[^>]*>/, "")).join("");
}
// the table's first rows go in with the page, the rest in later tasks (a newer render or another page stops them)
const TABLE_FIRST = 100, TABLE_CHUNK = 150;
let tableRest = [], tableJob = 0;
function fillTable(tbody) {
  const rest = tableRest, job = ++tableJob; tableRest = [];
  let k = 0;
  const step = () => {
    if (job !== tableJob || !tbody.isConnected) return;
    tbody.insertAdjacentHTML("beforeend", rest.slice(k, k += TABLE_CHUNK).join(""));
    if (k < rest.length) setTimeout(step); else tbody.parentElement.querySelector("tbody.sizer")?.remove();
  };
  if (rest.length) setTimeout(step);
}
const rowHtml = c => `<tr class="row" data-open="${c.id}"><td>${c.img ? `<img class="thumb" loading="lazy" decoding="async" src="${img(c, 240)}" alt="">` : ""}</td><td>${esc(c.name)}${psdChips(c)}</td>
      <td>${esc(KIND_LABEL[c.type] || c.type)}${c.subtype ? ` · ${esc(cap(c.subtype))}` : ""}</td><td>${esc(c.series || "")}${c.subseries ? `<div class="muted" style="font-size:12px">${esc(c.subseries)}</div>` : ""}</td><td class="num">${c.stars ?? ""}</td>
      ${["hp", "def", "atk", "spd"].map(k => `<td class="num">${c[k] ?? ""}</td>`).join("")}<td class="num">${c.hp != null ? total(c) : ""}</td>
      <td>${(c.types || []).map(t => iconImg(t)).join("")}</td><td>${esc(c.author || "")}</td>${S.created ? `<td${c.created ? ` title="${esc(createdTip(c))}"` : ""}>${createdText(c)}</td>` : ""}<td>${date(c.ts)}</td></tr>`;

// ---- card detail -----------------------------------------------------------------------------------
function statBars(c) {
  if (c.creatures?.length > 1) return c.creatures.map((x, i) => `<div class="creature-label">Creature ${i + 1}</div>${bars(x)}`).join("");
  return bars(c);
}
function bars(c) {
  const rows = [["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"]].filter(([k]) => c[k] != null);
  if (!rows.length) return "";
  return `<div class="statbars">${rows.map(([k, l]) => `<span class="lbl">${l}</span><div class="segs" style="--c:${STAT_COLORS[k]}" role="img" aria-label="${l} ${c[k]}">${Array.from({ length: 10 * Math.max(1, Math.ceil(c[k] / 10)) }, (_, i) => `<i class="${i < c[k] ? "on" : ""}"></i>`).join("")}</div><span class="num">${c[k]}</span>`).join("")}
    <span class="lbl">Total</span><span class="muted">${rows.length === 4 ? "HP + DEF + ATK + SPD" : ""}</span><span class="num"><b>${total(c)}</b></span></div>`;
}
function similar(c, n = 8) {
  if (c.hp == null) return [];
  const v = x => [x.hp ?? 0, x.def ?? 0, x.atk ?? 0, x.spd ?? 0];
  const a = v(c);
  return S.cards.filter(x => x.id !== c.id && x.hp != null && x.type === c.type)
    .map(x => [v(x).reduce((s, y, i) => s + (y - a[i]) ** 2, 0) + Math.abs((x.stars || 0) - (c.stars || 0)) * 2, x])
    .sort((p, q) => p[0] - q[0]).slice(0, n).map(([, x]) => x);
}
function dupsOf(c) {      // the other cards printed from the same PSD
  const original = c.dup ? S.byId.get(c.dup) : c;
  return original ? [original, ...(original.dups || []).map(x => S.byId.get(x))].filter(x => x && x.id !== c.id) : [];
}
function strip(title, cards, tip = "") {
  return cards.length ? `<h3><span class="muted">${cards.length}</span> ${noted(title, tip)}</h3><div class="strip">${cards.slice(0, 24).map(x => tileHtml(x, { small: true })).join("")}</div>` : "";
}
function openCard(id, showDetails = false) {
  const c = S.byId.get(id);
  const was = $(".psd-details", modal);                  // a re-render keeps it open
  showDetails ||= !modal.hidden && !!was?.open && was.dataset.id === id;
  const wasB = $(".badge-help", modal), keepBadges = !modal.hidden && !!wasB?.open && wasB.dataset.id === id;
  if (!c) { toast("That card doesn't exist (anymore)."); history.replaceState(null, "", S.listHash); return; }
  const pool = S.list.length && S.list.some(x => x.id === id) ? S.list : S.cards;
  const i = pool.findIndex(x => x.id === id), prev = pool[(i - 1 + pool.length) % pool.length], next = pool[(i + 1) % pool.length];
  const inDeck = deckHas(c.id);
  const mentions = [...(S.mentions.get(c.id) || [])].map(x => S.byId.get(x)).filter(Boolean);
  const mentionedBy = [...(S.mentionedBy.get(c.id) || [])].map(x => S.byId.get(x)).filter(Boolean);
  const inSub = x => x.subseries === c.subseries;                // any series
  const sameSub = c.subseries ? S.cards.filter(x => inSub(x) && x.id !== c.id) : [];
  const sameSeries = c.series ? S.cards.filter(x => x.series === c.series && x.id !== c.id && !(c.subseries && inSub(x))) : [];
  modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(c.name)}">
    <button type="button" class="ghost icon close" data-action="close" aria-label="Close (Esc)">✕</button>
    <div class="detail">
      <div class="image-wrap"><div class="iv"><div class="iv-stage"><div class="iv-orig">${c.png ? `<a href="${esc(fullUrl(c))}" target="_blank" rel="noopener" title="Full-size image"><img id="detail-img" src="${placeholderOf(c) || esc(fullUrl(c))}" alt="${esc(c.name)}"${c.tw ? ` width="${c.tw}" height="${c.th}"` : ""} style="aspect-ratio:${c.tw && c.th ? `${c.tw}/${c.th}` : "2/3"}"></a>` : `<div class="empty">No image</div>`}</div></div></div>
        <div class="actions card-actions">
          <button type="button" class="${inDeck ? "" : "primary"}" data-action="deck-toggle" data-id="${c.id}">${inDeck ? "Remove from deck" : "Add to deck"} <span class="kbd">d</span></button>
          <button type="button" data-action="compare-add" data-id="${c.id}">${S.compare.includes(c.id) ? "In comparison" : "Compare"} <span class="kbd">x</span></button>
          <button type="button" data-action="edit-card" data-id="${c.id}">${editing() ? "All fields" : "Edit"} <span class="kbd">e</span></button>
        </div>
        <div class="actions" style="justify-content:space-between">
          <a class="fact" data-nav="prev" href="#/card/${prev.id}" title="Previous (←)">← ${esc(prev.name)}</a>
          <a class="fact" data-nav="next" href="#/card/${next.id}" title="Next (→)">${esc(next.name)} →</a></div></div>
      <div>
        <h2>${esc(c.name)}</h2>
        <div class="facts">
          <a class="fact" href="#/cards?kind=${encodeURIComponent(kindOf(c))}">${esc(KIND_LABEL[c.type] || c.type)}</a>
          ${c.subtype ? `<a class="fact" href="#/cards?sub=${encodeURIComponent(c.subtype)}">${esc(cap(c.subtype))}</a>` : ""}
          ${c.stars ? `<a class="fact" href="#/cards?stars=${c.stars}"><span class="stars">${stars(c.stars)}</span> ${c.stars}-star</a>` : ""}
          ${c.series ? `<a class="fact" href="#/cards?series=${encodeURIComponent(c.series)}">${esc(c.series)}</a>` : ""}
          ${c.subseries ? `<a class="fact" href="#/cards?subseries=${encodeURIComponent(c.subseries)}" data-tip="Subseries">${esc(c.subseries)}</a>` : ""}
          ${c.author ? `<a class="fact" href="#/cards?author=${encodeURIComponent(c.author)}">by ${esc(c.author)}</a>` : ""}
          ${c.created ? `<span class="fact" data-tip="${esc(createdTip(c))}">created ${createdText(c)}</span>` : ""}
          ${c.ts ? `<span class="fact" data-tip="Last PSD commit (Pacific time)">updated ${date(c.ts)}</span>` : ""}
          ${!c.parsed ? `<span class="fact">Image only: not parsed yet</span>` : ""}
          ${c._unused ? `<span class="fact unused" data-tip="No card names this status effect">Unused: on no card</span>` : ""}
          ${c.dup ? `<a class="fact" href="#/card/${c.dup}" data-tip="The same card, counted once">Duplicate of ${esc(S.byId.get(c.dup)?.name || "")}</a>` : ""}
          ${c._staged ? `<span class="fact staged">Unpublished edit</span>` : c._sent ? `<span class="fact" data-tip="Published; the site is rebuilding">Publishing…</span>` : webEdited(c) ? `<span class="fact" data-tip="${esc(changes.editedTip(c))}">Edited</span>` : ""}
          ${psdBadges(c)}
          ${c.hidden ? `<span class="fact">Hidden</span>` : ""}
        </div>
        ${c.types && c.types.length ? `<div class="ctypes">${c.types.map(t => `<a href="#/cards?types=${encodeURIComponent(t)}">${iconImg(t, "")}</a>`).join("")}</div>` : ""}
        ${statBars(c)}
        ${c.ability ? `<div class="ability">${S.renderer.render(c.ability, c.name)}</div>` : c.parsed ? `<p class="muted">No ability text.</p>` : ""}
        ${c.note ? `<div class="note"><b>Note</b> ${S.renderer.render(c.note, c.name)}</div>` : ""}
        ${artHtml(c)}
        ${hasBadges(c.ability) || hasBadges(c.note) ? `<details class="badge-help" data-id="${esc(c.id)}"${keepBadges ? " open" : ""}><summary>Badges</summary>${legendHtml()}</details>` : ""}
        ${c.aliases?.length ? `<p class="muted">Also known as: ${c.aliases.map(esc).join(", ")}</p>` : ""}
        ${c.problems && c.problems.length ? `<p class="muted">Parser notes: ${c.problems.map(esc).join(" · ")}</p>` : ""}
        <div class="related">
          <div id="card-balance">${balanceHtml(c)}</div>
          <div id="card-ratings">${ratings.blockHtml(ratedOf(c), { editing: editing(), mine: editor.myRating(ratedOf(c).id) })}</div>
          ${strip("Duplicates", dupsOf(c))}${strip("Mentions", mentions, "Cards its ability text names")}${strip("Mentioned by", mentionedBy, "Cards whose ability text names this card")}${strip("Similar stats", similar(c), "The 8 cards of the same kind nearest in HP, DEF, ATK and SPD, star level weighed in")}${strip(`More from ${c.subseries || ""}`, sameSub)}${strip(`More from ${c.series || ""}`, sameSeries)}
          <div id="decks-slot">${usingDecks(c)}</div>
          <div id="card-changes">${balanceHtml(c, "changes")}</div>
          <div id="history-slot">${historyHtml(c, S.data.repo, S.history?._shas)}</div>
          <div id="versions-slot">${versionsHtml(c)}</div>
          ${c.details ? (st => details.detailsHtml(st, showDetails || !!st.details, c.id))(details.readState(store)) : ""}
        </div>
      </div>
    </div></div>`;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modal.scrollTop = 0;
  document.title = `${c.name} · Impossibility Simulator`;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();   // shortcuts work right away
  if (c.img && $("#detail-img")?.getAttribute("src") !== img(c, 720)) {        // sharper 720 px image once it's loaded
    const big = new Image(); big.onload = () => { const el = $("#detail-img"); if (el && el.alt === c.name) el.src = big.src; }; big.src = img(c, 720);
  }
  const fillBalance = () => { if (parseHash().arg !== c.id) return; for (const [sel, part] of [["#card-balance"], ["#card-changes", "changes"]]) { const slot = $(sel, modal); if (slot) slot.innerHTML = balanceHtml(c, part); } };
  if (c.hv && !c.history) loadHistory().then(() => { const slot = $("#history-slot"); if (slot && parseHash().arg === c.id) slot.innerHTML = historyHtml(c, S.data.repo, S.history?._shas); fillBalance(); }, () => {});
  else if (c.dup && hasBalance(c) && balanceOf(c).hv && !balanceOf(c).history) loadHistory().then(fillBalance, () => {});   // its original's texts
  if (hasBalance(c) && !S.analytics) loadAnalytics().then(fillBalance, () => { const slot = $("#card-balance", modal); if (slot && parseHash().arg === c.id) slot.innerHTML = `<h3>Balance</h3><p class="muted">Couldn't load the balance data.</p>`; });
  if (c.iv && !S.versions) loadVersions().then(() => { const slot = $("#versions-slot"); if (slot && parseHash().arg === c.id) slot.innerHTML = versionsHtml(c); }, () => {});
  const dd = $(".psd-details", modal);
  if (dd) details.mount(dd, { card: c, load: () => loadDetails(c), storage: store, extras: { badges: psdBadges(c), labels: FIELD_LABEL } });
  if (editing()) inline.mountCard(modal, c);
  if (editing()) previews.mountCard(modal, c);
}

/** The card dialog's first picture: the grid tile's when it has loaded (240 or 360 px, no new download), the 720 px one a
 *  share page preloads, else the 360 px one */
function placeholderOf(c) {
  if (!c.img) return "";
  const t = view.querySelector(`.grid .tile[data-open="${CSS.escape(c.id)}"] img.art`);
  if (t?.complete && t.naturalWidth && t.currentSrc) return t.currentSrc.startsWith(ROOT) ? t.currentSrc.slice(ROOT.length) : t.currentSrc;
  if (document.querySelector(`link[rel="preload"][as="image"][href="${img(c, 720)}"]`)) return img(c, 720);
  return thumbUrl(c);
}
// ---- image versions: every commit that changed the card's PNG (from git history), shown next to the current card
const versionList = c => {
  const rows = S.versions && S.versions.cards[c.id];
  if (!rows) return [];
  return rows.map(([ci, path]) => { const [sha, ts, author, subject] = S.versions.commits[ci]; return { sha, ts, author, subject, path: path || c.png }; });
};
const versionUrl = v => `https://raw.githubusercontent.com/${S.versions.repo}/${v.sha}/${urlPath(v.path)}`;
function versionsHtml(c) {
  if (!c.iv) return "";
  if (!S.versions) return `<h3>Image versions</h3><p class="muted">Loading ${c.iv} versions…</p>`;
  const vs = versionList(c);
  if (vs.length < 2) return "";
  return `<h3>Image versions <span class="muted">${vs.length}</span></h3>
    <div class="versions">
      <div class="ver-list" role="group" aria-label="Image versions, newest first">${vs.map((v, i) => `<button type="button" class="ver-item" data-action="version-pick" data-i="${i}" aria-pressed="false">
        <span class="when">${date(v.ts)}${i === 0 ? ` <span class="fact">current</span>` : ""}</span><span class="who">${esc(v.author || "")}</span><span class="msg">${esc(v.subject || "")}</span></button>`).join("")}</div>
      <div class="ver-compare" id="ver-compare" aria-live="polite"><p class="muted">Pick a version to compare (↑ ↓).</p></div>
    </div>`;
}
function showVersion(c, i) {
  const vs = versionList(c), v = vs[i], box = $("#ver-compare");
  if (!v || !box) return;
  $$(".ver-item", modal).forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
  // text at that time, when the bot's text history lines up with the commit (the latest text at or before it; the
  // current one from when it started, not from the last PSD commit)
  const then = textAt(c, v.ts);
  const link = w => commitAfter(S.versions.repo, w.sha, `Commit for the ${date(w.ts)} image version`);
  const caption = `${date(v.ts)}${v.author ? ` · ${esc(v.author)}` : ""}${link(v)}<br><span class="muted">${esc(v.subject || "")}</span>`;
  box.innerHTML = i === 0
    ? `<figure><img src="${img(c, 720)}" alt="${esc(c.name)}, current version"><figcaption>${caption}<br>Current version</figcaption></figure>`
    : `<div class="ver-pair"><figure><a href="${esc(versionUrl(v))}" target="_blank" rel="noopener"><img class="ver-old" src="${esc(versionUrl(v))}" alt="${esc(c.name)}, version from ${date(v.ts)}" loading="lazy"></a><figcaption>${caption}</figcaption></figure>
      <figure><img src="${img(c, 720)}" alt="${esc(c.name)}, current version"><figcaption>Current<br><span class="muted">${date(vs[0].ts)}${link(vs[0])}</span></figcaption></figure></div>
      ${then && then !== c.ability ? `<div class="ver-text"><div class="muted">Text then (changes highlighted)</div><div>${diffWords(then, c.ability)}</div></div>` : ""}`;
}
// ---- balance: the card's standing among its star level and its recorded changes (balance.js)
const balanceOf = c => (c.dup ? S.byId.get(c.dup) || c : c);         // a duplicate shows its original's
const ratedOf = c => (c.variantOf ? c : balanceOf(c));                // a variant picture keeps its own ratings
G.ratedBy(ratedOf);                                                   // the Missing filter's No ratings, as the page shows them
const hasBalance = c => !!balanceOf(c).balance;
function balanceHtml(c, part = "balance") {          // part: "balance" (the line) or "changes" (the recorded changes)
  if (!hasBalance(c)) return "";
  if (!S.analytics) return part === "balance" ? `<h3>Balance</h3><p class="muted">Loading…</p>` : "";
  const o = balanceOf(c);
  const texts = o.hv && !o.history ? null : (o.history || []).map(v => v.ability).concat(o.ability || "");
  return (part === "balance" ? St.balance.balanceBlock : St.balance.changesBlock)(c, S.analytics, { byId: S.byId, texts, repo: S.data.repo });
}
function closeModal() {
  if (modal.hidden) return;
  modal.hidden = true; modal.innerHTML = ""; document.body.style.overflow = "";
  document.title = "Impossibility Simulator · Card Browser";
}

// ---- rulebook --------------------------------------------------------------------------------------
// site/rulebook's chapters, drawn by rulebook.js. A chapter just published from the rulebook editor (rulebook-edit.js)
// shows its sent text until the build has it (RB_SENT, for an hour); its new pictures come from the commit meanwhile.
const RB_SENT = "rulebook-sent";
function bookChapters() {
  let sent = null;
  try { sent = JSON.parse(localStorage.getItem(RB_SENT) || "null"); } catch { /* none */ }
  const same = sent && sent.chapters.length === S.book.built.length && sent.chapters.every((c, i) => c.file === S.book.built[i].file && c.source === S.book.built[i].source);
  if (sent && (same || Date.now() - sent.at > 3600e3)) { localStorage.removeItem(RB_SENT); sent = null; }   // built, or stale
  S.book.sent = sent;
  S.book.chapters = (sent ? sent.chapters : S.book.built).map(c => ({ ...c, ast: RB.parse(c.source) }));
  for (const c of S.book.chapters) c.text = `${c.title}\n${RB.plainText(c.ast)}`.toLowerCase();
  return S.book.chapters;
}
let cardNames = null;                                    // ![[Card]] and [[Card]]: printed title or file name, any case
const cardByName = name => {
  if (!cardNames) { cardNames = new Map(); for (const c of S.all) for (const k of [c.name, c.key]) if (k && !cardNames.has(norm(k))) cardNames.set(norm(k), c); }
  return cardNames.get(norm(name)) || null;
};
/** a rulebook picture's file by name, with or without its extension ("kirby-sleepy" for a mascot) */
const bookFile = f => (S.book.images[f] || S.book.sent?.images?.includes(f) ? f
  : Object.keys(S.book.images).find(k => k.replace(/\.\w+$/, "") === f.replace(/\.\w+$/, "")) || S.book.sent?.images?.find(k => k.replace(/\.\w+$/, "") === f) || f);
function bookCtx(extra = {}) {
  const imgs = S.book.images, sent = S.book.sent;
  return {
    render: t => S.renderer.render(t, "", { links: false }), icon: t => S.renderer.icon(t), card: cardByName, cardImg: c => img(c, 360),
    imgUrl: f => { const k = bookFile(f); return imgs[k] ? `${RB.IMG_DIR}${encodeURIComponent(k)}?v=${imgs[k][2]}`
      : sent?.images?.includes(k) ? `https://raw.githubusercontent.com/${S.data.repo}/${sent.sha}/site/rulebook/img/${encodeURIComponent(k)}` : RB.IMG_DIR + encodeURIComponent(k); },
    size: f => imgs[bookFile(f)]?.slice(0, 2) || null, chapters: S.book.chapters, ...extra,
  };
}
const pdfUrl = () => `https://github.com/${S.data.repo}/blob/${S.data.branch || "main"}/TTS/Rulebook/Rulebook.pdf`;   // AutoCroissant rulebook_pages
const fileUrl = ch => `https://github.com/${S.data.repo}/commits/${S.data.branch || "main"}/site/rulebook/${encodeURIComponent(ch.file)}`;
let rulesAt = "", spy = null;                            // the rulebook hash last scrolled to: a re-render stays put
function renderRules(r) {
  if (!S.book) {
    view.innerHTML = `<div class="loading">Loading the rulebook…</div>`;
    whenLoaded(loadBook(), "the rulebook", () => { if (parseHash().name === "rules") renderRules(parseHash()); });
    return;
  }
  if (r.arg === "print") { renderSheets(r); return; }
  document.body.classList.remove("rb-shot");
  const q = (r.params.get("q") || "").trim().toLowerCase();
  if (document.activeElement !== qInput) qInput.value = "";
  const chapters = S.book.chapters, ctx = bookCtx({ editable: editing() }), shown = q ? chapters.filter(c => c.text.includes(q)) : chapters;
  // a Photoshop page's old link (#/rules/07-stats3, the changelog's #/rules?q=07 Stats3): its chapter by number
  const was = t => { const m = /^(\d{2})[-_ ]/.exec(t || ""); return m && chapters.find(c => c.num === m[1]); };
  const gone = r.arg && !chapters.some(c => c.id === r.arg.split("/")[0]) ? was(r.arg) : q && !shown.length ? was(q) : null;
  if (gone) { location.replace(`#/rules/${gone.id}`); return; }
  const tags = ["OYT", "1CD", "1/2CD", "AAT", "1GCD", "1/2GCD", "BOT", "ENDT", "BOGT", "ENDGT", "OFS", "OS", "OD", "WOF", "1PG", "2U", "Action",
    "1PT", "E2T", "FTE2T", "1PGT", "E2GT"];   // old system last
  const gloss = list => `<div class="glossary">${list.map(t => `<div>${badgeHtml(t)} ${esc(tagInfo(t).meaning)}</div>`).join("")}</div>`;
  const banned = S.data.banlist, can = editing();
  const label = c => `${Number(c.num) ? `${Number(c.num)}. ` : ""}${esc(c.title)}`;
  view.innerHTML = `<div class="rules">
    <nav class="toc" aria-label="Rulebook chapters"><input type="search" id="rules-q" placeholder="Search the rulebook…" value="${esc(r.params.get("q") || "")}" style="width:100%;margin-bottom:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface)">
      ${chapters.map(c => `<a href="#/rules/${c.id}" data-scroll="${c.id}" data-toc="${c.id}">${label(c)}</a><div class="subs" data-subs="${c.id}" hidden>${RB.sectionsOf(c).map(x => `<a class="sub" href="#/rules/${c.id}/${x.anchor.slice(c.id.length + 2)}" data-scroll="${x.anchor}">${esc(x.title)}</a>`).join("")}</div>`).join("")}
      <a href="#/rules" data-scroll="glossary" data-toc="glossary">Timing tags</a><a href="#/rules" data-scroll="banlist" data-toc="banlist">Constructed ban list</a>
      <div class="toc-tools"><a class="ghost" href="${esc(pdfUrl())}" target="_blank" rel="noopener" title="The rulebook as a PDF (the Tabletop Simulator save's)">PDF</a><a class="ghost" href="#/rules/print" title="The PDF's pages, as the next save update prints them">TTS pages</a><a class="ghost" href="game.txt" target="_blank" rel="noopener" title="Every card and rulebook chapter as one text file">game.txt</a>
        <button type="button" class="ghost" data-action="rb-new" title="${can ? "Write a new chapter" : "Sign in to write a chapter"}">New chapter</button></div></nav>
    <div class="rb rb-book">
      ${q ? `<p class="muted">${shown.length} chapter${shown.length === 1 ? "" : "s"} mention “${esc(r.params.get("q"))}”.</p>` : `<img class="rb-cover" src="${esc(ctx.imgUrl("cover"))}" alt="Impossibility Simulator" width="260" height="462">`}
      ${S.book.sent ? `<p class="muted">Your published rulebook edit shows here until the site rebuilds (a few minutes).</p>` : ""}
      ${shown.map(c => `<article class="rb-chapter" id="${c.id}"><div class="rb-tools"><button type="button" class="ghost" data-action="rb-edit" data-id="${c.id}" title="${can ? "Edit this chapter" : "Sign in to edit this chapter"}">Edit</button><a class="ghost" href="${esc(fileUrl(c))}" target="_blank" rel="noopener" title="This chapter's changes on GitHub">History</a></div>${RB.chapterHtml(c, ctx)}</article>`).join("")
        || `<div class="empty">No rulebook chapter mentions that.</div>`}
      ${!q ? `<article class="rb-chapter rb-extra" id="glossary"><header class="rb-head"><h2>Timing tags</h2></header>
        <div class="rb-panel rb-solo"><p>X can be any number; the first number of a pair such as (1/2CD) can also be 0 or −1. Hover or tap a badge for its meaning.</p>${legendHtml()}</div>
        ${[...Object.entries(GROUP_NAMES).map(([g, l]) => [l, tags.filter(t => tagInfo(t).group === g && !tagInfo(t).old)]), ["Old system (rulebook pictures)", tags.filter(t => tagInfo(t).old)]]
          .filter(([, list]) => list.length).map(([l, list]) => `<section class="rb-sec"><h3 class="rb-tab">${esc(l)}</h3><div class="rb-panel"><div class="rb-gloss">${list.map(t => `<span class="rb-gloss-tag">${badgeHtml(t)}</span><span>${esc(tagInfo(t).meaning.replace(/^Old system: /, ""))}</span>`).join("")}</div></div></section>`).join("")}</article>
      <article class="rb-chapter rb-extra" id="banlist"><header class="rb-head"><h2>Constructed ban list</h2></header>
        <div class="rb-panel rb-solo">${banned.notes.map(n => `<p>${esc(n)}</p>`).join("")}</div>
        ${banned.groups.map(g => `<section class="rb-sec"><h3 class="rb-tab">${esc(g.title)}</h3><div class="rb-panel"><div class="rb-bans">${g.entries.map(e => { const c = e.id && S.byId.get(e.id);
          return `<div class="rb-ban">${c ? `<a class="rb-card" href="#/card/${esc(c.id)}" data-card="${esc(c.id)}" title="${esc(c.name)}"><img src="${esc(img(c, 240))}" alt="${esc(c.name)}" loading="lazy" decoding="async"></a>` : ""}
            <b>${c ? `<a class="card-ref" href="#/card/${esc(c.id)}" data-card="${esc(c.id)}">${esc(e.name)}</a>` : esc(e.name)}</b>${e.reason ? `<i>${esc(e.reason)}</i>` : ""}</div>`; }).join("")}</div></div></section>`).join("")}</article>` : ""}
    </div></div>`;
  if (q) {                                               // only the blocks that hold it, highlighted
    for (const el of $$(".rb-chapter > :not(.rb-head):not(.rb-tools)", view)) if (!el.textContent.toLowerCase().includes(q)) el.classList.add("rb-hit-none");
    highlight($$(".rb-chapter", view), q);
  }
  watchToc();
  const [ch, sec] = (r.arg || "").split("/");
  if (ch && !q && rulesAt !== location.hash) document.getElementById(sec ? `${ch}--${sec}` : ch)?.scrollIntoView();   // #/rules/<chapter>[/<section>]
  rulesAt = location.hash;
  const input = $("#rules-q");
  input.addEventListener("input", debounce(() => { setParams({ q: input.value }); const i2 = $("#rules-q"); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); }, 200));
}
// the contents follow the reading: the chapter in view is marked and shows its sections
function watchToc() {
  spy?.disconnect();
  const seen = new Map();
  spy = new IntersectionObserver(es => {
    for (const e of es) seen.set(e.target.id, e.isIntersecting ? e.intersectionRect.height : 0);
    const best = [...seen].sort((a, b) => b[1] - a[1])[0];
    if (!best?.[1]) return;
    for (const a of $$(".toc [data-toc]", view)) a.classList.toggle("on", a.dataset.toc === best[0]);
    for (const d of $$(".toc [data-subs]", view)) d.hidden = d.dataset.subs !== best[0];
  }, { rootMargin: "-80px 0px -40% 0px", threshold: [0, .1, .3, .6, 1] });
  for (const el of $$(".rb-chapter", view)) spy.observe(el);
}
// #/rules/print: the TTS pages (rulebook.js paginate), all of them small; ?sheet=N alone at full size, nothing else on the
// page. #rb-sheet-list holds the pages and the chapters they were cut from: the TTS export (AutoCroissant
// commands/rulebook_pages.py) checks those against main's before it screenshots the pages
async function renderSheets(r) {
  const shot = r.params.get("sheet"), solo = shot !== null && shot !== "";
  document.body.classList.toggle("rb-shot", solo);
  view.innerHTML = `<p class="rb-print-bar muted">The rulebook's pages as the Tabletop Simulator save's PDF shows them (1080×1920; the next save update prints them). <a href="${esc(pdfUrl())}" target="_blank" rel="noopener">The PDF</a> · <a href="#/rules">Back to the rulebook</a></p><div class="rb-measure"></div>`;
  const host = $(".rb-measure", view), ctx = bookCtx({ eager: true }), chapters = S.book.chapters;
  const warm = document.createElement("div");             // every picture loaded first: the pages measure them
  warm.className = "rb"; warm.style.cssText = "position:absolute;left:-20000px;top:0;width:1080px";
  warm.innerHTML = chapters.map(c => RB.chapterHtml(c, ctx)).join("");
  document.body.append(warm);
  await Promise.all([...warm.querySelectorAll("img")].map(i => i.decode().catch(() => {})));
  // the pages' fonts before any measure (the book view may use an installed Consolas and never ask for them)
  await Promise.all(["35px Inconsolata", "bold 35px Inconsolata", "35px 'EB Garamond'"].map(f => document.fonts.load(f).catch(() => {})));
  await document.fonts.ready;
  warm.remove();
  if (parseHash().name !== "rules" || parseHash().arg !== "print") return;
  const cover = { cover: ctx.imgUrl("cover") };           // the PDF's first page
  let sheets = RB.paginate(host, chapters, ctx, cover);   // measured at full size, then shown small
  await Promise.all([...host.querySelectorAll("img")].map(i => i.decode().catch(() => {})));
  if ([...host.querySelectorAll(".rb-body")].some(b => b.scrollHeight > b.clientHeight + 1)) sheets = RB.paginate(host, chapters, ctx, cover);   // a picture late: cut again
  host.className = "rb-sheets";
  if (solo) sheets.forEach((x, i) => x.el.classList.toggle("rb-shown", i === +shot));
  const list = Object.assign(document.createElement("script"), { type: "application/json", id: "rb-sheet-list" });
  list.textContent = JSON.stringify({ sheets: sheets.map(x => ({ name: x.name, num: x.num, ch: x.ch, n: x.n })), chapters: chapters.map(c => [c.file, c.source]) });
  view.append(list);
  document.body.dataset.sheets = String(sheets.length);    // the export waits for this
}
function highlight(els, q) {
  for (const el of els) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue, idx = text.toLowerCase().indexOf(q);
      if (idx < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0, i = idx;
      while (i >= 0) {
        frag.append(text.slice(last, i));
        const m = document.createElement("mark"); m.textContent = text.slice(i, i + q.length); frag.append(m);
        last = i + q.length; i = text.toLowerCase().indexOf(q, last);
      }
      frag.append(text.slice(last)); node.replaceWith(frag);
    }
  }
}

// ---- deck builder ----------------------------------------------------------------------------------
const deck = () => D.activeDeck(S.decks);
const deckHas = id => { const d = deck(); return !!d && (d.cards.includes(id) || d.field === id); };
function updateDeckCount() { const d = deck(); const n = d ? d.cards.length + (d.field ? 1 : 0) : 0; $("#deck-count").textContent = n ? String(n) : ""; }
function toggleDeck(id) {
  const c = S.byId.get(id), d = deck();
  if (!c || !d) return;
  if (deckHas(id)) { D.removeCard(d, id); toast(`Removed ${c.name} from “${d.name}”`); }
  else { const err = D.addCard(d, c, S.byId); if (err) { toast(err); return; } toast(`Added ${c.name} to “${d.name}”${c._banned ? " (banned in constructed!)" : ""}`); }
  D.saveDecks(S.decks); updateDeckCount(); refresh(id);
}
function renderDeck(r) {
  if (r.arg) { const shared = D.decode(r.arg); S.shared = shared; } else S.shared = null;
  const d = S.shared || deck();
  const readOnly = !!S.shared;
  const v = D.validate(d, S.byId, S.banned);
  const slot = (c, label, tier) => c
    ? `<div class="slot filled${v.badCards.has(c.id) ? " bad" : ""}" data-open="${c.id}" title="${esc(c.name)}">${c.img ? `<img loading="lazy" decoding="async" ${imgAttrs(c, 130)} alt="${esc(c.name)}">` : ""}<span class="slot-name">${esc(c.name)}</span>${readOnly ? "" : `<button type="button" class="x" data-action="deck-remove" data-id="${c.id}" aria-label="Remove ${esc(c.name)}">✕</button>`}</div>`
    : `<button type="button" class="slot" data-action="pick" data-tier="${tier}" ${readOnly ? "disabled" : ""}>+ ${esc(label)}</button>`;
  const cards = d.cards.map(id => S.byId.get(id)).filter(Boolean);
  const groups = D.HAND.map(g => `<div class="tier-title"><span>${g.label}</span><span class="muted">${cards.filter(c => c.type === g.kind).length} / ${g.tiers.reduce((s, [, n]) => s + n, 0)}</span></div>
    ${g.tiers.map(([st, n]) => { const have = cards.filter(c => c.type === g.kind && c.stars === st);
      return `<div class="muted" style="margin:8px 0 4px">${st}★ <span class="stars">${stars(st)}</span> · ${have.length}/${n}</div><div class="slots">${Array.from({ length: Math.max(n, have.length) }, (_, i) => slot(have[i], `${st}★ ${g.kind}`, `${g.kind}:${st}`)).join("")}</div>`; }).join("")}`).join("");
  const stray = cards.filter(c => !D.groupOf(c) || !D.need(c.type, c.stars));
  const field = S.byId.get(d.field);
  const counts = { banned: cards.filter(c => S.banned.has(c.id)).length };
  view.innerHTML = `<div class="deck">
    <section>
      ${readOnly ? `<div class="panel"><b>Shared hand: ${esc(d.name)}</b> · ${noted(`${v.count}/${v.slots} cards`, D.CHECK_TIP)} <button type="button" class="primary" data-action="save-shared">Save a copy to my decks</button></div>` : ""}
      <div class="panel"><h3>${readOnly ? "" : `<input id="deck-name" value="${esc(d.name)}" aria-label="Deck name" style="font:inherit;font-weight:700;background:transparent;border:0;color:inherit;width:100%">`}</h3>
        <p class="muted">7 creatures and 10 items, one of each, none banned, plus an optional field card (≤${D.FIELD_MAX_STARS}★) for the shop.</p>
        ${groups}
        <div class="tier-title"><span>Field card (optional)</span><span class="muted">${field ? 1 : 0} / 1</span></div>
        <div class="slots">${slot(field, `field card (≤${D.FIELD_MAX_STARS}★)`, "field")}</div>
        ${stray.length ? `<div class="tier-title"><span>Not allowed in a hand</span></div><div class="slots">${stray.map(c => slot(c)).join("")}</div>` : ""}
      </div>
    </section>
    <aside>
      <div class="panel"><h3>${v.complete ? "✅ Legal hand" : `Checks · ${noted(`${v.count}/${v.slots} cards`, D.CHECK_TIP)}`}</h3><ul class="checks">${v.checks.map(c => `<li class="${c.ok ? "ok" : "err"}">${c.ok ? "✓" : "✗"} ${esc(c.text)}</li>`).join("")}</ul>
        ${cards.length ? `<p class="muted">${noted("Average total stats", "Mean HP + DEF + ATK + SPD of the hand's cards with stats; field card left out")}: ${(cards.filter(c => c.hp != null).reduce((s, c) => s + total(c), 0) / Math.max(1, cards.filter(c => c.hp != null).length)).toFixed(1)} · banned: ${counts.banned}</p>` : ""}</div>
      ${readOnly ? "" : `<div class="panel"><h3>Build</h3><div class="actions">
        <button type="button" data-action="deck-random" title="Fill the rest of the hand with random legal cards">Fill randomly</button>
        <button type="button" class="danger" data-action="deck-clear">Clear</button></div></div>`}
      <div class="panel"><h3>Share & export</h3><div class="actions">
        <button type="button" data-action="deck-share">Copy share link</button>
        <button type="button" data-action="deck-discord" title="Card names as links, ready to paste">Copy for Discord</button>
        <button type="button" data-action="deck-copy-text">Copy as text</button>
        <button type="button" data-action="deck-tts" title="Tabletop Simulator saved object">Download for TTS</button>
        <button type="button" data-action="deck-print">Print proxies</button></div>
        <p class="muted">TTS: save the .json to Documents/My Games/Tabletop Simulator/Saves/Saved Objects, then load it from Objects → Saved Objects.</p></div>
      ${readOnly ? "" : `<div class="panel"><h3>Import</h3><textarea id="deck-import" placeholder="One card name per line (“Field: name” for the field card)"></textarea>
        <div class="actions"><button type="button" data-action="deck-import">Import as new deck</button></div></div>
      <div class="panel"><h3>My decks</h3><div class="deck-list">${S.decks.map(x => { const n = x.cards.length + (x.field ? 1 : 0);
        return `<div class="deck-row"><button type="button" class="${x.id === d.id ? "on" : ""}" data-action="deck-select" data-id="${x.id}">${esc(x.name)} <span class="muted">${n}</span></button>
          <button type="button" class="ghost" data-action="deck-publish" data-id="${x.id}"${n ? "" : " disabled"} title="${editing() ? "Publish this hand as a deck, public or private" : "Sign in to publish this hand"}">${editing() ? "Publish…" : "Sign in to publish"}</button></div>`; }).join("")}</div>
        <div class="actions"><button type="button" data-action="deck-new">New</button><button type="button" data-action="deck-dup">Duplicate</button>
        <button type="button" class="danger" data-action="deck-delete" ${S.decks.length < 2 ? "disabled" : ""}>Delete</button></div></div>`}
      <p class="muted">Published decks${publishedCount()} · <a href="#/decks">Browse</a></p>
    </aside></div>`;
  const nameInput = $("#deck-name");
  if (nameInput) nameInput.addEventListener("change", () => { d.name = nameInput.value.trim() || "Untitled hand"; D.saveDecks(S.decks); renderDeck(parseHash()); });
}
function openPicker(tier) {                              // the shared picker (pick.js) on one tier, in a dialog
  const [kind, st] = tier.split(":");
  const fits = c => (kind === "field" ? c.type === "field" && (c.stars || 0) <= D.FIELD_MAX_STARS : c.type === kind && c.stars === Number(st));
  modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="Pick a card"><button type="button" class="ghost icon close" data-action="close" aria-label="Close">✕</button>
    <h3>${kind === "field" ? `Pick a field card (≤${D.FIELD_MAX_STARS}★)` : `Pick a ${st}★ ${kind}`}</h3>
    <p class="muted">Banned cards are marked: they make the hand illegal.</p><div id="picker-body"></div></div>`;
  modal.hidden = false; document.body.style.overflow = "hidden";
  pick.mount($("#picker-body"), { cards: () => S.cards, filter: c => fits(c) && c.parsed && !deckHas(c.id), kinds: KINDS, kindOf,
    tile: (c, o) => tileHtml(c, { small: true, constructed: true, ...o }),
    onChoose: id => { const err = D.addCard(deck(), S.byId.get(id), S.byId); if (err) toast(err); else { D.saveDecks(S.decks); updateDeckCount(); closeModal(); renderDeck(parseHash()); } } });
}

// ---- stats / changes / compare -------------------------------------------------------------------
let statsJob = 0;
function renderStatsView(r) {
  if (!St) {                                             // the first open: charts.js
    view.innerHTML = `<div class="loading">Loading…</div>`;
    whenLoaded(loadCharts(), "the Stats page", () => { const h = parseHash(); if (h.name === "stats") renderView(h, location.hash || hashOf(h)); });
    return;
  }
  const top = scrollY === 0 && !S.restoring, vh = innerHeight;           // before the view goes (see renderCards)
  St.stats.renderStats(view, { cards: S.cards, banned: S.banned, icons: S.icons, mentions: S.mentions, byId: S.byId, distPage: S.distPage }, r.params);
  const ctx = { cards: S.cards };
  const onStats = () => parseHash(S.renderedHash).name === "stats";   // a card dialog over Stats: fill it anyway
  const fill = (A = S.analytics) => {                    // Balance needs analytics.json; Ratings and History go in with it
    const now = parseHash(S.renderedHash);
    if (now.name !== "stats") return;
    const put = (id, html) => { const slot = $(`#${id}`, view); if (slot) slot.innerHTML = html; };
    if (A) put("stats-balance", St.balance.statsHtml(A, { cards: S.cards, byId: S.byId }, now.params));
    put("stats-ratings", St.insights.ratingsHtml(ctx, now.params));
    put("stats-history", St.insights.historyHtml(ctx, now.params));
  };
  const job = ++statsJob, slot = $("#stats-balance", view);
  if (S.analytics) {                                     // below the first screen, at the top of the page: after it has painted
    if (top && slot && slot.getBoundingClientRect().top > vh) requestAnimationFrame(() => setTimeout(() => { if (job === statsJob) fill(); }));
    else fill();
  } else {
    $("#stats-balance", view).innerHTML = `<p class="loading">Loading the balance section…</p>`;
    loadAnalytics().then(() => fill(), e => { const slot = $("#stats-balance", view); if (slot && onStats()) slot.innerHTML = `<p class="muted">Couldn't load the balance section (${esc(e.message)}).</p>`; fill(null); });
  }
}
function distPage(panel, step) {          // a stat distribution's pager: the next or previous page of values (stats.js)
  if (!panel?.dataset.pages) return;
  const pages = panel.dataset.pages.split(",").map(Number), to = pages[pages.indexOf(+panel.dataset.cur) + step];
  if (to == null) return;
  panel.dataset.cur = to; S.distPage[panel.dataset.stat] = to;
  for (const pg of $$(".dist-page", panel)) pg.hidden = +pg.dataset.page !== to;
  const [lo, hi] = to ? [10 * to + 1, 10 * to + 10] : [0, 10];
  $(".dist-range", panel).textContent = `${lo}–${hi}`;
  const had = document.activeElement, btns = $$(".dist-pager button", panel);
  btns.forEach(b => (b.disabled = pages[pages.indexOf(to) + +b.dataset.step] == null));
  if (had?.disabled && btns.includes(had)) (btns.find(b => !b.disabled) || panel).focus();   // a disabled button drops focus: keep it in the panel
}
// the Changes page's category tabs, a row across its top: [hash key, label]; #/changes is the first, #/changes/<key> the others
// (a link to one survives a refresh), and each shows its own sections only
const CHANGE_TABS = [["", "Recently updated"], ["changelog", "Changelog"], ["archive", "Archive"], ["edits", "Database edits"],
  ["parser", "Parser notes"]];
const NEEDS = { "": "history", changelog: "changelog", archive: "changelog", edits: "changelog" };   // the data a tab loads first
function renderChanges(r = parseHash(), held = null) {   // held: the tab a loading page focused, for the loaded redraw
  const tab = CHANGE_TABS.some(([k]) => k && k === r.arg) ? r.arg : "";
  const nav = `<nav class="change-tabs" aria-label="Kinds of changes">${CHANGE_TABS.map(([k, l]) => `<a href="#/changes${k ? `/${k}` : ""}"${k === tab ? ' class="on" aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>`;
  const page = body => {
    const el = document.activeElement;   // a tab had focus from the keyboard (or still has it from the loading page): the chosen one keeps it
    const kept = (held && el === held) || changes.keepsTabFocus(el);
    view.innerHTML = `<div style="max-width:980px;margin:auto">${nav}${body}</div>`;
    held = kept ? $(".change-tabs a.on", view) : null;
    held?.focus();
  };
  const here = () => { const now = parseHash(); return now.name === "changes" && (now.arg || "") === (r.arg || "") ? now : null; };
  const again = () => { const now = here(); if (now) renderChanges(now, held); };
  if (NEEDS[tab] === "changelog" && !S.changelog) {
    page(`<div class="loading">Loading the changelog…</div>`);
    loadChangelog().then(again, e => { if (here()) page(`<div class="empty">Couldn't load the changelog (${esc(e.message)}). <a href="javascript:location.reload()">Reload</a></div>`); });
    return;
  }
  if (NEEDS[tab] === "history" && (!historyP || !S.history)) {
    page(`<div class="loading">Loading recent changes…</div>`);
    whenLoaded(loadHistory(), "card history", again);
    return;
  }
  const updated = `<p class="muted">Site updated ${new Date(S.data.generated).toLocaleString(undefined, { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })} (Pacific), the last build that changed it, from <a href="https://github.com/${esc(S.data.botRepo)}" target="_blank" rel="noopener">${esc(S.data.botRepo)}</a> and <a href="https://github.com/${esc(S.data.repo)}" target="_blank" rel="noopener">${esc(S.data.repo)}</a>.</p>`;
  if (tab === "changelog") { page(changes.changelogHtml(S.changelog, r.params)); return; }
  if (tab === "archive") { page(changes.archiveHtml(S.changelog?.archived || [], S.changelog?.repo, r.params)); return; }
  if (tab === "edits") { page(changes.editsHtml(S.changelog, r.params)); return; }
  if (tab === "parser") { page(parserNotesHtml() + updated); return; }
  const item = (c, diff = true) => {          // diff: the text change since the last earlier text
    const last = diff && c.history && c.history.length ? c.history[c.history.length - 1] : null;
    return `<div class="item">${c.img ? `<img loading="lazy" decoding="async" src="${img(c, 240)}" alt="" data-open="${c.id}">` : "<div></div>"}<div>
      <a href="#/card/${c.id}"><b>${esc(c.name)}</b></a> <span class="muted">${esc(KIND_LABEL[c.type] || c.type)}${c.stars ? ` · ${c.stars}★` : ""}${c.ts ? ` · ${date(c.ts)}` : ""}${c.author ? ` · ${esc(c.author)}` : ""}</span>
      ${last && c.ability ? `<div class="ability" style="margin-top:4px;font-size:14px">${diffWords(last.ability, c.ability)}</div>` : ""}</div></div>`;
  };
  const recent = S.cards.filter(c => c.ts).sort((a, b) => b.ts - a.ts).slice(0, 60);
  page(`<section class="panel"><h3>Recently updated</h3><p class="muted">Text changes highlighted (none when the update kept the text).</p><div class="feed">${recent.map(c => item(c, textChanged(c))).join("")}</div></section>${updated}`);
}
/** The Parser notes tab: the cards the bot hasn't parsed yet, and the parser's notes */
function parserNotesHtml() {
  const unparsed = S.cards.filter(c => !c.parsed), problems = S.cards.filter(c => c.problems && c.problems.length);
  if (!unparsed.length && !problems.length) return `<section class="panel"><h3>Parser notes</h3><p class="empty">Every card is parsed, with no parser notes.</p></section>`;
  return `${unparsed.length ? `<section class="panel"><h3>Not in the card data yet <span class="muted">${unparsed.length}</span></h3><p class="muted">The next card sync adds them.</p>
      <div class="grid" style="--tile:120px">${unparsed.map(c => tileHtml(c, { small: true })).join("")}</div></section>` : ""}
    ${problems.length ? `<section class="panel"><h3>Parser notes <span class="muted">${problems.length}</span></h3><ul>${problems.map(c => `<li><a href="#/card/${c.id}">${esc(c.name)}</a> <span class="muted">${c.problems.map(esc).join(" · ")}</span>${detailsLink(c)}</li>`).join("")}</ul></section>` : ""}`;
}
function renderCompare(r) {
  const ids = (r.arg || S.compare.join(",")).split(",").filter(id => S.byId.has(id)).slice(0, 5);
  if (!ids.length) { view.innerHTML = `<div class="empty">Nothing to compare: press “Compare” (x) on a card.</div>`; return; }
  const cs = ids.map(id => S.byId.get(id)), first = cs[0];
  const delta = (c, k) => { if (c === first || c[k] == null || first[k] == null) return ""; const d = c[k] - first[k]; return d ? ` <span class="${d > 0 ? "diff-up" : "diff-down"}">${d > 0 ? "+" : ""}${d}</span>` : ""; };
  view.innerHTML = `<div class="toolbar"><span class="result-count">Comparing ${cs.length} cards</span><button type="button" data-action="share-compare">Copy link</button><button type="button" class="ghost" data-action="compare-clear">Clear</button></div>
    <div class="compare" style="--n:${cs.length}">${cs.map(c => `<div class="col panel">${c.img ? `<img decoding="async" ${imgAttrs(c, 300)} alt="" data-open="${c.id}">` : ""}
      <h3><a href="#/card/${c.id}">${esc(c.name)}</a></h3><p class="muted">${esc(KIND_LABEL[c.type] || c.type)} ${c.stars ? `· ${c.stars}★` : ""} ${c.series ? `· ${esc(c.series)}` : ""} ${c.subseries ? `· ${esc(c.subseries)}` : ""}</p>
      ${["hp", "def", "atk", "spd"].map(k => c[k] != null ? `<div>${k.toUpperCase()} <b>${c[k]}</b>${delta(c, k)}</div>` : "").join("")}
      ${c.hp != null ? `<div>Total <b>${total(c)}</b>${c === first || first.hp == null ? "" : (d => d ? ` <span class="${d > 0 ? "diff-up" : "diff-down"}">${d > 0 ? "+" : ""}${d}</span>` : "")(total(c) - total(first))}</div>` : ""}
      ${c.ability ? `<div class="ability" style="margin-top:8px">${S.renderer.render(c.ability, c.name)}</div>` : ""}
      <p><button type="button" class="ghost" data-action="compare-remove" data-id="${c.id}">Remove</button></p></div>`).join("")}</div>`;
}

// ---- published decks (data/decks.json; staged or just-published ones from the editor): #/decks and #/decks/<owner>/<slug>
const publishedCount = () => { const n = S.data.decks; return n && typeof n === "object" ? ` (${+n.public || 0})` : ""; };   // cards.json "decks": the public count without a fetch (the browser lists no private deck)
const deckCtx = () => ({ byId: S.byId, img, validate: d => D.validate(d, S.byId, S.banned) });
const deckPageUrl = (owner, slug) => `${ROOT}decks/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/`;
const passes = deckPasses();                              // remembered passphrases, sealed with a key that can't leave IndexedDB
const opened = new Map();                                 // "<owner>/<slug>:<ciphertext head>" -> the decrypted payload, for the session
/** Every deck the pages show: the published ones, less those removed in the batch, plus the staged and just-published files. */
function deckList() {
  const pending = editor.pendingDecks(), out = [];
  for (const d of S.decksData ? [...S.decksData.decks, ...S.decksData.private] : []) if (!pending.has(decks.keyOf(d.owner, d.slug))) out.push(d);
  for (const [key, { file, state }] of pending) { const e = file && decks.entryOf(file, key.split("/")[1], S.byId, state); if (e) out.push(e); }
  return out;
}
/** One deck by owner (any case) and slug: an entry, {removed, state} for one leaving with the batch, or null. */
function deckAt(owner, slug) {
  const p = editor.deckOf(owner, slug);
  if (p && !p.file) return { removed: true, state: p.state, owner, slug };
  if (p) return decks.entryOf(p.file, slug, S.byId, p.state);
  return deckList().find(d => d.slug === slug && d.owner.toLowerCase() === owner.toLowerCase()) || null;
}
const hasDecks = () => (+S.data.decks?.public || 0) > 0 || editor.pendingDecks().size > 0;   // else no fetch
const publicDecks = () => deckList().filter(d => !d.private);
/** Cards tab: the published decks a search finds, filled in once decks.json is loaded (the drawn view's search: a
 *  card dialog may be over it). */
function deckHits(q) {
  if (!q.trim() || !hasDecks()) return "";
  if (S.decksData) return decks.searchHitsHtml(publicDecks(), q, deckCtx());
  loadDecks().then(() => { const el = $("#deck-hits"), h = parseHash(S.renderedHash || ""); if (el && h.name === "cards" && (h.params.get("q") || "") === q) el.innerHTML = deckHits(q); });
  return "";
}
/** Card page: the public decks holding the card. */
function usingDecks(c) {
  if (!hasDecks()) return "";
  if (S.decksData) return decks.usingHtml(publicDecks(), c.id, deckCtx());
  loadDecks().then(() => { const slot = $("#decks-slot"); if (slot && !modal.hidden && parseHash().arg === c.id) slot.innerHTML = usingDecks(c); });
  return "";
}
function decksReady() {
  if (S.decksData) return true;
  view.innerHTML = `<div class="loading">Loading decks…</div>`;
  whenLoaded(loadDecks(), "decks", () => { const h = parseHash(); if (h.name === "decks") renderView(h, location.hash || hashOf(h)); });   // through renderView, so the title follows
  return false;
}
function renderDecks(r) {
  S.deckTitle = ""; S.deckView = null;
  if (r.arg) { renderDeckPage(r); return; }
  if (!decksReady()) return;
  const p = r.params, f = { q: p.get("q") || "", owner: p.get("owner") || "", card: p.get("card") || "", sort: p.get("sort") || "newest", complete: p.get("complete") === "1" };
  view.innerHTML = decks.browserHtml(deckList(), f, { ...deckCtx(), error: S.decksData.error });
  const input = $("#decks-q");
  input.addEventListener("input", debounce(() => { setParams({ q: input.value }); const i2 = $("#decks-q"); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } }, 200));
}
function renderDeckPage(r) {
  const [owner, ...rest] = r.arg.split("/"), slug = rest.join("/");
  if (!slug) { location.replace(`#/decks?owner=${encodeURIComponent(owner)}`); return; }       // #/decks/<owner>: that owner's decks
  if (!decksReady()) return;
  const d = deckAt(owner, slug);
  if (!d) { view.innerHTML = decks.missingHtml(); return; }
  if (d.removed) { view.innerHTML = decks.removedHtml(d); return; }
  const me = editor.me, here = () => { const h = parseHash(); return h.name === "decks" && h.arg === r.arg; };
  const ctx = { ...deckCtx(), canEdit: !!me && (me.admin || me.login.toLowerCase() === d.owner.toLowerCase()), hands: S.decks.map(x => ({ id: x.id, name: x.name, n: x.cards.length + (x.field ? 1 : 0) })) };
  const show = full => { S.deckTitle = full.name; S.deckView = full; view.innerHTML = decks.deckPageHtml(full, ctx); };
  if (!d.private) {
    if (!d.state) { S.renderedHash = S.listHash = decks.deckHash(d.owner, d.slug); syncUrl({ name: "decks", arg: `${d.owner}/${d.slug}` }); }   // the share page's URL, the file's spelling
    show(d); return;
  }
  S.deckTitle = "Private deck";
  const deckKey = decks.keyOf(d.owner, d.slug), cacheKey = `${deckKey}:${String(d.data).slice(0, 24)}`, stored = passes.has(deckKey);
  if (opened.has(cacheKey)) { const pl = opened.get(cacheKey); show({ ...d, ...pl, n: decks.countOf(pl), remembered: stored }); return; }
  const subtle = globalThis.crypto?.subtle, passCtx = { canEdit: ctx.canEdit, hands: ctx.hands };   // the Owner panel sits under the form too: no passphrase needed to unpublish or replace
  if (!subtle) { view.innerHTML = decks.passFormHtml(d, { ...passCtx, noCrypto: true }); return; }
  const form = () => {
    view.innerHTML = decks.passFormHtml(d, passCtx);
    $("#deck-pass").addEventListener("submit", e => { e.preventDefault(); const pass = $("#deck-pass-in").value; if (!pass) return;
      $("#deck-pass button").disabled = true; $("#deck-pass-err").textContent = "Opening…"; tryOpen(pass, $("#deck-pass-remember").checked, false); });
    $("#deck-pass-in").focus();
  };
  const tryOpen = async (pass, remember, auto) => {
    try { opened.set(cacheKey, await decks.decrypt(subtle, pass, d.owner, d.slug, d)); }
    catch (err) {
      if (auto) passes.forget(deckKey);
      if (!here()) return;
      if (auto) form();                                                                 // the auto-open showed no form yet
      else { $("#deck-pass button").disabled = false; $("#deck-pass-in").select(); }   // keep what was typed and the Remember tick
      $("#deck-pass-err").textContent = auto ? "The remembered passphrase no longer opens this deck" : err.message;
      return;
    }
    if (remember) await passes.save(deckKey, pass).catch(() => toast("This browser can't remember it safely: not remembered"));
    if (here()) rerender();
  };
  if (stored) {
    view.innerHTML = `<div class="loading">Opening the deck…</div>`;
    passes.load(deckKey).then(pass => (pass == null ? here() && form() : tryOpen(pass, false, true)));   // unreadable here: forgotten, the form
    return;
  }
  form();
}
// the deck page's Share, Discord, text, TTS and print act on the deck shown (S.deckView); the deck builder's on the hand
const ttsDownload = d => { D.download(`${d.name.replace(/[^\w\- ]+/g, "") || "hand"}.json`, JSON.stringify(D.ttsSave(d, S.byId, S.data.raw, S.data.pins), null, 2)); toast("Downloaded Tabletop Simulator saved object"); };
const printDeck = d => { if (!D.printSheet(d, S.byId, S.data.raw)) toast("Allow pop-ups to print proxies"); };

// ---- people: profiles (data/users.json; staged or just-published ones from the editor) + contributions (data/contributions.json)
function usersReady(name, again) {
  if (S.users && S.contrib && S.decksData) return true;   // S.contrib: with profile.js
  view.innerHTML = `<div class="loading">Loading people…</div>`;
  whenLoaded(Promise.all([loadUsers(), loadContrib(), loadDecks()]), "people", () => { if (parseHash().name === name) again(parseHash()); });
  return false;
}
function renderUser(r) {
  if (!r.arg) { location.replace("#/users"); return; }                                  // #/u alone is the list
  if (r.edit) {                                                                         // #/u/<login>/edit: the profile editor
    if (editor === IDLE) { view.innerHTML = `<div class="loading">Loading the editor…</div>`; whenLoaded(loadEditor(), "the editor", () => { const h = parseHash(); if (h.name === "u" && h.edit) renderView(h, location.hash || hashOf(h)); }); }
    else editor.profilePage(r.arg);
    return;
  }
  if (!usersReady("u", renderUser)) return;
  const me = editor.me, people = S.contrib.people || [];
  let pending = editor.profileOf(r.arg), published = S.userBy.get(r.arg.toLowerCase()) || null;
  let person = Pf.findPerson(r.arg, people);
  if (!pending && !published && person) {                                               // a credited name: the profile one of its logins made, if any
    const row = Pf.mergeUsers(S.users, editor.pendingProfiles()).find(u => Pf.personOf(u.profile, [person]));
    if (row) { pending = editor.profileOf(row.profile.login); published = S.userBy.get(row.profile.login.toLowerCase()) || null; }
  }
  const profile = pending ? pending.profile : published;
  if (!person && profile) person = Pf.personOf(profile, people);
  const login = pending?.profile?.login || published?.login || person?.key || r.arg;    // the file's spelling: u/<login>/ exists only for it
  if (login !== r.arg) { const to = { name: "u", arg: login, params: r.params }; S.renderedHash = S.listHash = hashOf(to); syncUrl(to); }
  const own = !!me && (me.login.toLowerCase() === login.toLowerCase() || !!person?.logins.some(l => l.toLowerCase() === me.login.toLowerCase()));
  const owners = new Set([login, person?.github, ...(person?.logins || [])].filter(Boolean).map(s => s.toLowerCase())), theirs = deckList().filter(d => owners.has(d.owner.toLowerCase()));
  view.innerHTML = Pf.personHtml({ login, profile, person, state: pending?.state || "", removed: !!pending && !pending.profile,
    own, canEdit: own || !!me?.admin, byId: S.byId, cards: S.cards, tile: c => tileHtml(c, { small: true }),
    available: !!S.contrib.available, since: S.contrib.since, repo: S.data.repo, titles: S.titles, date, month, kinds: KINDS, kindOf,
    people, site: S.contrib.site || {}, mentions: S.mentions, starKind: r.params.get("stars") || "", mentionedBy: S.mentionedBy, banned: S.banned,
    decks: { public: decks.sortDecks(theirs.filter(d => !d.private)), private: decks.sortDecks(theirs.filter(d => d.private)) }, deckTile: d => decks.deckTileHtml(d, deckCtx()) });
  if (r.params.get("stars") && !$(".p-stars", view)?.dataset.kind) personStars({ name: "u", arg: login, params: r.params }, "");   // an unknown kind: all, out of the address
}
/** The Star levels' kind in the address (u/<login>/?stars=<kind>), without a redraw; the address only while it shows the person. */
function personStars(r, kind) {
  const params = new URLSearchParams(r.params);
  if (kind) params.set("stars", kind); else params.delete("stars");
  const to = { ...r, params };
  S.renderedHash = S.listHash = hashOf(to);
  if (parseHash().name === "u") syncUrl(to);
}
function renderUsers() {
  if (!usersReady("users", renderUsers)) return;
  const me = editor.me, rows = Pf.peopleRows(S.contrib.people || [], Pf.mergeUsers(S.users, editor.pendingProfiles()));
  view.innerHTML = Pf.peopleHtml(rows, { me, hasOwn: !!me && rows.some(r => r.profile && r.profile.login.toLowerCase() === me.login.toLowerCase()),
    available: !!S.contrib.available, since: S.contrib.since, titles: S.titles, date, decks: deckList() });
  updatePeopleCount(rows.length);
}
// the People tab's counter: the build's count until the table has been made here (pending profiles included)
function updatePeopleCount(n = S.data.peopleCount) { $("#people-count").textContent = n ? String(n) : ""; }
/** Who u/<name>/ is: the profile (pending or published) and the person, as the person page resolves them. */
function personAt(name) {
  const pending = editor.profileOf(name), profile = pending ? pending.profile : S.userBy?.get(name.toLowerCase()) || null, people = S.contrib?.people || [];
  return { profile, state: pending?.state || "", person: Pf.findPerson(name, people) || (profile && Pf.personOf(profile, people)) };
}
function openUserShare(name) {
  const { profile, person, state } = personAt(name), fav = S.byId.get(profile?.favourite || "");
  showDialog(Pf.shareDialogHtml({ name, url: userUrl(name), text: S.contrib?.previews?.[name] || "", state, native: !!navigator.share,
    image: fav?.img ? img(fav, 360) : "og.jpg", color: fav?.color }));
  $("#share-url").addEventListener("focus", e => e.target.select());
}
const userShare = name => ({ name, url: userUrl(name), person: personAt(name).person, titles: S.titles || new Map(), cards: S.cards, kindOf });
const userDiscord = name => Pf.personDiscord(userShare(name));
const userText = name => Pf.personText(userShare(name));          // no motto or other profile text

// ---- sharing ---------------------------------------------------------------------------------------
const md = s => String(s).replace(/([\\*_~`|[\]])/g, "\\$1");
const mdLink = c => `[${md(c.name)}](<${shareUrl(c.id)}>)`;          // <…> stops Discord's preview
function deckDiscord(d) {
  const v = D.validate(d, S.byId, S.banned), cards = d.cards.map(id => S.byId.get(id)).filter(Boolean), field = S.byId.get(d.field);
  const build = link => [`**${md(d.name)}** · ${v.count}/${v.slots} cards · ${v.complete ? "✅ legal" : "not legal yet"}`,
    ...D.HAND.map(g => { const cs = cards.filter(c => c.type === g.kind).sort((a, b) => a.stars - b.stars); return cs.length ? `**${g.label}:** ${cs.map(link).join(", ")}` : ""; }),
    field ? `**Field:** ${link(field)}` : "", `[Open the hand](${deckUrl(d)})`].filter(Boolean).join("\n");
  const text = build(mdLink);
  return text.length <= 2000 ? text : build(c => md(c.name));        // Discord's limit
}

// ---- interactions ----------------------------------------------------------------------------------
function refresh(id) {
  const inDeck = deckHas(id), t = gridTiles.get(id), c = S.byId.get(id);
  for (const b of $$(".add[data-id]")) if (b.dataset.id === id) { b.classList.toggle("in", inDeck); b.textContent = inDeck ? "✓ In deck" : "+ Deck"; }
  if (t?.el.isConnected && c) t.html = tileHtml(c, { css: t.css }); else gridTiles.delete(id);   // its tile, changed in place, stays
  if (!modal.hidden && parseHash().name === "card") openCard(parseHash().arg);
  else if (parseHash().name === "deck") renderDeck(parseHash());
}
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.hidden = true), 2600); }
/** a toast with an Undo button, up a little longer */
function toastUndo(msg, undo) {
  toast(msg); clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.hidden = true), 6000);
  const b = Object.assign(document.createElement("button"), { type: "button", className: "toast-undo", textContent: "Undo" });
  b.addEventListener("click", () => { toastEl.hidden = true; undo(); }, { once: true }); toastEl.append(" ", b);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); } catch { prompt("Copy:", text); } }
function showDialog(html) { modal.innerHTML = `<div class="dialog small" role="dialog" aria-modal="true"><button type="button" class="ghost icon close" data-action="close" aria-label="Close">✕</button>${html}</div>`; modal.hidden = false; }

// the rulebook editor (rulebook-edit.js): a chapter's text beside its page, published as one commit
let rbEditP = null;
function openBookEditor(id, line = null) {
  if (!editing()) { act("edit-hub"); return; }
  withEditor(ed => (rbEditP ||= (early("rulebook-edit.js"), import("./rulebook-edit.js")).catch(e => { rbEditP = null; throw e; })).then(m => m.open({
    id, line, RB, book: S.book, ctx: bookCtx, editor: ed, repo: S.data.repo, branch: S.data.branch || "main", modal, toast, closeModal,
    cards: () => S.all.filter(c => !c.hidden).map(c => c.name),
    published: sent => { localStorage.setItem(RB_SENT, JSON.stringify(sent)); bookChapters(); rerender(); },
  })).catch(e => toast(`Couldn't open the rulebook editor (${e.message})`)));
}
const actions = {
  "rb-edit": el => openBookEditor(el.dataset.id, el.dataset.line != null ? +el.dataset.line : null),
  "rb-new": () => openBookEditor(""),
  "close": () => { if ($("#edit-form", modal)) { actions["edit-cancel"](); return; } if (parseHash().name === "card") location.hash = S.listHash; else closeModal(); },
  "toggle-param": (el, exclude = false) => { const p = parseHash().params, k = el.dataset.key, cur = vals(p, k), v = el.dataset.value;
    if (!XABLE.has(k) || !el.closest(".browse .filters")) { setParams({ [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }); return; }
    const [inc, exc] = G.flip(cur, vals(p, `x${k}`), v, exclude); setParams({ [k]: inc, [`x${k}`]: exc }); },
  "select-param": el => { const k = el.dataset.key, o = el.selectedOptions?.[0]?.dataset || {};      // a sort: its direction (default unless the option says)
    const p = parseHash().params;
    if (NOT_KEYS.includes(k) && el.closest(".browse .filters") && !p.get(k) && (p.get(`x${k}`) || S.notPick.has(k))) {   // ≠ on: the pick is excluded
      S.notPick.add(k); setParams({ [`x${k}`]: el.value }); return; }
    setParams({ [k]: el.value, ...(k === "sort" ? { dir: o.dir ?? "" } : {}) }); },
  "not-param": el => { const k = el.dataset.key, p = parseHash().params, inc = p.get(k) || "", exc = p.get(`x${k}`) || "";   // ≠: the select's value in or out
    if (!inc && !exc) { S.notPick[S.notPick.has(k) ? "delete" : "add"](k); rerender(); return; }
    if (inc) S.notPick.add(k); else S.notPick.delete(k);
    setParams({ [k]: exc, [`x${k}`]: inc }); },
  "font-forget": el => { const v = el.dataset.value, p = parseHash().params; S.fontKept = S.fontKept.filter(f => f !== v);
    if (vals(p, "font").includes(v) || vals(p, "xfont").includes(v)) setParams({ font: vals(p, "font").filter(f => f !== v), xfont: vals(p, "xfont").filter(f => f !== v) }); else rerender(); },
  "remove-param": el => { const p = parseHash().params; if (el.dataset.key === "font" || el.dataset.key === "xfont") S.fontKept = S.fontKept.filter(f => f !== el.dataset.value);   // the bar's ✕: gone, as before
    if (el.dataset.value !== undefined) setParams({ [el.dataset.key]: vals(p, el.dataset.key).filter(x => x !== el.dataset.value) }); else setParams({ [el.dataset.key]: "" }); if (el.dataset.key === "q") qInput.value = ""; },
  "clear-filters": () => { qInput.value = ""; S.notPick.clear(); S.fontKept = []; const fb = $(".browse .font-box", view); if (fb) fb.value = ""; history.replaceState(history.state, "", "#/cards"); renderView(parseHash(), "#/cards"); },
  "range": el => { const p = parseHash().params, k = el.dataset.key, cur = rangeOf(p, k) || [0, S.statMax[k]]; cur[+el.dataset.which] = Number(el.value);
    setParams({ [k]: cur[0] === 0 && cur[1] >= S.statMax[k] ? "" : `${Math.min(...cur)}-${Math.max(...cur)}` }); },
  "flip-dir": () => { const p = parseHash().params; setParams({ dir: isDesc(sortOf(p), p.get("dir")) ? "asc" : "desc" }); },
  "sort-by": el => { const p = parseHash().params; setParams({ sort: el.dataset.key, dir: p.get("sort") === el.dataset.key && p.get("dir") !== "asc" ? "asc" : "" }); },
  "set-pref": el => {
    if (el.dataset.key === "view" && el.dataset.value === "table") { S.selected.clear(); S.selecting = false; }   // the table shows no selection
    localStorage.setItem(el.dataset.key, el.dataset.value); setParams({ [el.dataset.key]: el.dataset.value });
  },
  "random-from-list": () => { const l = S.list.length ? S.list : S.cards; location.hash = `#/card/${l[Math.floor(Math.random() * l.length)].id}`; },
  "deck-toggle": el => toggleDeck(el.dataset.id),
  "deck-remove": el => { D.removeCard(deck(), el.dataset.id); D.saveDecks(S.decks); updateDeckCount(); renderDeck(parseHash()); },
  "pick": el => openPicker(el.dataset.tier),
  "deck-random": () => { D.randomFill(deck(), S.cards, S.banned); D.saveDecks(S.decks); updateDeckCount(); renderDeck(parseHash()); },
  "deck-clear": () => { if (!confirm("Remove every card from this deck?")) return; const d = deck(); d.cards = []; d.field = null; D.saveDecks(S.decks); updateDeckCount(); renderDeck(parseHash()); },
  "deck-share": () => copy(deckUrl(S.shared || deck()), "share link"),
  "deck-discord": () => copy(deckDiscord(S.shared || deck()), "hand for Discord"),
  "deck-copy-text": () => copy(D.toText(S.shared || deck(), S.byId), "deck list"),
  "deck-tts": () => ttsDownload(S.shared || deck()),
  "deck-print": () => printDeck(S.shared || deck()),
  // published decks: the deck page's buttons act on the deck shown; Publish… (or Sign in to publish) on the deck builder's saved hands
  "deck-publish": el => withEditor(ed => ed.publishDeck(el.dataset.id)),
  "deck-save-copy": () => { const d = S.deckView; if (!d) return; D.newDeck(S.decks, d.name, d.cards.filter(id => S.byId.has(id)), S.byId.has(d.field) ? d.field : null); updateDeckCount(); toast(`Saved “${d.name}” to your decks`); },
  "deck-page-share": () => { if (S.deckView) copy(deckUrl(S.deckView), "share link"); },
  "deck-page-discord": () => { if (S.deckView) copy(deckDiscord(S.deckView), "hand for Discord"); },
  "deck-page-text": () => { if (S.deckView) copy(D.toText(S.deckView, S.byId), "deck list"); },
  "deck-page-tts": () => { if (S.deckView) ttsDownload(S.deckView); },
  "deck-page-print": () => { if (S.deckView) printDeck(S.deckView); },
  "deck-forget": () => { const d = S.deckView; if (!d) return; passes.forget(decks.keyOf(d.owner, d.slug)); toast("Passphrase forgotten"); rerender(); },
  "deck-import": () => { const { deck: d, unknown } = D.fromText($("#deck-import").value, S.cards); D.newDeck(S.decks, d.name, d.cards, d.field); updateDeckCount(); renderDeck(parseHash()); toast(unknown.length ? `Imported; not found: ${unknown.join(", ")}` : "Imported"); },
  "deck-select": el => { D.setActive(S.decks.find(x => x.id === el.dataset.id)); updateDeckCount(); location.hash = "#/deck"; renderDeck(parseHash()); },
  "deck-new": () => { D.newDeck(S.decks, `Hand ${S.decks.length + 1}`); updateDeckCount(); renderDeck(parseHash()); },
  "deck-dup": () => { const d = deck(); D.newDeck(S.decks, `${d.name} (copy)`, d.cards.slice(), d.field); updateDeckCount(); renderDeck(parseHash()); },
  "deck-delete": () => { const d = deck(); if (S.decks.length < 2 || !confirm(`Delete “${d.name}”?`)) return; S.decks = S.decks.filter(x => x !== d); D.saveDecks(S.decks); D.setActive(S.decks[0]); updateDeckCount(); renderDeck(parseHash()); },
  "save-shared": () => { const s = S.shared; D.newDeck(S.decks, s.name, s.cards.filter(id => S.byId.has(id)), s.field); updateDeckCount(); location.hash = "#/deck"; toast("Saved to your decks"); },
  "copy-user-link": el => copy(userUrl(el.dataset.login), "link: paste it in Discord"),
  "share-user": el => openUserShare(el.dataset.login),
  "person-stars": el => { const box = el.closest(".p-stars"); if (!box || !Pf) return; Pf.showStars(box, el.dataset.kind, S.cards, kindOf); personStars(parseHash(), el.dataset.kind); },
  "share-user-discord": el => copy(userDiscord(el.dataset.login), "person for Discord"),
  "share-user-text": el => copy(userText(el.dataset.login), "person as text"),
  "share-user-native": el => { const name = el.dataset.login; navigator.share({ title: name, text: Pf.personText({ ...userShare(name), name: "" }), url: userUrl(name) }).catch(() => {}); },
  "compare-add": el => { const id = el.dataset.id; if (!S.compare.includes(id)) S.compare = [...S.compare, id].slice(-5); toast(`Comparing ${S.compare.length} card${S.compare.length > 1 ? "s" : ""} (Compare is in the toolbar)`); openCard(id); },
  "compare-remove": el => { S.compare = S.compare.filter(x => x !== el.dataset.id); location.hash = `#/compare/${S.compare.join(",")}`; },
  "compare-clear": () => { S.compare = []; location.hash = "#/cards"; },
  "share-compare": () => copy(new URL(`#/compare/${parseHash().arg || S.compare.join(",")}`, document.baseURI).href, "comparison link"),
  "toggle-table": el => { const box = $(`#chart-${el.dataset.target}`); const on = el.getAttribute("aria-pressed") !== "true"; el.setAttribute("aria-pressed", on);
    el.textContent = on ? "Chart" : "Table"; $(".view-chart", box).hidden = on; $(".view-table", box).hidden = !on; },
  "stats-filter": el => setParams({ [el.dataset.key]: el.value }),
  "dist-page": el => distPage(el.closest(".dist-panel"), +el.dataset.step),
  "version-pick": el => { const id = parseHash().arg, c = S.byId.get(id); if (c) { showVersion(c, +el.dataset.i); if (c.hv && !c.history) loadHistory().then(() => showVersion(c, +el.dataset.i), () => {}); } },
  "toggle-filters": () => { S.filtersOpen = !S.filtersOpen; $(".filters")?.classList.toggle("open", S.filtersOpen); },
  "select-mode": () => { S.selecting = !S.selecting; if (!S.selecting) S.selected.clear(); rerender(); },
  // My filters: a link's search saved; ✕ forgets one (and drops it from the address), Undo puts both back
  "cf-save": el => { const v = el.dataset.value, had = CF.add(v); toast(had ? `Already in My filters as “${had}”` : `Saved “${v}” to My filters`); rerender(); },
  "cf-delete": el => { const v = el.dataset.value, p = parseHash().params, was = { cf: vals(p, "cf").includes(v), xcf: vals(p, "xcf").includes(v) }, at = CF.remove(v);
    if (was.cf || was.xcf) setParams({ cf: vals(p, "cf").filter(x => x !== v), xcf: vals(p, "xcf").filter(x => x !== v) }); else rerender();
    toastUndo(`Removed “${v}” from My filters`, () => { CF.add(v, at); const r = parseHash();
      if (r.name === "cards" && (was.cf || was.xcf)) { const q = r.params, k = was.cf ? "cf" : "xcf"; setParams({ [k]: [...vals(q, k).filter(x => x !== v), v] }); }
      else if (r.name === "cards" || r.name === "card") rerender(); }); },
};                                                       // + edit mode's (createEditor)
/** An action by name; one only edit mode has (edit.js, tray.js) loads it first. */
function act(name, el) {
  if (actions[name]) actions[name](el);
  else if (editor === IDLE) withEditor(() => actions[name]?.(el));
}
document.addEventListener("click", e => {
  if (e.target.closest("a.details-link")) return;     // the browser follows it
  const a = e.target.closest("[data-action]");
  if (a && a.tagName !== "SELECT" && !(a.tagName === "INPUT" && a.type === "checkbox")) { e.preventDefault(); e.stopPropagation(); act(a.dataset.action, a); return; }
  const open = e.target.closest("[data-open], .chart [data-card]");
  if (open && editing() && (e.shiftKey || e.ctrlKey || e.metaKey || S.selecting) && open.closest(".browse .grid")) { e.preventDefault(); toggleSelect(open.dataset.open, e.shiftKey); return; }
  if (open?.matches("a[href]") && (e.metaKey || e.ctrlKey || e.shiftKey || e.button)) return;   // a tile's link: the browser opens its page
  if (open) { e.preventDefault(); location.hash = `#/card/${open.dataset.open || open.dataset.card}`; return; }
  const go = e.target.closest(".chart a.go");             // a Stats chart's cards: the grid from its top
  if (go && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) { e.preventDefault(); S.toTop = true; location.hash = go.getAttribute("href"); return; }
  const ref = e.target.closest("a.card-ref");
  if (ref) { e.preventDefault(); location.hash = `#/card/${ref.dataset.card}`; return; }
  const scroll = e.target.closest("[data-scroll]");
  if (scroll) {                                          // a rulebook page's link: its #/rules/<id> in the address bar too
    e.preventDefault(); document.getElementById(scroll.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    const to = scroll.getAttribute("href");
    if (to?.startsWith("#/rules/") && to !== location.hash) { rulesAt = to; history.pushState(null, "", to); syncUrl(parseHash()); S.renderedHash = S.listHash = to; }
    return;
  }
  if (e.target === modal) actions.close();
});
document.addEventListener("change", e => {
  const a = e.target.closest("[data-action]");
  if (a && (a.tagName === "SELECT" || a.type === "checkbox")) act(a.dataset.action, a);
});

// search box
const runSearch = debounce(() => {
  const name = parseHash().name;
  if (name === "rules") { setParams({ q: qInput.value }); return; }
  if (name !== "cards") { location.hash = `#/cards?q=${encodeURIComponent(qInput.value)}`; return; }
  setParams({ q: qInput.value });
}, 160);
qInput.addEventListener("input", runSearch);
$("#save-filter")?.addEventListener("click", () => {   // the search box's text as a filter in My filters (CSS shows it while there's text)
  const q = qInput.value.trim(); if (!q) return;
  const had = CF.add(q); qInput.value = "";
  toast(had ? `Already in My filters as “${had}”` : `Saved “${q}” to My filters`);
  const r = parseHash(); if (r.name === "cards" || r.name === "rules") setParams({ q: "" });
});
$("#search-form").addEventListener("submit", e => { e.preventDefault(); const ex = exactOf(qInput.value, S.cards), l = ex.length === 1 ? ex : S.list; if (l.length === 1) location.hash = `#/card/${l[0].id}`; });   // one exact name, else one result
$("#search-help").addEventListener("click", () => showDialog(`<h3>Search syntax</h3><p class="muted">The bot's /query_ability syntax, plus names and aliases.</p>
  <table class="help-table">${SEARCH_HELP.map(([q, d]) => `<tr><td><code>${esc(q)}</code></td><td>${esc(d)}</td></tr>`).join("")}</table>`));
$("#random").addEventListener("click", () => actions["random-from-list"]());
$("#theme").addEventListener("click", () => { const t = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = t; localStorage.setItem("theme", t); if (parseHash().name === "stats") renderView(parseHash(), location.hash); });
const showKeys = () => showDialog(`<h3>Keyboard shortcuts</h3><table class="help-table">${[["/", "Search"], ["Esc", "Close / clear"], ["← →", "Previous / next card (Changes tabs: next tab; a stat distribution: more values)"], ["d", "Add to / remove from deck"],
  ["c", "Copy card link"], ["x", "Add to comparison"], ["e", editing() ? "Edit the card (all fields)" : "Edit the card"], ["↑ ↓", "Move through image versions"], ["r", "Random card"], ["1–6", "Cards · Rulebook · Deck · Stats · Changes · People"],
  ...(editing() ? [["1–9", "With cards selected: drop them on that pinned box (the first nine)"]] : []), ["?", "This help"]].map(([k, d]) => `<tr><td><span class="kbd">${k}</span></td><td>${d}</td></tr>`).join("")}</table>`);
$("#keys").addEventListener("click", showKeys);
$("#account").addEventListener("click", () => act("edit-hub"));

document.addEventListener("keydown", e => {
  const item = document.activeElement?.closest?.(".ver-item");
  if (item && (e.key === "ArrowDown" || e.key === "ArrowUp")) {   // move through the version list
    e.preventDefault();
    const next = e.key === "ArrowDown" ? item.nextElementSibling : item.previousElementSibling;
    if (next) { next.focus(); next.click(); }
    return;
  }
  const ctab = document.activeElement?.closest?.(".change-tabs a");
  if (ctab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {   // the Changes tabs: arrows choose the next
    e.preventDefault();
    const all = $$(".change-tabs a"), i = all.indexOf(ctab);
    const to = all[e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
    if (to && to !== ctab) location.hash = to.getAttribute("href");
    return;
  }
  const dist = document.activeElement?.closest?.(".dist-panel[tabindex]");
  if (dist && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); distPage(dist, e.key === "ArrowRight" ? 1 : -1); return; }
  const ae = document.activeElement, typing = /INPUT|TEXTAREA|SELECT/.test(ae?.tagName) || !!ae?.isContentEditable || !!ae?.closest?.(".segs[data-inline], .star-pick, .type-palette");   // the inline controls are inputs; stat rows and stars take the arrows
  if (e.key === "Escape") { if (!modal.hidden) actions.close(); else if (typing) ae.blur(); else if (S.selected.size || S.selecting) { S.selected.clear(); if (S.selecting) { S.selecting = false; rerender(); } else inline?.reflect(view, S.selected); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Enter" && ae?.dataset?.open && (modal.hidden || modal.contains(ae)) && !$("#edit-form", modal)) { location.hash = `#/card/${ae.dataset.open}`; return; }   // as a click: the profile editor's tiles too
  if ($("#edit-form")) return;                                                         // no single-key shortcuts while a form (card dialog, profile editor) is up
  if (modal.hidden && editing() && S.selected.size && parseHash().name === "cards" && $(".tray", view) && tray.dropKey(e.key)) { e.preventDefault(); return; }   // 1-9: onto a pinned box on screen
  const inCard = !modal.hidden && parseHash().name === "card", id = parseHash().arg;
  if (e.key === "/") { e.preventDefault(); qInput.focus(); qInput.select(); }
  else if (e.key === "?") showKeys();
  else if (e.key === "r") actions["random-from-list"]();
  else if (/^[1-6]$/.test(e.key) && modal.hidden) location.hash = ["#/cards", "#/rules", "#/deck", "#/stats", "#/changes", "#/users"][+e.key - 1];
  else if (inCard && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { const link = $(`[data-nav="${e.key === "ArrowLeft" ? "prev" : "next"}"]`, modal); if (link) location.hash = link.getAttribute("href"); }
  else if (inCard && e.key === "d") toggleDeck(id);
  else if (inCard && e.key === "c") copy(shareUrl(id), "link: paste it in Discord");
  else if (inCard && e.key === "x") actions["compare-add"]({ dataset: { id } });
  else if (inCard && e.key === "e") { e.preventDefault(); withEditor(ed => ed.open(id)); }
});

// tooltips: [data-tip] text, [data-v]+[data-l] chart values, card links show a preview; when they go: tip.js
function fillTip(t) {
  if (t.dataset.v !== undefined) {
    const v = document.createElement("div"); v.className = "v"; v.textContent = t.dataset.v;
    const l = document.createElement("div"); l.textContent = t.dataset.l || ""; tip.replaceChildren(v, l);
    if (t.closest(".chart a.go")) { const h = document.createElement("div"); h.className = "muted"; h.textContent = "Show these cards"; tip.append(h); }   // a Stats link
  } else if (t.matches("a.card-ref, .chart [data-card]")) {
    const c = S.byId.get(t.dataset.card);
    if (!c) return false;
    tip.replaceChildren();
    if (c.img) { const im = document.createElement("img"); im.style.aspectRatio = `auto ${c.tw && c.th ? `${c.tw}/${c.th}` : "2/3"}`; im.src = thumbUrl(c); im.alt = ""; tip.append(im); }   // sized before it loads: place() flips it right
    const n = document.createElement("div"); n.className = "v"; n.textContent = c.name; tip.append(n);
  } else tip.textContent = t.dataset.tip;
}
const tips = tipController({ fill: fillTip, show: () => { tip.hidden = false; }, hide: () => { tip.hidden = true; } });
function hideTip() { tips.hide(); }
// the Font box: its data and list load on first focus (then the list opens as if typed); a pick or Enter (the best
// suggestion when no row is chosen) adds the font, the box empties and keeps the focus
const addFont = (el, v) => { el.value = ""; const p = parseHash().params; if (vals(p, "font").includes(v)) { toast("Already picked"); return; }
  setParams({ font: [...vals(p, "font").filter(x => x !== v), v], xfont: vals(p, "xfont").filter(x => x !== v) }); };
document.addEventListener("focusin", e => { const el = e.target; if (!el.matches?.(".font-box") || (S.fontUse && tokensMod)) return;
  Promise.all([loadFonts(), loadTokens()]).then(() => { if (document.activeElement === el) el.dispatchEvent(new Event("input", { bubbles: true })); }, () => toast("Couldn't load the fonts"));
});
document.addEventListener("suggest-pick", e => { if (e.target.matches?.(".font-box")) addFont(e.target, e.detail.value); });
document.addEventListener("keydown", e => { const el = e.target; if (e.key !== "Enter" || !el.matches?.(".font-box") || e.isComposing || !tokensMod) return;
  e.preventDefault(); const typed = norm(el.value); if (!typed) return;
  const best = tokensMod.suggestNames(el.value, fontEntries())[0];   // the same name first, a picked one too (addFont says so)
  if (best) addFont(el, best.value);
  else toast(S.cards.some(c => fontsOf(c).some(f => norm(f) === typed)) ? "No card in this search uses that font" : "No card uses a font by that name"); });
// exclusions: a right-click on a sidebar filter (a long press on touch: wireTips; the menu a touch brings up is only suppressed)
let touchAt = -1e9;
document.addEventListener("pointerdown", e => { if (e.pointerType === "touch") touchAt = performance.now(); }, true);
document.addEventListener("contextmenu", e => { const el = xTarget(e.target); if (!el) return; e.preventDefault(); if (performance.now() - touchAt > 1500) actions["toggle-param"](el, true); });
wireTips(document, tips, (cx, cy) => {
  const r = tip.getBoundingClientRect();
  let x = cx + 14, y = cy + 16;
  if (x + r.width > innerWidth - 8) x = Math.max(8, cx - r.width - 14);
  if (y + r.height > innerHeight - 8) y = cy - r.height - 14;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}, { match: xTarget, run: el => actions["toggle-param"](el, true) });

try { for (const k of Object.keys(localStorage)) if (k === "edit-token" || k.startsWith("deckPass:")) localStorage.removeItem(k); } catch {}   // plain-text secrets of before 2026-10-23
if (wantsEditor()) loadEditor().catch(() => {});          // at once, beside cards.json
init().finally(fresh.watch);                            // a new deploy reloads the page (fresh.js)
