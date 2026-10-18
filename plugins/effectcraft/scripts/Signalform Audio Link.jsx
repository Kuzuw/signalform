// Signalform Audio Link: connects the "Audio: …" sliders of Signalform effects to the music.
// A ScriptUI panel for EffectCraft (https://github.com/storytold/effectcraft); it also runs in After Effects.
// Install: File ▸ Scripts ▸ Install ScriptUI Panel…, then open it from the Window menu.
//
// It links to, in order of preference:
//   1. a "Signalform Audio" null layer: exported from Signalform (Track ▸ Export analysis for EffectCraft),
//      with keyframed sliders for Level, Bass, Mids, Highs, Kick, Snare, Hi-hat, Build and Drop;
//   2. an "Audio Amplitude" null layer: made by EffectCraft's Animation ▸ Keyframe Assistant ▸
//      Convert Audio to Keyframes (loudness only; the kick is taken from how fast the loudness rises).
// Linking writes expressions, so the effects follow the keyframes and stay editable.
(function (thisObj) {
  var MAP = [
    ["Audio: Level", "Level"], ["Audio: Bass", "Bass"], ["Audio: Mids", "Mids"],
    ["Audio: Highs", "Highs"], ["Audio: Kick", "Kick"], ["Audio: Drop", "Drop"]
  ];

  function signalformEffects(layer) {
    var out = [], fx = layer.property("ADBE Effect Parade");
    if (!fx) return out;
    for (var i = 1; i <= fx.numProperties; i++) {
      var e = fx.property(i);
      if (String(e.matchName).indexOf("org.signalform.") === 0 || String(e.name).indexOf("Signalform") === 0) out.push(e);
    }
    return out;
  }
  function findLayer(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    return null;
  }
  function expressionFor(source, slider) {
    if (source === "signalform") return 'thisComp.layer("Signalform Audio").effect("' + slider + '")("Slider")';
    // loudness from Convert Audio to Keyframes (roughly 0–30) mapped to 0–100 %
    var amp = 'thisComp.layer("Audio Amplitude").effect("Both Channels")("Slider")';
    if (slider === "Kick") return 'var a = ' + amp + ', p = ' + amp + '.valueAtTime(time - thisComp.frameDuration * 2);\nclamp((a - p) * 14, 0, 100)';
    if (slider === "Drop") return '0';
    var k = { Level: 4, Bass: 3.6, Mids: 3, Highs: 2.2 }[slider] || 3;
    return 'clamp(' + amp + ' * ' + k + ', 0, 100)';
  }

  function link(status, onlySelected) {
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) { status.text = "Open a composition first."; return; }
    var source = findLayer(comp, "Signalform Audio") ? "signalform" : findLayer(comp, "Audio Amplitude") ? "amplitude" : null;
    if (!source) { status.text = "No \"Signalform Audio\" or \"Audio Amplitude\" layer in this composition."; return; }
    var layers = onlySelected ? comp.selectedLayers : [];
    if (!onlySelected) for (var i = 1; i <= comp.numLayers; i++) layers.push(comp.layer(i));
    app.beginUndoGroup("Link Signalform effects to the music");
    var n = 0;
    for (var l = 0; l < layers.length; l++) {
      var fxs = signalformEffects(layers[l]);
      for (var f = 0; f < fxs.length; f++) {
        for (var m = 0; m < MAP.length; m++) {
          var p = fxs[f].property(MAP[m][0]);
          if (p) { p.expression = expressionFor(source, MAP[m][1]); n++; }
        }
      }
    }
    app.endUndoGroup();
    status.text = n ? "Linked " + n + " sliders to " + (source === "signalform" ? "Signalform Audio." : "Audio Amplitude.") : "No Signalform effects found" + (onlySelected ? " on the selected layers." : ".");
  }
  function unlink(status) {
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) { status.text = "Open a composition first."; return; }
    app.beginUndoGroup("Unlink Signalform effects");
    var n = 0, layers = comp.selectedLayers;
    for (var l = 0; l < layers.length; l++) {
      var fxs = signalformEffects(layers[l]);
      for (var f = 0; f < fxs.length; f++) for (var m = 0; m < MAP.length; m++) { var p = fxs[f].property(MAP[m][0]); if (p && p.expression) { p.expression = ""; n++; } }
    }
    app.endUndoGroup();
    status.text = n ? "Unlinked " + n + " sliders." : "Select layers with linked Signalform effects.";
  }

  var ui = thisObj instanceof Panel ? thisObj : new Window("palette", "Signalform Audio Link", undefined, { resizeable: true });
  ui.orientation = "column";
  ui.alignChildren = ["fill", "top"];
  ui.spacing = 8; ui.margins = 12;
  ui.add("statictext", undefined, "Make Signalform effects follow the music.", { multiline: true });
  var bSel = ui.add("button", undefined, "Link selected layers");
  var bAll = ui.add("button", undefined, "Link every layer in the comp");
  var bOff = ui.add("button", undefined, "Unlink selected layers");
  var status = ui.add("statictext", undefined, "Needs a \"Signalform Audio\" or \"Audio Amplitude\" layer.", { multiline: true });
  status.preferredSize = [260, 44];
  bSel.onClick = function () { link(status, true); };
  bAll.onClick = function () { link(status, false); };
  bOff.onClick = function () { unlink(status); };
  if (ui instanceof Window) { ui.center(); ui.show(); } else ui.layout.layout(true);
})(this);
