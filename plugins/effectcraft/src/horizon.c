/* Signalform Horizon for EffectCraft: a landscape rolling towards a setting sun.
 * A CPU take on Signalform's Horizon module: a neon grid rolling towards the camera, mountains that
 * the mids raise, a striped sun that breathes with the bass, and grid lines that flash on kicks. */
#include "sf.h"
#include "sf_gen.h"

#define SF_MANIFEST "{\"api\":1,\"id\":\"org.signalform.horizon\",\"name\":\"Signalform Horizon\",\"category\":\"Signalform\",\"version\":\"1.0.0\"," \
  "\"author\":\"Signalform contributors\",\"description\":\"A neon landscape rolling towards a setting sun, moved by the music.\",\"params\":[" \
  "{\"id\":\"speed\",\"name\":\"Travel Speed\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":5,\"decimals\":2}," \
  "{\"id\":\"horizon\",\"name\":\"Horizon Height\",\"type\":\"slider\",\"default\":45,\"min\":20,\"max\":80,\"decimals\":0}," \
  "{\"id\":\"cells\",\"name\":\"Grid Size\",\"type\":\"slider\",\"default\":1,\"min\":0.3,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"lineW\",\"name\":\"Line Width\",\"type\":\"slider\",\"default\":1,\"min\":0.3,\"max\":4,\"decimals\":2}," \
  "{\"id\":\"mount\",\"name\":\"Mountain Height\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"sun\",\"name\":\"Sun Size\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"stripes\",\"name\":\"Sun Stripes\",\"type\":\"checkbox\",\"default\":true}," \
  "{\"id\":\"stars\",\"name\":\"Stars\",\"type\":\"slider\",\"default\":0.6,\"min\":0,\"max\":1,\"decimals\":2}," \
  "{\"id\":\"grid\",\"name\":\"Grid Colour\",\"type\":\"color\",\"default\":[0.25,0.45,1,1]}," \
  "{\"id\":\"grid2\",\"name\":\"Far Grid Colour\",\"type\":\"color\",\"default\":[0.95,0.3,0.85,1]}," \
  "{\"id\":\"sunTop\",\"name\":\"Sun Top\",\"type\":\"color\",\"default\":[1,0.9,0.55,1]}," \
  "{\"id\":\"sunBottom\",\"name\":\"Sun Bottom\",\"type\":\"color\",\"default\":[1,0.35,0.45,1]}," \
  "{\"id\":\"sky\",\"name\":\"Sky\",\"type\":\"color\",\"default\":[0.12,0.04,0.2,1]}," \
  "{\"id\":\"glow\",\"name\":\"Glow\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":2,\"decimals\":2}" \
  SF_AUDIO_JSON "]}"

enum { P_SPEED, P_HOR, P_CELLS, P_LINEW, P_MOUNT, P_SUN, P_STRIPES, P_STARS, P_GRID, P_GRID2 = P_GRID + 4, P_SUNT = P_GRID2 + 4, P_SUNB = P_SUNT + 4, P_SKY = P_SUNB + 4, P_GLOW = P_SKY + 4, P_AUDIO, P_N = P_AUDIO + SF_AUDIO_N };

static inline float ridge(float x, float m) {
  float hh = 0.f, a = 1.f, f = 1.f;
  for (int i = 0; i < 4; i++) { hh += a * sf_noise1(x * f + (float)i * 17.3f); a *= 0.5f; f *= 2.1f; }
  return hh * m;
}

static int sf_render(float *px, int w, int h, const double *pr, int np, double t, double scale) {
  if (np < P_N) return 1;
  SfAudio au = sf_audio(pr, P_AUDIO);
  float T = (float)t, travel = T * (float)pr[P_SPEED] * 2.f + au.kick * 0.25f;
  float yh = (float)pr[P_HOR] / 100.f;                    /* horizon, from the top */
  float cellK = (float)pr[P_CELLS], lw = (float)pr[P_LINEW] * (float)scale, mount = (float)pr[P_MOUNT] * (0.7f + au.mid * 0.9f);
  float sunK = (float)pr[P_SUN] * (1.f + au.bass * 0.08f), stars = (float)pr[P_STARS], glow = (float)pr[P_GLOW];
  int stripes = pr[P_STRIPES] > 0.5;
  float g1[3], g2[3], st[3], sb[3], sky[3];
  SF_COLOR(pr, P_GRID, g1); SF_COLOR(pr, P_GRID2, g2); SF_COLOR(pr, P_SUNT, st); SF_COLOR(pr, P_SUNB, sb); SF_COLOR(pr, P_SKY, sky);
  float hpx = yh * h, aspect = (float)w / (float)h, sunR = 0.17f * sunK, sunY = yh - sunR * 0.55f;
  float flash = 1.f + au.kick * 1.6f + au.drop * 1.2f;
  for (int y = 0; y < h; y++) {
    float v = ((float)y + 0.5f) / h;                      /* 0 top … 1 bottom */
    for (int x = 0; x < w; x++) {
      float u = ((float)x + 0.5f) / w, c[3];
      float X = (u - 0.5f) * aspect;
      if ((float)y + 0.5f < hpx) {
        /* sky: dark at the top, warm towards the horizon, a few stars */
        float k = sf_sat(v / yh);
        for (int i = 0; i < 3; i++) c[i] = sf_mix(sky[i] * 0.35f, sky[i] * 1.6f + sb[i] * 0.25f, k * k);
        if (stars > 0.f) {
          float sx = sf_floor((float)x / 3.f), sy = sf_floor((float)y / 3.f), hs = sf_hash2(sx, sy);
          if (hs > 1.f - 0.004f * stars) { float tw = 0.6f + 0.4f * sf_sin(T * (2.f + hs * 5.f) + hs * 40.f) + au.high * 0.5f; for (int i = 0; i < 3; i++) c[i] += 0.5f * tw * (1.f - k); }
        }
        /* the sun, cut by stripes that widen towards its base */
        float dx = X, dy = (v - sunY) * 1.f, dr = sf_sqrt(dx * dx + dy * dy);
        float edge = 1.f / h;
        float disc = 1.f - sf_smooth(sunR - edge, sunR + edge, dr);
        if (stripes) {
          float sv = (v - (sunY - sunR * 0.1f)) / sunR;   /* 0 … ~1.1 from the middle of the sun down */
          if (sv > 0.f) { float band = sf_fract(sv * 7.f - T * 0.3f), gap = sf_sat(sv) * 0.55f; disc *= sf_smooth(gap - 0.05f, gap + 0.05f, band); }
        }
        float sk = sf_sat((v - (sunY - sunR)) / (2.f * sunR));
        for (int i = 0; i < 3; i++) c[i] = sf_mix(c[i], sf_mix(st[i], sb[i], sk), disc) + sf_mix(st[i], sb[i], 0.6f) * sf_exp(-sf_max(0.f, dr - sunR) * 9.f) * 0.35f * glow * (0.7f + au.bass * 0.6f);
        /* mountains: a dark silhouette rising from the horizon, rimmed with the grid colour */
        float m = ridge(X * 2.2f + 3.f, 0.11f * mount) * (0.55f + 0.45f * sf_smooth(0.f, 0.7f, sf_abs(X)));
        float top = yh - m;
        if (v > top) { float rimv = sf_exp(-(v - top) * h * 0.35f); for (int i = 0; i < 3; i++) c[i] = sf_mix(c[i], sky[i] * 0.25f, 0.92f) + g2[i] * rimv * 0.8f * flash * glow; }
      } else {
        /* the ground: a perspective grid rolling towards the camera */
        float dv = sf_max(1e-4f, v - yh), Z = 0.35f / dv, Xg = X * Z;
        float zz = Z * cellK + travel, xx = Xg * cellK * 1.6f;
        float fz = 0.35f / (dv * dv) / h * cellK, fx = Z / w * aspect * cellK * 1.6f;   /* footprint of one pixel, for anti-aliasing */
        /* distance to the nearest line (cell units), covered over the pixel's footprint; lines finer than a pixel average out */
        float dz = sf_abs(sf_fract(zz + 0.5f) - 0.5f), dxl = sf_abs(sf_fract(xx + 0.5f) - 0.5f);
        float wz = 0.025f * lw, wx = 0.025f * lw;
        float cz = sf_mix(sf_sat((wz - dz) / sf_max(fz, 1e-4f) + 0.5f), 2.f * wz, sf_smooth(0.3f, 1.2f, fz));
        float cx = sf_mix(sf_sat((wx - dxl) / sf_max(fx, 1e-4f) + 0.5f), 2.f * wx, sf_smooth(0.3f, 1.2f, fx));
        float line = sf_max(cz, cx);
        float depth = sf_sat(dv / (1.f - yh)), fade = sf_smooth(0.f, 0.25f, depth);
        for (int i = 0; i < 3; i++) {
          float gc = sf_mix(g2[i], g1[i], depth);
          c[i] = sky[i] * 0.15f * (1.f - depth) + gc * line * (0.35f + 0.65f * fade) * flash * glow + gc * sf_exp(-dv * 30.f) * 0.25f * glow;
        }
      }
      sf_put(px + ((size_t)y * w + x) * 4, sf_tone(c[0] * 1.2f), sf_tone(c[1] * 1.2f), sf_tone(c[2] * 1.2f), au.bg == 0 ? 1 : 0);
    }
  }
  return 0;
}

#include "sf_abi.h"
