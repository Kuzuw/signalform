# Contributing to Signalform

Thanks for helping. Bug reports, ideas, new modules and fixes are all welcome.

- **Found a bug?** [Open a bug report](https://github.com/Kuzuw/signalform/issues/new?template=bug_report.yml). Include your Windows version, Signalform version, GPU and audio source.
- **Have an idea?** [Suggest a feature](https://github.com/Kuzuw/signalform/issues/new?template=feature_request.yml).
- **Want to write code?** Read on. For anything larger than a small fix, open an issue first so we can agree on the approach.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need [Node.js 20+](https://nodejs.org) and Git. The app targets Windows, but the interface also runs on macOS and Linux for development.

```bash
git clone https://github.com/Kuzuw/signalform.git
cd signalform
npm install
npm run dev        # starts the app with DevTools open
```

The interface in `renderer/` is plain ES modules with no build step: edit a file and reload the window (<kbd>Ctrl</kbd>+<kbd>R</kbd>).

| Command | What it does |
|---|---|
| `npm start` | Run the app |
| `npm run dev` | Run the app with DevTools |
| `npm run dist` | Build `dist/Signalform-Setup-x.y.z.exe` (on Windows) |
| `npm run docs:modules` | Regenerate [`docs/MODULES.md`](docs/MODULES.md) from the modules' parameter lists |
| `npm run docs:images` | Re-render the README images in `docs/images/` (needs Playwright and ffmpeg) |

## Writing a module

A module is one file in `renderer/modules/`. It describes its settings and returns an instance that draws one frame at a time:

```js
import { hexToRgb, rgba, clear, TAU } from './util.js';

export default {
  id: 'pulse',                       // stable id, saved in scenes and presets
  name: 'Pulse',
  tagline: 'A ring that breathes with the bass.',
  params: [
    { key: 'size', label: 'Size', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.5, section: 'Shape' },
    { key: 'kick', label: 'Kick punch', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'color', label: 'Color', type: 'color', default: '#ff8a3d', section: 'Color' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');      // or 'webgl2' (see gl.js)
    return {
      render(F, { dt, t, W, H, S, params: p }) {
        clear(ctx, W, H);
        const r = Math.min(W, H) * 0.5 * p.size * (0.6 + F.bass * 0.6 + F.kick * 0.3 * p.kick);
        ctx.strokeStyle = rgba(hexToRgb(p.color), 0.4 + F.level * 0.6);
        ctx.lineWidth = 3 * S;
        ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, TAU); ctx.stroke();
      },
      resize(W, H) {},
      dispose() {}
    };
  }
};
```

Then add it to `renderer/modules/index.js`. It appears in the library with a settings panel generated from `params`, and gets the shared Look and Audio controls for free. Run `npm run docs:modules` to add it to the module reference.

### Parameters

| `type` | Fields | Control |
|---|---|---|
| `range` | `min`, `max`, `step`, `default`, optional `unit` or `pct: true` | Slider with a typed value |
| `select` | `options: [[value, label], …]`, `default` | Drop-down |
| `toggle` | `default` | Checkbox |
| `color` | `default` (`#rrggbb`) | Color swatch |
| `text` | `default` | Text field |
| `action` | — | Button that calls `instance.action(key, params)` |
| `hidden` | `default` | Stored but not shown |

Any parameter can also have:

- `section: 'Name'` to start a new collapsible section in the panel;
- `showIf: { otherKey: value }` (or an array of values) to show it only when another setting matches.

The palette buttons fill a module's `color` parameters in order; parameters whose key or label mentions *shadow*, *tint* or *dark* get the palette's dark tone.

### The instance

| Member | Required | Notes |
|---|---|---|
| `render(F, env)` | yes | Draw one frame. `env` is `{ dt, t, W, H, S, params }`: frame time and clock in seconds, canvas size in pixels, the pixel scale `S` (multiply line widths and sizes by it so the module looks the same at any size), and the current settings. |
| `resize(W, H)` | no | The widget changed size. |
| `dispose()` | no | Free GPU resources, buffers and listeners. |
| `action(key, params)` | no | Called by `action` parameters. |
| `pointer(type, x, y, params)`, `capturing` | no | Mouse input on the widget while `capturing` is true (used by Oscilloscope's custom shape). |

### The audio frame `F`

Every value is already smoothed and normalized to about 0–1 unless noted. The widget's **Audio** tab reshapes it before your module sees it.

| Field | Meaning |
|---|---|
| `sub`, `bass`, `lowMid`, `mid`, `highMid`, `high`, `level` | Band levels and overall level |
| `kick`, `snare`, `hat` | Hit envelopes: jump on a hit, then decay |
| `beat`, `hit` | Any beat / strongest recent hit |
| `onsets` | Hits detected this frame: `[{ band: 'kick' \| 'snare' \| 'hat', strength }]` |
| `build`, `drop` | Rises through a build-up; spikes on the drop |
| `centroid` | Spectral brightness |
| `pitch` | Estimated pitch in Hz |
| `wave`, `waveL`, `waveR` | Waveform samples (−1…1), mono and stereo |
| `spectrum` | Linear FFT magnitudes |
| `bands` | 64 log-spaced bands, 30 Hz to 16 kHz |
| `time`, `dt`, `sampleRate`, `active`, `peak` | Clock, frame time, sample rate, whether sound is present, recent peak |

`renderer/modules/util.js` has noise, color helpers and `Accum`, an additive light buffer for phosphor-style modules. `renderer/modules/gl.js` sets up a full-screen WebGL 2 shader with uniforms.

### Module guidelines

- **Look good with the defaults** and react clearly to the demo beat.
- **Stay fast.** Aim for 60 fps at 1080p on an integrated GPU with the defaults; put the heavy stuff behind a slider.
- **Scale with `S`** so the module looks the same in a small card and full screen.
- **Never throw from `render`.** A broken frame stops the whole stage.
- Keep `id` and parameter `key`s stable once released: scenes and presets store them.

## Writing an effect

Effects live in `renderer/rack.js`. A one-pass effect is a name, a category, its `main` parameter (the one the music can drive), a parameter list in the same format as modules, and a GLSL fragment shader body: the input picture is `uIn` (`tx(uv)` samples it, `UV` is the pixel's position), and every range or toggle parameter arrives as a uniform `u_<key>`. Effects that need several passes or keep state between frames (Glow, Feedback echo) use `run(E, src, dst, item, state)` with the engine's `pass()` and `tmp()` helpers instead.

## Tests

The tests drive the interface and the modules in headless Chromium, with a browser stand-in (`renderer/shim.js`) instead of Electron. They need Playwright:

```bash
npm i -D playwright
npx playwright install chromium     # or set PW_CHROMIUM to a Chromium executable

node test/run-modules.mjs out/modules.png      # renders every module into one contact sheet
ONLY=pulse node test/run-modules.mjs out/pulse.png
node test/run-app.mjs out/                     # clicks through the interface, saves screenshots
node test/run-render.mjs out/render.webm       # renders the 5-second fixture track (WebM or MP4, as the browser records)
node test/onsets-varied.mjs 2001 40            # kick / snare / hat precision and recall on varied synthetic mixes
node scripts/train-kick.mjs                    # refit the kick classifier (WRITE=1 saves renderer/kick-net.js)
TARGET=snare node scripts/train-kick.mjs       # refit the snare classifier (WRITE=1 saves renderer/snare-net.js)
```

Check the images, and make sure the interface and render runs end with `problems: none`.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep pull requests focused: one feature or fix each.
3. Run the tests that cover it, and `npm run docs:modules` if you touched a module's parameters.
4. Add a line under **Unreleased** in [`CHANGELOG.md`](CHANGELOG.md).
5. Open the pull request and fill in the template. Screenshots or a short clip help a lot for visual changes.

### Style

- Plain modern JavaScript (ES modules in the renderer, CommonJS in `main/`), two-space indentation, semicolons, single quotes.
- No new runtime dependencies without discussing them first; the app ships with one (`ffmpeg-static`).
- Interface text is short, plain and sentence case.

## Releases

Maintainers bump `version` in `package.json`, move the **Unreleased** notes in `CHANGELOG.md` under the new version, and push to `main`. The workflow builds the installer and publishes the release.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
