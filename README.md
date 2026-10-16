# Signalform

A free, open-source, realtime audio-reactive visual engine for Windows. No DAW required.

**[⬇ Download the latest release](https://github.com/Kuzuw/signalform/releases/latest)**: get `Signalform-Setup-x.y.z.exe` and run it. Windows 10 or 11, 64-bit.

## Features

- **15 visual modules:** ASCII, Aura, Ferro, Flow Field, Fractal, Grain, Lissajous, Oscilloscope, Spectre, Trace, Waveform, Oscillon, Stroke, Discharge and Familiar. Every setting can be changed, and **Randomize** rolls a new look in one click.
  - **Oscillon:** a phosphor beam sweeps a closed surface until it becomes a glowing shell. It snaps to a new form on heavy hits, swells where sounds land, squeezes on a build and throws itself open on the drop.
  - **Stroke:** a pen of light on a long exposure. Slow strokes burn thick and fast ones thin to a wire. Hits break the line into flaring corners, the line follows the melody, and big drops race a laser figure.
  - **Discharge:** lightning on a photographic plate.
    - Kicks tear long channels, snares throw arcs, hats crackle, and rolls flicker one channel.
    - It holds back through a build and breaks loose on the drop, with a sky flash on big hits.
  - **Familiar:** up to 100,000 points of light that rest as one creature. It breathes in silence, scatters on hits and gathers back. Type a word and the swarm becomes it.
- **Free composition.** Each module is a widget you can move, resize, layer, blend, hide, lock or duplicate.
  - **Card backgrounds:** Glass (blurs what's behind), Solid, Dark, Light (visuals print as ink), Clear (floats over the layers below) or any color, with rounded corners.
  - **Selection and groups:** shift-click to select several, then group them (Ctrl+G), align them, or lay them out side by side or in a grid.
  - **Drag and drop:** drag modules from the library onto the stage, and drag layers to reorder them.
- **Presets** for each module, and **scenes** that save a whole layout. Scenes can be exported and imported as `.sfscene` files. Seven starter scenes are included.
- **Audio sources:** system audio (whatever your PC is playing), any microphone or audio interface, virtual cables (VB-Cable, Voicemeeter), track files, and a built-in demo beat.
- **Analysis** shared by all modules: bass, mid and high levels; kick, snare and hi-hat hits; pitch; and detection of build-ups and drops.
- **Render a track to MP4** with its audio, and **record live takes** of the whole stage, a group or a single widget.
- **Live Output** sends any widget, a group or the whole stage as a live video source over **Spout** and **NDI**. Resolume, OBS and TouchDesigner can receive it.
- **Free and open source** under the MIT license.

## First launch

The installer is not code-signed yet. If Windows SmartScreen appears, choose **More info** → **Run anyway**.

## Using the app

| Action | How |
|---|---|
| Choose the audio | **Audio source** card at the top left: Connect (system audio), an input, a track, or the demo beat |
| Add a module | Click its tile, or drag it onto the stage |
| Move / resize | Drag the widget / drag its corners or edges. Shift keeps the shape. Alt turns off snapping |
| Select several / group | Shift-click, then **Group** (Ctrl+G). Ctrl+Shift+G ungroups. Clicking a grouped widget selects the group; double-click picks one widget inside it |
| Arrange | With several selected: align, **Side by side**, **Grid** or **Stack full** |
| Card look | Inspector → Background: Glass / Solid, Dark / Light / Clear / custom color, corner radius |
| Layer order | Drag rows in Layers, or press `[` and `]` |
| Duplicate / delete | Ctrl+D / Delete |
| Play / pause the track or demo | Space |
| Perform mode (visuals only) | F, Esc to leave |
| Reset a slider | Double-click it |
| Export a video of a track | Load a track, then **Export video from this track** |
| Draw a custom Oscilloscope shape | Oscilloscope → Custom shape → **Draw a shape on the widget** |

## Live Output (Spout, NDI)

Open **Live Output**, pick what to send (the whole stage, a group or one widget), choose the resolution and frame rate, tick Spout and/or NDI, and press **Go live**. In Resolume, OBS or TouchDesigner, the source appears under the name you typed.

Spout and NDI need native libraries, which the release build tries to include. If one of them couldn't be built, the app shows it as unavailable, with the reason. NDI also needs the free NDI Runtime or NDI Tools on the computer. The adapters live in `main/outputs/`.

## Build it yourself

You need [Node.js 20+](https://nodejs.org) on Windows.

```bash
npm install
npm start          # run the app
npm run dist       # build dist/Signalform-Setup-x.y.z.exe
```

## Make a release

GitHub Actions (`.github/workflows/build.yml`) builds the installer on a Windows machine:

1. Bump `version` in `package.json` (for example to `1.0.1`).
2. Push to `main`.
3. About 10 minutes later, the release `v1.0.1` appears with the new `.exe`. The workflow creates the tag itself.

Pushes that keep the same version rebuild and replace the installer in that version's release. **Run workflow** in the Actions tab does the same on demand.

To sign the installer and remove the SmartScreen warning, add a code-signing certificate as the repository secrets `WIN_CERT_PFX_BASE64` and `WIN_CERT_PASSWORD`.

## Project layout

```
main/            Electron main process: window, menus, storage, recording files, live output
  outputs/       Spout and NDI adapters
renderer/        The app UI
  audio.js       Sources and analysis (levels, onsets, build/drop)
  stage.js       Widgets, layout, layering, groups, compositor
  modules/       The 15 visual modules (WebGL 2 for Aura, Ferro and Fractal; Canvas for the rest)
build/           Icon
test/            Headless visual and interface tests
```

## Contributing

Issues and pull requests are welcome.

A new visual module is one file in `renderer/modules/`:
- It exports `{ id, name, tagline, params, create(canvas) }`.
- Its `render(F, env)` receives the audio frame `F`: levels, bands, onsets, build, drop, waveforms and spectrum.

Add it to `renderer/modules/index.js`. It then shows up in the library, with a settings panel generated from `params`.

The tests (`test/run-modules.mjs`, `test/run-app.mjs`, `test/run-render.mjs`) drive the modules, the interface and a track render in headless Chromium. They need Playwright (`npm i -D playwright`) and `PW_CHROMIUM` set to a Chromium path.

## License

[MIT](LICENSE)
