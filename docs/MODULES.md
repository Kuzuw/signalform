# Module reference

> Generated from the code by `npm run docs:modules`. Do not edit by hand.

Signalform ships with 15 modules. Every widget also has the shared [Look](#look-every-widget) and [Audio](#audio-every-widget) controls, whatever its module.

[ASCII](#ascii) · [Aura](#aura) · [Ferro](#ferro) · [Flow Field](#flow-field) · [Fractal](#fractal) · [Grain](#grain) · [Lissajous](#lissajous) · [Oscilloscope](#oscilloscope) · [Spectre](#spectre) · [Trace](#trace) · [Waveform](#waveform) · [Oscillon](#oscillon) · [Stroke](#stroke) · [Discharge](#discharge) · [Familiar](#familiar)

## ASCII

<img src="images/modules/ascii.jpg" width="420" alt="ASCII">

*Audio-reactive character rasterization.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Source | Noise field · Spectrum · Waveform · Your text | Noise field |
|  | Text<br><sub>shown when Source: Your text</sub> | text | `SIGNAL` |
| **Glyphs** | Glyph set | Classic  .:-=+*#%@ · Blocks ░▒▓█ · Dots ·•● · Binary 01 · Hex 0–F · Lines -=≡ · Katakana · My characters | Classic  .:-=+*#%@ |
|  | Characters (light → dense)<br><sub>shown when Glyph set: My characters</sub> | text | ` .:-=+*#%@` |
|  | Weight | Light · Regular · Medium · Bold | Medium |
|  | Glyph size | 6 – 40 | 12 |
|  | Letter spacing | 0.45 – 1.2 | 0.62 |
| **Motion** | Density | 0.2 – 2 | 1 |
|  | Glyph motion | Still · Drift · Rain · Jitter | Drift |
|  | Motion speed | 0 – 3 | 1 |
|  | Bass punch | 0 – 2 | 1 |
|  | Hi-hat sparkle | 0 – 2 | 1 |
|  | Columns follow frequencies | on / off | on |
| **Color** | Coloring | Single color · By intensity · By frequency | By intensity |
|  | Color A | color | `#cfd6e6` |
|  | Color B | color | `#ff7a3d` |
|  | Invert | on / off | off |

## Aura

<img src="images/modules/aura.jpg" width="420" alt="Aura">

*Light bends into cinematic motion.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Color A | color | `#ff8a3d` |
|  | Color B | color | `#5ab8ff` |
|  | Softness | 0.3 – 3 | 1.2 |
|  | Intensity | 0.2 – 3 | 1 |
|  | Motion | Drifting · Orbiting · Passing by · Still in a row | Drifting |
|  | Spread | 0.2 – 2 | 1 |
|  | Light sources | 1 – 7 | 4 |
|  | Optical streaks | 0 – 1.5 | 0.6 |
|  | Diffraction spikes | None · 4 points · 6 points · 8 points | 6 points |
|  | Diffraction color split | 0 – 2 | 0.8 |
|  | Drift speed | 0 – 3 | 1 |
|  | Film grain | 0 – 0.12 | 0.03 |

## Ferro

<img src="images/modules/ferro.jpg" width="420" alt="Ferro">

*Reactive magnetic fluid simulation.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Magnetic strength | 0 – 2 | 1 |
|  | Spike density | 6 – 40 | 18 |
|  | Body size | 0.08 – 0.4 | 0.27 |
|  | Spike sharpness | 0.6 – 4 | 1.8 |
|  | Turbulence | 0 – 2 | 0.8 |
|  | Orbiting droplets | 0 – 6 | 4 |
|  | Metal tint | color | `#c9d2e3` |
|  | Rim light | color | `#ff6a2b` |
|  | Rim light amount | 0 – 2 | 1 |
|  | Gloss | 0 – 2 | 1 |
|  | Light angle | 0 – 6.28 | 0.8 |
|  | Motion speed | 0 – 3 | 1 |

## Flow Field

<img src="images/modules/flowfield.jpg" width="420" alt="Flow Field">

*Sound flows through motion fields.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Field** | Stream pattern | Curl noise · Vortex · Waves · Radial burst · Crosshatch | Curl noise |
|  | Particles | 500 – 20000 | 4000 |
|  | Flow speed | 0.1 – 4 | 1 |
|  | Field scale | 0.2 – 4 | 1 |
|  | Turbulence | 0 – 3 | 1 |
|  | Field evolution | 0 – 3 | 1 |
|  | Burst on hits | 0 – 2 | 1 |
|  | Particles start | Everywhere · From the center · From the edges · From the bottom | Everywhere |
|  | Particle life | 0.2 – 3 | 1 |
| **Drawing** | Trail length | 0.5 – 0.99 | 0.9 |
|  | Particle shape | Streaks · Dots · Dashes | Streaks |
|  | Brightness | 0.1 – 3 | 1 |
|  | Line width | 0.5 – 4 | 1 |
| **Color** | Coloring | By direction · By speed · Single color | By direction |
|  | Color A | color | `#ff8a3d` |
|  | Color B | color | `#38c6c0` |

## Fractal

<img src="images/modules/fractal.jpg" width="420" alt="Fractal">

*Sound transformed into recursive form.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Structure | Julia set · Kali set · Folded geometry | Folded geometry |
|  | Detail (iterations) | 6 – 160 | 24 |
|  | Zoom | 0.3 – 4 | 1 |
|  | Kaleidoscope segments | 1 – 16 | 1 |
|  | Rotation speed | 0 – 2 | 0.3 |
|  | Harmonic deformation | 0 – 3 | 1 |
|  | Pan X | -1.5 – 1.5 | 0 |
|  | Pan Y | -1.5 – 1.5 | 0 |
| **Color** | Color cycling | 0 – 1 | 0.1 |
|  | Palette shift | 0 – 1 | 0.05 |
|  | Saturation | 0 – 1.4 | 0.9 |
|  | Glow | 0 – 2 | 1 |
|  | Evolution speed | 0 – 3 | 1 |
|  | Smooth edges (uses more GPU) | on / off | on |

## Grain

<img src="images/modules/grain.jpg" width="420" alt="Grain">

*Dynamic grain structures and flow.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Grains | 5000 – 120000 | 50000 |
|  | Grain size | 1 – 6 | 2 |
|  | Flow speed | 0 – 3 | 1 |
|  | Turbulence | 0 – 3 | 1 |
|  | Pattern scale | 0.3 – 3 | 1 |
|  | Surface memory | 0.5 – 0.99 | 0.9 |
|  | Drift | Wander · Rise · Fall like sand · Wind · Swirl | Wander |
|  | Bass shake | 0 – 2 | 1 |
|  | Scatter on hits | 0 – 2 | 1 |
|  | Shadow color | color | `#3a2a1f` |
|  | Highlight color | color | `#ffd9a8` |
|  | Contrast | 0.2 – 3 | 1 |

## Lissajous

<img src="images/modules/lissajous.jpg" width="420" alt="Lissajous">

*Flowing harmonic line structures.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Curve source | Harmonic (follows pitch) · Stereo X/Y signal · Both layered | Harmonic (follows pitch) |
|  | Frequency ratio | Auto from sound · 1 : 1 · 1 : 2 · 2 : 3 · 3 : 4 · 3 : 5 · 4 : 5 · 5 : 6 · 5 : 8 · 2 : 5 · 3 : 7 | Auto from sound |
|  | Layers | 1 – 12 | 5 |
|  | Layer phase spread | 0 – 1 | 0.18 |
|  | Phase drift | 0 – 3 | 0.6 |
|  | Size | 0.2 – 1.2 | 0.8 |
|  | 3D tilt | 0 – 1.5 | 0.35 |
|  | Tumble speed | 0 – 2 | 0.3 |
|  | Signal interference | 0 – 2 | 0.7 |
|  | Line width | 0.5 – 5 | 1.4 |
|  | Glow | 0 – 2 | 1 |
|  | Persistence | 0 – 0.97 | 0.75 |
|  | Color A | color | `#7fe3d6` |
|  | Color B | color | `#ff6fae` |

## Oscilloscope

<img src="images/modules/oscilloscope.jpg" width="420" alt="Oscilloscope">

*Signal rendered through light.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Display | Waveform (Y/T) · Stereo phase (X/Y) · Custom shape | Custom shape |
|  | Shape<br><sub>shown when Display: Custom shape</sub> | Circle · Square · Triangle · Star · Heart · Infinity · My drawing | Circle |
|  | Draw a shape on the widget<br><sub>shown when Display: Custom shape</sub> | button |  |
|  | Gain | 0.1 – 4 | 1 |
|  | Channels<br><sub>shown when Display: Waveform (Y/T)</sub> | Mono mix · Left + right | Left + right |
|  | Shape rotation<br><sub>shown when Display: Custom shape</sub> | -2 – 2 | 0.2 |
|  | Echoes | 0 – 8 | 0 |
|  | Echo size step<br><sub>shown when Echoes ≥ 1</sub> | -0.3 – 0.3 | -0.12 |
|  | Echo twist<br><sub>shown when Echoes ≥ 1</sub> | -90 – 90 | 12 |
| **Phosphor** | Phosphor persistence | 0 – 0.97 | 0.8 |
|  | Beam width | 0.5 – 5 | 1.5 |
|  | Optical bloom | 0 – 2 | 1 |
| **Color** | Phosphor color | color | `#8dffb0` |
|  | Graticule | on / off | off |

## Spectre

<img src="images/modules/spectre.jpg" width="420" alt="Spectre">

*Harmonic frequencies visualized as light.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Structure | Luminous bands · Spectral layers · Flowing spectrogram · Radial spectrum | Spectral layers |
|  | Coloring | Per band · Monochrome | Per band |
|  | Bands | 8 – 64 | 48 |
| **Frequencies** | Lowest frequency | 30 – 2000 | 30 |
|  | Highest frequency | 400 – 16000 | 16000 |
|  | Response curve | 0.5 – 3 | 1.4 |
|  | Treble boost | 0 – 2 | 0.4 |
|  | Layers<br><sub>shown when Structure: Spectral layers / Flowing spectrogram</sub> | 1 – 24 | 10 |
| **Shape** | Height | 0.2 – 1.5 | 0.8 |
|  | Bar gap<br><sub>shown when Structure: Luminous bands / Radial spectrum</sub> | 0 – 0.9 | 0.36 |
|  | Rounded bars<br><sub>shown when Structure: Luminous bands</sub> | on / off | on |
|  | Peak caps<br><sub>shown when Structure: Luminous bands / Radial spectrum</sub> | on / off | on |
|  | Mirror | on / off | on |
|  | Fall smoothing | 0 – 0.98 | 0.82 |
|  | Glow | 0 – 2 | 1 |
|  | Persistence | 0 – 0.95 | 0.4 |
| **Color** | Low frequencies | color | `#ff4d2e` |
|  | Mid frequencies | color | `#ffd166` |
|  | High frequencies | color | `#5ad1ff` |
|  | Monochrome color<br><sub>shown when Coloring: Monochrome</sub> | color | `#e8eefc` |

## Trace

<img src="images/modules/trace.jpg" width="420" alt="Trace">

*A living line driven by sound.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Form | Open line · Closed loop · Spiral | Open line |
|  | Lines | 1 – 12 | 1 |
|  | Line spacing<br><sub>shown when Lines ≥ 2</sub> | 0 – 1 | 0.25 |
|  | Line delay<br><sub>shown when Lines ≥ 2</sub> | 0 – 1 | 0.3 |
| **Motion** | Control points | 8 – 96 | 40 |
|  | Tension | 0.2 – 4 | 1.2 |
|  | Damping | 0.5 – 0.99 | 0.86 |
|  | Deformation | 0 – 2 | 1 |
|  | Shape drift | 0 – 2 | 0.6 |
|  | Ripple on hits | 0 – 2 | 1 |
| **Light** | Thickness | 0.5 – 8 | 2.2 |
|  | Glow | 0 – 2 | 1 |
|  | Afterimage | 0 – 0.97 | 0.7 |
|  | Color A | color | `#f4f1ff` |
|  | Color B | color | `#ff5c8a` |

## Waveform

<img src="images/modules/waveform.jpg" width="420" alt="Waveform">

*Layered waveform shapes from audio.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Settings** | Arrangement | Radial rings · Stacked contours · Mirrored mass | Radial rings |
|  | Layers | 3 – 60 | 24 |
|  | Layer spacing | 0.2 – 2 | 1 |
|  | Amplitude | 0.1 – 3 | 1 |
|  | Detail | 32 – 400 | 160 |
|  | Filled shapes | on / off | on |
|  | Color | Multi-color palette · Single color | Multi-color palette |
|  | Palette<br><sub>shown when Color: Multi-color palette</sub> | Ember · Glacier · Acid · Dusk · Mono | Ember |
|  | Single color<br><sub>shown when Color: Single color</sub> | color | `#e9edf7` |
|  | Line width | 0.5 – 4 | 1.2 |
|  | Flow speed | 0.2 – 3 | 1 |
|  | Ring rotation<br><sub>shown when Arrangement: Radial rings</sub> | -2 – 2 | 0.25 |
|  | Layer twist<br><sub>shown when Arrangement: Radial rings</sub> | -1 – 1 | 0 |
|  | Thicken on kicks | 0 – 3 | 0.8 |

## Oscillon

<img src="images/modules/oscillon.jpg" width="420" alt="Oscillon">

*A shell drawn by a phosphor beam.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Shape** | Form | Changes with the music · Sphere · Spindle · Torus · Shell · Bell · Knot | Changes with the music |
|  | Snap to a new form<br><sub>shown when Form: Changes with the music</sub> | On heavy hits and drops · Only on drops · Never | On heavy hits and drops |
|  | Scale | 0.3 – 1.6 | 1 |
|  | Swelling from sounds | 0 – 2 | 1 |
|  | Squeeze on build, open on drop | on / off | on |
| **Beam** | Beam samples per frame | 4000 – 80000 | 20000 |
|  | Beam weave | 3 – 120 | 37 |
|  | Weave ratio | 0.2 – 1.5 | 0.618 |
|  | Beam speed | 0.1 – 3 | 1 |
|  | Phosphor persistence | 0 – 0.97 | 0.82 |
|  | Rotation | -2 – 2 | 0.35 |
| **Light** | Phosphor | color | `#e8eeff` |
|  | Shadow tint | color | `#2a3550` |
|  | Exposure | 0.2 – 4 | 1 |
|  | Bloom | 0 – 2 | 0.8 |

## Stroke

<img src="images/modules/stroke.jpg" width="420" alt="Stroke">

*A pen of light on a long exposure.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Motion** | Pen speed | 0.1 – 3 | 1 |
|  | Follow the melody | 0 – 1 | 0.6 |
|  | Wander | 0 – 2 | 0.8 |
|  | Corner on hits | 0 – 1 | 0.7 |
|  | Race a laser figure on big drops | on / off | on |
| **Light** | Exposure length | 0.5 – 0.998 | 0.985 |
|  | Slow stroke width | 1 – 24 | 9 |
|  | Fast stroke width | 0.3 – 4 | 0.8 |
|  | Flare size | 0 – 2 | 1 |
|  | Light | color | `#f4f6ff` |
|  | Halo | color | `#8fb4ff` |

## Discharge

<img src="images/modules/discharge.jpg" width="420" alt="Discharge">

*Lightning on a photographic plate.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Strikes** | Strikes come from | Every sound · Kicks only · Kicks and snares | Every sound |
|  | Strikes start from | The top · The bottom · The sides · The center · Anywhere | The top |
|  | Sensitivity | 0.2 – 2 | 1 |
|  | Channel length | 0.3 – 1.6 | 1 |
|  | Branching | 0 – 2 | 1 |
|  | Roughness | 0.3 – 2 | 1 |
|  | Hold back on builds, break loose on drops | on / off | on |
| **Plate** | Channel width | 0.3 – 4 | 1.4 |
|  | Afterglow | 0 – 0.95 | 0.55 |
|  | Sky flash | 0 – 1.5 | 0.7 |
|  | Plate grain | 0 – 1 | 0.35 |
|  | Core | color | `#ffffff` |
|  | Glow | color | `#9db8ff` |

## Familiar

<img src="images/modules/familiar.jpg" width="420" alt="Familiar">

*A body made of light.*

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Body** | Body | Creature · Orb · Your word | Creature |
|  | Word<br><sub>shown when Body: Your word</sub> | text | `SIGNAL` |
|  | Points of light | 5000 – 100000 | 45000 |
|  | Size | 0.3 – 1.6 | 1 |
| **Behavior** | Breathing | 0 – 2 | 1 |
|  | Scatter on hits | 0 – 2 | 1 |
|  | Gathers back | 0.2 – 3 | 1 |
|  | Sway | 0 – 2 | 1 |
|  | Turning | 0 – 2 | 0.6 |
| **Light** | Point size | 0.5 – 4 | 1 |
|  | Depth of field | 0 – 2 | 1 |
|  | Self-shadowing | 0 – 1 | 0.7 |
|  | Light | color | `#f5f3ff` |
|  | Shadow tint | color | `#3b3550` |
|  | Exposure | 0.2 – 3 | 1 |
|  | Trails | 0 – 0.9 | 0.2 |

## Look (every widget)

A post pass over the module's picture.

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Color** | Hue shift | -180 – 180 ° | 0 ° |
|  | Saturation | 0–250 % | 100 % |
|  | Brightness | 0–250 % | 100 % |
|  | Contrast | 20–250 % | 100 % |
|  | Invert | on / off | off |
| **Transform** | Zoom | 20–300 % | 100 % |
|  | Rotation | -180 – 180 ° | 0 ° |
|  | Spin | -90 – 90 °/s | 0 °/s |
|  | Offset X | -1 – 1 | 0 |
|  | Offset Y | -1 – 1 | 0 |
|  | Flip horizontally | on / off | off |
|  | Flip vertically | on / off | off |
| **Symmetry** | Mirror | None · Left ↔ right · Top ↕ bottom · Four quadrants · Kaleidoscope | None |
|  | Kaleidoscope segments<br><sub>shown when Mirror: Kaleidoscope</sub> | 3 – 16 | 6 |
| **Effects** | Glow | 0 – 2 | 0 |
|  | Trails | 0–97 % | 0 % |
|  | Pixelate | 0 – 40 | 0 |
|  | Vignette | 0–100 % | 0 % |

## Audio (every widget)

How this widget hears the music. Two widgets can react to the same track differently.

| Section | Control | Range / options | Default |
|---|---|---|---|
| **Response** | Reactivity | 0 – 3 | 1 |
|  | Listen to | Whole mix · Bass and kicks · Mids and vocals · Highs and hats | Whole mix |
|  | Smoothing | 0 – 0.95 | 0 |
|  | Hit strength | 0 – 2.5 | 1 |
| **Time** | Motion speed | 0 – 4 | 1 |
