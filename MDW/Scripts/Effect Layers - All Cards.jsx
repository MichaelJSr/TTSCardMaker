// Effect Layers - All Cards.jsx - run Effect Layers over every card in the repo, unattended.
//
// Use: File > Scripts > Browse... and pick this file (keep it next to "Effect Layers.jsx"). Close your other
// documents first. For every card PSD in the repo (MDW, Markers, Rulebook, Types and site are skipped) it:
//   1. turns old hand-placed overlays into effect layers (see Effect Layers.jsx, "Convert overlays");
//   2. rebuilds effect layers whose words moved because the text was edited ("Update all", stale ones only);
//   3. (AUTO_STYLES, on by default) gives each status word that has a style in the status chart
//      (MDW/Croissant's Special Folder/Satus Effect Colors.psd: Blazing, Frozen, ...) an effect layer with that style,
//      unless the card already has one for it, and colors the word like the chart.
// Cards that change are saved and their PNG re-exported next to the PSD; the rest are closed untouched.
// A summary is shown at the end and written to "effect-layers-all-cards.log" in the temp folder.
// It opens every card, so a full run takes a while (about 1-2 seconds per card).
#target photoshop

var AUTO_STYLES = true;                      // false: only convert overlays and update effect layers
// used only without the status chart: these styles from MDW/Debuff And Attributes Layer Effects.asl in the Styles panel
var STATUS_STYLES = ["Become Back Money", "Corrupted Blood", "Cursed Inferno", "Frozen In Time", "Spirit Flame", "Hemorrhaging",
  "Contracted", "Condemned", "Withering", "Infected", "Blazing", "Frozen", "Glued", "Hexed", "Curse"];
var SKIP_FOLDERS = { "MDW": 1, "Markers": 1, "Rulebook": 1, "Types": 1, "site": 1 };

var EFFECT_LAYERS_NO_UI = true;
$.evalFile(new File(File($.fileName).parent + "/Effect Layers.jsx"));

function cardFiles(folder, out) {
  var items = folder.getFiles();
  for (var i = 0; i < items.length; i++) {
    var f = items[i], n = decodeURI(f.name);
    if (n.charAt(0) == ".") continue;
    if (f instanceof Folder) { if (!SKIP_FOLDERS[n]) cardFiles(f, out); }
    else if (/\.psd$/i.test(n)) out.push(f);
  }
  return out;
}
/* status words in the text that have a same-named style and no effect layer yet: [{style, phrases}], where phrases
   are "Frozen" or, when some Frozens are already covered (e.g. by "Frozen In Time"), just the free "Frozen#n" */
/* the styled statuses: from the chart, else STATUS_STYLES that are in the Styles panel; longest first */
function styledStatuses(presets) {
  var names = [], cs = chart().statuses;
  for (var k in cs) if (cs.hasOwnProperty(k) && cs[k].styled) names.push(cs[k].name);
  if (!names.length)
    for (var s = 0; s < STATUS_STYLES.length; s++)
      for (var p = 0; p < presets.length; p++) if (presets[p] == STATUS_STYLES[s]) names.push(STATUS_STYLES[s]);
  names.sort(function (a, b) { return b.length - a.length; });
  return names;
}
function missingStyled(doc, ability, presets) {
  var text = textKey(doc, ability).getString(sID("textKey")), covered = [], out = [], layers = allLayers(doc, []);
  for (var i = 0; i < layers.length; i++)
    if (isFx(layers[i]) && parseFxName(layers[i].name).base == ability.name) covered = covered.concat(phraseRanges(text, parseFxName(layers[i].name).phrases));
  var statuses = styledStatuses(presets);
  for (var s = 0; s < statuses.length; s++) {
    var word = statuses[s];
    var ranges = phraseRanges(text, [word]), free = [];
    for (var r = 0; r < ranges.length; r++) {
      var hit = false;
      for (var c = 0; c < covered.length; c++) if (ranges[r][0] < covered[c][1] && covered[c][0] < ranges[r][1]) hit = true;
      if (!hit) free.push(r + 1);
    }
    if (!free.length) continue;
    var phrases = [];
    if (free.length == ranges.length) phrases.push(word); else for (var f = 0; f < free.length; f++) phrases.push(word + "#" + free[f]);
    out.push({ style: word, phrases: phrases });
    covered = covered.concat(phraseRanges(text, phrases));
  }
  return out;
}
/* the card's PNG next to its PSD, the way the repo's PNGs were made: cards with a color profile other than sRGB
   (often "Display") are converted to sRGB first. Call after saving: the conversion isn't saved into the PSD. */
function exportPng(doc, psdFile) {
  var profile = "";
  try { profile = doc.colorProfileName; } catch (e) {}
  if (profile && !/^sRGB/.test(profile)) doc.convertProfile("sRGB IEC61966-2.1", Intent.RELATIVECOLORIMETRIC, true, false);
  doc.saveAs(new File(psdFile.fsName.replace(/\.psd$/i, ".png")), new PNGSaveOptions(), true, Extension.LOWERCASE);
}
function processCard(doc, presets) {
  var changes = [], ability = abilityLayer(doc);
  if (ability) {
    var notes = [], made = convertOverlays(doc, ability, notes);
    for (var i = 0; i < made.length; i++) changes.push("converted overlay -> " + made[i]);
    for (var i = 0; i < notes.length; i++) changes.push("note: " + notes[i]);
  }
  var res = updateStale(doc);
  for (var i = 0; i < res.done.length; i++) changes.push("updated " + res.done[i]);
  for (var i = 0; i < res.failed.length; i++) changes.push("FAILED " + res.failed[i]);
  if (AUTO_STYLES && ability) {
    var todo = missingStyled(doc, ability, presets);
    for (var i = 0; i < todo.length; i++) {
      var style = chartStatus(todo[i].style) ? { kind: "chart", name: todo[i].style } : { kind: "preset", name: todo[i].style };
      var fx = addFx(doc, ability, todo[i].phrases, style, true);
      changes.push("added " + fx.name + " (style " + todo[i].style + ")");
    }
  }
  return changes;
}

/* every card under root; progress(i, total, path) is called before each. Returns {summary, log} */
function runAll(root, progress) {
  var files = cardFiles(root, []), presets = styleNames(), log = [], changed = 0, failed = 0;
  var units = app.preferences.rulerUnits, dialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS; app.displayDialogs = DialogModes.NO;
  var t0 = new Date().getTime();
  chart();                                                 // opened once for the whole run
  try {
    for (var i = 0; i < files.length; i++) {
      var rel = decodeURI(files[i].fsName).substr(decodeURI(root.fsName).length + 1);
      if (progress) progress(i, files.length, rel);
      var doc = null;
      try {
        doc = app.open(files[i]);
        var changes = processCard(doc, presets);
        if (changes.length) {
          doc.save(); exportPng(doc, files[i]); changed++;
          log.push(rel + ":\n    " + changes.join("\n    "));
        }
      } catch (e) {
        failed++; log.push(rel + ": ERROR " + e.message + (e.line ? " (line " + e.line + ")" : ""));
        if (/I\/O|permission/i.test(String(e)) && i == 0) { log.push("Photoshop may lack access to this folder: System Settings > Privacy & Security > Files and Folders."); break; }
      }
      if (doc) { try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {} }
    }
  } finally {
    closeChart();
    app.preferences.rulerUnits = units; app.displayDialogs = dialogs;
  }
  var minutes = Math.round((new Date().getTime() - t0) / 600) / 100;
  return { summary: files.length + " cards checked in " + minutes + " min: " + changed + " changed, " + failed + " failed.", log: log };
}
function main() {
  if (app.documents.length) { alert("Effect Layers - All Cards: close your open documents first."); return; }
  var win = new Window("palette", "Effect Layers - All Cards");
  win.alignChildren = "fill";
  var label = win.add("statictext", undefined, ""); label.characters = 60;
  var bar = win.add("progressbar", undefined, 0, 100); bar.preferredSize.width = 420;
  win.show();
  var res;
  try {
    res = runAll(File($.fileName).parent.parent.parent, function (i, total, rel) {   // MDW/Scripts -> repo
      bar.maxvalue = total; bar.value = i; label.text = (i + 1) + "/" + total + "  " + rel; win.update();
    });
  } finally { win.close(); }
  var lf = new File(Folder.temp + "/effect-layers-all-cards.log"); lf.open("w"); lf.write(res.summary + "\n\n" + res.log.join("\n")); lf.close();
  alert(res.summary + (res.log.length ? "\n\n" + res.log.slice(0, 25).join("\n") + (res.log.length > 25 ? "\n..." : "") : "") + "\n\nFull log: " + lf.fsName);
}
if (typeof EFFECT_LAYERS_ALL_NO_UI == "undefined") main();
