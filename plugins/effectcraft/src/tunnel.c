/* Signalform Tunnel for EffectCraft: a flight down an endless tube of light rings.
 * A CPU port of Signalform's Tunnel module: every ring lights the glossy wall around it, the tube
 * bends ahead of the camera, and kicks flash the nearest rings and jolt the flight forward. */
#include "sf.h"
#include "sf_gen.h"

#define SF_MANIFEST "{\"api\":1,\"id\":\"org.signalform.tunnel\",\"name\":\"Signalform Tunnel\",\"category\":\"Signalform\",\"version\":\"1.0.0\"," \
  "\"author\":\"Signalform contributors\",\"description\":\"A flight down an endless tunnel of light, carried by the music.\",\"params\":[" \
  "{\"id\":\"style\",\"name\":\"Walls\",\"type\":\"popup\",\"options\":[\"Light Rings\",\"Wire Grid\",\"Light Panels\",\"Warp Streaks\"],\"default\":0}," \
  "{\"id\":\"sides\",\"name\":\"Shape\",\"type\":\"popup\",\"options\":[\"Round\",\"Triangle\",\"Square\",\"Hexagon\",\"Octagon\"],\"default\":0}," \
  "{\"id\":\"speed\",\"name\":\"Flight Speed\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":6,\"decimals\":2}," \
  "{\"id\":\"surge\",\"name\":\"Surge on Kicks\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"twist\",\"name\":\"Twist\",\"type\":\"slider\",\"default\":0.6,\"min\":-3,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"roll\",\"name\":\"Roll\",\"type\":\"angle\",\"default\":0}," \
  "{\"id\":\"bend\",\"name\":\"Curves\",\"type\":\"slider\",\"default\":0.8,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"density\",\"name\":\"Ring Density\",\"type\":\"slider\",\"default\":3.2,\"min\":0.5,\"max\":8,\"decimals\":2}," \
  "{\"id\":\"segments\",\"name\":\"Segments Around\",\"type\":\"slider\",\"default\":16,\"min\":4,\"max\":48,\"decimals\":0}," \
  "{\"id\":\"width\",\"name\":\"Line Width\",\"type\":\"slider\",\"default\":0.9,\"min\":0.2,\"max\":4,\"decimals\":2}," \
  "{\"id\":\"wall\",\"name\":\"Light on the Walls\",\"type\":\"slider\",\"default\":0.7,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"fog\",\"name\":\"Depth Fade\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"core\",\"name\":\"Light at the End\",\"type\":\"slider\",\"default\":0.6,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"colorA\",\"name\":\"Near Colour\",\"type\":\"color\",\"default\":[0.77,0.85,1,1]}," \
  "{\"id\":\"colorB\",\"name\":\"Far Colour\",\"type\":\"color\",\"default\":[0.23,0.3,1,1]}," \
  "{\"id\":\"glow\",\"name\":\"Glow\",\"type\":\"slider\",\"default\":0.8,\"min\":0,\"max\":2,\"decimals\":2}" \
  SF_AUDIO_JSON "]}"

enum { P_STYLE, P_SIDES, P_SPEED, P_SURGE, P_TWIST, P_ROLL, P_BEND, P_DENS, P_SEGS, P_WIDTH, P_WALL, P_FOG, P_CORE, P_CA, P_CB = P_CA + 4, P_GLOW = P_CB + 4, P_AUDIO, P_N = P_AUDIO + SF_AUDIO_N };

static float sidesN;
static inline float polyR(float x, float y) {
  if (sidesN < 2.5f) return sf_sqrt(x * x + y * y);
  float seg = SF_TAU / sidesN, a = sf_atan2(y, x) + seg * 0.5f;
  a = a - seg * sf_floor(a / seg) - seg * 0.5f;
  return sf_sqrt(x * x + y * y) * sf_cos(a) / sf_cos(seg * 0.5f);
}
/* the tube's centre line relative to a camera that rides along it, facing forward */
static float camZ, bend;
static inline void center(float w, float *cx, float *cy) { *cx = sf_sin(w * 0.13f) * 1.6f; *cy = sf_cos(w * 0.09f) * 0.9f; }
static inline void path(float z, float *px, float *py) {
  float c0x, c0y, c1x, c1y, czx, czy;
  center(camZ, &c0x, &c0y); center(camZ + 0.01f, &c1x, &c1y); center(camZ + z, &czx, &czy);
  float dx = (c1x - c0x) / 0.01f, dy = (c1y - c0y) / 0.01f;
  *px = bend * (czx - c0x - dx * z); *py = bend * (czy - c0y - dy * z);
}
static inline float lineAA(float x, float w, float fw) { float d = sf_abs(sf_fract(x + 0.5f) - 0.5f); return 1.f - sf_smooth(w, w + fw * 1.2f, d); }

static int sf_render(float *px, int w, int h, const double *pr, int np, double t, double scale) {
  if (np < P_N) return 1;
  (void)scale;
  SfAudio au = sf_audio(pr, P_AUDIO);
  int style = (int)pr[P_STYLE];
  static const float SIDES[5] = { 0, 3, 4, 6, 8 };
  sidesN = SIDES[(int)sf_clamp((float)pr[P_SIDES], 0, 4)];
  float dens = (float)pr[P_DENS], segs = (float)pr[P_SEGS], width = (float)pr[P_WIDTH] * 0.06f;
  bend = (float)pr[P_BEND];
  /* flight: steady speed; kicks jolt it forward (a stateless plug-in can't integrate speed changes) */
  camZ = (float)t * (float)pr[P_SPEED] * (0.8f + au.bass * 0.6f) + au.kick * (float)pr[P_SURGE] * 0.35f + au.drop * 0.6f;
  float roll = (float)pr[P_ROLL] * SF_PI / 180.f + (float)t * 0.05f * (float)pr[P_TWIST];
  float cr = sf_cos(roll), sr = sf_sin(roll);
  float ca[3], cb[3]; SF_COLOR(pr, P_CA, ca); SF_COLOR(pr, P_CB, cb);
  float fog = (float)pr[P_FOG], core = (float)pr[P_CORE], glow = (float)pr[P_GLOW], wallK = (float)pr[P_WALL], twist = (float)pr[P_TWIST];
  float vpx, vpy; path(16.f, &vpx, &vpy); vpx /= 16.f; vpy /= 16.f;
  float inv = 1.f / (float)h;
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    float ux = ((float)x + 0.5f - 0.5f * w) * inv, uy = (0.5f * h - (float)y - 0.5f) * inv;
    float p0 = ux * cr - uy * sr, p1 = ux * sr + uy * cr;
    /* where the view ray meets the wall: start from a straight tube, then refine against the bent one */
    float lp = sf_max(polyR(p0, p1), 0.004f), z = 0.5f / lp;
    for (int i = 0; i < 6; i++) { float qx, qy; path(z, &qx, &qy); float g = polyR(p0 * z - qx, p1 * z - qy); if (g < 1e-4f) break; z = sf_clamp(z * 0.5f / g, 0.05f, 80.f); }
    float qx, qy; path(z, &qx, &qy); qx = p0 * z - qx; qy = p1 * z - qy;
    float ang = sf_atan2(qy, qx) / SF_TAU + 0.5f, u = ang + twist * z * 0.03f, v = z + camZ;
    float kv = v * dens, k = sf_floor(kv);
    /* energy of this ring: a pattern along the tube, the level, and kicks flashing the nearest rings */
    float e = (0.3f + 0.7f * sf_noise1(k * 0.61f)) * (0.25f + au.level * 1.1f) + au.kick * 1.4f * sf_exp(-z * 0.35f) + au.drop * 0.8f;
    float fpos = sf_abs(sf_fract(u) * 2.f - 1.f), sp = 0.4f + 1.4f * sf_band(&au, fpos);
    float fwk = dens * z * z * inv * 1.2f + 1e-4f;          /* how fast the ring coordinate changes per pixel */
    float fwu = segs * inv / sf_max(lp, 0.01f) * 0.2f + 1e-4f;
    float b = 0.f;
    if (style == 0) b = lineAA(kv, width, fwk) * (0.3f + e * 2.4f) * sp;
    else if (style == 1) b = sf_max(lineAA(kv, width, fwk) * (0.3f + e * 2.4f), lineAA(u * segs, width * 0.8f, fwu) * (0.18f + e * 0.8f)) * sp;
    else if (style == 2) {
      float cell = sf_floor(u * segs), hs = sf_hash2(cell + 0.5f, k + 0.5f);
      float on = hs > 0.55f - e * 0.45f ? 1.f : 0.f;
      b = on * (0.25f + e * 1.5f) * sp * (0.6f + 0.4f * hs) + (lineAA(kv, width * 0.6f, fwk) + lineAA(u * segs, width * 0.6f, fwu)) * 0.12f * (0.3f + e);
    } else {
      float col = sf_floor(u * segs * 3.f), hs = sf_hash1(col * 7.13f), s = sf_fract(v * 0.6f + hs * 13.f);
      float len = 0.08f + 0.25f * au.bass + 0.3f * e;
      float streak = sf_smooth(len, 0.f, s) * sf_smooth(0.f, 0.01f, s) * (sf_hash2(col, sf_floor(v * 0.6f + hs * 13.f)) > 0.3f ? 1.f : 0.f);
      float thin = 1.f - sf_smooth(0.f, 0.5f, sf_abs(sf_fract(u * segs * 3.f) - 0.5f) * 2.f / sf_max(width * 8.f, 0.05f));
      b = streak * thin * (0.9f + e * 1.8f) * sp;
    }
    float far = sf_sat(1.4f - fwk * 2.5f) * sf_smooth(40.f, 14.f, z);
    b *= far;
    /* each ring lights the glossy wall around it; the upper side catches a sheen */
    float dk = sf_abs(sf_fract(kv + 0.5f) - 0.5f) / sf_max(dens, 0.1f);
    float ny = qy / sf_max(sf_sqrt(qx * qx + qy * qy), 1e-4f), sheen = sf_pow(sf_max(0.f, ny), 6.f);
    b += (style < 2 ? sf_exp(-dk * 6.f) * (0.12f + e * 1.3f) * sp : 0.12f * (0.2f + e)) * (0.35f + 1.4f * sheen) * wallK * sf_mix(1.f, far, 0.6f) * sf_smooth(45.f, 12.f, z);
    float tz = sf_sat(z / 10.f), fg = sf_exp(-z * fog * 0.12f);
    float rr = sf_sqrt((p0 - vpx) * (p0 - vpx) + (p1 - vpy) * (p1 - vpy));
    float lit = b + 0.03f * (1.f + au.bass) * sf_smooth(30.f, 2.f, z);
    float cl = core * sf_exp(-rr * 16.f) * (0.25f + au.bass * 0.9f + au.kick * 0.6f);
    float out[3];
    for (int c = 0; c < 3; c++) {
      float base = sf_mix(ca[c], cb[c], tz) * lit * fg + sf_mix(cb[c], 1.f, 0.35f) * cl + ca[c] * au.drop * 0.35f * fg;
      out[c] = sf_tone(base * (1.f + glow));
    }
    sf_put(px + ((size_t)y * w + x) * 4, out[0], out[1], out[2], au.bg == 0 ? 1 : 0);
  }
  return 0;
}

#include "sf_abi.h"
