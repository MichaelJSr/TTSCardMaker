// The Table tab: the Tabletop Simulator save's decks and bags; deck edits are staged and published to the card repo.
import { esc, norm } from "./text.js";
import { SAVE_PATH, RULES_PATH, parse, dump, clone, walk, index, isCard, isBag, entry, facePath, pos, urlPath, randomGuid, applyOps, synced, fixRules } from "./tts.js";

const K = { stage: "table-stage" };
// rule kinds in TTS/decks.json, in the game's words
const KINDS = [["creatures", "Creatures"], ["items", "Items"], ["fields", "Field cards"], ["nme", "N.M.E"], ["minions", "Minions"],
  ["status_effects", "Status effects"], ["auxiliary_items", "Auxiliary items"], ["morgue", "The Morgue"], ["", "Other decks"]];
const INSTALL = "Documents/My Games/Tabletop Simulator/Saves/";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const mb = n => `${(n / 1048576).toFixed(1)} MB`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function createTable(app) {
  const { S, view } = app;
  let stage = load(K.stage, []);                   // staged edits (see tts.js), kept apart from the card-edit batch
  const T = { doc: null, rules: { decks: {}, bags: {} }, size: 0, at: null, ref: null, view: null, ix: null, marks: new Map(), skipped: [], fix: null, p: null };
  const me = () => app.editor.me;
  const branch = () => S.data.branch || "main";    // the branch publish commits to
  const rawUrl = (path, ref = branch()) => `https://raw.githubusercontent.com/${S.data.repo}/${ref}/${urlPath(path)}`;

  // ---- loading: only when the tab opens (5.5 MB); the raw CDN lags a commit by up to 5 minutes
  function loadSave(ref) {
    return (T.p ||= (async () => {
      const [save, rules] = await Promise.all([fetch(rawUrl(SAVE_PATH, ref), { cache: "no-store" }), fetch(rawUrl(RULES_PATH, ref), { cache: "no-store" }).catch(() => null)]);
      if (!save.ok) throw new Error(`HTTP ${save.status}`);
      const text = await save.text();
      T.doc = parse(text); T.size = new Blob([text]).size; T.at = new Date(); T.ref = ref;
      T.rules = { decks: {}, bags: {} };
      try { if (rules?.ok) T.rules = { decks: {}, bags: {}, ...parse(await rules.text()) }; } catch { /* rules are optional */ }
      refresh();
    })().catch(e => { T.p = null; throw e; }));
  }
  const reload = (ref = branch()) => { T.p = null; T.doc = null; return loadSave(ref); };

  // ---- the loaded save with the staged edits applied
  function refresh() {
    if (!T.doc) return;
    T.view = stage.length ? clone(T.doc) : T.doc;        // the pristine save is kept for discards
    const r = applyOps(T.view, stage, { raw: S.data.raw });
    T.marks = r.marks; T.skipped = r.skipped; T.ix = index(T.view); T.fix = fixRules(T.rules, r.applied, T.view);
  }
  const freshGuid = () => { for (;;) { const g = randomGuid(); if (!T.ix.guids.has(g)) return g; } };   // unused in the save and the staged edits
  const count = () => { const el = document.getElementById("table-count"); if (el) el.textContent = stage.length ? String(stage.length) : ""; };
  const save = () => { localStorage.setItem(K.stage, JSON.stringify(stage)); refresh(); count(); app.rerender(); };
  const push = op => { stage.push({ id: uid(), ...op }); save(); return T.fix?.notes.get(stage[stage.length - 1]); };
  const describe = op => ({
    move: `Move ${op.name} from ‘${op.deckName}’ to ‘${op.toName}’`, copy: `Copy ${op.name} from ‘${op.deckName}’ to ‘${op.toName}’`,
    remove: `Remove ${op.name} from ‘${op.deckName}’`, add: `Add ${op.name} to ‘${op.deckName}’`, rename: `Rename ‘${op.deckName}’ to ‘${op.name}’`,
    up: `Move ${op.name} up in ‘${op.deckName}’`, down: `Move ${op.name} down in ‘${op.deckName}’`,
  }[op.t] || op.t);
  function message(ops) {
    const n = (t, word) => { const k = ops.filter(o => o.t === t).length; return k ? `${plural(k, word[0])} ${word[1]}` : ""; };
    const re = ops.filter(o => o.t === "up" || o.t === "down").length;
    const parts = [n("move", ["card", "moved"]), n("copy", ["card", "copied"]), n("add", ["card", "added"]), n("remove", ["card", "removed"]), n("rename", ["deck", "renamed"]),
      re ? `${plural(re, "card")} reordered` : ""].filter(Boolean);
    return `TTS table: ${parts.join(", ") || "edited"}`;
  }

  // ---- save card -> website card: by the face's repo path, else by name
  let byPng = null, byName = null;
  function siteCard(card) {
    if (!byPng) {
      byPng = new Map(); byName = new Map();
      for (const c of S.all) { if (c.png) byPng.set(c.png, c); byName.set(norm(c.name), c); for (const a of c.aliases || []) if (!byName.has(norm(a))) byName.set(norm(a), c); }
    }
    const p = facePath(card);
    return (p && byPng.get(p)) || (card.Nickname && byName.get(norm(card.Nickname))) || null;
  }

  // ---- labels
  const nameOf = o => o.Nickname || "(unnamed)";
  const deckOf = guid => T.ix.decks.get(guid)?.deck;
  const kindOf = guid => { const k = T.rules.decks[guid]?.rule?.kind || ""; return KINDS.some(([x]) => x === k) ? k : ""; };
  function ruleText(rule) {
    if (!rule) return "";
    const kind = KINDS.find(([k]) => k === rule.kind)?.[1] || rule.kind || "?", stars = (rule.stars || []).join("/");
    return `${kind}${stars ? ` ${stars}★` : ""}${rule.subtype ? ` ${rule.subtype}` : ""}${rule.partial ? " (hand-picked)" : ""}${rule.count > 1 ? ` ×${rule.count}` : ""}`;
  }
  function where(o, parents) {        // decks.json's label (nearest named tile, as the audit did), else computed here
    if (parents.length) return `in bag ‘${nameOf(parents[parents.length - 1])}’`;
    const w = T.rules.decks[o.GUID]?.where || T.rules.bags[o.GUID]?.where;
    if (w && w !== "table") return w;
    const p = pos(o);
    let best = null, dist = Infinity;
    for (const t of T.view.ObjectStates) {
      if (t === o || !t.Nickname || !/^Custom_(Tile|Board)$/.test(t.Name)) continue;
      const q = pos(t), d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < dist) { dist = d; best = t; }
    }
    return best && dist < 40 ? `near ‘${best.Nickname}’` : `at x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)}`;
  }
  const faces = deck => { const m = new Map(); for (const c of deck.ContainedObjects || []) { const k = facePath(c) || c.GUID; m.set(k, (m.get(k) || 0) + 1); } return m; };
  const sig = deck => (deck.ContainedObjects || []).map(c => facePath(c) || c.Nickname).sort().join("\n");
  function copiesOf(deck, sigs) {      // other decks with the same cards
    if (!(deck.ContainedObjects || []).length) return [];
    return [...T.ix.decks.values()].map(d => d.deck).filter(d => d !== deck && sigs.get(d) === sigs.get(deck));
  }
  const deckLink = d => `<a href="#/table/${esc(d.GUID)}" data-action="table-open" data-guid="${esc(d.GUID)}">${esc(nameOf(d))}</a>`;   // its own action: rows have one too

  // ---- views
  function render(r) {
    if (!T.doc) {
      view.innerHTML = `<div class="loading">Loading the Tabletop Simulator save (about 5 MB)…</div>`;
      loadSave(T.ref || branch()).then(() => { if (app.onTable()) app.rerender(); },
        e => { if (app.onTable()) view.innerHTML = `<div class="empty">Couldn't load the save (${esc(e.message)}). <button type="button" class="ghost" data-action="table-reload">Retry</button></div>`; });
      return;
    }
    if (r.arg) renderDeck(r.arg); else renderOverview();
  }
  function headHtml() {
    const objects = [...walk(T.view.ObjectStates)], cards = objects.filter(([o]) => isCard(o)).length;
    return `<section class="panel"><h3>Tabletop Simulator table</h3>
      <p>The game's save as the bot keeps it on ${esc(branch())}: <a href="${esc(rawUrl(SAVE_PATH))}" download="Impossibility Simulator.json">Impossibility Simulator.json</a> <span class="muted">(${mb(T.size)})</span>.
        <span class="muted">Install: put it in ${esc(INSTALL)} and load it from Games → Save &amp; Load.</span></p>
      <p class="muted">${plural(T.ix.decks.size, "deck")}, ${plural(cards, "card")}, ${plural(objects.length, "object")} · loaded ${T.at.toLocaleTimeString()}${T.ref === branch() ? "" : ` from commit ${esc(T.ref.slice(0, 7))}`}
        <button type="button" class="ghost" data-action="table-reload">Reload</button>${me() ? "" : ` · <a href="#" data-action="edit-hub">Sign in</a> to edit decks`}</p></section>`;
  }
  function stageHtml() {
    if (!stage.length) return "";
    const skipped = new Map(T.skipped.map(s => [s.op.id, s.why])), notes = T.fix.notes;
    return `<section class="panel" id="table-stage"><h3>Unpublished table changes <span class="muted">${stage.length}</span></h3>
      ${stage.map(op => `<div class="review-item"><div>${esc(describe(op))}${skipped.has(op.id) ? ` <span class="fact banned">no longer applies: ${esc(skipped.get(op.id))}</span>` : ""}${notes.has(op) ? ` <span class="fact">${esc(notes.get(op))}</span>` : ""}</div>
        <div class="actions"><button type="button" class="ghost" data-action="table-discard" data-id="${esc(op.id)}">Discard</button></div></div>`).join("")}
      <label class="muted" for="table-msg">Commit message (optional)</label><input id="table-msg" class="wide" placeholder="${esc(message(stage))}">
      <div class="actions"><button type="button" class="primary" data-action="table-publish"${me() ? "" : " disabled"}>Publish ${plural(stage.length, "change")}</button>
        <button type="button" class="ghost" data-action="table-discard-all">Discard all</button></div>
      <p class="muted">${me() ? `One commit to ${esc(S.data.repo)}: the latest save is fetched, the changes re-applied to it and the file written as TTS writes it.` : "Sign in (pencil button) to publish."}
        ${T.fix.changed ? ` The bot keeps decks with a rule in step with ${esc(RULES_PATH)}, so the same commit updates it (${plural(T.fix.changed, "change")}) to keep these edits.` : ""}</p>
      <p class="muted table-status" aria-live="polite"></p></section>`;
  }
  function renderOverview() {
    const all = [...T.ix.decks.values()], sigs = new Map(all.map(d => [d.deck, sig(d.deck)]));
    const row = ({ deck, parents }) => `<tr class="row" data-action="table-open" data-guid="${esc(deck.GUID)}"><td>${deckLink(deck)}</td><td class="muted">${esc(where(deck, parents))}</td>
      <td class="num">${(deck.ContainedObjects || []).length}</td><td>${esc(ruleText(T.rules.decks[deck.GUID]?.rule))}</td><td>${copiesOf(deck, sigs).map(deckLink).join(", ")}</td></tr>`;
    const groups = KINDS.map(([k, label]) => [label, all.filter(d => kindOf(d.deck.GUID) === k)]).filter(([, l]) => l.length);
    const bags = [...walk(T.view.ObjectStates)].filter(([o]) => isBag(o));
    view.innerHTML = `<div class="table-page">${headHtml()}${stageHtml()}
      ${groups.map(([label, list]) => `<section class="panel"><h3>${esc(label)} <span class="muted">${list.length}</span></h3>
        <div class="scroll-x"><table class="data"><thead><tr><th>Deck</th><th>Where</th><th class="num">Cards</th><th>Rule</th><th>Copies</th></tr></thead><tbody>${list.map(row).join("")}</tbody></table></div></section>`).join("")}
      <section class="panel"><h3>Bags <span class="muted">${bags.length}</span></h3><p class="muted">Read-only, except the decks inside them.</p>${bags.map(([b, parents]) => bagHtml(b, parents)).join("")}</section></div>`;
  }
  function bagHtml(bag, parents) {
    const items = bag.ContainedObjects || [];
    const decks = items.filter(o => o.Name === "Deck"), cards = items.filter(isCard), rest = items.filter(o => o.Name !== "Deck" && !isCard(o));
    const tally = list => { const m = new Map(); for (const o of list) { const k = o.Nickname || o.Name; m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([k, n]) => `${esc(k)}${n > 1 ? ` ×${n}` : ""}`).join(", "); };
    return `<details class="bag"><summary><b>${esc(nameOf(bag))}</b> <span class="muted">${esc(bag.Name.replace(/_/g, " "))} · ${esc(where(bag, parents))} · ${plural(items.length, "object")}</span></summary>
      ${decks.length ? `<p>Decks: ${decks.map(d => `${deckLink(d)} <span class="muted">(${(d.ContainedObjects || []).length})</span>`).join(", ")}</p>` : ""}
      ${cards.length ? `<p>Cards: <span class="muted">${tally(cards)}</span></p>` : ""}
      ${rest.length ? `<p>Other: <span class="muted">${tally(rest)}</span></p>` : ""}
      ${items.length ? "" : `<p class="muted">Empty.</p>`}</details>`;
  }
  function renderDeck(guid) {
    const d = T.ix.decks.get(guid);
    if (!d) { view.innerHTML = `<div class="empty">No deck ${esc(guid)} in the save. <a href="#/table">Back to the table</a></div>`; return; }
    const { deck, parents } = d, cards = deck.ContainedObjects || [], rule = T.rules.decks[guid]?.rule, editing = !!me(), fc = faces(deck);
    const sigs = new Map([...T.ix.decks.values()].map(x => [x.deck, sig(x.deck)])), copies = copiesOf(deck, sigs);
    const seen = new Map();                  // GUID + face -> cards with them so far (copies share GUIDs; cardAt counts the same way)
    const tiles = cards.map((card, i) => { const k = `${card.GUID}\n${facePath(card)}`, nth = seen.get(k) || 0; seen.set(k, nth + 1); return cardHtml(card, i, cards.length, nth, fc, editing, deck); });
    view.innerHTML = `<div class="table-page">
      <p><a href="#/table">← Table</a>${stage.length ? ` <span class="muted">· ${plural(stage.length, "unpublished table change")}, <a href="#/table">review and publish</a></span>` : ""}</p>
      <section class="panel"><h3>${esc(nameOf(deck))} ${editing ? `<button type="button" class="ghost" data-action="table-rename" data-deck="${esc(guid)}">Rename</button>` : ""}</h3>
        <p class="muted">${esc(where(deck, parents))} · ${plural(cards.length, "card")} (${fc.size} distinct)${rule ? ` · ${esc(ruleText(rule))}` : ""}${copies.length ? ` · copies: ${copies.map(deckLink).join(", ")}` : ""}</p>
        ${synced(rule) && editing ? `<p class="muted">The bot keeps this deck in step with its rule: when you publish, a card whose last copy leaves is excluded from the rule (${esc(RULES_PATH)}) and a card put in that the rule doesn't cover is included.</p>` : ""}
        ${cards.length === 1 ? `<p class="muted">A deck with one card becomes a loose card when TTS loads it.</p>` : ""}
        ${editing ? `<div class="actions"><button type="button" class="primary" data-action="table-add" data-deck="${esc(guid)}">Add a card</button></div>` : ""}
      </section>
      ${cards.length ? `<div class="grid tgrid" style="--tile:150px">${tiles.join("")}</div>` : `<div class="empty">Empty deck.</div>`}</div>`;
  }
  function cardHtml(card, i, n, nth, fc, editing, deck) {
    const c = siteCard(card), mark = T.marks.get(card), copies = fc.get(facePath(card) || card.GUID) || 1;
    const url = entry(card)?.FaceURL || "", png = facePath(card) || "", link = /^https?:\/\//i.test(url) ? url : "";
    const art = c ? app.tileHtml(c, { small: true })
      : `<a class="tile" href="${esc(link)}" target="_blank" rel="noopener" title="${esc(url)}"><img class="art" loading="lazy" decoding="async" src="${esc(link)}" alt=""><div class="meta"><div class="name">${esc(card.Nickname || "(no name)")}</div><div class="sub">${esc(png || url || "no image")}</div></div></a>`;
    const at = `data-deck="${esc(deck.GUID)}" data-card="${esc(card.GUID)}" data-nth="${nth}" data-name="${esc(card.Nickname)}" data-png="${esc(png)}"`;
    return `<div class="tcard${mark ? ` ${mark}` : ""}">${art}
      <div class="tcard-sub"><span class="muted" title="Nickname in TTS">${esc(card.Nickname)}</span>${copies > 1 ? `<span class="fact" data-tip="Copies in this deck">×${copies}</span>` : ""}${mark ? `<span class="fact staged">${mark === "added" ? "New" : "Moved in"}</span>` : ""}</div>
      ${editing ? `<div class="tools"><button type="button" class="ghost icon" data-action="table-up" ${at}${i === 0 ? " disabled" : ""} title="Up">↑</button>
        <button type="button" class="ghost icon" data-action="table-down" ${at}${i === n - 1 ? " disabled" : ""} title="Down">↓</button>
        <button type="button" class="ghost" data-action="table-move" ${at}>Move</button><button type="button" class="ghost" data-action="table-copy" ${at}>Copy</button>
        <button type="button" class="ghost danger" data-action="table-remove" ${at} title="Remove from the deck">✕</button></div>` : ""}</div>`;
  }
  function destDialog(el, t) {
    const from = el.dataset.deck;
    const groups = KINDS.map(([k, label]) => [label, [...T.ix.decks.values()].filter(d => kindOf(d.deck.GUID) === k)]).filter(([, l]) => l.length);
    app.showDialog(`<h3>${t === "move" ? "Move" : "Copy"} ${esc(el.dataset.name)} to…</h3>
      ${groups.map(([label, list]) => `<h4>${esc(label)}</h4><div class="chips">${list.map(({ deck, parents }) => `<button type="button" class="chip" data-action="table-to" data-t="${t}" data-deck="${esc(from)}" data-card="${esc(el.dataset.card)}" data-nth="${esc(el.dataset.nth)}" data-name="${esc(el.dataset.name)}" data-png="${esc(el.dataset.png || "")}" data-to="${esc(deck.GUID)}"${deck.GUID === from && t === "move" ? " disabled" : ""}>${esc(nameOf(deck))} · ${esc(where(deck, parents))}<span class="n">${(deck.ContainedObjects || []).length}</span></button>`).join("")}</div>`).join("")}`);
  }

  // ---- publish: the fresh save from the API, every staged edit re-applied, the same bytes TTS and the bot write
  async function publish(el, force) {
    if (!me()) { app.editor.actions["edit-hub"](); return; }
    const status = el.closest(".dialog, .panel")?.querySelector(".table-status"), msg = document.getElementById("table-msg")?.value.trim();
    el.disabled = true;
    if (status) status.textContent = "Fetching the latest save and publishing…";
    const ops = stage.slice();
    let result = null, fix = null, doc = null;
    try {
      const sha = await app.editor.commit({ [SAVE_PATH]: old => {
        if (old == null) throw new Error(`${SAVE_PATH} is not on ${branch()}`);
        doc = parse(old);
        result = applyOps(doc, ops, { raw: S.data.raw });
        if (result.skipped.length && !force) throw Object.assign(new Error("some changes no longer apply"), { skipped: result.skipped });
        return result.applied.length ? dump(doc) : null;
      }, [RULES_PATH]: old => {                              // the rules follow (the bot reads them fresh from main)
        fix = null;                                            // a 422 retry re-runs this
        if (old == null || !result.applied.length) return null;
        fix = fixRules(parse(old), result.applied, doc);
        return fix.changed ? `${dump(fix.rules)}\n` : null;
      } }, msg || message(ops));
      const done = new Set(ops.map(o => o.id));             // edits staged meanwhile stay
      stage = stage.filter(o => !done.has(o.id));
      if (stage.length) localStorage.setItem(K.stage, JSON.stringify(stage)); else localStorage.removeItem(K.stage);
      count();
      const link = rawUrl(SAVE_PATH, sha || branch());
      app.showDialog(`<h3>Published</h3><p>${sha ? `Commit <a href="https://github.com/${esc(S.data.repo)}/commit/${sha}" target="_blank" rel="noopener">${sha.slice(0, 7)}</a>: ${plural(result.applied.length, "change")} applied${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.` : "Nothing changed on GitHub."}</p>
        ${result.skipped.length ? `<ul>${result.skipped.map(s => `<li>${esc(describe(s.op))}: ${esc(s.why)}</li>`).join("")}</ul>` : ""}
        ${fix?.changed ? `<p class="muted">${esc(RULES_PATH)} updated too (${plural(fix.changed, "change")}), so the bot keeps these edits.</p>` : ""}
        <p>Download: <a href="${esc(link)}" download="Impossibility Simulator.json">Impossibility Simulator.json</a><br><span class="muted">Put it in ${esc(INSTALL)}. The bot's next update pins its image links.</span></p>`);
      reload(sha || branch()).then(() => app.rerender(), () => app.rerender());
      app.rerender();
    } catch (err) {
      el.disabled = false;
      if (err.skipped) {
        app.showDialog(`<h3>Some changes no longer apply</h3><p class="muted">The save on GitHub changed since they were staged.</p><ul>${err.skipped.map(s => `<li>${esc(describe(s.op))}: ${esc(s.why)}</li>`).join("")}</ul>
          <div class="actions"><button type="button" class="primary" data-action="table-publish" data-force="1">Publish the other ${ops.length - err.skipped.length}</button><button type="button" class="ghost" data-action="close">Cancel</button></div>
          <p class="muted table-status" aria-live="polite"></p>`);
        return;
      }
      if (status) status.textContent = `Not published: ${err.message}`;
    }
  }

  const step = (el, t) => { const { deck, card, nth, name, png } = el.dataset, d = deckOf(deck); if (d) push({ t, deck, card, nth: +nth, name, png, deckName: nameOf(d) }); };
  const note = n => (n ? ` · ${n}` : "");
  const actions = {
    "table-open": el => { location.hash = `#/table/${el.dataset.guid}`; },
    "table-reload": () => { reload().then(() => app.rerender(), e => app.toast(`Couldn't reload: ${e.message}`)); app.rerender(); },
    "table-rename": el => {
      const d = deckOf(el.dataset.deck); if (!d) return;
      const name = prompt("Deck name", d.Nickname || "");
      if (name != null && name.trim() !== d.Nickname) push({ t: "rename", deck: d.GUID, deckName: nameOf(d), name: name.trim() });
    },
    "table-add": el => {
      const d = deckOf(el.dataset.deck); if (!d) return;
      const back = T.rules.decks[d.GUID]?.back;
      app.openPicker({ title: `Add a card to ‘${nameOf(d)}’`, hint: "Any card on the website. The new card takes the deck's back.", fits: c => !!c.png,
        onPick: id => { const c = S.byId.get(id); if (!c) return;
          const n = push({ t: "add", deck: d.GUID, deckName: nameOf(d), png: c.png, name: c.name, guid: freshGuid(), back: back ? S.data.raw + urlPath(back) : "" });
          app.closeModal(); app.toast(`Added ${c.name} to ‘${nameOf(d)}’ (unpublished)${note(n)}`); } });
    },
    "table-move": el => destDialog(el, "move"),
    "table-copy": el => destDialog(el, "copy"),
    "table-to": el => {
      const { t, deck, card, nth, name, png, to } = el.dataset, from = deckOf(deck), dest = deckOf(to);
      if (!from || !dest) return;
      const n = push({ t, deck, card, nth: +nth, name, png, deckName: nameOf(from), to, toName: nameOf(dest), guid: freshGuid() });
      app.closeModal(); app.toast(`${t === "move" ? "Moved" : "Copied"} ${name} to ‘${nameOf(dest)}’ (unpublished)${note(n)}`);
    },
    "table-remove": el => { const { deck, card, nth, name, png } = el.dataset, d = deckOf(deck); if (d) app.toast(`Removed ${name} from ‘${nameOf(d)}’ (unpublished)${note(push({ t: "remove", deck, card, nth: +nth, name, png, deckName: nameOf(d) }))}`); },
    "table-up": el => step(el, "up"),
    "table-down": el => step(el, "down"),
    "table-discard": el => { stage = stage.filter(o => o.id !== el.dataset.id); save(); },
    "table-discard-all": () => { if (confirm(`Discard ${plural(stage.length, "unpublished table change")}?`)) { stage = []; save(); } },
    "table-publish": el => publish(el, el.dataset.force === "1"),
  };
  return { render, actions, init: count };
}
