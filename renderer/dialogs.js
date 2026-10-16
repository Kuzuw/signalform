// Modal windows: scenes, record, render, live output.
import { h, modal, toast, fmtTime } from './ui.js';
import * as lib from './library.js';
import { byId } from './modules/index.js';
import { pickFormat } from './capture.js';

const RES = [[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']];

function sources(stage) {
  return [{ id: 'stage', name: 'Whole stage', sub: 'Everything you see' },
    ...stage.groups.map((g) => ({ id: g.id, name: g.name, sub: `Group · ${stage.members(g.id).length} widgets` })),
    ...stage.widgets.map((w) => ({ id: w.id, name: w.name, sub: byId[w.module].name }))];
}
function sourceOptions(stage, current) {
  return sources(stage).map((s) => h('option', { value: s.id, selected: current === s.id }, s.id === 'stage' ? s.name : `${s.name} (${s.sub.startsWith('Group') ? 'group' : 'widget'})`));
}
// a radio list: which widget, group or the whole stage
function sourcePicker(stage, current, name) {
  const list = sources(stage);
  if (!list.some((s) => s.id === current)) current = 'stage';
  return h('div', { class: 'radio-list', role: 'radiogroup' }, ...list.map((s) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name, value: s.id, checked: s.id === current }), h('i'),
    h('span', {}, h('b', {}, s.name), h('small', {}, s.sub)))));
}
function picked(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : 'stage'; }
function sel(id, opts, value) {
  return h('select', { id }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
}

/* ---------------- scenes ---------------- */
export function scenesDialog(app) {
  return modal({
    title: 'Scenes',
    wide: true,
    build(body, close) {
      const nameIn = h('input', { type: 'text', id: 'sceneName', value: app.stage.scene.name === 'Untitled' ? '' : app.stage.scene.name, placeholder: 'Scene name', style: { flex: 1 } });
      const save = async () => {
        const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return toast('Type a name for the scene.'); }
        app.stage.scene.name = n; await lib.saveScene(app.stage.serialize()); toast(`Scene “${n}” saved`); renderList();
      };
      nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      body.append(h('div', { class: 'lbl' }, h('span', {}, 'Save the current stage'),
        h('div', { class: 'row' }, nameIn, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save scene'))));
      const mine = h('div', { class: 'lbl' });
      const renderList = () => {
        mine.innerHTML = '';
        const list = lib.savedScenes();
        mine.append(h('span', {}, `Your scenes · ${list.length}`));
        if (!list.length) { mine.append(h('p', { class: 'note' }, 'Scenes you save appear here. They keep every widget, its position, layer settings and module settings.')); return; }
        mine.append(h('ul', { class: 'scene-list' }, ...list.map((s) => h('li', {},
          h('div', {}, h('b', {}, s.name), h('small', {}, `${s.scene.widgets.length} widgets · ${s.scene.aspect} · saved ${new Date(s.savedAt).toLocaleString()}`)),
          h('button', { class: 'btn', type: 'button', onclick: () => { app.loadScene(s.scene); close(); } }, 'Open'),
          h('button', { class: 'btn ghost danger', type: 'button', onclick: async () => { await lib.deleteScene(s.id); renderList(); } }, 'Delete')))));
      };
      renderList();
      body.append(mine,
        h('div', { class: 'lbl' }, h('span', {}, 'Starter scenes'),
          h('ul', { class: 'scene-list' }, ...lib.STARTERS.map((s) => h('li', {},
            h('div', {}, h('b', {}, s.name), h('small', {}, s.note)),
            h('span'),
            h('button', { class: 'btn', type: 'button', onclick: () => { app.loadScene({ ...s.scene, name: s.name }); close(); } }, 'Open'))))));
    },
    actions: [
      { label: 'New empty scene', onClick: (close) => { app.loadScene({ name: 'Untitled', aspect: app.stage.scene.aspect, widgets: [] }); close(); } },
      { label: 'Import file…', onClick: async (close) => { close(); app.importScene(); } },
      { label: 'Export file…', onClick: async () => { const r = await window.sf.scene.export(app.stage.serialize()); if (r) toast('Scene exported'); } },
      { label: 'Done', kind: 'primary', value: null }
    ]
  });
}

/* ---------------- record a live take ---------------- */
export function recordDialog(app) {
  const s = app.settings.record || { source: 'stage', height: 1080, fps: 60, audio: true };
  const fmt = pickFormat();
  return modal({
    title: 'Record Widget',
    aside: h('span', { class: 'muted' }, 'Which widget?'),
    build(body) {
      const cur = app.stage.selected || (app.stage.selectedGroup && app.stage.selectedGroup.id) || s.source;
      body.append(
        sourcePicker(app.stage, cur, 'recSrc'),
        h('div', { class: 'grid3' },
          h('label', { class: 'lbl' }, h('span', {}, 'Resolution'), sel('recHeight', RES, s.height)),
          h('label', { class: 'lbl' }, h('span', {}, 'Frame rate'), sel('recFps', [[30, '30 fps'], [60, '60 fps']], s.fps)),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'recAudio', checked: s.audio }), 'Include audio')),
        h('p', { class: 'note' }, fmt ? 'Records in real time and saves an MP4 (H.264 + AAC). Click Stop in the top bar to finish the take.' : 'Video encoding is not available on this system.'));
    },
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Record', kind: 'primary', id: 'recStart', onClick: async (close) => {
        const opts = { source: picked('recSrc'), height: +document.getElementById('recHeight').value, fps: +document.getElementById('recFps').value, audio: document.getElementById('recAudio').checked };
        app.settings.record = opts; app.saveSettings();
        close();
        app.startRecording(opts);
      } }
    ]
  });
}

/* ---------------- render a track ---------------- */
export function renderDialog(app) {
  const s = app.settings.render || { source: 'stage', height: 1080, fps: 60, mute: false };
  const audio = app.audio;
  const hasTrack = audio.sourceType === 'file' && audio.media && isFinite(audio.media.duration);
  let job = null;
  return modal({
    title: 'Render track to video',
    onClose: () => { if (job && !job.done) job.cancel(); },
    build(body, close, foot) {
      if (!hasTrack) {
        body.append(h('p', {}, 'Import a track first. The render plays it from the start and records the visuals with the audio until the track ends.'));
        foot.prepend(h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); app.pickTrack(true); } }, 'Choose a track…'));
        return;
      }
      const dur = audio.media.duration;
      const prog = h('div', { class: 'progress' }, h('i'));
      const status = h('p', { class: 'note' }, `“${audio.trackName}” · ${fmtTime(dur)}. The render runs in real time, so it takes as long as the track.`);
      body.append(status,
        h('div', { class: 'grid2' },
          h('label', { class: 'lbl' }, h('span', {}, 'Capture'), h('select', { id: 'rnSource' }, ...sourceOptions(app.stage, app.stage.get(s.source) || app.stage.group(s.source) ? s.source : 'stage'))),
          h('label', { class: 'lbl' }, h('span', {}, 'Resolution'), sel('rnHeight', RES, s.height)),
          h('label', { class: 'lbl' }, h('span', {}, 'Frame rate'), sel('rnFps', [[30, '30 fps'], [60, '60 fps']], s.fps)),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'rnMute', checked: s.mute }), 'Mute speakers while rendering')),
        prog);
      const start = h('button', { class: 'btn primary', type: 'button', id: 'rnStart', onclick: async () => {
        const opts = { source: document.getElementById('rnSource').value, height: +document.getElementById('rnHeight').value, fps: +document.getElementById('rnFps').value, mute: document.getElementById('rnMute').checked };
        app.settings.render = opts; app.saveSettings();
        start.disabled = true; body.querySelectorAll('select, input').forEach((e) => (e.disabled = true));
        document.getElementById('dlg').dataset.busy = '1';
        job = await app.renderTrack(opts, (p) => { prog.firstChild.style.width = (p * 100).toFixed(1) + '%'; status.textContent = `Rendering… ${fmtTime(p * dur)} of ${fmtTime(dur)}`; });
        const path = await job.result;
        delete document.getElementById('dlg').dataset.busy;
        if (path) {
          status.textContent = 'Saved: ' + path; status.className = 'ok';
          start.replaceWith(h('button', { class: 'btn', type: 'button', onclick: () => window.sf.rec.reveal(path) }, 'Show in folder'));
        } else { status.textContent = job.cancelled ? 'Render cancelled.' : 'Render finished but the file was not saved.'; }
      } }, 'Start render');
      foot.append(start);
    },
    actions: [{ label: 'Close', onClick: (close) => { if (job && !job.done) job.cancel(); close(); } }]
  });
}

/* ---------------- live output ---------------- */
export function outputDialog(app) {
  const outs = app.outputs;
  return modal({
    title: 'Live Output',
    wide: true,
    build(body) {
      const draw = () => {
        body.innerHTML = '';
        body.append(h('p', {}, 'Send the whole stage, a group or a single widget as a live video source. Pick it up in Resolume, OBS, TouchDesigner, VDMX or anything that receives Syphon, Spout or NDI.'));
        for (const o of outs.list) {
          const card = h('div', { class: 'out-card' + (o.running ? ' on' : '') });
          const disabled = o.running;
          const name = h('input', { type: 'text', value: o.name, disabled, 'aria-label': 'Source name', onchange: (e) => { o.name = e.target.value.trim() || 'Signalform'; app.saveSettings(); } });
          const src = h('select', { disabled, onchange: (e) => { o.source = e.target.value; app.saveSettings(); } }, ...sourceOptions(app.stage, o.source));
          const res = sel('', RES, o.height); res.disabled = disabled; res.onchange = (e) => { o.height = +e.target.value; app.saveSettings(); };
          const fps = sel('', [[30, '30 fps'], [60, '60 fps']], o.fps); fps.disabled = disabled; fps.onchange = (e) => { o.fps = +e.target.value; app.saveSettings(); };
          const backends = h('div', { class: 'grid2' }, ...outs.backends.map((b) => h('label', { class: 'backend' },
            h('input', { type: 'checkbox', checked: o.kinds.includes(b.kind) && b.available, disabled: disabled || !b.available, onchange: (e) => { o.kinds = e.target.checked ? [...new Set([...o.kinds, b.kind])] : o.kinds.filter((k) => k !== b.kind); app.saveSettings(); } }),
            h('b', {}, b.label + (b.platform === 'darwin' ? ' · macOS' : b.platform === 'win32' ? ' · Windows' : ' · network')),
            b.available ? null : h('small', {}, b.reason))));
          const toggle = h('button', { class: 'btn ' + (o.running ? '' : 'primary'), type: 'button', onclick: async () => {
            toggle.disabled = true;
            if (o.running) await outs.stopOne(o);
            else {
              if (!o.kinds.length) { toast('Choose at least one output type.', true); toggle.disabled = false; return; }
              const r = await outs.startOne(o);
              if (!r.ok) toast(r.errors?.[0] || 'The output could not start.', true);
            }
            app.updateLiveButton(); draw();
          } }, o.running ? 'Stop' : 'Go live');
          card.append(
            h('div', { class: 'row', style: { justifyContent: 'space-between' } },
              h('label', { class: 'lbl', style: { flex: 1 } }, h('span', {}, 'Source name (what receivers see)'), name),
              h('span', { class: 'pill' + (o.running ? ' on' : '') }, o.running ? 'LIVE · ' + o.active.map((k) => k.toUpperCase()).join(' + ') : 'OFF')),
            h('div', { class: 'grid2' },
              h('label', { class: 'lbl' }, h('span', {}, 'Send'), src),
              h('div', { class: 'grid2' }, h('label', { class: 'lbl' }, h('span', {}, 'Resolution'), res), h('label', { class: 'lbl' }, h('span', {}, 'Rate'), fps))),
            backends,
            o.errors.length ? h('p', { class: 'err' }, o.errors.join(' ')) : '',
            h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
              outs.list.length > 1 ? h('button', { class: 'btn ghost danger', type: 'button', disabled, onclick: () => { outs.remove(o); app.saveSettings(); draw(); } }, 'Remove') : '',
              toggle));
          body.append(card);
        }
        body.append(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { outs.add(); app.saveSettings(); draw(); } }, 'Add another output')));
      };
      draw();
    },
    actions: [{ label: 'Done', kind: 'primary', value: null }]
  });
}
