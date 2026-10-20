// Editing: staged in a batch, published as one commit to the card repo.
import { esc } from "./text.js";

const API = "https://api.github.com";
const K = { token: "edit-token", stage: "edit-stage", sent: "edit-sent", hidden: "edit-show-hidden" };
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
// where a field's unedited value comes from: the PSD, the card's folder, or nowhere (a database-only default)
const FROM = { name: "PSD", stars: "PSD", types: "PSD", hp: "PSD", def: "PSD", atk: "PSD", spd: "PSD", ability: "PSD", creatures: "PSD",
  type: "folder", subtype: "folder", series: "folder" };
const show = v => (v == null || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.map(x => (typeof x === "object" ? STATS.map(k => x[k] ?? "—").join("/") : x)).join(", ") : "—")
  : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

// Card Edits.json with the ops applied: keys sorted, fields in ORDER, one line per card
export function editsFile(text, ops, at, by, path = "MDW/Card Edits.json") {
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
    const fields = [...ORDER.filter(f => f in cur), ...Object.keys(cur).filter(f => !(f in FIELDS))];
    if (fields.length) data.cards[k] = { ...Object.fromEntries(fields.map(f => [f, cur[f]])), _by: by, _at: at };
  }
  const keys = Object.keys(data.cards).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const rest = Object.entries(data).filter(([k]) => k !== "cards").map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const body = keys.map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(data.cards[k])}`).join(",\n");
  return `{\n${rest.join("\n")}${rest.length ? "\n" : ""}  "cards": {${keys.length ? `\n${body}\n  ` : ""}}\n}\n`;
}

export function createEditor(app) {
  const { S } = app;
  let token = localStorage.getItem(K.token) || sessionStorage.getItem(K.token) || "";
  let me = null;                                   // { login, admin, push }
  let stage = { cards: {}, people: {}, admins: null, ...load(K.stage, {}) };
  const pristine = new Map();                      // id -> card as built
  const based = new Map();                         // id -> card with published-but-not-built edits
  let pristineBan = null;
  const files = () => ({ edits: "MDW/Card Edits.json", authors: "MDW/Card Authors.txt", banlist: "MDW/Constructed Ban List.txt", admins: "MDW/Website Admins.txt", ...S.data.files });
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
  // files: {path: oldText => newText}; retried on top if someone pushed meanwhile
  async function commitFiles(edits, message) {
    const repo = S.data.repo, branch = S.data.branch || "main";
    for (let attempt = 0; ; attempt++) {
      const head = (await gh(`/repos/${repo}/git/ref/heads/${branch}`)).object.sha;
      const base = await gh(`/repos/${repo}/git/commits/${head}`);
      const tree = [];
      for (const [path, edit] of Object.entries(edits)) {
        const old = await readFile(path, head), next = edit(old);
        if (next != null && next !== old) tree.push({ path, mode: "100644", type: "blob", content: next });
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
  }
  function signOut() { token = ""; me = null; localStorage.removeItem(K.token); sessionStorage.removeItem(K.token); }

  // ---- preview: staged and just-published changes applied to the loaded cards
  const snap = c => { if (c && !pristine.has(c.id)) pristine.set(c.id, structuredClone(c)); };
  const baseOf = c => based.get(c.id) || pristine.get(c.id) || c;
  const byKey = k => S.all.find(c => cardKey(c.key) === cardKey(k)) || S.all.find(c => cardKey(c.name) === cardKey(k));
  const tidy = (f, v) => (FIELDS[f] === "bool" ? !!v : FIELDS[f] === "list" ? v || [] : f === "dup_of" ? v || ""
    : f === "creatures" ? (v?.length > 1 ? v.map(x => Object.fromEntries(STATS.map(k => [k, x[k] ?? null]))) : null) : v ?? null);
  const psdValue = (b, f) => tidy(f, b.edited?.includes(f) ? (f === "aliases" ? [] : b.orig?.[f]) : value(b, f));
  function value(c, f) {
    if (f === "aliases") return c.webAliases || [];
    if (f === "dup_of") return c.dup ? S.byId.get(c.dup)?.key || "" : "";
    return tidy(f, c[f]);
  }
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
    for (const f of op.unset || []) setField(c, f, psdValue(b, f));
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
  function sentOps() {
    const sent = load(K.sent, null);
    if (!sent) return [];
    if (new Date(S.data.generated) > new Date(sent.at)) { localStorage.removeItem(K.sent); return []; }   // live now
    return sent.ops;
  }
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
  const count = () => Object.keys(stage.cards).length + Object.keys(stage.people).length + (stage.admins ? 1 : 0);

  // ---- the edit form
  const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
  const uniq = f => [...new Set(S.all.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const subseriesOpts = series => {          // that series' subseries first, then all
    const own = uniq(x => (x.series === series ? x.subseries : null));
    return [...own, ...uniq(x => x.subseries).filter(v => !own.includes(v))].map(v => `<option value="${esc(v)}">`).join("");
  };
  const isRule = c => (S.rules || []).includes(c);
  function ruleFormHtml(c) {
    const b = baseOf(c);
    const reset = f => { const p = psdValue(b, f); return same(value(c, f), p) ? "" : `<button type="button" class="ghost reset" data-reset="${f}" title="Back to what the page says">↺ Page: ${esc(show(p))}</button>`; };
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
    const reset = f => { const p = psdValue(b, f), src = FROM[f]; return same(value(c, f), p) ? "" : `<button type="button" class="ghost reset" data-reset="${f}" title="${src ? `Back to what the ${src} says` : "Remove the edit"}">↺ ${src ? src[0].toUpperCase() + src.slice(1) : "Default"}: ${esc(show(p))}</button>`; };
    const row = (f, input) => `<div class="erow" data-row="${f}"><label for="ef-${f}">${LABEL[f]}</label><div class="ein">${input}${reset(f)}</div></div>`;
    const num = f => `<input id="ef-${f}" type="number" min="0" max="99" step="1" value="${c[f] ?? ""}" placeholder="—">`;
    return `<div class="dialog edit-dialog" role="dialog" aria-modal="true" aria-label="Edit ${esc(c.name)}">
      <button type="button" class="ghost icon close" data-action="edit-cancel" aria-label="Cancel">✕</button>
      <h2>Edit ${esc(c.name)}</h2>
      <p class="muted">Changes go into your batch; publish the batch when you're done. <span class="kbd">${esc(c.key)}</span></p>
      <form id="edit-form" class="edit-form" autocomplete="off">
        <h3 class="egroup">On the card image</h3><p class="muted egroup-note">Printed on the card, read from the PSD.</p>
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
          ${row("series", `<input id="ef-series" list="dl-series" value="${esc(c.series || "")}" placeholder="—"><datalist id="dl-series">${uniq(x => x.series).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`)}
          ${row("subseries", `<input id="ef-subseries" list="dl-subseries" value="${esc(c.subseries || "")}" placeholder="—"><datalist id="dl-subseries">${subseriesOpts(c.series)}</datalist>`)}
        </fieldset>
        <fieldset><legend>Notes, names and credit</legend>
          ${row("note", `<textarea id="ef-note" rows="2" placeholder="Rulings or errata, shown on the card page">${esc(c.note || "")}</textarea>`)}
          ${row("aliases", `<input id="ef-aliases" value="${esc((c.webAliases || []).join(", "))}" placeholder="comma separated">${(c.aliases || []).filter(a => !(c.webAliases || []).includes(a)).length ? `<span class="muted">Bot aliases: ${esc(c.aliases.filter(a => !(c.webAliases || []).includes(a)).join(", "))}</span>` : ""}`)}
          <div class="erow" data-row="author"><label for="ef-author">Author</label><div class="ein">${isDup ? `<span class="muted">Same as the original</span>` : `<input id="ef-author" list="dl-people" value="${esc(c.author || "")}"><datalist id="dl-people">${(S.data.people || []).map(p => `<option value="${esc(p)}">`).join("")}</datalist>`}</div></div>
          ${row("dup_of", `<input id="ef-dup_of" list="dl-cards" value="${esc(value(c, "dup_of"))}" placeholder="not a duplicate"><datalist id="dl-cards">${S.all.filter(x => x.id !== c.id && !x.dup).map(x => `<option value="${esc(x.key)}">${esc(x.name)}</option>`).join("")}</datalist>`)}
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
    const all = {
      name: () => f("name").value.trim() || b.name, type: () => f("type").value, subtype: () => str("subtype"), series: () => str("series"), subseries: () => str("subseries"), stars: () => int("stars"),
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
      const pub = value(b, k);
      if (same(v, pub) || (typeof v === "string" && typeof pub === "string" && v === pub.replace(/\r/g, "").trim())) continue;   // as published
      if (same(v, psdValue(b, k)) && b.edited?.includes(k)) op.unset.push(k);
      else op.set[k] = v;
    }
    if (f("author") && f("author").value.trim() !== (b.author || "")) op.author = f("author").value.trim() || null;
    if (f("banned")) {
      const ban = { banned: f("banned").checked, group: f("ban-group").value, reason: f("ban-reason").value.trim() };
      const was = banOf(c.id, pristineBan || S.data.banlist);
      if (ban.banned !== was.banned || (ban.banned && (ban.group !== was.group || ban.reason !== was.reason))) op.ban = ban;
    }
    return op;
  }
  const opEmpty = op => !Object.keys(op.set).length && !op.unset.length && op.author === undefined && !op.ban;
  function describe(op) {
    const b = find(op.id) ? baseOf(find(op.id)) : {};
    const out = Object.entries(op.set).map(([k, v]) => `${LABEL[k]}: ${show(value(b, k))} → ${show(v)}`);
    const src = k => (isRule(find(op.id)) ? "the page" : FROM[k] ? `the ${FROM[k]}` : "the default");
    for (const k of op.unset) out.push(`${LABEL[k]}: back to ${src(k)} (${show(psdValue(b, k))})`);
    if (op.author !== undefined) out.push(`Author → ${op.author || "(from git)"}`);
    if (op.ban) out.push(op.ban.banned ? `Banned: ${op.ban.group}, ${op.ban.reason || "no reason"}` : "Unbanned");
    return out;
  }
  function openForm(id) {
    const c = find(id);
    if (!c) return;
    if (!me) { openHub(`Sign in to edit ${c.name}.`, id); return; }
    app.modal.innerHTML = formHtml(c);
    app.modal.hidden = false; document.body.style.overflow = "hidden"; app.modal.scrollTop = 0;
    const form = document.getElementById("edit-form"), ta = document.getElementById("ef-ability");
    const ser = document.getElementById("ef-series"), dl = document.getElementById("dl-subseries");
    if (ser && dl) ser.addEventListener("input", () => { dl.innerHTML = subseriesOpts(ser.value.trim()); });
    const update = () => {
      document.getElementById("ef-preview").innerHTML = ta.value.trim() ? app.render(ta.value, c.name) : `<span class="muted">No ability text.</span>`;
      const lines = describe(readForm(c));
      document.getElementById("ef-summary").innerHTML = lines.length ? `<b>${lines.length} change${lines.length > 1 ? "s" : ""}:</b> ${lines.map(esc).join(" · ")}` : "No changes yet.";
      form.dataset.dirty = lines.length ? "1" : "";
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
      if (opEmpty(op)) delete stage.cards[c.id]; else stage.cards[c.id] = op;
      save();
      app.toast(opEmpty(op) ? "No changes" : `Added to the batch: ${count()} unpublished`);
      if (isRule(c)) { app.closeModal(); app.rerender(); } else app.goCard(c.id);
    });
    update();
    document.getElementById(isRule(c) ? "ef-ability" : "ef-name").focus();
  }
  function resetField(c, f) {
    const p = psdValue(baseOf(c), f), el = document.getElementById(`ef-${f}`);
    if (f === "types") { for (const t of document.querySelectorAll("#ef-types [data-type]")) { const on = (p || []).includes(t.dataset.type); t.classList.toggle("on", on); t.setAttribute("aria-pressed", on); } return; }
    if (f === "creatures") { document.getElementById("ef-creatures").innerHTML = (p || []).map(creatureRow).join(""); if (!p) creatureAction("remove"); return; }
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!p;
    else el.value = Array.isArray(p) ? p.join(", ") : p ?? "";
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
    const names = ops.map(o => o.name);
    const what = [...names, ...(Object.keys(people).length ? ["people"] : []), ...(stage.admins ? ["admins"] : [])];
    const sha = await commitFiles(edits, message || (what.length > 3 ? `Website edits: ${what.length} changes` : `Website edit: ${what.join(", ")}`));
    localStorage.setItem(K.sent, JSON.stringify({ at, sha, ops: [...sentOps(), ...ops] }));
    if (stage.admins) S.data.admins = stage.admins;
    stage = { cards: {}, people: {}, admins: null };
    save();
    return sha;
  }

  // ---- batch tray and hub
  function renderBar() {
    let bar = document.getElementById("edit-bar");
    const n = count(), sending = sentOps().length;
    if (!n && !sending) { bar?.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "edit-bar"; bar.className = "edit-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Unpublished edits"); document.body.append(bar); }
    bar.innerHTML = n
      ? `<span>✎ <b>${n}</b> unpublished change${n > 1 ? "s" : ""}</span><button type="button" class="primary" data-action="edit-review">Review and publish</button><button type="button" class="ghost" data-action="edit-discard-all">Discard</button>`
      : `<span class="muted">Published edits show here until the site rebuilds (a few minutes).</span><button type="button" class="ghost" data-action="edit-dismiss-sent">OK</button>`;
  }
  function reviewHtml(note = "") {
    const ops = Object.values(stage.cards), people = Object.entries(stage.people);
    return `<h3>Unpublished changes</h3>
      ${ops.map(op => `<div class="review-item"><div><a href="#/card/${op.id}"><b>${esc(op.name)}</b></a><ul>${describe(op).map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>
        <div class="actions"><button type="button" class="ghost" data-action="edit-card" data-id="${op.id}">Edit</button><button type="button" class="ghost" data-action="edit-discard" data-id="${op.id}">Discard</button></div></div>`).join("")}
      ${stage.admins ? `<div class="review-item"><div><b>Admins</b><ul><li>${esc(stage.admins.join(", "))}</li></ul></div><div class="actions"><button type="button" class="ghost" data-action="edit-discard-admins">Discard</button></div></div>` : ""}
      ${people.length ? `<div class="review-item"><div><b>People</b><ul>${people.map(([g, d]) => `<li>${esc(g)} shown as ${esc(d)}</li>`).join("")}</ul></div><div class="actions"><button type="button" class="ghost" data-action="edit-discard-people">Discard</button></div></div>` : ""}
      ${count() ? `<label class="muted" for="edit-msg">Commit message (optional)</label><input id="edit-msg" class="wide" placeholder="Website edits">
        <div class="actions"><button type="button" class="primary" data-action="edit-publish">Publish ${count()} change${count() > 1 ? "s" : ""}</button></div>
        <p class="muted">One commit to ${esc(S.data.repo)} (${esc(S.data.branch || "main")}). The site rebuilds in a few minutes; the bot reads it on /update_stats.</p>` : `<p class="muted">Nothing to publish.</p>`}
      <p class="muted" id="edit-status" aria-live="polite">${esc(note)}</p>`;
  }
  function hubHtml(note = "", then = "") {
    if (!me) return `<h3>Sign in to edit</h3>${note ? `<p>${esc(note)}</p>` : ""}
      <p class="muted">Anyone with write access to ${esc(S.data.repo)} can edit. Edits are batched and published as one commit, which the website and the bot both read.</p>
      <ol class="muted"><li><a href="https://github.com/settings/tokens/new?scopes=public_repo&description=Impossibility%20Simulator%20card%20browser" target="_blank" rel="noopener">Create a GitHub token</a> with only <code>public_repo</code> ticked.</li><li>Paste it here.</li></ol>
      <form id="signin-form" data-then="${esc(then)}"><input id="signin-token" class="wide" type="password" placeholder="ghp_…" autocomplete="off" required>
        <label class="check"><input id="signin-remember" type="checkbox" checked> remember on this device</label>
        <div class="actions"><button type="submit" class="primary">Sign in</button></div><p class="muted" id="signin-status" aria-live="polite"></p></form>
      <p class="muted">The token stays in this browser and is only sent to api.github.com.</p>`;
    return `<h3>Editing as ${esc(me.login)} <span class="fact">${me.admin ? "Admin" : "Editor"}</span></h3>${note ? `<p>${esc(note)}</p>` : ""}
      <p class="muted">Open a card and press Edit (e). Changes wait in your batch until you publish them.</p>
      <div class="actions"><button type="button" data-action="edit-review"${count() ? "" : " disabled"}>Review batch (${count()})</button>
        <label class="check"><input type="checkbox" data-action="edit-show-hidden"${S.showHidden ? " checked" : ""}> show hidden cards</label></div>
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
  function openHub(note = "", then = "") {
    app.showDialog(hubHtml(note, then));
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
          if (form.dataset.then) openForm(form.dataset.then); else openHub();
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
    "edit-cancel": () => {
      const form = document.getElementById("edit-form");
      if (form?.dataset.dirty && !confirm("Discard these changes?")) return;
      const id = app.currentCard(); if (id) app.goCard(id); else app.closeModal();
    },
    "edit-review": () => app.showDialog(reviewHtml()),
    "edit-discard": el => { delete stage.cards[el.dataset.id]; save(); app.showDialog(reviewHtml("Discarded.")); app.rerender(); },
    "edit-discard-people": () => { stage.people = {}; save(); app.showDialog(reviewHtml("Discarded.")); },
    "edit-discard-admins": () => { stage.admins = null; save(); app.showDialog(reviewHtml("Discarded.")); },
    "edit-discard-all": () => { if (!confirm(`Discard ${count()} unpublished change${count() > 1 ? "s" : ""}?`)) return; stage = { cards: {}, people: {}, admins: null }; save(); app.rerender(); },
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
      if (token) signIn(token, !!localStorage.getItem(K.token)).then(() => { app.derive(); app.rerender(); }, () => {});
    },
    open: openForm,
    refresh: preview,
  };
}
