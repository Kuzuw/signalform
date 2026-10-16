# Signalform

A free, open-source, realtime audio-reactive visual engine. Standalone desktop app for macOS and Windows. No DAW required.

**[⬇ Download the latest release](https://github.com/Kuzuw/signalform/releases/latest)**: `.exe` for Windows, `.dmg` for Mac (arm64 = Apple Silicon, x64 = Intel).


- **15 visual modules:** ASCII, Aura, Ferro, Flow Field, Fractal, Grain, Lissajous, Oscilloscope, Spectre, Trace, Waveform, and the newer Oscillon, Stroke, Discharge and Familiar. Every setting of every module can be changed, and **Randomize** rolls a new look in one click.
  - **Oscillon:** a phosphor beam sweeps a closed surface until it becomes a glowing shell. It snaps to a new form on heavy hits, swells where sounds land, squeezes on a build and throws itself open on the drop.
  - **Stroke:** a pen of light on a long exposure. Slow strokes burn thick, fast ones thin to a wire, hits break the line into flaring corners, the line follows the melody, and big drops race a laser figure.
  - **Discharge:** lightning on a photographic plate. Kicks tear long channels with thin roots, snares throw arcs, hats crackle, and rolls flicker one channel. It holds back through a build and breaks loose on the drop, with a sky flash on big hits.
  - **Familiar:** up to 100,000 points of light that rest as one creature. It breathes in silence, scatters on hits and gathers back, with depth of field and self-shadowing. Type a word and the swarm becomes it.
- **Free composition.** Each module is a widget you can move, resize, layer, blend, hide, lock or duplicate.
  - **Card backgrounds:** Glass (blurs what's behind), Solid, Dark, Light (visuals print as ink), Clear (floats over the layers below) or any color, with rounded corners.
  - **Selection and groups:** shift-click to select several, then group them (Ctrl/Cmd+G), align them, lay them out side by side or in a grid.
  - **Drag and drop:** drag modules from the library onto the stage, and drag layers to reorder them.
- **Presets** for each module (name · Save · × · ▾, plus Reset to defaults), and **scenes** that save a whole layout. Scenes can be exported and imported as `.sfscene` files. Seven starter scenes are included.
- **Audio sources:** any microphone or audio interface, system audio, virtual routing devices (BlackHole, Loopback, VB-Cable), track files, and a built-in demo beat.
- **Analysis** shared by all modules:
  - bass, mid and high levels
  - kick, snare and hi-hat hits
  - pitch and spectral centroid
  - detection of a build-up and of the drop that follows it
- **Render a track to MP4.** The track plays from the start and the visuals are recorded with its audio.
- **Record a live take** of the whole stage, a group or a single widget.
- **Live Output:** sends any widget, a group, or the whole stage, as a live video source over **Syphon** (macOS), **Spout** (Windows) and **NDI** (both). Resolume, OBS, TouchDesigner and VDMX can all receive it.
- **Free and open source** under the MIT license. Every module and feature is included.
- **Platforms:** macOS 13 Ventura or later, with separate native builds for Apple Silicon and Intel. Windows 10 or later (x64).

---

## Run it on your computer

You need [Node.js 20+](https://nodejs.org).

```bash
npm install
npm start
```

## First launch

The release builds are not code-signed yet, so each system asks once:

- **macOS:** open the `.dmg` and drag Signalform to Applications. Then right-click Signalform → **Open** → **Open**. If macOS says the app "is damaged", run this once in Terminal:
  ```bash
  xattr -cr /Applications/Signalform.app
  ```
- **Windows:** when SmartScreen appears, choose **More info** → **Run anyway**.

## Make a release

Installers are built by GitHub Actions (`.github/workflows/build.yml`) on real macOS and Windows machines.

1. Bump `version` in `package.json`.
2. Push a tag:
   ```bash
   git tag v1.0.1 && git push origin v1.0.1
   ```
3. About 10–15 minutes later, a GitHub Release appears with the `.dmg`, `.zip` and `.exe` files.

**Run workflow** in the Actions tab builds the same files without making a release; they appear as run artifacts.

On a Mac you can build locally with `npm run dist:mac`. On Windows, use `npm run dist:win`.

**Optional code signing** removes the first-launch warnings. Add these repository secrets:
- **macOS:** `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (from an Apple Developer account).
- **Windows:** `WIN_CERT_PFX_BASE64`, `WIN_CERT_PASSWORD`.

## Live Output (Syphon, Spout, NDI)

Each output protocol needs a native library, compiled per platform:

| Output | Library | Platform |
|---|---|---|
| Syphon | `node-syphon` | macOS |
| Spout | `electron-spout` | Windows |
| NDI | `grandiose` (a fork with send support) | both |

The release workflow installs them on the right runner. If one fails to compile, the build still finishes and the app shows that output as unavailable, with the reason.

NDI also needs the free NDI runtime or NDI Tools on the computer.

In the app, open **Live Output** and pick what to send: the whole stage, a group or one widget. Choose the resolution and frame rate, tick Syphon, Spout or NDI, and press **Go live**. You can run several outputs at once. In Resolume, OBS, TouchDesigner or VDMX, the source shows up under the name you typed.

Frames are composited, read back and sent through the main process. That is reliable at 1080p30 and usually fine at 1080p60. For heavy 4K use, a GPU shared-texture path would be the next optimization.

> The output adapters live in `main/outputs/`. Each library is wrapped in about 30 lines, so if a library's API changes in a future version, this is the only place to adjust.

## Using the app

| Action | How |
|---|---|
| Add a module | Click its tile, or drag it onto the stage |
| Select several / group | Shift-click, then **Group** (Ctrl/Cmd+G; Shift+Ctrl/Cmd+G ungroups). Clicking a grouped widget selects the group; double-click picks one widget inside it |
| Arrange | With several selected: align, **Side by side**, **Grid** or **Stack full** |
| Card look | Inspector → Background: Glass / Solid, Dark / Light / Clear / custom color, corner radius |
| Move / resize | Drag the widget / drag its corners or edges. Shift keeps the shape. Alt turns off snapping |
| Nudge | Arrow keys (Shift = bigger steps) |
| Layer order | Drag rows in Layers, or `[` and `]` |
| Duplicate / delete | Ctrl/Cmd + D / Delete |
| Play / pause the track or demo | Space |
| Perform mode (hides everything except the visuals) | F, Esc to leave |
| Reset a slider | Double-click it |
| Draw a custom Oscilloscope shape | Oscilloscope → Custom shape → **Draw a shape on the widget**, then draw one continuous line |

**System audio:**

- On Windows, choose **System audio** in the source list.
- On macOS, the app asks the system for audio capture. If your macOS does not offer it, install a free virtual device such as [BlackHole](https://existential.audio/blackhole/), send your music to it, and pick it as the input.

## Project layout

```
main/            Electron main process: window, menus, storage, recording files, live output
  outputs/       Syphon, Spout and NDI adapters
renderer/        The app UI
  audio.js       Sources and analysis (levels, onsets, build/drop)
  stage.js       Widgets, layout, layering, compositor
  modules/       The 15 visual modules (WebGL 2 for Aura, Ferro and Fractal; Canvas for the rest)
build/           Icon, macOS entitlements, signing hook
test/            Headless visual and interface tests
```

## Tests

`test/run-modules.mjs`, `test/run-app.mjs` and `test/run-render.mjs` drive the modules, the whole interface and a track render in headless Chromium. They need Playwright: `npm i -D playwright`. Then set `PW_CHROMIUM` to a Chromium path, or adjust the path at the top of each file.

## Contributing

Issues and pull requests are welcome. A new visual module is one file in `renderer/modules/`. It exports `{ id, name, tagline, params, create(canvas) }`, and its `render(F, env)` receives the audio frame `F` (levels, bands, onsets, build, drop, waveforms, spectrum). Add it to `renderer/modules/index.js` and it shows up in the library with a settings panel generated from `params`.

## License

[MIT](LICENSE)
