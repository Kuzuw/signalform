// Signalform × EffectCraft (https://github.com/storytold/effectcraft).
// Turns Signalform's analysis of a track into a script for EffectCraft (or After Effects): it adds a
// "Signalform Audio" null layer with keyframed sliders (Level, Bass, Mids, Highs, Kick, Snare, Hi-hat,
// Build, Drop, 0–100 %) to the open composition, and links every Signalform effect plug-in in it.

const CHANNELS = [['Level', 'level'], ['Bass', 'bass'], ['Mids', 'mid'], ['Highs', 'high'], ['Kick', 'kick'], ['Snare', 'snare'], ['Hi-hat', 'hat'], ['Build', 'build'], ['Drop', 'drop']];
const LINKS = [['Audio: Level', 'Level'], ['Audio: Bass', 'Bass'], ['Audio: Mids', 'Mids'], ['Audio: Highs', 'Highs'], ['Audio: Kick', 'Kick'], ['Audio: Drop', 'Drop']];

export function analysisScript(an, appVersion = '') {
  const vals = {};
  for (const [, k] of CHANNELS) vals[k] = '[' + Array.from(an.frames[k], (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10).join(',') + ']';
  const title = String(an.name || 'Track').replace(/[\\"\n\r]/g, ' ');
  return `// Signalform ${appVersion} · audio analysis of "${title}" for EffectCraft and After Effects
// Run it with a composition open (File ▸ Scripts ▸ Run Script File…). It adds a "Signalform Audio" null with
// keyframed sliders, 0–100 %, ${an.fps} keys a second, and links the "Audio: …" sliders of every Signalform
// effect in the composition. Re-link later with the Signalform Audio Link panel.
// EffectCraft: https://github.com/storytold/effectcraft · Signalform: https://github.com/Kuzuw/signalform
(function () {
  var comp = app.project.activeItem;
  if (!(comp instanceof CompItem)) { alert("Open a composition first, then run this script again."); return; }
  var fps = ${an.fps}, duration = ${an.duration.toFixed(3)};
  var data = {
${CHANNELS.map(([n, k]) => `    "${n}": ${vals[k]}`).join(',\n')}
  };
  app.beginUndoGroup("Signalform Audio");
  for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === "Signalform Audio") { comp.layer(i).remove(); break; }
  var nul = comp.layers.addNull(Math.max(comp.duration, duration));
  nul.name = "Signalform Audio";
  nul.enabled = false;
  for (var name in data) {
    var fx = nul.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
    fx.name = name;
    var v = data[name], t = [];
    for (var j = 0; j < v.length; j++) t.push(j / fps);
    fx.property(1).setValuesAtTimes(t, v);
  }
  // link the Signalform effects already in the composition
  var links = ${JSON.stringify(LINKS)}, n = 0;
  for (var l = 1; l <= comp.numLayers; l++) {
    var par = comp.layer(l).property("ADBE Effect Parade");
    if (!par) continue;
    for (var e = 1; e <= par.numProperties; e++) {
      var eff = par.property(e);
      if (String(eff.matchName).indexOf("org.signalform.") !== 0 && String(eff.name).indexOf("Signalform") !== 0) continue;
      for (var m = 0; m < links.length; m++) {
        var p = eff.property(links[m][0]);
        if (p) { p.expression = 'thisComp.layer("Signalform Audio").effect("' + links[m][1] + '")("Slider")'; n++; }
      }
    }
  }
  app.endUndoGroup();
  writeLn("Signalform Audio: " + v.length + " frames; linked " + n + " sliders.");
})();
`;
}
