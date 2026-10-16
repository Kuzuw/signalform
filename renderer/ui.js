// Small DOM helpers and icons.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  play: P('<path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>'),
  pause: P('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  speaker: P('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mute: P('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  lock: P('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  eye: P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: P('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  copy: P('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  up: P('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: P('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  expand: P('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  fill: P('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 10l-3 2 3 2M16 10l3 2-3 2"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  dice: P('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>'),
  group: P('<rect x="3" y="3" width="11" height="11" rx="2"/><rect x="10" y="10" width="11" height="11" rx="2"/>'),
  loop: P('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  mic: P('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  system: P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  music: P('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  beat: P('<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>'),
  off: P('<circle cx="12" cy="12" r="9"/><path d="M6 18L18 6"/>'),
  chevron: P('<path d="M6 9l6 6 6-6"/>'),
  download: P('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>')
};

export function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

let toastTimer = 0;
export function toast(msg, isErr = false, ms = 3800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function uid() { return Math.random().toString(36).slice(2, 9); }

// Generic modal. build(body, close) fills the body; returns a promise resolving with close's value.
export function modal({ title, aside, build, actions = [], wide = false, onClose }) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = '';
  dlg.style.width = wide ? 'min(720px, 94vw)' : '';
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const close = (v) => { if (dlg.open) dlg.close(); if (onClose) onClose(v); resolve(v); };
  const body = h('div', { class: 'dlg-b' });
  const foot = h('div', { class: 'dlg-f' });
  dlg.append(h('div', { class: 'dlg-h' }, h('h3', {}, title), aside || null), body, foot);
  for (const a of actions) {
    foot.append(h('button', { class: 'btn ' + (a.kind || ''), type: 'button', id: a.id, onclick: () => (a.onClick ? a.onClick(close) : close(a.value)) }, a.label));
  }
  build(body, close, foot);
  dlg.onclose = () => resolve(undefined);
  dlg.oncancel = (e) => { if (dlg.dataset.busy) e.preventDefault(); };
  dlg.showModal();
  return done;
}
