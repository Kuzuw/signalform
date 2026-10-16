# Changelog

All notable changes to Signalform are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.0] - 2026-10-17

### Added
- **Edge feather** for every layer (Inspector → Background, under Corner radius): fades the card out softly towards its edges and corners instead of a hard cut. It works with any corner radius and with Glass, Solid and Clear cards, and it shows the same in recordings, track exports and Live Output.


## [1.3.0] - 2026-10-17

### Changed
Every original module was matched against the reference look of the Form Vision modules and restyled. Where a module changed character, the previous look is kept as an option.
- **Ferro:** black magnetic fluid on white: a chain of glossy beads that merge on the beat, buds and thorns, and a spray of droplets that hits fling out and the magnet pulls back. Heavy hits and drops snap it into one round drop.
- **Aura:** a breathing ring of shimmering specks (ring, two rings, disc or turning sphere) whose rim swells with its slice of the spectrum. The light blooms are kept as *Look → Light blooms*.
- **Oscillon:** new forms (cushion, pebble, peanut, trefoil, apple, ring, clover, orb) with bright caustic folds. It snaps to a new form on heavy hits and drops, every sound leaves a visible swelling on the surface, and it squeezes through a build and throws itself open on the drop. New settings: snap speed, wobble and frayed surface.
- **Flow Field:** new default look, a grid of points carried by a shearing flow field.
- **Fractal:** new default structure, a recursive network of linked clusters that rewires on drops.
- **Grain:** new default look, dust strung along drifting, wavy bands.
- **Spectre:** new default structure, glowing emission lines in prism colors with per-band equalization.
- **Trace:** new default form, the live signal at high gain.
- **Waveform:** new default arrangement, a solid scrolling mass of the music.
- **Lissajous:** fine translucent ribbons tracing a tumbling knot; new *Knot complexity* setting.
- **ASCII:** bold *x % X & # @* glyphs in grey and white by default.
- **Oscilloscope:** stereo X/Y in green phosphor by default.
- **Stroke**, **Discharge** and **Familiar:** neutral white light, a fuller Familiar body, denser lightning branches, and the Stroke pen keeps to a centered square.
- The Magnetic starter scene shows the new Ferro.

Scenes and presets saved with earlier versions keep the settings they stored; anything they didn't store now takes the new defaults.


## [1.2.0] - 2026-10-17

### Added
- Five new modules:
  - **Tunnel:** an endless flight through a curving tunnel of light rings, wire grid, light panels or warp streaks, round or polygonal. Rings are born at the far end with the energy of that moment, so every hit flies towards the viewer.
  - **Horizon:** a wireframe landscape grown from the spectrum, rolling towards a setting sun, a moon or a glow, with valley, ridge and left-to-right layouts.
  - **Strings:** plucked by the hits and bowed by their own band; horizontal, vertical, harp or across a circle, with a shutter blur.
  - **Halo:** rings of light thrown from the center by every hit, shaped by the spectrum or waveform of that instant.
  - **Cells:** a moving Voronoi tissue in glass, organic, crystal or stained-glass styles; every cell listens to its own slice of the spectrum.
- Three starter scenes: Hyperspace, Sunset Run and Stained Glass.
- Module reference (`docs/MODULES.md`) generated from the modules' parameter lists, with `npm run docs:modules`.
- README images rendered from the app itself (`npm run docs:images`).
- Contributing guide, code of conduct, security policy, and issue and pull request templates.

### Changed
- **Ferro rebuilt from scratch** as a raymarched 3D scene: a pool of glossy ferrofluid with sharp concave spikes on a studio floor, softbox and rim-light reflections, a glossy or matte floor, satellite droplets that merge with the body, and an orbiting camera. New settings: spike layout (hexagonal or rings), what the spikes follow (the whole mix, the spectrum from center to edge, or ripples on kicks), spike height, sharpness, irregularity, body height, wobble, magnet wander, lattice spin, camera height, angle, orbit and zoom, backdrop color, exposure and quality.
- The Magnetic starter scene uses the new Ferro.

## [1.1.0] - 2026-10-16

### Added
- **Look** tab for every widget: hue, saturation, brightness, contrast and invert; zoom, rotation, spin, offset and flips; mirror symmetry (left/right, top/bottom, four quadrants, kaleidoscope with 3–16 segments); glow, trails, pixelate and vignette.
- **Audio** tab for every widget: reactivity, which part of the mix to listen to (whole mix, bass and kicks, mids, highs), smoothing, hit strength and motion speed.
- One-click color palettes: Phosphor, Ember, Ice, Neon, Sunset, Gold, Pastel and Mono.
- Presets now include the Look and Audio settings.
- New module settings:
  - Spectre: frequency range, response curve, rounded bars and peak caps.
  - ASCII: glyph sets (blocks, dots, binary, hex, katakana or your own), font weight and spacing.
  - Flow Field: radial and crosshatch fields, spawn points, dots and dashes.
  - Trace: up to 12 parallel lines.
  - Oscilloscope: echoes.
  - Lissajous: 3D tilt and tumble.
  - Fractal: pan and color cycling.
  - Aura: motion styles. Ferro: spike sharpness. Oscillon: beam weave. Discharge: strike origin. Grain: drift. Familiar: point size. Waveform: ring rotation and twist.
- Live thumbnails in the module library and the layer list.
- Status bar with stage size, frame rate, widget count and audio source.
- Right-click menu on widgets.
- Click a slider's value to type an exact number.

### Changed
- Module settings are grouped into collapsible sections.
- Refined dark interface: spacing, typography and controls.
- Fractal rendering rewritten: cleaner Julia, Kali and folded-geometry sets with optional edge smoothing.
- ASCII renders much faster.

## [1.0.0] - 2026-10-16

First public release. Free and open source under the MIT license, for Windows 10 and 11 (64-bit).

### Added
- Fifteen audio-reactive modules: ASCII, Aura, Ferro, Flow Field, Fractal, Grain, Lissajous, Oscilloscope, Spectre, Trace, Waveform, Oscillon, Stroke, Discharge and Familiar.
- Free composition: move, resize, layer, blend, group, align, lock, hide and duplicate widgets; glass, solid and clear card backgrounds with rounded corners.
- Audio sources: system audio, inputs, virtual cables, track files and a built-in demo beat.
- Shared analysis: band levels, kick, snare and hi-hat detection, pitch, and build-up and drop detection.
- Presets, scenes (with `.sfscene` import and export) and seven starter scenes.
- Randomize and Reset to defaults for every module.
- Track playback with loop, monitor and seek, and **Export video from this track** to MP4.
- Live recording of the stage, a group or one widget.
- Live Output dialog for Spout and NDI (the native add-ons are not bundled yet).
- Windows installer built and published by GitHub Actions.

[Unreleased]: https://github.com/Kuzuw/signalform/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/Kuzuw/signalform/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Kuzuw/signalform/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Kuzuw/signalform/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Kuzuw/signalform/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Kuzuw/signalform/releases/tag/v1.0.0
