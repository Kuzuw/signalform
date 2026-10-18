/* The EffectCraft plug-in API v1 exports for one effect (include at the end of the effect's .c file).
 * See sf.h. Native builds export sf_manifest() and sf_entry() for the test harness instead. */
#ifndef SF_ABI_H
#define SF_ABI_H

static const char sf_manifest_json[] = SF_MANIFEST;

#ifdef __wasm__
#define SF_EXPORT(name) __attribute__((export_name(name)))

SF_EXPORT("ec_api_version") int ec_api_version(void) { return 1; }
SF_EXPORT("ec_manifest_ptr") int ec_manifest_ptr(void) { return (int)(unsigned long)sf_manifest_json; }
SF_EXPORT("ec_manifest_len") int ec_manifest_len(void) { return (int)sizeof(sf_manifest_json) - 1; }

/* one buffer for the parameters and pixels; it may be reused between frames */
SF_EXPORT("ec_alloc") int ec_alloc(int bytes) {
  u32 base = ((u32)(unsigned long)&__heap_base + 15u) & ~15u, need = base + (u32)bytes;
  u32 have = (u32)__builtin_wasm_memory_size(0) * 65536u;
  if (need > have && __builtin_wasm_memory_grow(0, (need - have + 65535u) / 65536u) == (unsigned long)-1) return 0;
  sf_end = need;
  return (int)base;
}

SF_EXPORT("ec_render") int ec_render(int pixels, int width, int height, int params, int nparams, double time, double scale) {
  if (width <= 0 || height <= 0) return 0;
  return sf_render((float *)(unsigned long)pixels, width, height, (const double *)(unsigned long)params, nparams, time, scale);
}
#else
const char *sf_manifest(void) { return sf_manifest_json; }
int sf_entry(float *px, int w, int h, const double *pr, int np, double t, double scale) { return sf_render(px, w, h, pr, np, t, scale); }
#endif

#endif
