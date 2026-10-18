//! Loads every dist/*.wasm into EffectCraft's plug-in host (wasmi, fuel-limited, no imports),
//! registers it like EffectCraft does at start-up, and renders a 480×270 frame with its defaults.
use effectcraft_effects::plugin::{PluginFrame, PluginParamKind, PluginParams, plugin};

fn main() {
    let dist = std::env::args().nth(1).unwrap_or_else(|| "../dist".into());
    let mut files: Vec<_> = std::fs::read_dir(&dist).map(|d| d.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "wasm")).collect()).unwrap_or_default();
    files.sort();
    let mut bad = 0;
    for f in &files {
        let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let res = (|| -> Result<String, String> {
            let bytes = std::fs::read(f).map_err(|e| e.to_string())?;
            let spec = effectcraft_plugin::load_wasm(&bytes, &name)?;
            let p = plugin(spec.id).ok_or("not registered")?;
            let m = p.manifest().clone();
            let (w, h) = (480u32, 270u32);
            let mut flat = Vec::new();
            for q in &m.params {
                match &q.kind {
                    PluginParamKind::Slider { default, .. } => flat.push(*default),
                    PluginParamKind::Angle { default } => flat.push(*default),
                    PluginParamKind::Checkbox { default } => flat.push(if *default { 1.0 } else { 0.0 }),
                    PluginParamKind::Popup { default, .. } => flat.push(*default as f64),
                    PluginParamKind::Point { default } => { flat.push(default[0] * w as f64); flat.push(default[1] * h as f64); }
                    PluginParamKind::Color { default } => flat.extend_from_slice(default),
                }
            }
            let mut pixels = vec![[0.0f32; 4]; (w * h) as usize];
            for (i, px) in pixels.iter_mut().enumerate() { let (x, y) = (i as u32 % w, i as u32 / w); *px = [x as f32 / w as f32, y as f32 / h as f32, 0.5, 1.0]; }
            let t0 = std::time::Instant::now();
            let mut frame = PluginFrame { width: w, height: h, pixels: &mut pixels, scale: 1.0 };
            p.render(&mut frame, &PluginParams { manifest: &m, flat: &flat }, 1.7)?;
            let ms = t0.elapsed().as_millis();
            let lit = pixels.iter().filter(|p| p[0] + p[1] + p[2] > 0.01).count();
            if pixels.iter().any(|p| p.iter().any(|v| !v.is_finite())) { return Err("rendered NaN or infinity".into()); }
            if lit < (w * h / 50) as usize { return Err("rendered an (almost) empty frame".into()); }
            Ok(format!("{} ({}, {} params) rendered 480×270 in {ms} ms in the wasmi sandbox", m.name, m.id, m.params.len()))
        })();
        match res { Ok(s) => println!("ok   {name}: {s}"), Err(e) => { bad += 1; println!("FAIL {name}: {e}"); } }
    }
    if files.is_empty() { println!("FAIL no plug-ins in {dist}"); bad += 1; }
    println!("{}", if bad == 0 { format!("problems: none ({} plug-ins)", files.len()) } else { format!("{bad} problem(s)") });
    std::process::exit(if bad == 0 { 0 } else { 1 });
}
