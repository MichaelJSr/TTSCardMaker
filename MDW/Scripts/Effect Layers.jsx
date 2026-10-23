// Effect Layers.jsx - give words in a card's text a layer style (glow, stroke, gradient...) while they keep the card's font.
//
// Use: select the text layer (usually "Ability"), then File > Scripts > Browse... and pick this file.
//   Add:        type the words (several: separate with |), pick a style, press Add. The script makes a layer named
//               "Ability FX: <words>" holding exactly those words, cut pixel-for-pixel from the text layer, and puts
//               it above the text's group so the group's stroke/shadow don't outline the effect.
//   Update all: after editing the text, run the script again and press Update all. Every FX layer is rebuilt from
//               the current text and keeps its layer style, opacity, fill and blend mode.
//   Convert overlays: shown when the card still has hand-placed overlay text layers; turns them into effect layers.
// The words keep the font and size of the text layer. Status colors and styles come from the status chart,
// MDW/Croissant's Special Folder/Satus Effect Colors.psd (one text layer per status, in its color, with its style):
// Add colors the words like the chart and can copy the chart's style. Without the chart, the swatches in
// MDW/Status Effects.aco / Attributes.aco and the Styles panel are used instead. Change colors in the text, then Update all.
// "Effect Layers - All Cards.jsx" does all of this for every card in the repo.
// AutoCroissant flags cards whose FX layers no longer line up with their text.
#target photoshop

var FX_TAG = " FX: ";
var SEP = " | ";
var NO_STYLE = "None (add one with Layer > Layer Style; Update all keeps it)";
var EFFECT_LAYERS_HOME = File($.fileName).parent;           // MDW/Scripts
var SWATCH_FILES = ["Status Effects.aco", "Attributes.aco"]; // in MDW; fallback colors when the chart is missing
var CHART_FILE = "Croissant's Special Folder/Satus Effect Colors.psd";   // in MDW; the authority for status colors and styles

function sID(s) { return stringIDToTypeID(s); }
function cID(s) { return charIDToTypeID(s); }

// ---------- layers ----------
function allLayers(container, out) {
  for (var i = 0; i < container.layers.length; i++) {
    var l = container.layers[i];
    out.push(l);
    if (l.typename == "LayerSet") allLayers(l, out);
  }
  return out;
}
function isText(l) { return l.typename == "ArtLayer" && l.kind == LayerKind.TEXT; }
function isFx(l) { return l.name.indexOf(FX_TAG) > 0; }
function parseFxName(name) {
  var at = name.indexOf(FX_TAG), words = name.substr(at + FX_TAG.length).split("|"), phrases = [];
  for (var i = 0; i < words.length; i++) { var w = words[i].replace(/^\s+|\s+$/g, ""); if (w) phrases.push(w); }
  return { base: name.substr(0, at), phrases: phrases };
}
function fxName(base, phrases) { return base.name + FX_TAG + phrases.join(SEP); }
function topGroup(layer) { var l = layer; while (l.parent && l.parent.typename == "LayerSet") l = l.parent; return l; }
function overlaps(a, b) {
  var x = a.bounds, y = b.bounds;
  return x[0].as("px") < y[2].as("px") && y[0].as("px") < x[2].as("px") && x[1].as("px") < y[3].as("px") && y[1].as("px") < x[3].as("px");
}
/* the text layer an FX layer was made from: same name, preferring one under the FX layer */
function findBase(doc, fx, baseName) {
  var found = null, layers = allLayers(doc, []);
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (!isText(l) || l.name != baseName) continue;
    if (overlaps(l, fx)) return l;
    if (!found) found = l;
  }
  return found;
}
function hasEffects(layer) {
  var r = new ActionReference(); r.putIdentifier(cID("Lyr "), layer.id);
  var d = executeActionGet(r);
  return d.hasKey(sID("layerEffects")) && (!d.hasKey(sID("layerFXVisible")) || d.getBoolean(sID("layerFXVisible")));
}

// ---------- text ----------
function textKey(doc, layer) {
  doc.activeLayer = layer;
  var r = new ActionReference(); r.putEnumerated(cID("Lyr "), cID("Ordn"), cID("Trgt"));
  return executeActionGet(r).getObjectValue(sID("textKey"));
}
function setTextKey(doc, layer, tk) {
  doc.activeLayer = layer;
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(cID("TxLr"), cID("Ordn"), cID("Trgt")); d.putReference(cID("null"), r);
  d.putObject(cID("T   "), cID("TxLr"), tk);
  executeAction(cID("setd"), d, DialogModes.NO);
}
function norm(s) { return s.replace(/[\s\u0003]+/g, " ").replace(/^\s+/, "").replace(/\s+$/, ""); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
/* [from, to) of every match of each phrase; any case, any whitespace between words. Whole words only
   ("Blazing" not inside "Blazingly"), unless the phrase only occurs inside other text ("2T1 Become...").
   "phrase#2" means only its 2nd occurrence. */
function splitOccurrence(phrase) {
  var m = /^(.*\S)#(\d+)$/.exec(phrase);
  return m ? { words: m[1], nth: parseInt(m[2], 10) } : { words: phrase, nth: 0 };
}
function phraseRanges(text, phrases) {
  var out = [];
  for (var p = 0; p < phrases.length; p++) {
    var spec = splitOccurrence(phrases[p]);
    var re = new RegExp(escRe(norm(spec.words)).replace(/ /g, "[\\s\\u0003]+"), "gi"), m, whole = [], any = [];
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      var before = m.index ? text.charAt(m.index - 1) : " ", after = text.charAt(m.index + m[0].length) || " ";
      var range = [m.index, m.index + m[0].length];
      any.push(range);
      if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) whole.push(range);
    }
    var found = whole.length ? whole : any;
    if (spec.nth) found = spec.nth <= found.length ? [found[spec.nth - 1]] : [];
    out = out.concat(found);
  }
  return out;
}
/* copy of the text with style runs outside `keep` changed by modify(textStyle) and those inside by modifyKept;
   everyLine: see layoutMode */
function restyle(tk, keep, modify, everyLine, modifyKept) {
  tk = withoutBom(tk);                                   // keep: ranges in cleanText()
  var styles = tk.getList(sID("textStyleRange")), list = new ActionList();
  function kept(k) { for (var j = 0; j < keep.length; j++) if (k >= keep[j][0] && k < keep[j][1]) return true; return false; }
  for (var s = 0; s < styles.count; s++) {
    var r = styles.getObjectValue(s), from = r.getInteger(sID("from")), to = r.getInteger(sID("to"));
    var style = r.getObjectValue(sID("textStyle")), k = from;
    while (k < to) {
      var inside = kept(k), e = k;
      while (e < to && kept(e) == inside) e++;
      var nr = new ActionDescriptor(), ns = new ActionDescriptor(); ns.fromStream(style.toStream());
      if (!inside) modify(ns); else if (modifyKept) modifyKept(ns);
      nr.putInteger(sID("from"), k); nr.putInteger(sID("to"), e);
      nr.putObject(sID("textStyle"), sID("textStyle"), ns); list.putObject(sID("textStyleRange"), nr);
      k = e;
    }
  }
  var out = withParagraphs(tk, everyLine); out.putList(sID("textStyleRange"), list);
  return out;
}
/* copy of tk without a leading byte-order mark (U+FEFF). Sent back, Photoshop gives that character its own run in a
   fallback font (MyriadArabic), which changes the first line's height. AutoCroissant ignores the character. */
function withoutBom(tk) {
  var text = tk.getString(sID("textKey"));
  if (text.charCodeAt(0) != 0xFEFF) return tk;
  function shifted(list, key) {
    var out = new ActionList();
    for (var i = 0; i < list.count; i++) {
      var r = new ActionDescriptor(); r.fromStream(list.getObjectValue(i).toStream());
      var from = Math.max(0, r.getInteger(sID("from")) - 1), to = r.getInteger(sID("to")) - 1;
      if (to <= from) continue;
      r.putInteger(sID("from"), from); r.putInteger(sID("to"), to); out.putObject(sID(key), r);
    }
    return out;
  }
  var out = new ActionDescriptor(); out.fromStream(tk.toStream());
  out.putString(sID("textKey"), text.substr(1));
  out.putList(sID("textStyleRange"), shifted(tk.getList(sID("textStyleRange")), "textStyleRange"));
  out.putList(sID("paragraphStyleRange"), shifted(tk.getList(sID("paragraphStyleRange")), "paragraphStyleRange"));
  return out;
}
/* the text of a layer as the script sends it back (no leading byte-order mark) */
function cleanText(doc, layer) { return withoutBom(textKey(doc, layer)).getString(sID("textKey")); }
/* copy of tk whose paragraphs state the line composer explicitly */
function withParagraphs(tk, everyLine) {
  tk = withoutBom(tk);
  var out = new ActionDescriptor(); out.fromStream(tk.toStream());
  var ps = tk.getList(sID("paragraphStyleRange")), list = new ActionList();
  for (var i = 0; i < ps.count; i++) {
    var r = new ActionDescriptor(); r.fromStream(ps.getObjectValue(i).toStream());
    var st = new ActionDescriptor(); st.fromStream(r.getObjectValue(sID("paragraphStyle")).toStream());
    if (everyLine === true || everyLine === false) st.putBoolean(sID("textEveryLineComposer"), everyLine);
    r.putObject(sID("paragraphStyle"), sID("paragraphStyle"), st); list.putObject(sID("paragraphStyleRange"), r);
  }
  out.putList(sID("paragraphStyleRange"), list);
  return out;
}
/* Which line composer reproduces this text layer? Photoshop reads paragraph styles back without it (Single-line or
   Every-line) and resets it to Every-line when they are sent back, which re-breaks every line of cards set with
   Single-line (17 of 40 in a 2026-10-20 trial). So try both on a hidden copy and keep the one whose pixels match
   the layer's. null: neither does, e.g. when it was last laid out with other versions of its fonts. */
var LAYOUT_MODES = {};                                   // "docId:layerId" -> true / false / null
var LAYOUT_MSG = "Photoshop lays this text out differently here than when it was saved (other font versions?). " +
  "Edit the text once by hand (type and delete a space) so it is laid out again, then run this again.";
function layoutMode(doc, base) {
  var key = doc.id + ":" + base.id;
  if (LAYOUT_MODES.hasOwnProperty(key)) return LAYOUT_MODES[key];
  selectTransparency(base);
  var total = hasSelection(doc) ? hardenSelection(doc) : 0, best = null, bestDiff = -1, tries = [false, true];
  doc.selection.deselect();
  for (var i = 0; i < tries.length; i++) {
    var c = base.duplicate(base, ElementPlacement.PLACEBEFORE);
    setTextKey(doc, c, withParagraphs(textKey(doc, c), tries[i]));
    c.rasterize(RasterizeType.TEXTCONTENTS);
    var diff = pixelDifference(doc, c, base);
    c.remove();
    if (bestDiff < 0 || diff < bestDiff) { best = tries[i]; bestDiff = diff; }
    if (diff == 0) break;
  }
  // anti-aliasing noise is a few pixels per glyph edge; a re-broken line or moved paragraph is thousands
  LAYOUT_MODES[key] = bestDiff <= Math.max(50, 0.01 * total) ? best : null;
  return LAYOUT_MODES[key];
}

// ---------- selections ----------
function transparencyRef(layer) { var r = new ActionReference(); r.putEnumerated(cID("Chnl"), cID("Chnl"), cID("Trsp")); r.putIdentifier(cID("Lyr "), layer.id); return r; }
function selectionRef() { var r = new ActionReference(); r.putProperty(cID("Chnl"), cID("fsel")); return r; }
function selectTransparency(layer) { var d = new ActionDescriptor(); d.putReference(cID("null"), selectionRef()); d.putReference(cID("T   "), transparencyRef(layer)); executeAction(cID("setd"), d, DialogModes.NO); }
function subtractTransparency(layer) { var d = new ActionDescriptor(); d.putReference(cID("null"), transparencyRef(layer)); d.putReference(cID("From"), selectionRef()); executeAction(cID("Sbtr"), d, DialogModes.NO); }
function hasSelection(doc) { try { doc.selection.bounds; return true; } catch (e) { return false; } }
/* soft selection -> hard at 50% (subtracting soft selections multiplies them, which leaves faint hairlines) */
function hardenSelection(doc, level) {
  var ch = doc.channels.add(); doc.selection.store(ch); doc.selection.deselect();
  doc.activeChannels = [ch];
  var d = new ActionDescriptor(); d.putInteger(cID("Lvl "), level || 128); executeAction(cID("Thrs"), d, DialogModes.NO);
  var count = ch.histogram[255];
  doc.activeChannels = doc.componentChannels;
  doc.selection.load(ch); ch.remove();
  return count;                                          // pixels still selected
}

/* pixels covered by one layer but not the other (both ways, at 50%) */
function pixelDifference(doc, a, b) {
  var diff = 0;
  selectTransparency(a); subtractTransparency(b); if (hasSelection(doc)) diff += hardenSelection(doc);
  selectTransparency(b); subtractTransparency(a); if (hasSelection(doc)) diff += hardenSelection(doc);
  doc.selection.deselect();
  return diff;
}

// ---------- swatches ----------
/* {lowercase name: {r, g, b, name}} from a Photoshop .aco: a version 1 block, then version 2 with UTF-16 names */
function readAco(file, out) {
  if (!file.exists) return out;
  file.encoding = "BINARY"; file.open("r"); var d = file.read(); file.close();
  var pos = 0;
  function u16() { var v = ((d.charCodeAt(pos) & 255) << 8) | (d.charCodeAt(pos + 1) & 255); pos += 2; return v; }
  while (pos + 4 <= d.length && d.substr(pos, 4) != "8BIM") {
    var version = u16(), count = u16();
    for (var i = 0; i < count; i++) {
      var space = u16(), w = u16(), x = u16(), y = u16(); u16();
      if (version != 2) continue;
      var len = u16() * 65536 + u16(), label = "";
      for (var k = 0; k < len; k++) { var c = u16(); if (c) label += String.fromCharCode(c); }
      if (space == 0) out[label.toLowerCase()] = { r: w >> 8, g: x >> 8, b: y >> 8, name: label };   // RGB swatches
    }
  }
  return out;
}
var SWATCHES = null;
function swatches() {
  if (!SWATCHES) {
    SWATCHES = {};
    for (var i = 0; i < SWATCH_FILES.length; i++) readAco(new File(EFFECT_LAYERS_HOME.parent + "/" + SWATCH_FILES[i]), SWATCHES);
  }
  return SWATCHES;
}
/* the swatch named like the phrase ("Frozen In Time" -> "Frozen In Time 1" for two-tone ones), or null */
function swatchFor(phrase) {
  var sw = swatches(), k = norm(splitOccurrence(phrase).words).toLowerCase();
  return sw[k] || sw[k + " 1"] || null;
}
function hex(c) { function h(v) { return (v < 16 ? "0" : "") + v.toString(16).toUpperCase(); } return "#" + h(c.r) + h(c.g) + h(c.b); }

// ---------- the status chart ----------
var CHART = null;
/* {statuses: {lowercase name: {name, r, g, b, styled, layer}}, doc, opened}; opens the chart if it isn't open */
function chart() {
  if (CHART) return CHART;
  CHART = { statuses: {}, doc: null, opened: false };
  var f = new File(EFFECT_LAYERS_HOME.parent + "/" + CHART_FILE);
  if (!f.exists) return CHART;
  var back = app.documents.length ? app.activeDocument : null;
  for (var i = 0; i < app.documents.length; i++) { try { if (app.documents[i].fullName.fsName == f.fsName) CHART.doc = app.documents[i]; } catch (e) {} }
  if (!CHART.doc) { CHART.doc = app.open(f); CHART.opened = true; }
  app.activeDocument = CHART.doc;
  var layers = allLayers(CHART.doc, []);
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (!isText(l)) continue;
    try {
      var label = norm(l.textItem.contents), c = l.textItem.color.rgb;
      if (label) CHART.statuses[label.toLowerCase()] = { name: label, r: Math.round(c.red), g: Math.round(c.green), b: Math.round(c.blue), styled: hasEffects(l), layer: l };
    } catch (e) {}
  }
  if (back) app.activeDocument = back;
  return CHART;
}
function closeChart() { if (CHART && CHART.opened && CHART.doc) { try { CHART.doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} } CHART = null; }
function chartStatus(phrase) { return chart().statuses[norm(splitOccurrence(phrase).words).toLowerCase()] || null; }
/* the color for a phrase: the chart's, else its .aco swatch's (two-tone swatches: "<name> 1"), else null */
function statusColor(phrase) { return chartStatus(phrase) || swatchFor(phrase); }
/* the chart's style for a status, onto Photoshop's layer-style clipboard (it works across documents) */
function copyChartStyle(phrase) {
  var st = chartStatus(phrase);
  if (!st || !st.styled) return false;
  var back = app.activeDocument;
  app.activeDocument = CHART.doc; CHART.doc.activeLayer = st.layer;
  executeAction(sID("copyEffects"), undefined, DialogModes.NO);
  app.activeDocument = back;
  return true;
}
function pasteStyle(doc, layer) {
  doc.activeLayer = layer;
  var d = new ActionDescriptor(); d.putBoolean(sID("allowPasteFXOnLayerSet"), true);
  executeAction(sID("pasteEffects"), d, DialogModes.NO);
}
/* color each phrase like the chart (or its swatch), in the text itself. Returns ["Frozen #9AFFF4", ...] */
function colorWords(doc, base, phrases) {
  var done = [], everyLine = layoutMode(doc, base);
  if (everyLine === null) throw new Error("\"" + base.name + "\": " + LAYOUT_MSG);
  for (var i = 0; i < phrases.length; i++) {
    var c = statusColor(phrases[i]);
    if (!c) continue;
    var text = cleanText(doc, base), ranges = phraseRanges(text, [phrases[i]]);
    if (!ranges.length) continue;
    setTextKey(doc, base, restyle(textKey(doc, base), complementRanges(ranges, text.length), paint(c.r, c.g, c.b), everyLine));
    done.push(phrases[i] + " " + hex(c));
  }
  return done;
}

// ---------- effect layers ----------
/* a raster layer with just the phrases' pixels from `base` (font, size, color as in the text) */
function solid(r, g, b) { var c = new SolidColor(); c.rgb.red = r; c.rgb.green = g; c.rgb.blue = b; return c; }
function paint(r, g, b) {
  return function (st) { var c = new ActionDescriptor(); c.putDouble(cID("Rd  "), r); c.putDouble(cID("Grn "), g); c.putDouble(cID("Bl  "), b); st.putObject(sID("color"), cID("RGBC"), c); };
}
function clearStyle(doc, layer) { doc.activeLayer = layer; try { executeAction(sID("disableLayerStyle"), undefined, DialogModes.NO); } catch (e) {} }
/* select exactly the pixels of `key` that are not black: merge it onto a black layer (opaque everywhere), copy that
   layer's red channel into a scratch alpha channel with Apply Image, load it (soft: the anti-aliasing), and keep
   every pixel it touches. (Loading the document's own red channel instead reads a stale composite.) */
function selectKeyed(doc, key) {
  selectTransparency(key);
  var limit = hasSelection(doc) ? hardenSelection(doc, 1) : 0;   // the mask can't be bigger than the key itself
  doc.selection.deselect();
  var black = doc.artLayers.add();
  black.move(key, ElementPlacement.PLACEAFTER);
  doc.activeLayer = black;
  doc.selection.selectAll(); doc.selection.fill(solid(0, 0, 0)); doc.selection.deselect();
  doc.activeLayer = key;
  var flat = key.merge();
  flat.name = "effect layers mask " + flat.id;
  var ch = doc.channels.add();
  doc.activeChannels = [ch];
  var d = new ActionDescriptor(), src = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(cID("Chnl"), cID("Chnl"), cID("Rd  ")); r.putName(cID("Lyr "), flat.name);
  src.putReference(cID("T   "), r); src.putBoolean(cID("PrsT"), false);
  d.putObject(cID("With"), cID("Clcl"), src);
  executeAction(cID("AppI"), d, DialogModes.NO);
  doc.activeChannels = doc.componentChannels;
  flat.remove();
  doc.selection.load(ch); ch.remove();
  var picked = hasSelection(doc) ? hardenSelection(doc, 1) : 0;
  if (picked > limit + 16) { doc.selection.deselect(); throw new Error("the word mask came out wrong (" + picked + " pixels for " + limit + "); nothing was changed"); }
  return picked;
}
/* [from, to) of the runs in the icon font (badges, tokens), in cleanText() positions */
var ICON_FONT_PS = "stoogedings-Regular";
function iconRuns(tk) {
  tk = withoutBom(tk);
  var styles = tk.getList(sID("textStyleRange")), n = tk.getString(sID("textKey")).length, out = [];
  for (var i = 0; i < styles.count; i++) {
    var r = styles.getObjectValue(i), st = r.getObjectValue(sID("textStyle"));
    if (st.hasKey(sID("fontPostScriptName")) && st.getString(sID("fontPostScriptName")) == ICON_FONT_PS)
      out.push([r.getInteger(sID("from")), Math.min(r.getInteger(sID("to")), n)]);
  }
  return out;
}
/* alpha channel of the icon font's color glyphs in `base` (badges, color tokens), or null. They are SVG glyphs
   in their own colors (Photoshop paints currentColor black), so a key's black paint leaves them showing */
function iconGlyphChannel(doc, base, everyLine) {
  if (!iconRuns(textKey(doc, base)).length) return null;
  var gk = base.duplicate(base, ElementPlacement.PLACEBEFORE);
  setTextKey(doc, gk, restyle(textKey(doc, gk), [], paint(0, 0, 0), everyLine));   // all text black
  gk.rasterize(RasterizeType.TEXTCONTENTS); clearStyle(doc, gk); gk.visible = true;
  var ch = null;
  if (selectKeyed(doc, gk)) { ch = doc.channels.add(); doc.selection.store(ch); }   // merges gk away
  doc.activeChannels = doc.componentChannels;             // a new channel would otherwise stay the active one
  doc.selection.deselect();
  return ch;
}
function rangesMeet(a, b) {
  for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) if (a[i][0] < b[j][1] && b[j][0] < a[i][1]) return true;
  return false;
}
function buildFx(doc, base, phrases) {
  var ranges = phraseRanges(cleanText(doc, base), phrases);
  if (!ranges.length) throw new Error("\"" + phrases.join(SEP) + "\" isn't in the text of \"" + base.name + "\"");
  var everyLine = layoutMode(doc, base);
  if (everyLine === null) throw new Error("\"" + base.name + "\": " + LAYOUT_MSG);
  // a badge layer ("Ability FX: (OYT) | [dark]", the gradient cards) takes the icon font's glyphs on purpose: no cut then
  var glyphs = rangesMeet(ranges, iconRuns(textKey(doc, base))) ? null : iconGlyphChannel(doc, base, everyLine);
  // Key copy: the phrases white, the rest black. Only color changes, so the layout is exactly the text's (squashing
  // the other words instead moved centered lines by a pixel or two through optical kerning).
  var key = base.duplicate(base, ElementPlacement.PLACEBEFORE);
  setTextKey(doc, key, restyle(textKey(doc, key), ranges, paint(0, 0, 0), everyLine, paint(255, 255, 255)));
  key.rasterize(RasterizeType.TEXTCONTENTS); clearStyle(doc, key); key.visible = true;
  var picked = selectKeyed(doc, key);                       // merges the key away
  if (glyphs) {                                             // badges and color tokens stay out of the FX layer
    if (picked) { doc.selection.load(glyphs, SelectionType.DIMINISH); picked = hasSelection(doc) ? hardenSelection(doc, 1) : 0; }
    glyphs.remove();
    doc.activeChannels = doc.componentChannels;
  }
  if (!picked) throw new Error("\"" + phrases.join(SEP) + "\" has no visible pixels in \"" + base.name + "\"");
  // the pixels themselves come from an untouched copy of the text, so they are the card's own
  var source = base.duplicate(base, ElementPlacement.PLACEBEFORE);
  source.rasterize(RasterizeType.TEXTCONTENTS); source.visible = true;
  doc.activeLayer = source;
  executeAction(cID("CpTL"), undefined, DialogModes.NO);           // Layer via Copy: selected on-canvas pixels only
  var fx = doc.activeLayer;
  doc.selection.deselect(); source.remove();
  clearStyle(doc, fx);                                              // drop the text layer's own style
  fx.visible = true; fx.opacity = 100; fx.fillOpacity = 100; fx.blendMode = BlendMode.NORMAL;
  fx.name = fxName(base, phrases);
  return fx;
}
function copyStyle(doc, from, to) {
  if (!hasEffects(from)) return false;
  doc.activeLayer = from; executeAction(sID("copyEffects"), undefined, DialogModes.NO);
  doc.activeLayer = to;
  var d = new ActionDescriptor(); d.putBoolean(sID("allowPasteFXOnLayerSet"), true);
  executeAction(sID("pasteEffects"), d, DialogModes.NO);
  return true;
}
function styleNames() {
  var names = [];
  try {
    var r = new ActionReference(); r.putProperty(cID("Prpr"), sID("presetManager")); r.putEnumerated(cID("capp"), cID("Ordn"), cID("Trgt"));
    var list = executeActionGet(r).getList(sID("presetManager"));
    for (var i = 0; i < list.count; i++) {
      if (list.getObjectType(i) != cID("StyC")) continue;
      var n = list.getObjectValue(i).getList(cID("Nm  "));
      for (var j = 0; j < n.count; j++) names.push(n.getString(j));
    }
  } catch (e) {}
  return names;
}
function applyStyle(doc, layer, name) {
  doc.activeLayer = layer;
  var d = new ActionDescriptor(), r = new ActionReference(), t = new ActionReference();
  r.putName(cID("Styl"), name); d.putReference(cID("null"), r);
  t.putEnumerated(cID("Lyr "), cID("Ordn"), cID("Trgt")); d.putReference(cID("T   "), t);
  executeAction(cID("ASty"), d, DialogModes.NO);
}
/* new FX layer above the text's group. style: {kind: "none" | "chart" | "clipboard" | "preset" | "layer", name, layer}
   ("chart": the chart's style for `name`; "clipboard": a style already copied). recolor: color the words first */
function addFx(doc, base, phrases, style, recolor) {
  if (style && style.kind == "chart" && !copyChartStyle(style.name)) style = null;
  if (recolor) colorWords(doc, base, phrases);
  var fx = buildFx(doc, base, phrases), top = topGroup(base);
  if (top != base) fx.move(top, ElementPlacement.PLACEBEFORE);
  if (style && (style.kind == "chart" || style.kind == "clipboard")) pasteStyle(doc, fx);
  else if (style && style.kind == "preset") applyStyle(doc, fx, style.name);
  else if (style && style.kind == "layer") copyStyle(doc, style.layer, fx);
  doc.activeLayer = fx;
  return fx;
}
/* rebuild one FX layer from its text; keeps style, opacity, fill, blend mode, visibility and stacking */
function updateFx(doc, old) {
  var spec = parseFxName(old.name), base = findBase(doc, old, spec.base);
  if (!base) throw new Error("no text layer named \"" + spec.base + "\"");
  var fx = buildFx(doc, base, spec.phrases);
  fx.move(old, ElementPlacement.PLACEBEFORE);
  copyStyle(doc, old, fx);
  fx.opacity = old.opacity; fx.fillOpacity = old.fillOpacity; fx.blendMode = old.blendMode; fx.visible = old.visible;
  fx.name = old.name;
  old.remove();
  return fx;
}
function updateAll(doc) {
  var layers = allLayers(doc, []), done = [], failed = [];
  for (var i = 0; i < layers.length; i++) {
    if (!isFx(layers[i])) continue;
    var name = layers[i].name;
    try { updateFx(doc, layers[i]); done.push(name); } catch (e) { failed.push(name + ": " + e.message); }
  }
  return { done: done, failed: failed };
}

/* is the FX layer off its text? Its pixels are copies of the text's, so pixels left after subtracting the
   text's mean the text moved (same test as AutoCroissant's EFFECT LAYER OUT OF DATE: over 5% left) */
function isStale(doc, fx) {
  var spec = parseFxName(fx.name), base = findBase(doc, fx, spec.base);
  if (!base) return false;                               // nothing to rebuild from; Update all reports it
  selectTransparency(fx);
  if (!hasSelection(doc)) return false;
  var total = hardenSelection(doc);
  selectTransparency(fx); subtractTransparency(base);
  var left = hasSelection(doc) ? hardenSelection(doc) : 0;
  doc.selection.deselect();
  return total > 0 && left > 0.05 * total;
}
function updateStale(doc) {
  var layers = allLayers(doc, []), done = [], failed = [];
  for (var i = 0; i < layers.length; i++) {
    if (!isFx(layers[i]) || !layers[i].visible || !isStale(doc, layers[i])) continue;
    var label = layers[i].name;
    try { updateFx(doc, layers[i]); done.push(label); } catch (e) { failed.push(label + ": " + e.message); }
  }
  return { done: done, failed: failed };
}

// ---------- old overlays ----------
function abilityLayer(doc) {
  var layers = allLayers(doc, []);
  for (var i = 0; i < layers.length; i++) if (isText(layers[i]) && layers[i].name.toLowerCase() == "ability" && layers[i].visible) return layers[i];
  return null;
}
/* hand-placed effect overlays: short visible text layers over the Ability text whose words are in it.
   Returns [{phrase, layers}] grouped by phrase (the same word overlaid twice is one group) */
var NOT_OVERLAYS = { "ability": 1, "name": 1, "health": 1, "defense": 1, "attack": 1, "speed": 1, "hp": 1, "def": 1, "atk": 1, "spd": 1 };
function box(l) { try { return l.boundsNoEffects; } catch (e) { return l.bounds; } }
function insideShare(a, b) {                             // share of a's box inside b's box, effects not counted
  var x = box(a), y = box(b);
  var w = Math.min(x[2].as("px"), y[2].as("px")) - Math.max(x[0].as("px"), y[0].as("px"));
  var h = Math.min(x[3].as("px"), y[3].as("px")) - Math.max(x[1].as("px"), y[1].as("px"));
  var area = (x[2].as("px") - x[0].as("px")) * (x[3].as("px") - x[1].as("px"));
  return w > 0 && h > 0 && area > 0 ? w * h / area : 0;
}
function findOverlays(doc, ability) {
  var layers = allLayers(doc, []), text = cleanText(doc, ability), groups = {}, order = [];
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (!isText(l) || l == ability || !l.visible || NOT_OVERLAYS[l.name.toLowerCase()]) continue;
    var t = norm(l.textItem.contents);
    if (!t || t.length > 40 || insideShare(l, ability) < 0.8 || !phraseRanges(text, [t]).length) continue;
    var k = t.toLowerCase();
    if (!groups[k]) { groups[k] = { phrase: t, layers: [] }; order.push(k); }
    groups[k].layers.push(l);
  }
  var out = [];
  for (var i = 0; i < order.length; i++) out.push(groups[order[i]]);
  return out;
}
function complementRanges(ranges, length) {
  var out = [], last = 0;
  ranges.sort(function (a, b) { return a[0] - b[0]; });
  for (var i = 0; i < ranges.length; i++) { out.push([last, ranges[i][0]]); last = ranges[i][1]; }
  out.push([last, length + 1]);
  return out;
}
/* overlay -> effect layer: the words take the overlay's color in the text, the effect layer takes the overlay's
   style, opacity, blend mode and place in the layer stack, and the overlay is deleted */
/* the phrase's occurrences the overlays sit on, as "phrase#n" (all of them: just "phrase") */
function coveredOccurrences(doc, ability, phrase, overlays) {
  var n = phraseRanges(cleanText(doc, ability), [phrase]).length;
  if (n <= overlays.length) return [phrase];
  var picked = [];
  for (var k = 1; k <= n; k++) {
    var probe = buildFx(doc, ability, [phrase + "#" + k]), hit = false;
    for (var j = 0; j < overlays.length; j++) if (overlaps(probe, overlays[j])) hit = true;
    probe.remove();
    if (hit) picked.push(phrase + "#" + k);
  }
  return picked.length ? picked : [phrase];
}
/* the overlay's color: its first style run that draws something (Mr_Krabs's "\r2T": the return red, "2T" yellow) */
function overlayColor(doc, ov) {
  var tk = withoutBom(textKey(doc, ov)), txt = tk.getString(sID("textKey")), st = tk.getList(sID("textStyleRange")), first = null;
  for (var i = 0; i < st.count; i++) {
    var r = st.getObjectValue(i), ts = r.getObjectValue(sID("textStyle"));
    if (!ts.hasKey(sID("color"))) continue;
    if (!first) first = ts.getObjectValue(sID("color"));
    var s = txt.substring(r.getInteger(sID("from")), Math.min(r.getInteger(sID("to")), txt.length));
    if (/\S/.test(s.replace(/\u0003/g, ""))) return ts.getObjectValue(sID("color"));
  }
  if (!first) throw new Error("overlay \"" + ov.name + "\" has no text color");
  return first;
}
function convertOverlays(doc, ability, notes) {
  var groups = findOverlays(doc, ability), made = [];
  for (var g = 0; g < groups.length; g++) {
    var ov = groups[g].layers[0], phrases = coveredOccurrences(doc, ability, groups[g].phrase, groups[g].layers);
    var color = overlayColor(doc, ov);
    var want = statusColor(groups[g].phrase);
    if (want && notes) {
      var own = { r: Math.round(color.getDouble(cID("Rd  "))), g: Math.round(color.getDouble(cID("Grn "))), b: Math.round(color.getDouble(cID("Bl  "))) };
      if (Math.abs(own.r - want.r) > 2 || Math.abs(own.g - want.g) > 2 || Math.abs(own.b - want.b) > 2)
        notes.push("kept the overlay's color " + hex(own) + " for " + groups[g].phrase + " (the status chart has " + hex(want) + ")");
    }
    var everyLine = layoutMode(doc, ability);
    if (everyLine === null) throw new Error("\"" + ability.name + "\": " + LAYOUT_MSG);
    var text = cleanText(doc, ability);
    setTextKey(doc, ability, restyle(textKey(doc, ability), complementRanges(phraseRanges(text, phrases), text.length), function (st) { st.putObject(sID("color"), cID("RGBC"), color); }, everyLine));
    var fx = buildFx(doc, ability, phrases);
    fx.move(ov, ElementPlacement.PLACEBEFORE);
    copyStyle(doc, ov, fx);
    fx.opacity = ov.opacity; fx.fillOpacity = ov.fillOpacity; fx.blendMode = ov.blendMode;
    for (var j = 0; j < groups[g].layers.length; j++) groups[g].layers[j].remove();
    made.push(fx.name);
  }
  return made;
}

// ---------- dialog ----------
/* returns {action: "add", base, phrases, style} or {action: "update"} or null */
function ask(doc) {
  var layers = allLayers(doc, []), active = doc.activeLayer, base = null, fxLayers = [], styled = [];
  if (isText(active) && !isFx(active)) base = active;
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (isFx(l)) fxLayers.push(l);
    if (!base && isText(l) && l.name.toLowerCase() == "ability") base = l;
  }
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (l != base && l.typename == "ArtLayer" && (isText(l) || isFx(l)) && hasEffects(l)) styled.push(l);
  }
  var presets = styleNames(), choices = [NO_STYLE], kinds = [{ kind: "none" }], charted = [], cs = chart().statuses;
  for (var k in cs) if (cs.hasOwnProperty(k) && cs[k].styled) charted.push(cs[k].name);
  charted.sort();
  for (var i = 0; i < charted.length; i++) { choices.push("Status chart: " + charted[i]); kinds.push({ kind: "chart", name: charted[i] }); }
  for (var i = 0; i < styled.length; i++) { choices.push("Same as layer: " + styled[i].name); kinds.push({ kind: "layer", layer: styled[i] }); }
  for (var i = 0; i < presets.length; i++) { choices.push("Style: " + presets[i]); kinds.push({ kind: "preset", name: presets[i] }); }

  var w = new Window("dialog", "Effect Layers");
  w.orientation = "column"; w.alignChildren = "fill";
  var add = w.add("panel", undefined, base ? "Add an effect to words in \"" + base.name + "\"" : "Select a text layer to add effects");
  add.alignChildren = "fill";
  add.add("statictext", undefined, "Words (separate several with |):");
  var words = add.add("edittext", undefined, ""); words.characters = 48; words.enabled = !!base;
  add.add("statictext", undefined, "Layer style:");
  var pick = add.add("dropdownlist", undefined, choices); pick.selection = 0; pick.enabled = !!base;
  var recolor = add.add("checkbox", undefined, "Color the words like the status chart (Satus Effect Colors.psd)");
  recolor.value = true; recolor.enabled = !!base;
  var swatchNote = add.add("statictext", undefined, ""); swatchNote.characters = 48;
  words.onChanging = function () {
    var parts = parseFxName("x" + FX_TAG + words.text).phrases, found = [];
    for (var i = 0; i < parts.length; i++) { var c = statusColor(parts[i]); if (c) found.push(c.name + " " + hex(c)); }
    swatchNote.text = found.length ? "Color: " + found.join(", ") : "Not in the status chart: the words keep their color";
    var first = words.text.split("|")[0].replace(/^\s+|\s+$/g, "").toLowerCase();
    for (var i = 0; i < kinds.length; i++) if (kinds[i].kind == "chart" && kinds[i].name.toLowerCase() == first) { pick.selection = i; return; }
    for (var i = 0; i < kinds.length; i++) if (kinds[i].kind == "preset" && kinds[i].name.toLowerCase() == first) { pick.selection = i; return; }
  };
  var list = w.add("panel", undefined, "Effect layers in this card");
  list.alignChildren = "left";
  list.add("statictext", undefined, fxLayers.length ? fxLayers.length + " (Update all rebuilds them from the current text)" : "None yet");
  for (var i = 0; i < fxLayers.length && i < 8; i++) list.add("statictext", undefined, "  " + fxLayers[i].name);
  var ability = abilityLayer(doc), overlays = ability ? findOverlays(doc, ability) : [];
  if (overlays.length) {
    var ovPanel = w.add("panel", undefined, "Old overlay layers");
    ovPanel.alignChildren = "left";
    var names = []; for (var i = 0; i < overlays.length; i++) names.push(overlays[i].phrase);
    ovPanel.add("statictext", undefined, overlays.length + " hand-placed: " + names.join(", ").substr(0, 70));
  }
  var buttons = w.add("group"); buttons.alignment = "right";
  var convertButton = overlays.length ? buttons.add("button", undefined, "Convert overlays") : null;
  var addButton = buttons.add("button", undefined, "Add"), updateButton = buttons.add("button", undefined, "Update all");
  buttons.add("button", undefined, "Cancel", { name: "cancel" });
  addButton.enabled = !!base; updateButton.enabled = fxLayers.length > 0;
  var job = null;
  addButton.onClick = function () {
    var phrases = parseFxName("x" + FX_TAG + words.text).phrases;
    if (phrases.length) { job = { action: "add", base: base, phrases: phrases, style: kinds[pick.selection.index], recolor: recolor.value }; w.close(1); }
  };
  updateButton.onClick = function () { job = { action: "update" }; w.close(1); };
  if (convertButton) convertButton.onClick = function () { job = { action: "convert", base: ability }; w.close(1); };
  w.show();
  return job;
}
var EFFECT_LAYERS_JOB = null;
function doJob() {
  var doc = app.activeDocument, job = EFFECT_LAYERS_JOB;
  if (job.action == "add") {
    try { addFx(doc, job.base, job.phrases, job.style, job.recolor); } catch (e) { job.error = e.message; }
  } else if (job.action == "convert") {
    job.notes = [];
    try { job.converted = convertOverlays(doc, job.base, job.notes); } catch (e) { job.error = e.message; }
  } else job.result = updateAll(doc);
}
function main() {
  if (!app.documents.length) { alert("Open a card first."); return; }
  var doc = app.activeDocument, units = app.preferences.rulerUnits, dialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  try {
    EFFECT_LAYERS_JOB = ask(doc);
    if (!EFFECT_LAYERS_JOB) return;
    var st = EFFECT_LAYERS_JOB.style;                        // copy the chart's style now: switching documents
    if (st && st.kind == "chart") EFFECT_LAYERS_JOB.style = copyChartStyle(st.name) ? { kind: "clipboard" } : null;   // inside the undo step breaks it
    app.activeDocument = doc;
    app.displayDialogs = DialogModes.NO;
    doc.suspendHistory("Effect Layers", "doJob()");          // one undo step
    app.displayDialogs = dialogs;
    var job = EFFECT_LAYERS_JOB;
    if (job.error) alert("Effect Layers: " + job.error);
    if (job.converted) alert("Converted " + job.converted.length + " overlay(s):\n" + job.converted.join("\n") + (job.notes.length ? "\n\n" + job.notes.join("\n") : ""));
    if (job.result) alert("Updated " + job.result.done.length + " effect layer(s)." +
      (job.result.failed.length ? "\n\nCouldn't update:\n" + job.result.failed.join("\n") : ""));
  } finally { closeChart(); app.preferences.rulerUnits = units; app.displayDialogs = dialogs; }
}
if (typeof EFFECT_LAYERS_NO_UI == "undefined") main();
