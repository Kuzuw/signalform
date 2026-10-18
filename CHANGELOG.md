# Changelog

All notable changes to Signalform are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.2.0] - 2026-10-18

### Added
- **Songs on the timeline: render whole sets as one video.** *Add audio* in the timeline (or drop audio files on it) puts songs on audio lanes, one after another; the timeline becomes the set and *Timeline audio* the music, so every song drives the visuals. Drag songs to move them (up or down for the other lane), trim their ends, drag the dots on top to fade them, and overlap two songs on lanes A and B to crossfade (equal-power). Right-click a song for *Crossfade from the previous song* (6 s or 16 s), *Start when the previous song ends*, fades, louder and quieter, *Restore the full song* and *Remove and close the gap*. Songs are decoded only around the playhead and let go once played, so an hour-long set doesn't fill the memory; scenes remember where the files are, and a moved file can be found again from its clip.
- **Exact render** (the default for a set or a track): the music runs through an offline audio engine and every frame is analysed, drawn at the video's resolution and encoded with WebCodecs (H.264 from the graphics card's encoder where there is one), then joined with the audio by ffmpeg. The video is perfectly smooth whatever the computer, the app stays responsive while it works, and it usually finishes faster than real time. The progress shows the speed and the time left. *Real time* is still there.
- 24 fps as a render frame rate.

### Changed
- **Real-time recording is lighter:**
  - Frames are composed only at the chosen frame rate, no longer at the screen's refresh rate (a 144 Hz screen composed 144 frames a second for a 60 fps video).
  - Hidden layers are no longer drawn while the whole stage is recorded.
  - With effects on the stage, the recorded picture is shown on screen instead of being composed a second time.
  - Plain widgets are drawn straight into the video, and the others reuse a scratch canvas instead of reallocating one per widget per frame.
  - Widgets draw at the video's resolution (sharper 4K renders, less work on high-DPI screens).
  - Module thumbnails pause during a take, and takes and Live Output keep running while the window is minimized.

## [2.1.0] - 2026-10-18

### Added
- **Timeline** under the stage (*View ▸ Timeline*, Ctrl+T):
  - **Keyframes for any setting.** A ◆ beside every setting in Module, Look and Audio, and beside Opacity, adds a key at the playhead; once a setting has keys, changing it keys it where the playhead is. Numbers and colours travel between keys (linear, or eased in and out); choices and switches change at the key, and any key can be set to Hold. Drag keys along their row, right-click for options, Delete to remove; keys snap to the playhead and to each other. The inspector follows the animated values as the playhead moves.
  - **In and out points.** Each layer has a bar: drag its ends to set when it appears and disappears, or drag it to move it. A layer outside its bar is not drawn.
  - **The playhead.** With a track loaded it is the track's position: play, scrub from the ruler, and see the track's waveform. Without one the timeline runs on its own clock for a length you set. Zoom with Ctrl+scroll or the zoom slider; it pages along while playing.
  - **Render follows the timeline.** *Export video from this track* plays the timeline with the track; without a track, **Render** records the timeline for its length, with or without the audio of the current source.
  - Saved with the scene; duplicating a layer copies its keys.
- **Signalform for EffectCraft:** Signalform's visuals as WebAssembly effect plug-ins for [EffectCraft](https://github.com/storytold/effectcraft), the open-source motion graphics app by the ArtCraft Team and the EffectCraft contributors: **CRT Screen** (an effect for any layer), and **Tunnel**, **Cells**, **Ferro** (with REACTIVE!!!), **Horizon** and **Aura** (generators, with Audio: Level, Bass, Mids, Highs, Kick and Drop sliders). Every release now includes `Signalform-for-EffectCraft-x.y.z.zip`. See [plugins/effectcraft](plugins/effectcraft/README.md).
- **Export for EffectCraft** in the track card: Signalform analyses the whole track offline, frame by frame (much faster than playing it), and saves a script that adds a *Signalform Audio* null with keyframed Level, Bass, Mids, Highs, Kick, Snare, Hi-hat, Build and Drop sliders to an EffectCraft (or After Effects) composition and links the Signalform effects to it. The **Signalform Audio Link** panel links effects added later, or works from EffectCraft's own Convert Audio to Keyframes.
- CI builds the plug-ins, renders each one in EffectCraft's own plug-in host, runs the export and panel scripts against a model of the scripting API, and drives the timeline in headless Chromium.

### Changed
- *File ▸ Render Track to Video…* is now *Render to Video…*, and renders the timeline when no track is loaded.

## [2.0.0] - 2026-10-18

### Added
- **Real-life oscilloscope** (*Oscilloscope → Look → Real-life oscilloscope*): the whole instrument, a dual-trace analog scope with the tube recessed in its front panel. VOLTS/DIV (with the red variable-gain knob), SEC/DIV, trigger level, position, intensity, focus and scale illumination knobs turn to the scope's actual settings; the mode, trigger and slope buttons light up for what is selected; the POWER, TRIG'D and READY lamps light live. The panel adapts to wide and tall layers and is redrawn only when a setting changes.
- **REACTIVE!!!** switch and **Reaction strength** for Ferro (*Module → Reaction*). The magnet's field now follows the loudness and the bass: spikes stand up all around the body, the body pumps on kicks and when the bass rises, the beads are shoved apart on hits and snap back, snares twist it and swell its buds, the highs stir it, and droplets fly harder. REACTIVE!!! more than doubles all of it, raises the spike crown higher and shakes the camera on kicks.
- **Search and categories in the module library**: type to filter by name or description (Esc clears); modules are grouped into Signal, Light and particles, Forms, and Worlds and type.
- **Continuous integration** on GitHub: every push and pull request runs source and settings checks, verifies the module reference, scores beat detection (kick and snare F1 must stay at 80% or more) and clicks through the whole interface in headless Chromium. `npm test` runs the checks locally.

### Changed
- **CRT screen, more realistic:**
  - The beam spot is round: bright parts of the picture spread sideways as well as up and down.
  - *Power supply sag*: bright scenes make the picture swell a little and dim, like a real high-voltage supply and brightness limiter.
  - *Overscan*: a TV crops the picture's edges; a negative value underscans and shows the black border of a studio monitor.
  - *Geometry errors*: a slight tilt, keystone and uneven horizontal linearity.
  - *Colour purity errors*: faint tints towards the corners where the beams land a little off their phosphors.
  - *Dust and smudges* on the glass, and a thin glint of light along the glass edge.
  - A new *Geometry* section; every monitor model sets the new controls too.
- **Modules, modernized** (each keeps its character; the previous look is kept as an option where it changed):
  - **Tunnel**: every ring lights the glossy wall around it, the tube catches a sheen on its upper side, and the default colours go from warm brown to a cool white-to-blue depth (*Light on the walls*).
  - **Cells**: frosted glass panes lit from the upper left, hair-thin bright walls with a soft halo, panes at slightly different depths, and calmer blue and teal colours.
  - **Waveform**: fine rounded bars, brightest at the centre line, older columns fading out and the newest glowing (*Look → Fine bars*; *Solid mass* is the previous look).
  - **Flow Field**: each point of the lattice draws a fine tail back to its home, so the field reads as a clean vector map, and the fastest points take the accent colour.
  - **Trace**: the live signal leaves a short afterimage, glows in two layers, has a soft fill under the line and an optional measurement grid.
  - **Grain**: the dust has depth: tiny far specks, a sharp middle layer with a soft bloom, and rare out-of-focus specks drifting past in front (*Depth of field*).
  - **ASCII**: a contrast curve carves clear shapes out of the field instead of an even wall of glyphs, lighter type by default, and a soft glow.
- **Interface**: a new logo, a divider between the scene controls and the actions, quieter scrollbars, status bar readouts in tidy segments, and focus rings and hover states on sliders.
- The Stained Glass starter keeps its warm colours.


## [1.8.0] - 2026-10-17

### Changed
- **CRT screen rebuilt as a full CRT simulation.** The picture goes through the same stages as on a real set, each at the resolution it really has:
  - **The signal.** RGB, S-Video, composite or an aerial (RF). Composite is a real NTSC encode and decode: colour rides on a subcarrier, so fine detail turns into rainbows, colour edges bleed and crawl, and the set's sharpness control rings around edges. Snow, ghosting, line wobble and a rolling hum bar for a tired signal.
  - **The TV's knobs.** Brightness, contrast, colour, tint and colour temperature (6500 K studio white to a cool 9300 K).
  - **The beam.** Each scan line is drawn as a gaussian spot that widens on bright parts of the picture, so scan lines show in the dark and bloom shut in the highlights. Scan lines are filtered to the pixel, so they don't shimmer or alias when the layer is resized. Red and blue can land slightly off the green (misconvergence, stronger towards the corners). Phosphor persistence, with green fading slowest like real colour phosphors, flicker and an interlaced mode.
  - **The phosphor mask.** Aperture grille (Trinitron), slot mask or shadow mask with round dots, filtered to the pixel so it doesn't make moiré, with an adjustable pitch.
  - **The glass.** Spherical, cylindrical or flat curvature, rounded corners, halation, glow diffused in the faceplate, edge falloff, the faint grey of the glass and a window reflection, and a plastic bezel that reflects the picture.
  - **Degauss wobble on drops:** after a drop the colours swim and the picture wobbles for a second, like switching an old set on.
  - **Six monitors to start from** (*Model*): living-room TV, arcade monitor, studio monitor (PVM), computer monitor, black-and-white TV, and an old TV on an aerial. Choosing one sets every other setting.
  - Its settings are grouped in collapsible sections (Monitor, Signal, Picture, Beam, Phosphor mask, Glass).
  - Built to be light: only one pass runs per screen pixel; the signal is decoded at its own resolution (240 lines by default) and the glow on a buffer a sixth of the size.
  - Scenes saved with the old CRT screen keep their scan line, mask, curvature, vignette and flicker settings.

### Added
- **Late Night TV** starter scene: a sunset landscape on an old living-room TV.


## [1.7.0] - 2026-10-17

### Added
- **Effect rack.** A new **Effects** tab on every widget holds a chain of GPU effects you add from a menu, reorder (drag, or the arrows), switch off, duplicate, reset or remove. With nothing selected, the inspector shows the **stage's own rack**, which applies to the whole picture and to recordings and Live Output of the whole stage. 23 effects:
  - Light: Glow, Light streaks (anamorphic, vertical or cross)
  - Blur: Blur, Motion blur, Zoom blur
  - Colour: Colour grade, Gradient map, Ink threshold
  - Stylize: Pixelate (squares or LED dots), Halftone, Posterize (with dither), Edge glow
  - Space: Kaleidoscope, Mirror, Warp (waves, ripples, swirl, bulge)
  - Lens: RGB split, Vignette, Sharpen
  - Texture: Film grain, CRT screen, Glitch
  - Time: Feedback echo, Strobe
- Every effect's main setting can **follow the music**: loudness, bass, mids, highs, kicks, snares, hi-hats, build-ups or drops, with an amount from −100% to 100%. Strobe flashes on kicks out of the box.
- Effects are saved with scenes and with presets. All effects share one GPU context, however many widgets use them.

### Changed
- **Oscilloscope, more realistic:**
  - The tube face sits in a bezel, with a rounded screen the beam can't leave (*Tube frame*; *Screen only* removes it).
  - The spot defocuses towards the corners (*Corner defocus*) and grows with the beam intensity.
  - A fine phosphor grain (*Phosphor grain*).
  - Two kinds of halation: a near glow from light scattered in the phosphor, and a wider halo from light reflected inside the faceplate.
  - The graticule is lit from the bottom edge of the faceplate.
  - Optional trace noise.
- **Oscilloscope, faster:** it renders straight to its own canvas (no full-size copy per frame); the readout is redrawn only when its text changes; samples are read straight from the stream; each trace keeps its own beam history instead of copying arrays for every sample. About 0.3 ms of CPU time per frame on the test machine.


## [1.6.0] - 2026-10-17

### Changed
- **Oscilloscope is now a real oscilloscope simulator.**
  - **Every sample is drawn.** The audio thread streams the whole signal to the scope, so the beam traces it continuously instead of redrawing the latest snapshot each frame.
  - **Beam physics on the GPU.** Each move of the beam is a gaussian spot integrated along its path, so slow parts burn bright and fast jumps leave faint lines, like a CRT. The beam path is smoothed between samples (Beam interpolation 1×–8×).
  - **Real phosphors** with a fast flash and a slow afterglow that fade at their own rates: P31, P1, P7 (blue flash, yellow afterglow), P4, P11, P3 or a custom colour. Persistence is exact at any frame rate. Halation, focus and intensity controls.
  - **Y/T with a real time base:** time/div, trigger source (CH1, CH2, CH1 + CH2), slope, level, Auto / Normal / Free run, holdoff; dual trace, single channel or Add, each channel with its own position.
  - **X/Y** with volts/div, variable gain, X and Y position and an optional 45° mid/side rotation.
  - Etched 10 × 8 graticule with minor ticks and scale illumination, an on-screen readout, and the tube glass.
  - Shapes and pictures are drawn by the same beam at a chosen redraw rate, with the beam blanked between strokes.


## [1.5.0] - 2026-10-17

### Added
- **Pictures in Oscilloscope and Oscillon.** Choose a photo or drawing and the beam traces its outlines, the way oscilloscope art is made. Settings for edge detail, shading dark areas, light-on-dark subjects, beam points and sweep; the picture wobbles with the sound and pulses on kicks. In Oscillon (*Form → Your picture*) it becomes a swaying sheet of light that swells with every sound. The picture is saved inside the scene.
- **Render quality** at the bottom of the stage: *Auto* (lowers the resolution while the frame rate is low and raises it again when there is room), *Full quality*, *Balanced* and *Fast*.

### Changed
- **Kick detection rebuilt.** Hits are now found on the audio thread, sample-accurately and independently of the frame rate. Every rise of the low end is judged about 24 ms later by a small trained classifier that looks at its loudness against earlier kicks, the click on top, how its pitch falls and whether it lands on the beat, so bass notes no longer read as kicks. On a varied test set of synthetic mixes kick accuracy (F1) went from 64% to 90%.
- **Snare detection rebuilt** the same way: a second small classifier judges every broadband jump by how noisy and flat it is across the mids and highs, how long it lasts and where it sits in the beat, so bass notes and kick clicks no longer read as snares. Snare accuracy (F1) on mixes it was not trained on went from 22% to 95%.
- **Ferro** no longer turns into a giant bubble on its own. Pulling everything into one drop is now off by default (*Pull into one drop*: Never / On drops / On drops and heavy kicks), eases in and out, and keeps about the same volume as the beads.
- **Faster** (measured against 1.4.0 on the same machine): Oscillon 2.8× (no trig per beam sample), Lissajous 3.3× (one path per colour group), Familiar 2×, Aura 1.3×; tone mapping and soft splats use lookup tables; widgets with a neutral Look are shown without an extra copy per frame; module tiles are drawn after the window opens and cached for the next launch, so the app starts much faster.


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

[Unreleased]: https://github.com/Kuzuw/signalform/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/Kuzuw/signalform/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Kuzuw/signalform/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Kuzuw/signalform/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Kuzuw/signalform/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Kuzuw/signalform/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Kuzuw/signalform/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Kuzuw/signalform/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Kuzuw/signalform/releases/tag/v1.0.0
