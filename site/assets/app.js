import { compile, suggest, total, SEARCH_HELP } from "./search.js";
import { esc, norm, makeRenderer, plain, diffWords, tagInfo, badgeHtml, GROUP_NAMES, legendHtml, hasBadges } from "./text.js";
import * as D from "./deck.js";
import { renderStats } from "./stats.js";
import { createEditor } from "./edit.js";
import { personHtml, peopleHtml, peopleRows, personOf, findPerson, titlesOf, mergeUsers, shareDialogHtml, personDiscord, personText } from "./profile.js";
import * as inline from "./inline.js";
import * as details from "./details.js";
import { tipController } from "./tip.js";
import * as decks from "./decks.js";
import * as pick from "./pick.js";
import * as balance from "./balance.js";
import * as changes from "./changes.js";
import { date, month, TZ, textAt, textChanged, historyHtml } from "./history.js";
import { deckPasses } from "./login.js";

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
  renderedHash: null, listHash: "#/cards", shared: null,
  selected: new Set(),                                     // tiles picked in the cards grid (edit mode: drag them onto a series or author)
};
// The game's names (rulebook "04 Table": creature and item decks, field cards, N.M.E. items, the auxiliary decks)
const KINDS = [["creature", "Creatures"], ["item", "Items"], ["field", "Field cards"], ["minion", "Minions"], ["nme", "N.M.E. items"],
  ["aux item", "Auxiliary items"], ["status", "Status effects"], ["creatures", "Auxiliary creatures"]];
const KIND_LABEL = { creature: "Creature", item: "Item", field: "Field card", minion: "Minion", nme: "N.M.E. item", "aux item": "Auxiliary item",
  debuff: "Debuff", buff: "Buff", creatures: "Auxiliary creature", unknown: "Other" };
const FLAGS = [["history", "Text history"], ["alias", "Aliases"], ["dup", "Duplicates"], ["unused", "Unused status effects"], ["edited", "Edited on the website"],
  ["pending", "PSD pending or refused"], ["unparsed", "Not parsed yet"], ["problems", "Parse problems"], ["details", "PSD details"]];
const STAT_COLORS = { hp: "#2fbf3a", def: "#3d63ff", atk: "#ff3b3b", spd: "#ffd21f" };   // the game's own stat colors
// [key, label, dir it sets]; "created" = the creation date (first Discord post or first upload), when the build has dates
const SORTS = [["name", "Name"], ["stars", "Stars"], ["total", "Total stats"], ["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"],
  ["new", "Recently updated"], ["created", "Newest created", ""], ["created", "Oldest created", "asc"], ["series", "Series"], ["type", "Kind"], ["mentioned", "Most referenced"]];
const sortOf = p => (p.get("sort") === "created" && !S.created ? "" : p.get("sort")) || "name";   // a shallow build: Name
const isDesc = (sort, dir) => (dir ? dir === "desc" : ["stars", "total", "hp", "def", "atk", "spd", "new", "created", "mentioned"].includes(sort));

const urlPath = p => p.split("/").map(encodeURIComponent).join("/");
const BUILD = document.querySelector('meta[name="build"]')?.content || "";
const V = /^[0-9a-f]+$/.test(BUILD) ? `?v=${BUILD}` : "";            // same URLs as the preload hints in index.html
const img = (c, w) => (c.img ? `thumbs/${c.img}-${w}.webp` : "");      // card images: 240 / 360 / 720 px wide
const thumbUrl = c => img(c, 360);
/** <img> attributes for a card image shown about `css` px wide: the browser picks 240 or 360 (or 720) px by screen density */
const imgAttrs = (c, css, big = false) => `src="${img(c, 360)}" srcset="${img(c, 240)} 240w, ${img(c, 360)} 360w${big ? `, ${img(c, 720)} 720w` : ""}" sizes="${css}px"${c.tw ? ` width="${c.tw}" height="${c.th}"` : ""}`;
const fullUrl = c => (c.png ? S.data.raw + urlPath(c.png) : "");
const ghUrl = p => `https://github.com/${S.data.repo}/blob/main/${urlPath(p)}`;
const stars = n => (n ? "★".repeat(Math.min(n, 10)) : "");
const day = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "");
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
const iconImg = (name, cls = "tok") => { const ic = iconFor(name); return ic ? `<img class="${cls}" src="${esc(ic.file)}" alt="${esc(name)}" data-tip="${esc(name.replace(/_/g, " "))}">` : ""; };
// edits the pipeline bakes into the card image (build_site.py PSD_FIELDS): pending, refused, or baked but not re-parsed yet
const FIELD_LABEL = { name: "Name", stars: "Stars", types: "Types", hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", ability: "Ability" };
const PSD_TIP = "The card image is being regenerated with this edit";     // the one tip for a pending PSD field (edit.js too)
const pendingList = c => (c.pending || []).map(f => FIELD_LABEL[f] || f).join(", ");
const psdBadges = c => [
  c.refused ? `<span class="fact refused" data-tip="The last try to regenerate the card image was refused; change the edit or the PSD">Image update refused: ${esc(c.refused)}</span>`
    : c.pending?.length ? `<span class="fact pending" data-tip="${PSD_TIP}">PSD pending: ${esc(pendingList(c))}</span>` : "",
  c.reparsePending ? `<span class="fact" data-tip="The PSD changed since the bot last read it; the data follows on the next /update_stats">Re-parse pending</span>` : "",
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
// loaded on demand: the rulebook pages, and older versions of card text
let rulesP = null, historyP = null, versionsP = null;
const loadRules = () => (rulesP ||= getJson("rules.json").then(d => { S.rules = d.rules; editor.refresh(); }).catch(e => { rulesP = null; throw e; }));
const loadHistory = () => (historyP ||= getJson("history.json").then(h => {
  for (const c of [...S.cards, ...(S.rules || [])]) if (h[c.id]) c.history = h[c.id];
  S.history = h;
}).catch(e => { historyP = null; throw e; }));
const loadVersions = () => (versionsP ||= getJson("versions.json").then(d => { S.versions = d; }).catch(e => { versionsP = null; throw e; }));
// balance analytics (data/analytics.json): the Stats page's Balance section and the cards' Balance blocks
let analyticsP = null;
const loadAnalytics = () => (analyticsP ||= getJson("analytics.json").then(d => { S.analytics = d; }).catch(e => { analyticsP = null; throw e; }));
// the Changes page's Changelog and Database edits tabs (data/changelog.json, changes.js)
let changelogP = null;
const loadChangelog = () => (changelogP ||= getJson("changelog.json").then(d => { S.changelog = d; }).catch(e => { changelogP = null; throw e; }));
let usersP = null, contribP = null;                     // profiles (data/users.json) and contributions (data/contributions.json): the People tab and person pages
const loadUsers = () => (usersP ||= getJson("users.json").then(d => { S.users = d.users || []; S.userBy = new Map(S.users.map(p => [p.login.toLowerCase(), p])); return S.userBy; }).catch(e => { usersP = null; throw e; }));
const loadContrib = () => (contribP ||= getJson("contributions.json").then(d => { S.contrib = d; S.titles = titlesOf(d.people || []); }).catch(e => { contribP = null; throw e; }));
// published decks (data/decks.json): the deck browser, deck pages and the person pages' Decks panel. A failed load leaves an
// empty set with the reason (the browser says so; person pages just show no decks) instead of breaking the page.
let decksP = null;
const loadDecks = () => (decksP ||= getJson("decks.json").then(d => { S.decksData = decks.normalizeData(d, S.byId); })
  .catch(e => { decksP = null; S.decksData = { generated: "", decks: [], private: [], error: e.message }; }));
// the Details dropdown on a card page: data/details/<id>.json, fetched on first open and kept for the session
const detailsP = new Map();
const loadDetails = c => detailsP.get(c.id) || detailsP.set(c.id, getJson(`details/${encodeURIComponent(c.id)}.json`).catch(e => { detailsP.delete(c.id); throw e; })).get(c.id);
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
  S.all = S.data.cards; S.rules = null; S.icons = S.data.icons;
  S.created = S.all.some(c => c.created);                 // creation dates: none in a shallow build without the dates file
  for (const c of S.all) S.byId.set(c.id, c);
  editor.init();                                           // applies staged edits, then derive()
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
  S.renderer = makeRenderer({ cards: S.cards, icons: S.icons });
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
  if (S.renderedHash) renderView(parseHash(base), base);
  if (onCard && $(".detail", modal)) openCard(parseHash().arg);       // dialogs stay open
}
const editor = createEditor({
  S, KIND_LABEL, PSD_TIP, derive, rerender, goCard, currentCard, toast: m => toast(m), modal,
  openCard: id => openCard(id), closeModal: () => closeModal(), showDialog: h => showDialog(h),
  statBars: c => statBars(c), imageOf: c => thumbUrl(c),   // the form's live preview
  iconFor: n => iconFor(n), render: (t, n) => S.renderer.render(t, n),
  users: () => loadUsers(), goUser, goEdit, onAuth: () => { renderAccount(); if (!editor.me) S.selected.clear(); },
  // the profile page editor (#/u/<login>/edit) renders into the view and reuses the tiles, the kinds and the saved hands
  view, route: () => parseHash(), tile: c => tileHtml(c, { small: true }), kinds: KINDS, kindOf, savedDecks: () => S.decks,
  decks: () => loadDecks().then(() => deckList()),         // the published decks (with the pending ones): the publish dialog's "replaces"
});
// edit mode = signed in: the card dialog and the cards grid edit in place (inline.js), the form stays as "All fields"
const editing = () => !!editor.me;
inline.install({ editor, modal, selected: S.selected, goCard: id => goCard(id), rerender: () => rerender(), toast: m => toast(m) });
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
    if (m) return { name: STATIC_PAGES[m[1]], arg: decodeURIComponent(m[2]), params: new URLSearchParams() };
    const k = rest.match(/^decks\/([^/?#]+)\/([^/?#]+)/);
    if (k) return { name: "decks", arg: `${decodeURIComponent(k[1])}/${decodeURIComponent(k[2])}`, params: new URLSearchParams() };
  }
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "u" && parts.length === 3 && parts[2] === "edit") return { name: "u", arg: parts[1], edit: true, params: new URLSearchParams(query) };   // the profile editor
  return { name: parts[0] || "cards", arg: parts.slice(1).join("/"), params: new URLSearchParams(query) };
}
const hashOf = r => `#/${r.name}${r.arg ? `/${r.arg.split("/").map(encodeURIComponent).join("/")}` : ""}${r.edit ? "/edit" : ""}`;     // the route's hash when the address bar has none
// a published public deck (its share page exists): the entry, else null
const staticDeck = arg => { const [o, ...rest] = String(arg || "").split("/"), s = rest.join("/"); const d = S.decksData?.decks.find(x => x.slug === s && x.owner.toLowerCase() === o.toLowerCase()); return d && !editor.deckOf(o, s) ? d : null; };
// address bar shows the shareable URL: c/<id>/ for cards, u/<login>/ for profiles, decks/<owner>/<slug>/ for published decks, d/#/deck/… for shared hands;
// the profile editor stays a hash route
function syncUrl(r) {
  const sd = r.name === "decks" && r.arg ? staticDeck(r.arg) : null;
  const want = r.name === "card" ? shareUrl(r.arg) : r.name === "u" && r.arg && !r.edit ? userUrl(r.arg) : sd ? deckPageUrl(sd.owner, sd.slug)
    : r.name === "decks" && r.arg && !location.hash ? location.href                  // a deck's static path before decks.json is loaded (or a private, staged or missing deck): stay, never the bare root
    : `${ROOT}${r.name === "deck" && r.arg ? "d/" : ""}${location.hash}`;
  if (location.href !== want) history.replaceState(history.state, "", want);
}
function route() {
  const r = parseHash();
  syncUrl(r);
  hideTip();
  if (r.name === "card") {
    if (!S.renderedHash) renderView({ name: "cards", arg: "", params: new URLSearchParams() }, "#/cards");
    openCard(r.arg, r.params.has("details"));
    return;
  }
  const hash = location.hash || hashOf(r);
  if (hash === S.renderedHash && !modal.hidden) { closeModal(); return; }
  closeModal();
  renderView(r, hash);
}
function renderView(r, hash) {
  S.renderedHash = hash; S.listHash = hash;
  if (r.name !== "cards") S.selected.clear();
  if (!(r.name === "u" && r.edit)) editor.leave();
  const tab = { compare: "cards", u: "users", decks: "deck" }[r.name] || r.name;
  $$(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  if (r.name !== "cards" && qInput.value && document.activeElement !== qInput) qInput.value = "";
  const views = { cards: renderCards, rules: renderRules, deck: renderDeck, stats: renderStatsView, changes: renderChanges, compare: renderCompare, users: renderUsers, u: renderUser, decks: renderDecks };
  (views[r.name] || renderCards)(r);
  const titles = { cards: "Cards", rules: "Rulebook", deck: "Deck builder", stats: "Stats", changes: "Changes", compare: "Compare", users: "People", u: r.edit ? "Edit profile" : r.arg || "People",
    decks: r.arg ? S.deckTitle || "Deck" : "Published decks" };
  document.title = `${titles[r.name] || "Cards"} · Impossibility Simulator`;
}
function setParams(updates, { replace = true } = {}) {
  const r = parseHash();
  const p = r.params;
  for (const [k, v] of Object.entries(updates)) (v === "" || v == null || (Array.isArray(v) && !v.length)) ? p.delete(k) : p.set(k, Array.isArray(v) ? v.join(",") : v);
  const hash = `#/${r.name === "card" ? "cards" : r.name}${r.arg ? "/" + r.arg : ""}${p.toString() ? "?" + p : ""}`;
  if (replace) { history.replaceState(null, "", hash); renderView(parseHash(), hash); } else location.hash = hash;
}

// ---- cards (browse) --------------------------------------------------------------------------------
const csv = (p, k) => (p.get(k) ? p.get(k).split(",").filter(Boolean) : []);
function rangeOf(p, k) { const v = p.get(k); if (!v) return null; const [lo, hi] = v.split("-").map(Number); return [isNaN(lo) ? 0 : lo, isNaN(hi) ? 99 : hi]; }
// edited on the website or in Discord: an editor's fields (changes.fieldEditors), never a _by AutoCroissant entry (the
// 2026-10-22 migration's, the moved stat exclusions) nor the migration's fields in an editor's entry (botEdited without fieldBy)
const webEdited = c => changes.fieldEditors(c).length > 0;
function filterCards(p, { facets = true } = {}) {
  const pred = compile(p.get("q") || "");
  let list = pred ? S.cards.filter(pred) : S.cards.slice();
  if (!facets) return list;
  const kinds = csv(p, "kind"), st = csv(p, "stars").map(Number), subs = csv(p, "sub"), types = csv(p, "types"), flags = csv(p, "flags");
  const series = p.get("series"), subseries = p.get("subseries"), author = p.get("author");
  if (kinds.length) list = list.filter(c => kinds.includes(kindOf(c)));
  if (st.length) list = list.filter(c => st.includes(c.stars));
  if (subs.length) list = list.filter(c => subs.includes(c.subtype));
  if (types.length) list = list.filter(c => types.every(t => (c.types || []).includes(t)));
  if (series) list = list.filter(c => c.series === series);
  if (subseries) list = list.filter(c => c.subseries === subseries);
  if (author) list = list.filter(c => c.author === author);
  for (const k of ["hp", "def", "atk", "spd"]) { const r = rangeOf(p, k); if (r) list = list.filter(c => c[k] != null && c[k] >= r[0] && c[k] <= r[1]); }
  const flagFns = { history: c => !!c.hv, unparsed: c => !c.parsed, problems: c => !!(c.problems && c.problems.length), alias: c => !!(c.aliases && c.aliases.length),
    dup: c => !!(c.dup || c.dups), unused: c => !!c._unused, edited: c => !!(webEdited(c) || c._staged || c._sent),
    pending: c => !!((c.pending && c.pending.length) || c.refused), details: c => !!c.details };
  for (const f of flags) if (flagFns[f]) list = list.filter(flagFns[f]);
  return list;
}
function sortCards(list, sort = "name", dir = "") {
  const key = {
    name: c => c.name.toLowerCase(), stars: c => c.stars ?? -1, total: c => (c.hp == null ? -1 : total(c)), hp: c => c.hp ?? -1, def: c => c.def ?? -1,
    atk: c => c.atk ?? -1, spd: c => c.spd ?? -1, new: c => c.ts ?? 0, series: c => `${(c.series || "\uffff").toLowerCase()}\u0001${(c.subseries || "\uffff").toLowerCase()}`, type: c => kindOf(c),
    mentioned: c => (S.mentionedBy.get(c.id) || new Set()).size,
  }[sort] || (c => c.name.toLowerCase());
  const desc = isDesc(sort, dir);
  if (sort === "created") {                                // no date last; one day by first upload, then name
    const s = desc ? -1 : 1, cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    return list.sort((a, b) => (!a.created - !b.created) || s * cmp(a.created || "", b.created || "") || s * ((a.fs || 0) - (b.fs || 0))
      || a.name.localeCompare(b.name));
  }
  return list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * (desc ? -1 : 1); });
}
function chipList(key, options, selected, counts) {
  return `<div class="chips">${options.map(([v, label]) => `<button type="button" class="chip${selected.includes(String(v)) ? " on" : ""}" data-action="toggle-param" data-key="${key}" data-value="${esc(v)}">${esc(label)}${counts ? `<span class="n">${counts.get(String(v)) || 0}</span>` : ""}</button>`).join("")}</div>`;
}
function tileHtml(c, { small = false, eager = false, css = 190, constructed = false } = {}) {
  const inDeck = deckHas(c.id);
  return `<article class="tile" data-open="${c.id}" tabindex="0" aria-label="${esc(c.name)}">
    ${c.img ? `<img class="art" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" ${imgAttrs(c, small ? 120 : css)} alt="">` : `<div class="art"></div>`}
    ${constructed && c._banned ? `<span class="flag banned" data-tip="Banned in constructed: ${esc(c._banned)}">Banned</span>`
      : c._staged ? `<span class="flag staged" data-tip="Changed in your unpublished batch">Unpublished</span>`
      : c.hidden ? `<span class="flag" data-tip="Hidden from the website">Hidden</span>`
      : c.refused ? `<span class="flag refused" data-tip="Image update refused: ${esc(c.refused)}">Image update refused</span>`
      : c.pending?.length ? `<span class="flag pending" data-tip="${PSD_TIP}: ${esc(pendingList(c))}">PSD pending</span>`
      : c.reparsePending ? `<span class="flag" data-tip="The PSD changed since the bot last read it">Re-parse pending</span>`
      : !c.parsed ? `<span class="flag" data-tip="Not parsed by the bot yet">New</span>`
      : c._unused ? `<span class="flag unused" data-tip="No card names this status effect">Unused</span>`
      : c.dup ? `<span class="flag" data-tip="Duplicate of ${esc(S.byId.get(c.dup)?.name || "")}: same PSD">Duplicate</span>` : ""}
    ${small ? "" : `<button type="button" class="add${inDeck ? " in" : ""}" data-action="deck-toggle" data-id="${c.id}">${inDeck ? "✓ In deck" : "+ Deck"}</button>`}
    <div class="meta"><div class="name">${esc(c.name)}</div>
    <div class="sub">${c.stars ? `<span class="stars">${stars(c.stars)}</span>` : ""}${small ? "" : `<span>${esc(KIND_LABEL[c.type] || c.type)}</span>`}${small ? "" : (c.types || []).slice(0, 3).map(t => iconImg(t, "")).join("")}</div></div></article>`;
}
function renderCards(r) {
  const p = r.params;
  if (document.activeElement !== qInput) qInput.value = p.get("q") || "";
  const base = filterCards(p, { facets: false });
  const list = sortCards(filterCards(p), sortOf(p), p.get("dir") || "");
  S.list = list;
  if (S.selected.size) { const ids = new Set(list.map(c => c.id)); for (const id of S.selected) if (!ids.has(id)) S.selected.delete(id); }   // a drag carries only shown cards
  const count = (arr, f) => { const m = new Map(); for (const c of arr) for (const k of [].concat(f(c))) if (k != null) m.set(String(k), (m.get(String(k)) || 0) + 1); return m; };
  const kindCounts = count(base, kindOf), starCounts = count(base, c => c.stars), subCounts = count(base, c => c.subtype);
  const typeCounts = count(base, c => c.types || []);
  const series = [...new Set(S.cards.map(c => c.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const subseries = [...new Map(S.cards.filter(c => c.subseries && (!p.get("series") || c.series === p.get("series")))   // [series, subseries] of the picked series
    .map(c => [`${c.series || ""}\u0001${c.subseries}`, [c.series || "", c.subseries]])).values()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const sharedSub = name => subseries.filter(x => x[1] === name).length > 1;     // same name in two series: say which
  const subOpt = ([ser, sub]) => { const sh = sharedSub(sub), on = sub === p.get("subseries") && (!sh || ser === p.get("series"));
    return `<option value="${esc(sub)}"${sh ? ` data-series="${esc(ser)}"` : ""}${on ? " selected" : ""}>${esc(sub)}${sh ? ` (${esc(ser || "no series")})` : ""}</option>`; };
  const subPicked = p.get("subseries") && !subseries.some(([ser, sub]) => sub === p.get("subseries") && (!sharedSub(sub) || ser === p.get("series")));
  const authors = [...new Set(S.cards.map(c => c.author).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const starOpts = [...new Set(S.cards.map(c => c.stars).filter(Boolean))].sort((a, b) => a - b).map(s => [s, `${s}★`]);
  const subOpts = [...new Set(S.cards.map(c => c.subtype).filter(Boolean))].sort().map(s => [s, s[0].toUpperCase() + s.slice(1)]);
  const typeOpts = [...typeCounts.keys()].sort((a, b) => (typeCounts.get(b) || 0) - (typeCounts.get(a) || 0));
  const view_ = p.get("view") || localStorage.getItem("view") || "grid", size = p.get("size") || localStorage.getItem("size") || "m";
  const active = [];
  if (p.get("q")) active.push(["q", `“${p.get("q")}”`]);
  for (const k of csv(p, "kind")) active.push(["kind", (KINDS.find(x => x[0] === k) || [k, k])[1], k]);
  for (const s of csv(p, "stars")) active.push(["stars", `${s}★`, s]);
  for (const s of csv(p, "sub")) active.push(["sub", cap(s), s]);
  for (const t of csv(p, "types")) active.push(["types", t.replace(/_/g, " "), t]);
  if (p.get("series")) active.push(["series", p.get("series")]);
  if (p.get("subseries")) active.push(["subseries", p.get("subseries")]);
  if (p.get("author")) active.push(["author", `by ${p.get("author")}`]);
  for (const k of ["hp", "def", "atk", "spd"]) if (p.get(k)) active.push([k, `${k.toUpperCase()} ${p.get(k)}`]);
  for (const f of csv(p, "flags")) active.push(["flags", (FLAGS.find(x => x[0] === f) || [f, f])[1], f]);
  const rangeSel = (k, which) => { const r_ = rangeOf(p, k); const cur = r_ ? Math.min(r_[which], S.statMax[k]) : (which ? S.statMax[k] : 0);
    return `<select data-action="range" data-key="${k}" data-which="${which}" aria-label="${k} ${which ? "max" : "min"}">${Array.from({ length: S.statMax[k] + 1 }, (_, i) => `<option${i === cur ? " selected" : ""}>${i}</option>`).join("")}</select>`; };
  const suggestions = !list.length && p.get("q") ? suggest(p.get("q"), S.cards) : [];

  view.innerHTML = `<div class="browse">
    <aside class="filters${S.filtersOpen ? " open" : ""}" aria-label="Filters">
      <h3>Kind</h3>${chipList("kind", KINDS.filter(([k]) => kindCounts.get(k)), csv(p, "kind"), kindCounts)}
      <h3>Stars</h3>${chipList("stars", starOpts, csv(p, "stars"), starCounts)}
      ${subOpts.length ? `<h3>Item type</h3>${chipList("sub", subOpts, csv(p, "sub"), subCounts)}` : ""}
      ${typeOpts.length ? `<h3>Types</h3><div class="icon-toggles">${typeOpts.map(t => { const ic = iconFor(t); const on = csv(p, "types").includes(t);
        return `<button type="button" class="icon-toggle${on ? " on" : ""}" data-action="toggle-param" data-key="types" data-value="${esc(t)}" data-tip="${esc(t.replace(/_/g, " "))} (${typeCounts.get(t)})" aria-pressed="${on}">${ic ? `<img src="${esc(ic.file)}" alt="${esc(t)}">` : esc(t.slice(0, 2))}</button>`; }).join("")}</div>` : ""}
      <h3>Series</h3><select data-action="select-param" data-key="series"><option value="">All series</option>${series.map(s => `<option${s === p.get("series") ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
      ${subseries.length || p.get("subseries") ? `<h3>Subseries</h3><select data-action="select-param" data-key="subseries"><option value="">All subseries</option>${subPicked ? `<option selected>${esc(p.get("subseries"))}</option>` : ""}${subseries.map(subOpt).join("")}</select>` : ""}
      <h3>Stats</h3>${["hp", "def", "atk", "spd"].map(k => `<div class="range-row"><span class="muted">${k.toUpperCase()}</span>${rangeSel(k, 0)}${rangeSel(k, 1)}</div>`).join("")}
      <h3>Author</h3><select data-action="select-param" data-key="author"><option value="">Anyone</option>${authors.map(a => `<option${a === p.get("author") ? " selected" : ""}>${esc(a)}</option>`).join("")}</select>
      <h3>Flags</h3>${FLAGS
        .map(([f, l]) => `<label class="check"><input type="checkbox" data-action="toggle-param" data-key="flags" data-value="${f}"${csv(p, "flags").includes(f) ? " checked" : ""}> ${l}</label>`).join("")}
      <p><button type="button" class="ghost" data-action="clear-filters">Clear all filters</button></p>
    </aside>
    <section>
      <div class="toolbar">
        <span class="result-count">${list.length.toLocaleString()} card${list.length === 1 ? "" : "s"}</span>
        <button type="button" class="mobile-only" data-action="toggle-filters">Filters${active.length ? ` (${active.length})` : ""}</button>
        <label class="muted">Sort <select data-action="select-param" data-key="sort">${SORTS.filter(([v]) => v !== "created" || S.created).map(([v, l, d]) => { const cur = sortOf(p);
          return `<option value="${v}"${d !== undefined ? ` data-dir="${d}"` : ""}${v === cur && (d === undefined || (d === "asc") !== isDesc(cur, p.get("dir"))) ? " selected" : ""}>${l}</option>`; }).join("")}</select></label>
        <button type="button" class="ghost icon" data-action="flip-dir" title="Reverse order" aria-label="Reverse order">⇅</button>
        <span class="seg">${[["grid", "Grid"], ["table", "Table"]].map(([v, l]) => `<button type="button" class="${v === view_ ? "on" : ""}" data-action="set-pref" data-key="view" data-value="${v}">${l}</button>`).join("")}</span>
        ${view_ === "grid" ? `<span class="seg">${[["s", "S"], ["m", "M"], ["l", "L"]].map(([v, l]) => `<button type="button" class="${v === size ? "on" : ""}" data-action="set-pref" data-key="size" data-value="${v}" title="Tile size">${l}</button>`).join("")}</span>` : ""}
        <button type="button" class="ghost" data-action="random-from-list" title="Random result">Random</button>
        ${S.compare.length ? `<a href="#/compare/${S.compare.join(",")}">Compare (${S.compare.length})</a>` : ""}
      </div>
      ${active.length ? `<div class="active-filters">${active.map(([k, l, v]) => `<button type="button" class="chip" data-action="remove-param" data-key="${k}"${v !== undefined ? ` data-value="${esc(v)}"` : ""}>${esc(l)} ✕</button>`).join("")}</div>` : ""}
      <div id="deck-hits">${deckHits(p.get("q") || "")}</div>
      ${!list.length ? `<div class="empty">No cards match.${suggestions.length ? ` Did you mean ${suggestions.map(c => `<a href="#/card/${c.id}">${esc(c.name)}</a>`).join(", ")}?` : ""}</div>`
        : view_ === "table" ? tableHtml(list, p) : `<div class="grid" style="--tile:${{ s: "130px", m: "168px", l: "230px" }[size] || "168px"}">${list.map((c, i) => tileHtml(c, { eager: i < 8, css: { s: 160, m: 200, l: 270 }[size] || 200 })).join("")}</div>`}
    </section></div>`;
  if (editing()) inline.mountGrid(view, p);
}
function tableHtml(list, p) {
  const cols = [["name", "Card"], ["type", "Kind"], ["series", "Series"], ["stars", "★"], ["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"], ["total", "Total"], ["", "Types"], ["", "Author"],
    ...(S.created ? [["created", "Created"]] : []), ["new", "Updated"]];
  const sort = sortOf(p);
  return `<div class="scroll-x"><table class="data"><thead><tr><th></th>${cols.map(([k, l]) => `<th class="${["stars", "hp", "def", "atk", "spd", "total"].includes(k) ? "num" : ""}"${k ? ` data-action="sort-by" data-key="${k}"` : ""}>${l}${k && k === sort ? " ▾" : ""}</th>`).join("")}</tr></thead><tbody>
    ${list.map(c => `<tr class="row" data-open="${c.id}"><td>${c.img ? `<img class="thumb" loading="lazy" decoding="async" src="${img(c, 240)}" alt="">` : ""}</td><td>${esc(c.name)}${psdChips(c)}</td>
      <td>${esc(KIND_LABEL[c.type] || c.type)}${c.subtype ? ` · ${esc(cap(c.subtype))}` : ""}</td><td>${esc(c.series || "")}${c.subseries ? `<div class="muted" style="font-size:12px">${esc(c.subseries)}</div>` : ""}</td><td class="num">${c.stars ?? ""}</td>
      ${["hp", "def", "atk", "spd"].map(k => `<td class="num">${c[k] ?? ""}</td>`).join("")}<td class="num">${c.hp != null ? total(c) : ""}</td>
      <td>${(c.types || []).map(t => iconImg(t)).join("")}</td><td>${esc(c.author || "")}</td>${S.created ? `<td${c.created ? ` title="${esc(createdTip(c))}"` : ""}>${createdText(c)}</td>` : ""}<td>${date(c.ts)}</td></tr>`).join("")}</tbody></table></div>`;
}

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
function strip(title, cards) {
  return cards.length ? `<h3>${esc(title)} <span class="muted">${cards.length}</span></h3><div class="strip">${cards.slice(0, 24).map(x => tileHtml(x, { small: true })).join("")}</div>` : "";
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
  const inSub = x => x.subseries === c.subseries && x.series === c.series;
  const sameSub = c.subseries ? S.cards.filter(x => inSub(x) && x.id !== c.id) : [];
  const sameSeries = c.series ? S.cards.filter(x => x.series === c.series && x.id !== c.id && !(c.subseries && inSub(x))) : [];
  modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(c.name)}">
    <button type="button" class="ghost icon close" data-action="close" aria-label="Close (Esc)">✕</button>
    <div class="detail">
      <div class="image-wrap">${c.png ? `<a href="${esc(fullUrl(c))}" target="_blank" rel="noopener" title="Full-size image"><img id="detail-img" src="${thumbUrl(c) || esc(fullUrl(c))}" alt="${esc(c.name)}"${c.tw ? ` width="${c.tw}" height="${c.th}"` : ""} style="aspect-ratio:${c.tw && c.th ? `${c.tw}/${c.th}` : "2/3"}"></a>` : `<div class="empty">No image</div>`}
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
          ${c.subseries ? `<a class="fact" href="#/cards?${c.series ? `series=${encodeURIComponent(c.series)}&` : ""}subseries=${encodeURIComponent(c.subseries)}" data-tip="Subseries">${esc(c.subseries)}</a>` : ""}
          ${c.author ? `<a class="fact" href="#/cards?author=${encodeURIComponent(c.author)}">by ${esc(c.author)}</a>` : ""}
          ${c.created ? `<span class="fact" data-tip="${esc(createdTip(c))}">created ${createdText(c)}</span>` : ""}
          ${c.ts ? `<span class="fact" data-tip="Last PSD commit (Pacific time)">updated ${date(c.ts)}</span>` : ""}
          ${!c.parsed ? `<span class="fact">Image only: not parsed yet</span>` : ""}
          ${c._unused ? `<span class="fact unused" data-tip="No card names this status effect">Unused: on no card</span>` : ""}
          ${c.dup ? `<a class="fact" href="#/card/${c.dup}" data-tip="Same PSD, different name and art">Duplicate of ${esc(S.byId.get(c.dup)?.name || "")}</a>` : ""}
          ${c._staged ? `<span class="fact staged">Unpublished edit</span>` : c._sent ? `<span class="fact" data-tip="Published; the site is rebuilding">Publishing…</span>` : webEdited(c) ? `<span class="fact" data-tip="${esc(changes.editedTip(c))}">Edited</span>` : ""}
          ${psdBadges(c)}
          ${c.hidden ? `<span class="fact">Hidden</span>` : ""}
        </div>
        ${c.types && c.types.length ? `<div class="ctypes">${c.types.map(t => `<a href="#/cards?types=${encodeURIComponent(t)}">${iconImg(t, "")}</a>`).join("")}</div>` : ""}
        ${statBars(c)}
        ${c.ability ? `<div class="ability">${S.renderer.render(c.ability, c.name)}</div>` : c.parsed ? `<p class="muted">No ability text.</p>` : ""}
        ${c.note ? `<div class="note"><b>Note</b> ${S.renderer.render(c.note, c.name)}</div>` : ""}
        ${hasBadges(c.ability) || hasBadges(c.note) ? `<details class="badge-help" data-id="${esc(c.id)}"${keepBadges ? " open" : ""}><summary>Badges</summary>${legendHtml()}</details>` : ""}
        ${c.aliases?.length ? `<p class="muted">Also known as: ${c.aliases.map(esc).join(", ")}</p>` : ""}
        <div class="actions">
          <button type="button" class="${inDeck ? "" : "primary"}" data-action="deck-toggle" data-id="${c.id}">${inDeck ? "Remove from deck" : "Add to deck"} <span class="kbd">d</span></button>
          <button type="button" data-action="share" data-id="${c.id}">Share <span class="kbd">s</span></button>
          <button type="button" data-action="compare-add" data-id="${c.id}">${S.compare.includes(c.id) ? "In comparison" : "Compare"} <span class="kbd">x</span></button>
          <button type="button" data-action="edit-card" data-id="${c.id}">${editing() ? "All fields" : "Edit"} <span class="kbd">e</span></button>
          ${c.png ? `<a class="fact" href="${esc(fullUrl(c))}" target="_blank" rel="noopener">Full image</a>` : ""}
          ${c.psd ? `<a class="fact" href="${esc(ghUrl(c.psd))}" target="_blank" rel="noopener">PSD on GitHub</a>` : ""}
        </div>
        ${c.problems && c.problems.length ? `<p class="muted">Parser notes: ${c.problems.map(esc).join(" · ")}</p>` : ""}
        <div class="related">
          <div id="card-balance">${balanceHtml(c)}</div>
          ${strip("Duplicates", dupsOf(c))}${strip("Mentions", mentions)}${strip("Mentioned by", mentionedBy)}${strip("Similar stats", similar(c))}${strip(`More from ${c.subseries || ""}`, sameSub)}${strip(`More from ${c.series || ""}`, sameSeries)}
          <div id="decks-slot">${usingDecks(c)}</div>
          <div id="card-changes">${balanceHtml(c, "changes")}</div>
          <div id="history-slot">${historyHtml(c)}</div>
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
  if (c.img) {        // sharper 720 px image once it's loaded (the 360 px one is usually cached from the grid)
    const big = new Image(); big.onload = () => { const el = $("#detail-img"); if (el && el.alt === c.name) el.src = big.src; }; big.src = img(c, 720);
  }
  const fillBalance = () => { if (parseHash().arg !== c.id) return; for (const [sel, part] of [["#card-balance"], ["#card-changes", "changes"]]) { const slot = $(sel, modal); if (slot) slot.innerHTML = balanceHtml(c, part); } };
  if (c.hv && !c.history) loadHistory().then(() => { const slot = $("#history-slot"); if (slot && parseHash().arg === c.id) slot.innerHTML = historyHtml(c); fillBalance(); }, () => {});
  else if (c.dup && hasBalance(c) && balanceOf(c).hv && !balanceOf(c).history) loadHistory().then(fillBalance, () => {});   // its original's texts
  if (hasBalance(c) && !S.analytics) loadAnalytics().then(fillBalance, () => { const slot = $("#card-balance", modal); if (slot && parseHash().arg === c.id) slot.innerHTML = `<h3>Balance</h3><p class="muted">Couldn't load the balance data.</p>`; });
  if (c.iv && !S.versions) loadVersions().then(() => { const slot = $("#versions-slot"); if (slot && parseHash().arg === c.id) slot.innerHTML = versionsHtml(c); }, () => {});
  const dd = $(".psd-details", modal);
  if (dd) details.mount(dd, { card: c, load: () => loadDetails(c), storage: store, extras: { badges: psdBadges(c), labels: FIELD_LABEL } });
  if (editing()) inline.mountCard(modal, c);
}

// ---- image versions: every commit that changed the card's PNG (from git history), shown next to the current card
const versionList = c => {
  const rows = S.versions && S.versions.cards[c.id];
  if (!rows) return [];
  return rows.map(([ci, path]) => { const [sha, ts, author, subject] = S.versions.commits[ci]; return { sha, ts, author, subject, path: path || c.png }; });
};
const versionUrl = (v, cdn = false) => cdn
  ? `https://cdn.jsdelivr.net/gh/${S.versions.repo}@${v.sha}/${urlPath(v.path)}`
  : `https://raw.githubusercontent.com/${S.versions.repo}/${v.sha}/${urlPath(v.path)}`;
function versionsHtml(c) {
  if (!c.iv) return "";
  if (!S.versions) return `<h3>Image versions</h3><p class="muted">Loading ${c.iv} versions…</p>`;
  const vs = versionList(c);
  if (vs.length < 2) return "";
  const oldest = vs[vs.length - 1], fromInit = /^(git )?init$/i.test(oldest.subject.trim());
  return `<h3>Image versions <span class="muted">${vs.length}</span></h3>
    <p class="muted">Each commit that changed the image${fromInit ? `, since ${date(oldest.ts)} (first upload)` : ""}. Dates are Pacific time.</p>
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
  const caption = `${date(v.ts)}${v.author ? ` · ${esc(v.author)}` : ""}<br><span class="muted">${esc(v.subject || "")}</span>`;
  box.innerHTML = i === 0
    ? `<figure><img src="${img(c, 720)}" alt="${esc(c.name)}, current version"><figcaption>${caption}<br>Current version</figcaption></figure>`
    : `<div class="ver-pair"><figure><a href="${esc(versionUrl(v))}" target="_blank" rel="noopener"><img class="ver-old" src="${esc(versionUrl(v))}" alt="${esc(c.name)}, version from ${date(v.ts)}" loading="lazy"></a><figcaption>${caption}</figcaption></figure>
      <figure><img src="${img(c, 720)}" alt="${esc(c.name)}, current version"><figcaption>Current<br><span class="muted">${date(vs[0].ts)}</span></figcaption></figure></div>
      ${then && then !== c.ability ? `<div class="ver-text"><div class="muted">Text then (changes highlighted)</div><div>${diffWords(then, c.ability)}</div></div>` : ""}`;
  const old = $(".ver-old", box);
  if (old) old.addEventListener("error", () => { if (!old.dataset.cdn) { old.dataset.cdn = "1"; old.src = versionUrl(v, true); } }, { once: false });
}
// ---- balance: the card's standing among its star level and its recorded changes (balance.js)
const balanceOf = c => (c.dup ? S.byId.get(c.dup) || c : c);         // a duplicate shows its original's
const hasBalance = c => !!balanceOf(c).balance;
function balanceHtml(c, part = "balance") {          // part: "balance" (the line) or "changes" (the recorded changes)
  if (!hasBalance(c)) return "";
  if (!S.analytics) return part === "balance" ? `<h3>Balance</h3><p class="muted">Loading…</p>` : "";
  const o = balanceOf(c);
  const texts = o.hv && !o.history ? null : (o.history || []).map(v => v.ability).concat(o.ability || "");
  return (part === "balance" ? balance.balanceBlock : balance.changesBlock)(c, S.analytics, { byId: S.byId, texts });
}
function closeModal() {
  if (modal.hidden) return;
  modal.hidden = true; modal.innerHTML = ""; document.body.style.overflow = "";
  document.title = "Impossibility Simulator · Card Browser";
}

// ---- rulebook --------------------------------------------------------------------------------------
function renderRules(r) {
  if (!S.rules) {
    view.innerHTML = `<div class="loading">Loading the rulebook…</div>`;
    whenLoaded(loadRules(), "the rulebook", () => { if (parseHash().name === "rules") renderRules(parseHash()); });
    return;
  }
  const q = (r.params.get("q") || "").trim().toLowerCase();
  if (document.activeElement !== qInput) qInput.value = "";
  const pages = S.rules.filter(p => !q || (p.ability || "").toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  const tags = ["OYT", "1CD", "1/2CD", "AAT", "1GCD", "1/2GCD", "BOT", "ENDT", "BOGT", "ENDGT", "OFS", "OS", "OD", "WOF", "1PG", "2U", "Action",
    "1PT", "E2T", "FTE2T", "1PGT", "E2GT"];   // old system last
  const gloss = list => `<div class="glossary">${list.map(t => `<div>${badgeHtml(t)} ${esc(tagInfo(t).meaning)}</div>`).join("")}</div>`;
  const banned = S.data.banlist;
  view.innerHTML = `<div class="rules">
    <nav class="toc" aria-label="Rulebook pages"><input type="search" id="rules-q" placeholder="Search the rulebook…" value="${esc(r.params.get("q") || "")}" style="width:100%;margin-bottom:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface)">
      <a href="#/rules" data-scroll="badge-colors">Badge colors</a><a href="#/rules" data-scroll="glossary">Timing tags</a><a href="#/rules" data-scroll="banlist">Constructed ban list</a>
      ${S.rules.map(p => `<a href="#/rules" data-scroll="page-${p.id}">${esc(p.name)}</a>`).join("")}</nav>
    <div>
      ${q ? `<p class="muted">${pages.length} page${pages.length === 1 ? "" : "s"} mention “${esc(r.params.get("q"))}”.</p>` : ""}
      ${!q ? `<section class="panel" id="badge-colors"><h3>Badge colors</h3>${legendHtml()}</section>
      <section class="panel" id="glossary"><h3>Timing tags</h3><p class="muted">X can be any number; the first number of a pair such as (1/2CD) can also be 0 or −1. Hover a badge for its meaning.</p>
        ${Object.entries(GROUP_NAMES).map(([g, label]) => `<h4>${esc(label)}</h4>${gloss(tags.filter(t => tagInfo(t).group === g && !tagInfo(t).old))}`).join("")}
        <h4>Old system (rulebook pages)</h4>${gloss(tags.filter(t => tagInfo(t).old))}</section>
      <section class="panel" id="banlist"><h3>Constructed ban list</h3>${banned.notes.map(n => `<p class="muted">${esc(n)}</p>`).join("")}
        ${banned.groups.map(g => `<h4>${esc(g.title)}</h4><ul>${g.entries.map(e => `<li>${e.id ? `<a class="card-ref" href="#/card/${e.id}" data-card="${e.id}">${esc(e.name)}</a>` : esc(e.name)} <span class="muted">— ${esc(e.reason)}</span></li>`).join("")}</ul>`).join("")}</section>` : ""}
      ${pages.map(p => `<article class="page" id="page-${p.id}">${p.img ? `<a href="${esc(fullUrl(p))}" target="_blank" rel="noopener" title="Full-size page"><img loading="lazy" decoding="async" ${imgAttrs(p, 220, true)} alt="${esc(p.name)}"></a>` : "<div></div>"}
        <div><h3>${esc(p.name)}${p._staged ? ` <span class="fact staged">Unpublished edit</span>` : ""} <button type="button" class="ghost" data-action="edit-card" data-id="${p.id}" title="Edit this page">Edit</button></h3>
          <div class="ability">${S.renderer.render(p.ability || "")}</div>${p.note ? `<div class="note"><b>Note</b> ${S.renderer.render(p.note)}</div>` : ""}
          ${p.details ? details.detailsHtml(details.readState(store), false) : ""}</div></article>`).join("") || `<div class="empty">No rulebook page mentions that.</div>`}
    </div></div>`;
  if (q) highlight($$(".page .ability, .page h3", view), q);
  for (const p of pages) {                               // one Details dropdown per page, always closed at first
    const dd = p.details && document.getElementById(`page-${p.id}`)?.querySelector(".psd-details");
    if (dd) details.mount(dd, { card: p, load: () => loadDetails(p), storage: store, extras: { badges: psdBadges(p), labels: FIELD_LABEL, page: true }, outer: false });
  }
  const input = $("#rules-q");
  input.addEventListener("input", debounce(() => { setParams({ q: input.value }); const i2 = $("#rules-q"); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); }, 200));
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
      ${readOnly ? `<div class="panel"><b>Shared hand: ${esc(d.name)}</b> · ${v.count}/${v.slots} cards <button type="button" class="primary" data-action="save-shared">Save a copy to my decks</button></div>` : ""}
      <div class="panel"><h3>${readOnly ? "" : `<input id="deck-name" value="${esc(d.name)}" aria-label="Deck name" style="font:inherit;font-weight:700;background:transparent;border:0;color:inherit;width:100%">`}</h3>
        <p class="muted">7 creatures and 10 items, one of each, none banned, plus an optional field card (≤${D.FIELD_MAX_STARS}★) for the shop.</p>
        ${groups}
        <div class="tier-title"><span>Field card (optional)</span><span class="muted">${field ? 1 : 0} / 1</span></div>
        <div class="slots">${slot(field, `field card (≤${D.FIELD_MAX_STARS}★)`, "field")}</div>
        ${stray.length ? `<div class="tier-title"><span>Not allowed in a hand</span></div><div class="slots">${stray.map(c => slot(c)).join("")}</div>` : ""}
      </div>
    </section>
    <aside>
      <div class="panel"><h3>${v.complete ? "✅ Legal hand" : `Checks · ${v.count}/${v.slots} cards`}</h3><ul class="checks">${v.checks.map(c => `<li class="${c.ok ? "ok" : "err"}">${c.ok ? "✓" : "✗"} ${esc(c.text)}</li>`).join("")}</ul>
        ${cards.length ? `<p class="muted">Average total stats: ${(cards.filter(c => c.hp != null).reduce((s, c) => s + total(c), 0) / Math.max(1, cards.filter(c => c.hp != null).length)).toFixed(1)} · banned: ${counts.banned}</p>` : ""}</div>
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
    tile: c => tileHtml(c, { small: true, constructed: true }),
    onChoose: id => { const err = D.addCard(deck(), S.byId.get(id), S.byId); if (err) toast(err); else { D.saveDecks(S.decks); updateDeckCount(); closeModal(); renderDeck(parseHash()); } } });
}

// ---- stats / changes / compare -------------------------------------------------------------------
function renderStatsView(r) {
  renderStats(view, { cards: S.cards, renderer: S.renderer, banned: S.banned, icons: S.icons, mentions: S.mentions, byId: S.byId, banlist: S.data.banlist }, r.params);
  const fill = () => { const slot = $("#stats-balance", view), now = parseHash(); if (slot && now.name === "stats") slot.innerHTML = balance.statsHtml(S.analytics, { cards: S.cards, byId: S.byId }, now.params); };
  if (S.analytics) fill();
  else {
    $("#stats-balance", view).innerHTML = `<p class="loading">Loading the balance section…</p>`;
    loadAnalytics().then(fill, e => { const slot = $("#stats-balance", view); if (slot && parseHash().name === "stats") slot.innerHTML = `<p class="muted">Couldn't load the balance section (${esc(e.message)}).</p>`; });
  }
}
// the Changes page's category tabs, a row across its top: [hash key, label]; #/changes is the first, #/changes/<key> the others
// (a link to one survives a refresh), and each shows its own sections only
const CHANGE_TABS = [["", "Recently updated"], ["changelog", "Changelog"], ["edits", "Database edits"], ["website", "Website edits"],
  ["revised", "Most revised"], ["parser", "Parser notes"]];
const NEEDS = { "": "history", revised: "history", changelog: "changelog", edits: "changelog" };   // the data a tab loads first
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
  const updated = `<p class="muted">Updated ${new Date(S.data.generated).toLocaleString(undefined, { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })} (Pacific) from <a href="https://github.com/${esc(S.data.botRepo)}" target="_blank" rel="noopener">${esc(S.data.botRepo)}</a> and <a href="https://github.com/${esc(S.data.repo)}" target="_blank" rel="noopener">${esc(S.data.repo)}</a>.</p>`;
  if (tab === "changelog") { page(changes.changelogHtml(S.changelog, r.params)); return; }
  if (tab === "edits") { page(changes.editsHtml(S.changelog, r.params)); return; }
  if (tab === "website") { page(webEditsHtml() + updated); return; }
  if (tab === "parser") { page(parserNotesHtml() + updated); return; }
  const item = (c, diff = true) => {          // diff: the text change since the last earlier text
    const last = diff && c.history && c.history.length ? c.history[c.history.length - 1] : null;
    return `<div class="item">${c.img ? `<img loading="lazy" decoding="async" src="${img(c, 240)}" alt="" data-open="${c.id}">` : "<div></div>"}<div>
      <a href="#/card/${c.id}"><b>${esc(c.name)}</b></a> <span class="muted">${esc(KIND_LABEL[c.type] || c.type)}${c.stars ? ` · ${c.stars}★` : ""}${c.ts ? ` · ${date(c.ts)}` : ""}${c.author ? ` · ${esc(c.author)}` : ""}</span>
      ${last && c.ability ? `<div class="ability" style="margin-top:4px;font-size:14px">${diffWords(last.ability, c.ability)}</div>` : ""}</div></div>`;
  };
  if (tab === "revised") {
    const revised = S.cards.filter(c => c.hv && !c.dup).sort((a, b) => b.hv - a.hv);     // a duplicate has its original's
    page(`<section class="panel"><h3>Most revised</h3><p class="muted">The cards with the most earlier versions; text changes since the last one highlighted.</p><div class="feed">${revised.slice(0, 20).map(c => item(c)).join("") || `<p class="muted">No history yet.</p>`}</div></section>${updated}`);
    return;
  }
  const recent = S.cards.filter(c => c.ts).sort((a, b) => b.ts - a.ts).slice(0, 60);
  page(`<section class="panel"><h3>Recently updated</h3><p class="muted">Text changes highlighted (none when the update kept the text).</p><div class="feed">${recent.map(c => item(c, textChanged(c))).join("")}</div></section>${updated}`);
}
/** The Website edits tab: one row per card and editor whose Card Edits.json edit counts now (changes.webEdits: never the bot's, at most WEB_EDITS_SHOWN) */
function webEditsHtml() {
  const { shown, total } = changes.webEdits(S.all);
  return `<section class="panel"><h3>Edited on the website or in Discord${total ? ` <span class="muted">${total}</span>` : ""}</h3>
    <p class="muted">The cards an edit on the website or in Discord changes now, newest first${total > shown.length ? ` (the ${shown.length} newest)` : ""}: the fields, who and when. Aliases and series the bot moved in from Discord aren't listed.</p>
    ${total ? `<ul>${shown.map(({ c, by, at, fields }) => `<li><a href="#/card/${c.id}">${esc(c.name)}</a> <span class="muted">${esc(fields.join(", "))}${by ? ` · ${changes.nameHtml(by)}` : ""}${at ? ` · ${esc(at.slice(0, 10))}` : ""}</span>${psdChips(c)}</li>`).join("")}</ul>` : `<p class="empty">No card is edited on the website or in Discord.</p>`}</section>`;
}
/** The Parser notes tab: the cards the bot hasn't parsed yet, and the parser's notes */
function parserNotesHtml() {
  const unparsed = S.cards.filter(c => !c.parsed), problems = S.cards.filter(c => c.problems && c.problems.length);
  if (!unparsed.length && !problems.length) return `<section class="panel"><h3>Parser notes</h3><p class="empty">Every card is parsed, with no parser notes.</p></section>`;
  return `${unparsed.length ? `<section class="panel"><h3>Not parsed by the bot yet <span class="muted">${unparsed.length}</span></h3><p class="muted">Run /update_stats in Discord to add them.</p>
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
/** Cards tab: the published decks a search finds, filled in once decks.json is loaded. */
function deckHits(q) {
  if (!q.trim() || !hasDecks()) return "";
  if (S.decksData) return decks.searchHitsHtml(publicDecks(), q, deckCtx());
  loadDecks().then(() => { const el = $("#deck-hits"), h = parseHash(); if (el && h.name === "cards" && (h.params.get("q") || "") === q) el.innerHTML = deckHits(q); });
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
const ttsDownload = d => { D.download(`${d.name.replace(/[^\w\- ]+/g, "") || "hand"}.json`, JSON.stringify(D.ttsSave(d, S.byId, S.data.raw), null, 2)); toast("Downloaded Tabletop Simulator saved object"); };
const printDeck = d => { if (!D.printSheet(d, S.byId, S.data.raw)) toast("Allow pop-ups to print proxies"); };

// ---- people: profiles (data/users.json; staged or just-published ones from the editor) + contributions (data/contributions.json)
function usersReady(name, again) {
  if (S.users && S.contrib && S.decksData) return true;
  view.innerHTML = `<div class="loading">Loading people…</div>`;
  whenLoaded(Promise.all([loadUsers(), loadContrib(), loadDecks()]), "people", () => { if (parseHash().name === name) again(parseHash()); });
  return false;
}
function renderUser(r) {
  if (!r.arg) { location.replace("#/users"); return; }                                  // #/u alone is the list
  if (r.edit) { editor.profilePage(r.arg); return; }                                    // #/u/<login>/edit: the profile editor
  if (!usersReady("u", renderUser)) return;
  const me = editor.me, people = S.contrib.people || [];
  let pending = editor.profileOf(r.arg), published = S.userBy.get(r.arg.toLowerCase()) || null;
  let person = findPerson(r.arg, people);
  if (!pending && !published && person) {                                               // a credited name: the profile one of its logins made, if any
    const row = mergeUsers(S.users, editor.pendingProfiles()).find(u => personOf(u.profile, [person]));
    if (row) { pending = editor.profileOf(row.profile.login); published = S.userBy.get(row.profile.login.toLowerCase()) || null; }
  }
  const profile = pending ? pending.profile : published;
  if (!person && profile) person = personOf(profile, people);
  const login = pending?.profile?.login || published?.login || person?.key || r.arg;    // the file's spelling: u/<login>/ exists only for it
  if (login !== r.arg) { S.renderedHash = S.listHash = hashOf({ name: "u", arg: login }); syncUrl({ name: "u", arg: login }); }
  const own = !!me && (me.login.toLowerCase() === login.toLowerCase() || !!person?.logins.some(l => l.toLowerCase() === me.login.toLowerCase()));
  const owners = new Set([login, person?.github, ...(person?.logins || [])].filter(Boolean).map(s => s.toLowerCase())), theirs = deckList().filter(d => owners.has(d.owner.toLowerCase()));
  view.innerHTML = personHtml({ login, profile, person, state: pending?.state || "", removed: !!pending && !pending.profile,
    own, canEdit: own || !!me?.admin, byId: S.byId, cards: S.cards, tile: c => tileHtml(c, { small: true }),
    available: !!S.contrib.available, since: S.contrib.since, repo: S.data.repo, titles: S.titles, date, month, kinds: KINDS, kindOf,
    decks: { public: decks.sortDecks(theirs.filter(d => !d.private)), private: decks.sortDecks(theirs.filter(d => d.private)) }, deckTile: d => decks.deckTileHtml(d, deckCtx()) });
}
function renderUsers() {
  if (!usersReady("users", renderUsers)) return;
  const me = editor.me, rows = peopleRows(S.contrib.people || [], mergeUsers(S.users, editor.pendingProfiles()));
  view.innerHTML = peopleHtml(rows, { me, hasOwn: !!me && rows.some(r => r.profile && r.profile.login.toLowerCase() === me.login.toLowerCase()),
    available: !!S.contrib.available, since: S.contrib.since, titles: S.titles, date, decks: deckList() });
  updatePeopleCount(rows.length);
}
// the People tab's counter: the build's count until the table has been made here (pending profiles included)
function updatePeopleCount(n = S.data.peopleCount) { $("#people-count").textContent = n ? String(n) : ""; }
/** Who u/<name>/ is: the profile (pending or published) and the person, as the person page resolves them. */
function personAt(name) {
  const pending = editor.profileOf(name), profile = pending ? pending.profile : S.userBy?.get(name.toLowerCase()) || null, people = S.contrib?.people || [];
  return { profile, state: pending?.state || "", person: findPerson(name, people) || (profile && personOf(profile, people)) };
}
function openUserShare(name) {
  const { profile, person, state } = personAt(name), fav = S.byId.get(profile?.favourite || "");
  showDialog(shareDialogHtml({ name, url: userUrl(name), text: S.contrib?.previews?.[name] || "", state, native: !!navigator.share,
    image: fav?.img ? img(fav, 360) : "og.jpg", color: fav?.color }));
  $("#share-url").addEventListener("focus", e => e.target.select());
}
const userShare = name => ({ name, url: userUrl(name), person: personAt(name).person, titles: S.titles || new Map(), cards: S.cards, kindOf });
const userDiscord = name => personDiscord(userShare(name));
const userText = name => personText(userShare(name));          // no motto or other profile text

// ---- sharing (same text as the share pages' link previews) -----------------------------------------
const STAT_LABELS = [["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"]];
function shareHead(c) {
  const kind = KIND_LABEL[c.type] || c.type;
  return [c.stars ? `${c.stars}★ ${kind}` : kind, c.series, c.subseries, c.author ? `by ${c.author}` : ""].filter(Boolean).join(" · ");
}
const shareStats = c => STAT_LABELS.filter(([k]) => c[k] != null).map(([k, l]) => `${l} ${c[k]}`).join(" · ");
const ability = c => plain(c.ability || "").split("\n").map(l => l.trim()).filter(Boolean);
function shareText(c) {
  const out = [shareHead(c), shareStats(c), ability(c).join("\n")].filter(Boolean).join("\n");
  return out.length <= 300 ? out : `${out.slice(0, 297).replace(/\s+\S*$/, "")}…`;
}
const md = s => String(s).replace(/([\\*_~`|[\]])/g, "\\$1");
const mdLink = c => `[${md(c.name)}](<${shareUrl(c.id)}>)`;          // <…> stops Discord's preview
function cardDiscord(c) {
  return [`**${mdLink(c)}** · ${shareHead(c)}`, shareStats(c), ...ability(c).map(l => `> ${md(l)}`)].filter(Boolean).join("\n");
}
function deckDiscord(d) {
  const v = D.validate(d, S.byId, S.banned), cards = d.cards.map(id => S.byId.get(id)).filter(Boolean), field = S.byId.get(d.field);
  const build = link => [`**${md(d.name)}** · ${v.count}/${v.slots} cards · ${v.complete ? "✅ legal" : "not legal yet"}`,
    ...D.HAND.map(g => { const cs = cards.filter(c => c.type === g.kind).sort((a, b) => a.stars - b.stars); return cs.length ? `**${g.label}:** ${cs.map(link).join(", ")}` : ""; }),
    field ? `**Field:** ${link(field)}` : "", `[Open the hand](${deckUrl(d)})`].filter(Boolean).join("\n");
  const text = build(mdLink);
  return text.length <= 2000 ? text : build(c => md(c.name));        // Discord's limit
}
async function copyImage(c) {
  if (!c?.img || !window.ClipboardItem) { toast("Your browser can't copy images; use Full image"); return; }
  const blob = new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => { const cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext("2d").drawImage(im, 0, 0); cv.toBlob(res, "image/png"); };
    im.onerror = rej; im.src = img(c, 720);
  });
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Copied image"); }
  catch { toast("Couldn't copy the image"); }
}
function openShare(id) {
  const c = S.byId.get(id);
  if (!c) return;
  const url = shareUrl(c.id), text = shareText(c);
  showDialog(`<h3>Share ${esc(c.name)}</h3>
    <div class="share-url"><input id="share-url" readonly value="${esc(url)}" aria-label="Card link"><button type="button" class="primary" data-action="copy-link" data-id="${c.id}">Copy link</button></div>
    <p class="muted">Paste the link in Discord for a preview like this:</p>
    <div class="embed" style="--c:${esc(c.color || "#3987e5")}"><div class="embed-site">Impossibility Simulator</div><div class="embed-title">${esc(c.name)}</div>
      <div class="embed-desc">${esc(text).replace(/\n/g, "<br>")}</div>${c.img ? `<img src="${img(c, 360)}" alt="">` : ""}</div>
    <div class="actions">
      <button type="button" data-action="share-discord" data-id="${c.id}" title="Name as a link, stats and text, without a preview">Copy as Discord message</button>
      ${c.img ? `<button type="button" data-action="share-image" data-id="${c.id}">Copy image</button>` : ""}
      <button type="button" data-action="share-text" data-id="${c.id}">Copy plain text</button>
      ${navigator.share ? `<button type="button" data-action="share-native" data-id="${c.id}">Share…</button>` : ""}
    </div>`);
  $("#share-url").addEventListener("focus", e => e.target.select());
}

// ---- interactions ----------------------------------------------------------------------------------
function refresh(id) {
  const inDeck = deckHas(id);
  for (const b of $$(".add[data-id]")) if (b.dataset.id === id) { b.classList.toggle("in", inDeck); b.textContent = inDeck ? "✓ In deck" : "+ Deck"; }
  if (!modal.hidden && parseHash().name === "card") openCard(parseHash().arg);
  else if (parseHash().name === "deck") renderDeck(parseHash());
}
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.hidden = true), 2600); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); } catch { prompt("Copy:", text); } }
function showDialog(html) { modal.innerHTML = `<div class="dialog small" role="dialog" aria-modal="true"><button type="button" class="ghost icon close" data-action="close" aria-label="Close">✕</button>${html}</div>`; modal.hidden = false; }

const actions = {
  "close": () => { if ($("#edit-form", modal)) { actions["edit-cancel"](); return; } if (parseHash().name === "card") location.hash = S.listHash; else closeModal(); },
  "toggle-param": el => { const p = parseHash().params, cur = csv(p, el.dataset.key), v = el.dataset.value;
    setParams({ [el.dataset.key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }); },
  "select-param": el => { const k = el.dataset.key, o = el.selectedOptions?.[0]?.dataset || {};      // a shared subseries picks its series too; a sort its direction (default unless the option says)
    setParams({ [k]: el.value, ...(k === "series" ? { subseries: "" } : {}), ...(o.series ? { series: o.series } : {}), ...(k === "sort" ? { dir: o.dir ?? "" } : {}) }); },
  "remove-param": el => { const p = parseHash().params; if (el.dataset.value !== undefined) setParams({ [el.dataset.key]: csv(p, el.dataset.key).filter(x => x !== el.dataset.value) }); else setParams({ [el.dataset.key]: "", ...(el.dataset.key === "series" ? { subseries: "" } : {}) }); if (el.dataset.key === "q") qInput.value = ""; },
  "clear-filters": () => { qInput.value = ""; history.replaceState(null, "", "#/cards"); renderView(parseHash(), "#/cards"); },
  "range": el => { const p = parseHash().params, k = el.dataset.key, cur = rangeOf(p, k) || [0, S.statMax[k]]; cur[+el.dataset.which] = Number(el.value);
    setParams({ [k]: cur[0] === 0 && cur[1] >= S.statMax[k] ? "" : `${Math.min(...cur)}-${Math.max(...cur)}` }); },
  "flip-dir": () => { const p = parseHash().params; setParams({ dir: isDesc(sortOf(p), p.get("dir")) ? "asc" : "desc" }); },
  "sort-by": el => { const p = parseHash().params; setParams({ sort: el.dataset.key, dir: p.get("sort") === el.dataset.key && p.get("dir") !== "asc" ? "asc" : "" }); },
  "set-pref": el => { localStorage.setItem(el.dataset.key, el.dataset.value); setParams({ [el.dataset.key]: el.dataset.value }); },
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
  "deck-publish": el => editor.publishDeck(el.dataset.id),
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
  "copy-link": el => copy(shareUrl(el.dataset.id), "link: paste it in Discord"),
  "copy-user-link": el => copy(userUrl(el.dataset.login), "link: paste it in Discord"),
  "share-user": el => openUserShare(el.dataset.login),
  "share-user-discord": el => copy(userDiscord(el.dataset.login), "person for Discord"),
  "share-user-text": el => copy(userText(el.dataset.login), "person as text"),
  "share-user-native": el => { const name = el.dataset.login; navigator.share({ title: name, text: personText({ ...userShare(name), name: "" }), url: userUrl(name) }).catch(() => {}); },
  "share": el => openShare(el.dataset.id),
  "share-discord": el => copy(cardDiscord(S.byId.get(el.dataset.id)), "card for Discord"),
  "share-text": el => { const c = S.byId.get(el.dataset.id); copy(`${c.name} · ${shareText(c)}`, "card text"); },
  "share-image": el => copyImage(S.byId.get(el.dataset.id)),
  "share-native": el => { const c = S.byId.get(el.dataset.id); navigator.share({ title: c.name, text: shareText(c), url: shareUrl(c.id) }).catch(() => {}); },
  "compare-add": el => { const id = el.dataset.id; if (!S.compare.includes(id)) S.compare = [...S.compare, id].slice(-5); toast(`Comparing ${S.compare.length} card${S.compare.length > 1 ? "s" : ""} (Compare is in the toolbar)`); openCard(id); },
  "compare-remove": el => { S.compare = S.compare.filter(x => x !== el.dataset.id); location.hash = `#/compare/${S.compare.join(",")}`; },
  "compare-clear": () => { S.compare = []; location.hash = "#/cards"; },
  "share-compare": () => copy(new URL(`#/compare/${parseHash().arg || S.compare.join(",")}`, document.baseURI).href, "comparison link"),
  "toggle-table": el => { const box = $(`#chart-${el.dataset.target}`); const on = el.getAttribute("aria-pressed") !== "true"; el.setAttribute("aria-pressed", on);
    el.textContent = on ? "Chart" : "Table"; $(".view-chart", box).hidden = on; $(".view-table", box).hidden = !on; },
  "stats-filter": el => setParams({ [el.dataset.key]: el.value }),
  "version-pick": el => { const id = parseHash().arg, c = S.byId.get(id); if (c) { showVersion(c, +el.dataset.i); if (c.hv && !c.history) loadHistory().then(() => showVersion(c, +el.dataset.i), () => {}); } },
  "toggle-filters": () => { S.filtersOpen = !S.filtersOpen; $(".filters")?.classList.toggle("open", S.filtersOpen); },
  ...editor.actions,
};
document.addEventListener("click", e => {
  if (e.target.closest("a.details-link")) return;     // the browser follows it
  const a = e.target.closest("[data-action]");
  if (a && a.tagName !== "SELECT" && !(a.tagName === "INPUT" && a.type === "checkbox")) { e.preventDefault(); e.stopPropagation(); actions[a.dataset.action]?.(a); return; }
  const open = e.target.closest("[data-open], .chart [data-card]");
  if (open && editing() && (e.shiftKey || e.ctrlKey || e.metaKey) && open.closest(".browse .grid")) { e.preventDefault(); toggleSelect(open.dataset.open, e.shiftKey); return; }
  if (open) { e.preventDefault(); location.hash = `#/card/${open.dataset.open || open.dataset.card}`; return; }
  const ref = e.target.closest("a.card-ref");
  if (ref) { e.preventDefault(); location.hash = `#/card/${ref.dataset.card}`; return; }
  const scroll = e.target.closest("[data-scroll]");
  if (scroll) { e.preventDefault(); document.getElementById(scroll.dataset.scroll)?.scrollIntoView({ behavior: "smooth" }); return; }
  if (e.target === modal) actions.close();
});
document.addEventListener("change", e => {
  const a = e.target.closest("[data-action]");
  if (a && (a.tagName === "SELECT" || a.type === "checkbox")) actions[a.dataset.action]?.(a);
});

// search box
const runSearch = debounce(() => {
  const name = parseHash().name;
  if (name === "rules") { setParams({ q: qInput.value }); return; }
  if (name !== "cards") { location.hash = `#/cards?q=${encodeURIComponent(qInput.value)}`; return; }
  setParams({ q: qInput.value });
}, 160);
qInput.addEventListener("input", runSearch);
$("#search-form").addEventListener("submit", e => { e.preventDefault(); const l = S.list; if (l.length === 1) location.hash = `#/card/${l[0].id}`; });
$("#search-help").addEventListener("click", () => showDialog(`<h3>Search syntax</h3><p class="muted">The bot's /query_ability syntax, plus names and aliases.</p>
  <table class="help-table">${SEARCH_HELP.map(([q, d]) => `<tr><td><code>${esc(q)}</code></td><td>${esc(d)}</td></tr>`).join("")}</table>`));
$("#random").addEventListener("click", () => actions["random-from-list"]());
$("#theme").addEventListener("click", () => { const t = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = t; localStorage.setItem("theme", t); if (parseHash().name === "stats") renderView(parseHash(), location.hash); });
const showKeys = () => showDialog(`<h3>Keyboard shortcuts</h3><table class="help-table">${[["/", "Search"], ["Esc", "Close / clear"], ["← →", "Previous / next card (on the Changes tabs: the next tab)"], ["d", "Add to / remove from deck"],
  ["c", "Copy card link"], ["s", "Share"], ["x", "Add to comparison"], ["e", editing() ? "Edit the card (all fields)" : "Edit the card"], ["↑ ↓", "Move through image versions"], ["r", "Random card"], ["1–6", "Cards · Rulebook · Deck · Stats · Changes · People"], ["?", "This help"]].map(([k, d]) => `<tr><td><span class="kbd">${k}</span></td><td>${d}</td></tr>`).join("")}</table>`);
$("#keys").addEventListener("click", showKeys);
$("#account").addEventListener("click", () => actions["edit-hub"]());

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
  const ae = document.activeElement, typing = /INPUT|TEXTAREA|SELECT/.test(ae?.tagName) || !!ae?.isContentEditable || !!ae?.closest?.(".segs[data-inline], .star-pick, .type-palette");   // the inline controls are inputs; stat rows and stars take the arrows
  if (e.key === "Escape") { if (!modal.hidden) actions.close(); else if (typing) ae.blur(); else if (S.selected.size) { S.selected.clear(); inline.reflect(view, S.selected); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Enter" && ae?.dataset?.open && (modal.hidden || modal.contains(ae)) && !$("#edit-form", modal)) { location.hash = `#/card/${ae.dataset.open}`; return; }   // as a click: the profile editor's tiles too
  if ($("#edit-form")) return;                                                         // no single-key shortcuts while a form (card dialog, profile editor) is up
  const inCard = !modal.hidden && parseHash().name === "card", id = parseHash().arg;
  if (e.key === "/") { e.preventDefault(); qInput.focus(); qInput.select(); }
  else if (e.key === "?") showKeys();
  else if (e.key === "r") actions["random-from-list"]();
  else if (/^[1-6]$/.test(e.key) && modal.hidden) location.hash = ["#/cards", "#/rules", "#/deck", "#/stats", "#/changes", "#/users"][+e.key - 1];
  else if (inCard && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { const link = $(`[data-nav="${e.key === "ArrowLeft" ? "prev" : "next"}"]`, modal); if (link) location.hash = link.getAttribute("href"); }
  else if (inCard && e.key === "d") toggleDeck(id);
  else if (inCard && e.key === "c") copy(shareUrl(id), "link: paste it in Discord");
  else if (inCard && e.key === "s") openShare(id);
  else if (inCard && e.key === "x") actions["compare-add"]({ dataset: { id } });
  else if (inCard && e.key === "e") { e.preventDefault(); editor.open(id); }
});

// tooltips: [data-tip] text, [data-v]+[data-l] chart values, card links show a preview; when they go: tip.js
function fillTip(t) {
  if (t.dataset.v !== undefined) {
    const v = document.createElement("div"); v.className = "v"; v.textContent = t.dataset.v;
    const l = document.createElement("div"); l.textContent = t.dataset.l || ""; tip.replaceChildren(v, l);
  } else if (t.matches("a.card-ref, .chart [data-card]")) {
    const c = S.byId.get(t.dataset.card);
    if (!c) return false;
    tip.replaceChildren();
    if (c.img) { const im = document.createElement("img"); im.src = thumbUrl(c); im.alt = ""; tip.append(im); }
    const n = document.createElement("div"); n.className = "v"; n.textContent = c.name; tip.append(n);
  } else tip.textContent = t.dataset.tip;
}
const tips = tipController({ fill: fillTip, show: () => { tip.hidden = false; }, hide: () => { tip.hidden = true; } });
function hideTip() { tips.hide(); }
inline.extend({ hideTip, icons: () => S.icons });           // editors hide the tooltip; the type palette's icons
document.addEventListener("pointerover", e => tips.over(e.target));
document.addEventListener("pointermove", e => {
  if (!tips.move()) return;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
});
document.addEventListener("pointerout", e => tips.out(e.relatedTarget));

init();
passes.migrate().catch(() => {});                       // passphrases remembered in plain text before 2026-10-23: sealed now
