/* Signalform Aura for EffectCraft: a breathing ring of shimmering specks.
 * A CPU port of Signalform's Aura module: thousands of specks on a ring (or two rings, or a disc) whose
 * rim swells where its slice of the spectrum is loud; kicks pulse it and drops blow it wide.
 * Every speck is a function of time, splatted into a light buffer and tone-mapped. */
#include "sf.h"
#include "sf_gen.h"

#define SF_MANIFEST "{\"api\":1,\"id\":\"org.signalform.aura\",\"name\":\"Signalform Aura\",\"category\":\"Signalform\",\"version\":\"1.0.0\"," \
  "\"author\":\"Signalform contributors\",\"description\":\"A breathing ring of shimmering specks that swells with its slice of the spectrum.\",\"params\":[" \
  "{\"id\":\"form\",\"name\":\"Form\",\"type\":\"popup\",\"options\":[\"Ring\",\"Two Rings\",\"Disc\"],\"default\":0}," \
  "{\"id\":\"count\",\"name\":\"Specks\",\"type\":\"slider\",\"default\":12000,\"min\":1000,\"max\":60000,\"sliderMax\":30000,\"decimals\":0}," \
  "{\"id\":\"radius\",\"name\":\"Radius\",\"type\":\"slider\",\"default\":0.3,\"min\":0.05,\"max\":0.6,\"decimals\":3}," \
  "{\"id\":\"thick\",\"name\":\"Thickness\",\"type\":\"slider\",\"default\":0.06,\"min\":0.005,\"max\":0.3,\"decimals\":3}," \
  "{\"id\":\"swell\",\"name\":\"Swell\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"spin\",\"name\":\"Turn\",\"type\":\"slider\",\"default\":0.08,\"min\":-1,\"max\":1,\"decimals\":3}," \
  "{\"id\":\"twinkle\",\"name\":\"Shimmer\",\"type\":\"slider\",\"default\":0.6,\"min\":0,\"max\":1,\"decimals\":2}," \
  "{\"id\":\"speck\",\"name\":\"Speck Size\",\"type\":\"slider\",\"default\":1,\"min\":0.3,\"max\":4,\"decimals\":2}," \
  "{\"id\":\"center\",\"name\":\"Centre\",\"type\":\"point\",\"default\":[0.5,0.5]}," \
  "{\"id\":\"color\",\"name\":\"Colour\",\"type\":\"color\",\"default\":[1,1,1,1]}," \
  "{\"id\":\"color2\",\"name\":\"Rim Colour\",\"type\":\"color\",\"default\":[0.75,0.85,1,1]}," \
  "{\"id\":\"exposure\",\"name\":\"Exposure\",\"type\":\"slider\",\"default\":1,\"min\":0.1,\"max\":4,\"decimals\":2}" \
  SF_AUDIO_JSON "]}"

enum { P_FORM, P_COUNT, P_RADIUS, P_THICK, P_SWELL, P_SPIN, P_TWINK, P_SPECK, P_CENTER, P_COLOR = P_CENTER + 2, P_COLOR2 = P_COLOR + 4, P_EXPO = P_COLOR2 + 4, P_AUDIO, P_N = P_AUDIO + SF_AUDIO_N };

static int sf_render(float *px, int w, int h, const double *pr, int np, double t, double scale) {
  if (np < P_N) return 1;
  SfAudio au = sf_audio(pr, P_AUDIO);
  int form = (int)pr[P_FORM], n = (int)sf_clamp((float)pr[P_COUNT], 100, 60000);
  float T = (float)t, S = (float)h, R = (float)pr[P_RADIUS] * S * (1.f + au.kick * 0.08f + au.drop * 0.35f);
  float thick = (float)pr[P_THICK] * S, swell = (float)pr[P_SWELL], spin = (float)pr[P_SPIN], tw = (float)pr[P_TWINK];
  float sr = sf_max(0.6f, (float)pr[P_SPECK] * 0.9f * (float)scale), cx = (float)pr[P_CENTER], cy = (float)pr[P_CENTER + 1];
  float c1[3], c2[3]; SF_COLOR(pr, P_COLOR, c1); SF_COLOR(pr, P_COLOR2, c2);
  float *acc = (float *)sf_scratch((u32)w * (u32)h * 2u * 4u);    /* two channels: core light and rim light */
  if (!acc) return 2;
  for (int i = 0; i < w * h * 2; i++) acc[i] = 0.f;
  /* each speck: an angle, a depth into the ring, its own shimmer; the rim swells with the band at its angle */
  float e0 = 6.f / sf_sqrt((float)n / 12000.f);               /* keep the overall brightness as the count changes */
  for (int i = 0; i < n; i++) {
    float fi = (float)i, h1 = sf_hash1(fi * 1.371f + 0.5f), h2 = sf_hash1(fi * 2.713f + 1.7f), h3 = sf_hash1(fi * 0.917f + 4.1f), h4 = sf_hash1(fi * 3.31f + 9.3f);
    float a = h1 * SF_TAU + T * spin * (0.6f + 0.8f * h4);
    float band = sf_band(&au, sf_abs(sf_fract(a / SF_TAU + 0.25f) * 2.f - 1.f));   /* mirrored left/right: lows at the bottom, highs at the top */
    float g = (h2 + h3 - 1.f);                                 /* -1 … 1, peaked at 0 */
    float rr;
    if (form == 2) rr = R * sf_sqrt(h2) * (1.f + band * 0.35f * swell);
    else {
      float base = form == 1 && h4 > 0.5f ? R * 0.62f : R;
      rr = base + g * thick * (0.6f + band * 1.4f * swell) + band * swell * thick * 0.8f;
      rr += sf_sin(a * 3.f + T * 0.7f) * thick * 0.25f + sf_sin(a * 7.f - T * 1.1f) * thick * 0.12f * (1.f + au.mid);
    }
    float x = cx + sf_cos(a) * rr, y = cy - sf_sin(a) * rr;
    float shimmer = 1.f - tw + tw * (0.5f + 0.5f * sf_sin(T * (3.f + h4 * 9.f) + h3 * 40.f)) + au.high * h4 * 0.8f;
    float bright = e0 * shimmer * (0.35f + 0.65f * h3) * (0.6f + band * 0.9f + au.level * 0.4f);
    float rimw = sf_sat(g * 2.f + band * 0.5f);
    /* bilinear splat of a small spot */
    int ix = (int)sf_floor(x - 0.5f), iy = (int)sf_floor(y - 0.5f);
    float fx = x - 0.5f - (float)ix, fy = y - 0.5f - (float)iy;
    float wts[4] = { (1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy };
    int ox[4] = { 0, 1, 0, 1 }, oy[4] = { 0, 0, 1, 1 };
    for (int k = 0; k < 4; k++) {
      int X = ix + ox[k], Y = iy + oy[k];
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      float v = bright * wts[k] * sr;
      acc[(Y * w + X) * 2] += v * (1.f - rimw); acc[(Y * w + X) * 2 + 1] += v * rimw;
    }
  }
  /* a soft glow so the specks read as light, then tone-map */
  float expo = (float)pr[P_EXPO] * 0.32f;
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    float a = acc[(y * w + x) * 2], b = acc[(y * w + x) * 2 + 1];
    if (sr > 1.2f) {                                           /* bigger specks: spread to the neighbours */
      float s = 0, sb = 0; int m = 0;
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) { int X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; s += acc[(Y * w + X) * 2]; sb += acc[(Y * w + X) * 2 + 1]; m++; }
      float k = sf_sat((sr - 1.2f) / 2.f); a = sf_mix(a, s / (float)m * 1.5f, k); b = sf_mix(b, sb / (float)m * 1.5f, k);
    }
    float r = sf_tone((c1[0] * a + c2[0] * b) * expo), g = sf_tone((c1[1] * a + c2[1] * b) * expo), bl = sf_tone((c1[2] * a + c2[2] * b) * expo);
    sf_put(px + ((size_t)y * w + x) * 4, r, g, bl, au.bg == 0 ? 1 : 0);
  }
  return 0;
}

#include "sf_abi.h"
