'use strict';
// Live output manager. The renderer composites a widget or the whole stage, reads the
// pixels back (RGBA, top-down) and sends them here. Each output can feed several
// backends at once: Spout and NDI.
const adapters = {
  spout: require('./spout'),
  ndi: require('./ndi')
};

const live = new Map(); // id -> { name, sinks: [{kind, sink, busy}] }

function backends() {
  return Object.entries(adapters).map(([kind, a]) => ({
    kind,
    label: a.label,
    platform: a.platform,
    available: a.available(),
    reason: a.available() ? '' : a.reason()
  }));
}

async function start({ id, name, kinds }) {
  await stop(id);
  const sinks = [];
  const errors = [];
  for (const kind of kinds || []) {
    const a = adapters[kind];
    if (!a || !a.available()) { errors.push(`${kind}: ${a ? a.reason() : 'unknown backend'}`); continue; }
    try { sinks.push({ kind, sink: await a.create(name), busy: false }); }
    catch (err) { errors.push(`${a.label}: ${err.message}`); }
  }
  live.set(id, { name, sinks });
  return { ok: sinks.length > 0, active: sinks.map((s) => s.kind), errors };
}

async function stop(id) {
  const o = live.get(id);
  if (!o) return true;
  live.delete(id);
  for (const s of o.sinks) { try { await s.sink.close(); } catch {} }
  return true;
}

function stopAll() { for (const id of [...live.keys()]) stop(id); }

function frame(id, w, h, data) {
  const o = live.get(id);
  if (!o || !data) return;
  const buf = Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength);
  for (const s of o.sinks) {
    if (s.busy) continue; // drop the frame instead of queueing latency
    s.busy = true;
    Promise.resolve()
      .then(() => s.sink.send(w, h, buf))
      .catch(() => {})
      .finally(() => { s.busy = false; });
  }
}

module.exports = { backends, start, stop, stopAll, frame };
