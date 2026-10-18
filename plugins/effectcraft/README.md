# Signalform for EffectCraft

Signalform's visuals as effect plug-ins for **[EffectCraft](https://github.com/storytold/effectcraft)**, the free, open-source motion graphics and compositing app by the ArtCraft Team and the EffectCraft contributors. Put Signalform's tunnel, cells, ferrofluid, landscape, speck ring and CRT on layers in an EffectCraft composition, keyframe them, mix them with everything else EffectCraft does, and render.

| Effect | What it does |
|---|---|
| **Signalform CRT Screen** | Shows the layer on a cathode-ray tube: RGB, S-Video or composite NTSC signal (dot crawl, colour bleed), scan lines that widen on bright parts, aperture grille, slot or shadow mask, curved glass, halation and a bezel. Apply it to any layer, or to an adjustment layer for the whole comp. |
| **Signalform Tunnel** | A flight down an endless tunnel of light rings, grid, panels or warp streaks. |
| **Signalform Cells** | A living tissue of frosted-glass, organic, crystal or stained-glass cells, each lit by its own slice of the spectrum. |
| **Signalform Ferro** | Black magnetic fluid that spikes, pumps and throws droplets, with Signalform's **REACTIVE!!!** switch. |
| **Signalform Horizon** | A neon landscape rolling towards a striped setting sun. |
| **Signalform Aura** | A breathing ring of thousands of shimmering specks. |

Tunnel, Cells, Ferro, Horizon and Aura draw their own picture: apply them to a solid. Each has a **Background** choice (black, or transparent so it lays light over the layers below).

## Install

1. Download `Signalform-for-EffectCraft-x.y.z.zip` from the [latest Signalform release](https://github.com/Kuzuw/signalform/releases/latest) and unzip it.
2. Copy the `.wasm` files from `Plug-ins` into the `Plug-ins` folder in EffectCraft's settings folder:
   `%APPDATA%\EffectCraft\Plug-ins` on Windows, `~/Library/Application Support/EffectCraft/Plug-ins` on macOS, `~/.config/effectcraft/Plug-ins` on Linux. EffectCraft loads them at start-up. (Or load one at a time with **Effect ▸ Load Effect Plug-in…**.)
3. In EffectCraft, choose **File ▸ Scripts ▸ Install ScriptUI Panel…** and pick `ScriptUI Panels/Signalform Audio Link.jsx`.

The effects appear under **Signalform** in Effects & Presets and the Effect menu.

## Make them follow the music

A plug-in only knows the time, so the music reaches the effects through their **Audio: Level, Bass, Mids, Highs, Kick and Drop** sliders (0–100 %). Leave them as they are for gentle motion, keyframe them yourself, or link them to the track:

**With Signalform** (best: real beats, bands, builds and drops)

1. In Signalform, open the track (*Audio source ▸ Open a track…*) and click **Export for EffectCraft** in the track card. Signalform analyses the whole track (much faster than playing it) and saves a script.
2. In EffectCraft, with your composition open, run it: **File ▸ Scripts ▸ Run Script File…**. It adds a **Signalform Audio** null layer with keyframed sliders (Level, Bass, Mids, Highs, Kick, Snare, Hi-hat, Build, Drop) and links every Signalform effect already in the comp.
3. Added more effects later? Click **Link every layer in the comp** in the Signalform Audio Link panel (*Window ▸ Signalform Audio Link.jsx*).

**With EffectCraft alone** (loudness only)

1. Put the track in the comp, select it and choose **Animation ▸ Keyframe Assistant ▸ Convert Audio to Keyframes**. It makes an **Audio Amplitude** null.
2. In the Signalform Audio Link panel, click **Link selected layers**. Level, Bass, Mids and Highs follow the loudness, and the kick follows how fast it rises.

The links are ordinary expressions (`thisComp.layer("Signalform Audio").effect("Bass")("Slider")`), so you can edit or remove them like any other. They also work in After Effects scripts that use the same object model.

## How they are built

Each effect is one small, self-contained C file in [`src/`](src/) compiled to WebAssembly with clang, with no imports and no C library, as EffectCraft's [plug-in API v1](https://github.com/storytold/effectcraft/blob/main/docs/plugins.md) requires (premultiplied RGBA float pixels processed in place, parameters as flattened doubles, the layer time). Rendering is deterministic: the same frame gives the same pixels on every machine. [`sf.h`](src/sf.h) holds the shared maths (sine, exponent, logarithm, noise, tone mapping) that a module without a C library needs.

The effects are CPU ports of Signalform's GPU modules, rewritten to be a pure function of time and parameters (EffectCraft may render frames in any order and on several threads), so a few behaviours that need memory of earlier frames, like rings carried down the tunnel from past kicks, are approximated from the current audio values.

```sh
./build.sh                       # dist/*.wasm (the plug-ins) and build/* (native test builds); needs clang and wasm-ld
node test/host.mjs               # loads every plug-in as EffectCraft's ABI defines, validates its manifest, renders, compares with the native build
python3 test/render.py tunnel out.png --size 960x540 --frames 6 --set aKick=80    # preview frames as PNG
```

On GitHub, CI also builds [`host-check`](host-check/) against EffectCraft's own `effectcraft-plugin` crate and renders every plug-in in its wasmi sandbox.

## Credits

- **[EffectCraft](https://github.com/storytold/effectcraft)** by the ArtCraft Team and the EffectCraft contributors (MIT or Apache-2.0): the host application and the plug-in API these effects are written for. Thank you for making it open, documented and extensible. EffectCraft and ArtCraft are their names and trademarks; this pack is an independent, third-party plug-in set and is not made or endorsed by them.
- **[Signalform](https://github.com/Kuzuw/signalform)** (MIT): the modules these effects are ported from.

Licensed under the [MIT License](../../LICENSE), like Signalform.
