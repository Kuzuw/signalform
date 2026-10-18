/* Signalform for EffectCraft: shared plug-in core.
 *
 * EffectCraft (https://github.com/storytold/effectcraft) loads effect plug-ins as WebAssembly modules
 * through its plug-in API v1 (docs/plugins.md in that repository). A module has no imports and exports
 * memory, ec_api_version, ec_manifest_ptr/len, ec_alloc and ec_render. This header provides those
 * exports for one effect per module, plus what a module without a C library needs: a bump allocator
 * with scratch memory, and a small deterministic maths library (the same results on every machine,
 * which EffectCraft requires of plug-ins).
 *
 * Each effect's .c file defines SF_MANIFEST (its JSON manifest) and
 *   static int sf_render(float *px, int w, int h, const double *pr, int np, double t, double scale);
 * then includes "sf_abi.h" at the end. The same file also compiles natively for the test harness.
 */
#ifndef SF_H
#define SF_H

typedef unsigned int u32;
typedef unsigned char u8;
#ifdef __wasm__
typedef __SIZE_TYPE__ size_t;
#else
#include <stddef.h>
#endif

#define SF_PI 3.14159265358979f
#define SF_TAU 6.28318530717959f

/* ------------------------------------------------------------------ basic maths */
static inline float sf_abs(float x) { return __builtin_fabsf(x); }
static inline float sf_floor(float x) { return __builtin_floorf(x); }
static inline float sf_sqrt(float x) { return x > 0.f ? __builtin_sqrtf(x) : 0.f; }
static inline float sf_min(float a, float b) { return a < b ? a : b; }
static inline float sf_max(float a, float b) { return a > b ? a : b; }
static inline float sf_clamp(float x, float a, float b) { return x < a ? a : x > b ? b : x; }
static inline float sf_sat(float x) { return x < 0.f ? 0.f : x > 1.f ? 1.f : x; }
static inline float sf_fract(float x) { return x - sf_floor(x); }
static inline float sf_mix(float a, float b, float t) { return a + (b - a) * t; }
static inline float sf_smooth(float e0, float e1, float x) { float t = sf_sat((x - e0) / (e1 - e0)); return t * t * (3.f - 2.f * t); }

/* sin and cos: reduce to [-pi, pi], then a minimax polynomial (error < 2e-6) */
static inline float sf_sin(float x) {
  x = x - SF_TAU * sf_floor((x + SF_PI) / SF_TAU);
  float x2 = x * x;
  return x * (1.f + x2 * (-0.16666666f + x2 * (0.0083333310f + x2 * (-0.00019840874f + x2 * (2.7525562e-6f + x2 * -2.3889859e-8f)))));
}
static inline float sf_cos(float x) { return sf_sin(x + 1.5707963267949f); }

/* exp2 by splitting into an integer power (exponent bits) and a polynomial on [0, 1) */
static inline float sf_exp2(float x) {
  if (x < -126.f) return 0.f;
  if (x > 127.f) x = 127.f;
  float fi = sf_floor(x), f = x - fi;
  float p = 1.f + f * (0.69314718f + f * (0.24022650f + f * (0.055504109f + f * (0.0096181291f + f * 0.0013333558f))));
  union { float f; u32 i; } u; u.i = (u32)((int)fi + 127) << 23;
  return p * u.f;
}
static inline float sf_exp(float x) { return sf_exp2(x * 1.4426950409f); }
/* log2 from the exponent bits and a polynomial on the mantissa */
static inline float sf_log2(float x) {
  if (x <= 0.f) return -126.f;
  union { float f; u32 i; } u; u.f = x;
  float e = (float)((int)((u.i >> 23) & 255) - 127);
  u.i = (u.i & 0x007fffff) | 0x3f800000;
  float m = u.f; /* 1 <= m < 2 */
  float y = (m - 1.f) / (m + 1.f), y2 = y * y;
  return e + 2.8853900818f * y * (1.f + y2 * (0.33333333f + y2 * (0.2f + y2 * (0.14285714f + y2 * 0.11111111f))));
}
static inline float sf_pow(float x, float y) { return x <= 0.f ? 0.f : sf_exp2(y * sf_log2(x)); }
static inline float sf_atan(float x) {
  float a = sf_abs(x), r;
  if (a > 1.f) { float z = 1.f / a; r = 1.5707963f - z * (0.99997726f + z * z * (-0.33262347f + z * z * (0.19354346f + z * z * (-0.11643287f + z * z * (0.05265332f - z * z * 0.01172120f))))); }
  else r = a * (0.99997726f + a * a * (-0.33262347f + a * a * (0.19354346f + a * a * (-0.11643287f + a * a * (0.05265332f - a * a * 0.01172120f)))));
  return x < 0.f ? -r : r;
}
static inline float sf_atan2(float y, float x) {
  if (x > 0.f) return sf_atan(y / x);
  if (x < 0.f) return sf_atan(y / x) + (y >= 0.f ? SF_PI : -SF_PI);
  return y > 0.f ? 1.5707963f : y < 0.f ? -1.5707963f : 0.f;
}

/* hashes and value noise (integer-safe, no visible lattice) */
static inline float sf_hash1(float n) { return sf_fract(sf_sin(n * 12.9898f) * 43758.5453f); }
static inline float sf_hash2(float x, float y) {
  float p3x = sf_fract(x * 0.1031f), p3y = sf_fract(y * 0.1031f), p3z = sf_fract(x * 0.1031f);
  float d = p3x * (p3y + 33.33f) + p3y * (p3z + 33.33f) + p3z * (p3x + 33.33f);
  p3x += d; p3y += d; p3z += d;
  return sf_fract((p3x + p3y) * p3z);
}
static inline float sf_noise2(float x, float y) {
  float ix = sf_floor(x), iy = sf_floor(y), fx = x - ix, fy = y - iy;
  fx = fx * fx * (3.f - 2.f * fx); fy = fy * fy * (3.f - 2.f * fy);
  float a = sf_hash2(ix, iy), b = sf_hash2(ix + 1.f, iy), c = sf_hash2(ix, iy + 1.f), d = sf_hash2(ix + 1.f, iy + 1.f);
  return sf_mix(sf_mix(a, b, fx), sf_mix(c, d, fx), fy);
}
static inline float sf_noise1(float x) { float i = sf_floor(x), f = x - i; f = f * f * (3.f - 2.f * f); return sf_mix(sf_hash1(i), sf_hash1(i + 1.f), f); }

/* ------------------------------------------------------------------ colour */
/* light to display: a filmic shoulder, so additive light never clips hard */
static inline float sf_tone(float x) { return 1.f - sf_exp(-x); }
/* linear light <-> display, through a 4096-entry table built once (gamma 2.2) */
static float sf_enc_lut[4097];
static int sf_lut_ready = 0;
static void sf_lut_init(void) {
  if (sf_lut_ready) return;
  for (int i = 0; i <= 4096; i++) sf_enc_lut[i] = sf_pow((float)i / 4096.f, 1.f / 2.2f);
  sf_lut_ready = 1;
}
static inline float sf_encode(float x) { if (!sf_lut_ready) sf_lut_init(); x = sf_sat(x) * 4096.f; int i = (int)x; float f = x - (float)i; return i >= 4096 ? sf_enc_lut[4096] : sf_enc_lut[i] + (sf_enc_lut[i + 1] - sf_enc_lut[i]) * f; }
static inline float sf_decode(float x) { return sf_pow(sf_sat(x), 2.2f); }

/* write a pixel: premultiplied RGBA. `bg` 0 = transparent (light carries its own alpha), 1 = black */
static inline void sf_put(float *p, float r, float g, float b, int bg) {
  r = sf_max(r, 0.f); g = sf_max(g, 0.f); b = sf_max(b, 0.f);
  if (bg == 1) { p[0] = r; p[1] = g; p[2] = b; p[3] = 1.f; return; }
  float a = sf_sat(sf_max(r, sf_max(g, b)));
  p[0] = sf_min(r, 1.f); p[1] = sf_min(g, 1.f); p[2] = sf_min(b, 1.f); p[3] = a;
}

/* ------------------------------------------------------------------ memory */
/* Scratch memory past the host's buffer (params + pixels): grown on demand, reused every frame. */
#ifdef __wasm__
/* no C library: the two memory routines the compiler may still emit (for struct copies) */
void *memset(void *d, int c, size_t n) { u8 *p = (u8 *)d; while (n--) *p++ = (u8)c; return d; }
void *memcpy(void *d, const void *s, size_t n) { u8 *p = (u8 *)d; const u8 *q = (const u8 *)s; while (n--) *p++ = *q++; return d; }
extern u8 __heap_base;
static u32 sf_end = 0;
static void *sf_scratch(u32 bytes) {
  u32 at = (sf_end + 15u) & ~15u, need = at + bytes, have = (u32)__builtin_wasm_memory_size(0) * 65536u;
  if (need > have && __builtin_wasm_memory_grow(0, (need - have + 65535u) / 65536u) == (unsigned long)-1) return 0;
  return (void *)(unsigned long)at;
}
#else
#include <stdlib.h>
static void *sf_scratch_buf = 0; static u32 sf_scratch_cap = 0;
static void *sf_scratch(u32 bytes) {
  if (bytes > sf_scratch_cap) { free(sf_scratch_buf); sf_scratch_buf = malloc(bytes); sf_scratch_cap = sf_scratch_buf ? bytes : 0; }
  return sf_scratch_buf;
}
#endif

#endif
