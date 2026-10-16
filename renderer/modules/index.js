import ascii from './ascii.js';
import aura from './aura.js';
import ferro from './ferro.js';
import flowfield from './flowfield.js';
import fractal from './fractal.js';
import grain from './grain.js';
import lissajous from './lissajous.js';
import oscilloscope from './oscilloscope.js';
import spectre from './spectre.js';
import trace from './trace.js';
import waveform from './waveform.js';
import oscillon from './oscillon.js';
import stroke from './stroke.js';
import discharge from './discharge.js';
import familiar from './familiar.js';

export const MODULES = [ascii, aura, ferro, flowfield, fractal, grain, lissajous, oscilloscope, spectre, trace, waveform, oscillon, stroke, discharge, familiar];
export const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]));

export function defaults(mod) {
  const o = {};
  for (const p of mod.params) if (p.type !== 'action' && p.type !== 'section') o[p.key] = p.default;
  return o;
}
