// When the renderer runs in a plain browser (development, automated tests) there is no
// Electron preload. This stand-in keeps the UI working with browser storage and downloads.
export function installShim() {
  if (window.sf) return;
  const mem = {};
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem('sf.' + k)); } catch { return mem[k] ?? null; } },
    set(k, v) { try { localStorage.setItem('sf.' + k, JSON.stringify(v)); } catch { mem[k] = v; } return true; }
  };
  const recs = {};
  window.sf = {
    native: false,
    info: async () => ({ version: 'dev', platform: 'browser' }),
    requestMic: async () => true,
    store: { get: async (n) => ls.get(n), set: async (n, d) => ls.set(n, d) },
    scene: {
      export: async (scene) => { download(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }), (scene.name || 'scene') + '.sfscene'); return 'download'; },
      import: () => new Promise((resolve) => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.sfscene,.json';
        i.onchange = async () => { try { resolve(JSON.parse(await i.files[0].text())); } catch { resolve({ error: 'This file is not a Signalform scene.' }); } };
        i.click();
      })
    },
    rec: {
      begin: async ({ ext }) => { const id = Math.random().toString(36).slice(2); recs[id] = { ext, parts: [] }; return { id, finalExt: ext }; },
      chunk: async (id, buf) => { recs[id]?.parts.push(buf); return true; },
      end: async (id, name) => { const r = recs[id]; delete recs[id]; if (!r) return null; window.__lastRecording = { bytes: r.parts.reduce((a, b) => a + b.byteLength, 0), ext: r.ext }; download(new Blob(r.parts), `${name}.${r.ext}`); return `${name}.${r.ext}`; },
      abort: async (id) => { delete recs[id]; return true; },
      reveal: async () => {}
    },
    output: {
      backends: async () => [
        { kind: 'spout', label: 'Spout', platform: 'win32', available: false, reason: 'Live output works in the desktop app.' },
        { kind: 'ndi', label: 'NDI', platform: 'any', available: false, reason: 'Live output works in the desktop app.' }
      ],
      start: async () => ({ ok: false, errors: ['Live output works in the desktop app.'], active: [] }),
      stop: async () => true,
      frame: () => {}
    },
    onMenu: () => {},
    onRecStatus: () => {}
  };
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
