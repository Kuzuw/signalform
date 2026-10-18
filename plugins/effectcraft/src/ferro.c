/* Signalform Ferro for EffectCraft: black magnetic fluid on white.
 * A CPU port of Signalform's Ferro module: a chain of glossy beads that merge on the beat, spikes that
 * stand up as the magnet's field (the loudness and the bass) rises, and droplets thrown off by kicks.
 * REACTIVE!!! more than doubles the reaction. Positions are a function of time, as the plug-in API requires. */
#include "sf.h"
#include "sf_gen.h"

#define SF_MANIFEST "{\"api\":1,\"id\":\"org.signalform.ferro\",\"name\":\"Signalform Ferro\",\"category\":\"Signalform\",\"version\":\"1.0.0\"," \
  "\"author\":\"Signalform contributors\",\"description\":\"Black magnetic fluid that spikes, pumps and throws droplets with the music.\",\"params\":[" \
  "{\"id\":\"reactive\",\"name\":\"REACTIVE!!!\",\"type\":\"checkbox\",\"default\":false}," \
  "{\"id\":\"react\",\"name\":\"Reaction Strength\",\"type\":\"slider\",\"default\":1.3,\"min\":0,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"beads\",\"name\":\"Body Segments\",\"type\":\"slider\",\"default\":4,\"min\":1,\"max\":6,\"decimals\":0}," \
  "{\"id\":\"size\",\"name\":\"Body Size\",\"type\":\"slider\",\"default\":1,\"min\":0.4,\"max\":1.6,\"decimals\":2}," \
  "{\"id\":\"merge\",\"name\":\"Merging\",\"type\":\"slider\",\"default\":0.5,\"min\":0,\"max\":1,\"decimals\":2}," \
  "{\"id\":\"turb\",\"name\":\"Turbulence\",\"type\":\"slider\",\"default\":0.8,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"drift\",\"name\":\"Drift and Turn\",\"type\":\"slider\",\"default\":0.6,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"spikes\",\"name\":\"Spikes\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"spray\",\"name\":\"Droplets\",\"type\":\"slider\",\"default\":28,\"min\":0,\"max\":48,\"decimals\":0}," \
  "{\"id\":\"fling\",\"name\":\"Fling on Kicks\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"back\",\"name\":\"Background\",\"type\":\"color\",\"default\":[0.933,0.933,0.953,1]}," \
  "{\"id\":\"body\",\"name\":\"Fluid\",\"type\":\"color\",\"default\":[0.02,0.02,0.024,1]}," \
  "{\"id\":\"rim\",\"name\":\"Rim Light\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"gloss\",\"name\":\"Gloss\",\"type\":\"slider\",\"default\":1,\"min\":0,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"zoom\",\"name\":\"Zoom\",\"type\":\"slider\",\"default\":1,\"min\":0.5,\"max\":2,\"decimals\":2}" \
  SF_AUDIO_JSON "]}"

enum { P_REACTIVE, P_REACT, P_BEADS, P_SIZE, P_MERGE, P_TURB, P_DRIFT, P_SPIKES, P_SPRAY, P_FLING, P_BACK, P_BODY = P_BACK + 4, P_RIM = P_BODY + 4, P_GLOSS, P_ZOOM, P_AUDIO, P_N = P_AUDIO + SF_AUDIO_N };

#define MAXB 6
#define NS 18
#define ND 48
static float BX[MAXB], BY[MAXB], BR[MAXB], SX[NS], SY[NS], SDX[NS], SDY[NS], SL[NS], SW[NS], DX[ND], DY[ND], DR[ND];
static int NB, NSP, NDR;
static float KM;

static inline float smin(float a, float b, float k) { if (k <= 0.f) return sf_min(a, b); float hh = sf_sat(0.5f + 0.5f * (b - a) / k); return sf_mix(b, a, hh) - k * hh * (1.f - hh); }
/* distance to a spike: a cone from radius r at its base to a point at length l along (dx, dy) */
static inline float spike(float px, float py, int i) {
  float ax = px - SX[i], ay = py - SY[i], u = ax * SDX[i] + ay * SDY[i], v = sf_abs(-ax * SDY[i] + ay * SDX[i]);
  float l = SL[i], r = SW[i];
  float t = sf_clamp(u / l, 0.f, 1.f), rr = r * (1.f - t);
  float d = v - rr;                                           /* across the cone at this height */
  if (u < 0.f) d = sf_sqrt(u * u + v * v) - r;
  else if (u > l) d = sf_sqrt((u - l) * (u - l) + v * v);
  return d * 0.9f;
}
static inline float field(float px, float py) {
  float d = 1e3f;
  for (int i = 0; i < NB; i++) { float dx = px - BX[i], dy = py - BY[i]; d = smin(d, sf_sqrt(dx * dx + dy * dy) - BR[i], KM); }
  for (int i = 0; i < NSP; i++) d = smin(d, spike(px, py, i), 0.012f);
  return d;
}

static int sf_render(float *px, int w, int h, const double *pr, int np, double t, double scale) {
  if (np < P_N) return 1;
  (void)scale;
  SfAudio au = sf_audio(pr, P_AUDIO);
  int reactive = pr[P_REACTIVE] > 0.5;
  float R = (float)pr[P_REACT] * (reactive ? 2.2f : 1.f), T = (float)t;
  float turb = (float)pr[P_TURB], drift = (float)pr[P_DRIFT], spikesK = (float)pr[P_SPIKES], flingK = (float)pr[P_FLING];
  float back[3], body[3]; SF_COLOR(pr, P_BACK, back); SF_COLOR(pr, P_BODY, body);
  float rim = (float)pr[P_RIM], gloss = (float)pr[P_GLOSS], zoom = (float)pr[P_ZOOM];
  /* the magnet's field follows the loudness and the low end; kicks pump the body and shove the beads apart */
  float fieldS = au.level * 0.6f + au.bass * 0.7f + au.kick * 0.5f;
  float merged = sf_min(1.f, (float)pr[P_MERGE] * 0.6f + au.kick * 0.7f * sf_min(1.3f, R) + au.bass * 0.3f);
  float pump = sf_min(0.22f, R * 0.12f * au.kick), shove = sf_min(0.45f, R * 0.18f * au.kick);
  float size = (float)pr[P_SIZE] * (1.f + pump);
  NB = (int)sf_clamp((float)pr[P_BEADS], 1, MAXB);
  float axis = -0.85f + drift * 0.6f * sf_sin(T * 0.13f), ax = sf_cos(axis), ay = sf_sin(axis), nx = -ay, ny = ax;
  float len = 0.25f * size * (1.f - merged * 0.12f) * (1.f + shove);
  float shake = reactive ? au.kick * 0.012f : 0.f;
  float cx0 = sf_sin(T * 0.11f) * 0.03f * drift + shake * sf_sin(T * 91.f), cy0 = sf_cos(T * 0.09f) * 0.03f * drift + shake * sf_cos(T * 77.f);
  static const float K[6] = { 1.15f, 0.85f, 1.05f, 0.78f, 0.95f, 0.88f };
  for (int i = 0; i < NB; i++) {
    float tt = NB == 1 ? 0.f : (float)i / (float)(NB - 1) - 0.5f, ph = (float)i * 1.7f;
    float wob = turb * 0.03f * sf_sin(T * 1.3f + ph) * (1.f + au.mid * R + au.high * 0.6f * R);
    BX[i] = cx0 + ax * tt * len * 2.f + nx * (wob + sf_sin(T * 0.7f + ph) * 0.03f * turb);
    BY[i] = cy0 + ay * tt * len * 2.f + ny * (wob + sf_cos(T * 0.6f + ph) * 0.03f * turb);
    float band = sf_band(&au, (float)i / 6.f);
    BR[i] = size * (0.12f + merged * 0.03f) * (1.f + 0.55f * (K[i] - 1.f) * 1.6f + band * 0.15f * (0.5f + R * 0.6f)) * (NB == 1 ? 2.f : 1.f);
  }
  KM = 0.012f + merged * 0.045f;
  /* spikes stand taller as the field rises, each with its own sway */
  NSP = (int)(spikesK > 0.f ? (reactive ? NS : 12) : 0);
  for (int i = 0; i < NSP; i++) {
    int b = (i * 7) % NB; float a = (float)i * 2.399f + T * 0.05f * sf_sin((float)i);
    float sdx = sf_cos(a), sdy = sf_sin(a);
    float stand = (0.014f + 0.008f * sf_sin(T * 2.f + (float)i)) * (1.f + sf_min(reactive ? 7.f : 4.f, R * fieldS * (1.2f + 0.5f * sf_sin(T * 3.1f + (float)i * 1.7f))));
    SX[i] = BX[b] + sdx * BR[b] * 0.9f; SY[i] = BY[b] + sdy * BR[b] * 0.9f; SDX[i] = sdx; SDY[i] = sdy;
    SL[i] = stand * spikesK * size + 0.01f; SW[i] = 0.009f * size * (1.f + sf_min(0.6f, R * 0.2f * fieldS));
  }
  /* droplets ride orbits round the body; kicks fling them outward, the magnet pulls them back */
  NDR = (int)sf_clamp((float)pr[P_SPRAY], 0, ND);
  for (int i = 0; i < NDR; i++) {
    float h1 = sf_hash1((float)i * 3.17f + 1.f), h2 = sf_hash1((float)i * 7.31f + 2.f), h3 = sf_hash1((float)i * 1.93f + 3.f);
    float a = h1 * SF_TAU + T * (0.05f + 0.1f * h2) * (h3 > 0.5f ? 1.f : -1.f);
    float rr = (0.22f + 0.32f * h2) * (1.f + au.kick * flingK * 0.6f * sf_max(0.3f, R) * (0.5f + h3)) + 0.02f * sf_sin(T * 0.8f + (float)i);
    DX[i] = cx0 + sf_cos(a) * rr * 1.1f; DY[i] = cy0 + sf_sin(a) * rr * 0.85f;
    DR[i] = (0.0018f + h3 * h3 * h3 * h3 * 0.02f) * (1.f + au.high * 0.2f * R);
  }
  float inv = 1.f / ((float)h * zoom), pxs = inv;
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    float ux = ((float)x + 0.5f - 0.5f * w) * inv, uy = (0.5f * h - (float)y - 0.5f) * inv;
    float col[3] = { back[0], back[1], back[2] };
    /* droplets: flat discs that melt into each other when they touch */
    float dd = 1e3f;
    for (int i = 0; i < NDR; i++) { float dx = ux - DX[i], dy = uy - DY[i]; dd = smin(dd, sf_sqrt(dx * dx + dy * dy) - DR[i], 0.012f); }
    float dc = 1.f - sf_smooth(-pxs, pxs, dd);
    if (dc > 0.f) { float rimd = sf_smooth(-0.012f, 0.f, dd) * 0.35f * rim; for (int c = 0; c < 3; c++) col[c] = sf_mix(col[c], sf_mix(body[c], back[c], rimd), dc); }
    /* the body: shaded as rounded beads from the distance field */
    float d = field(ux, uy);
    if (d < pxs * 1.5f) {
      float e = 0.0008f, gx = field(ux + e, uy) - field(ux - e, uy), gy = field(ux, uy + e) - field(ux, uy - e), gl = sf_sqrt(gx * gx + gy * gy) + 1e-6f;
      gx /= gl; gy /= gl;
      float u = sf_sat(1.f + d / 0.09f);                       /* 1 at the edge, 0 deep inside: a dome */
      float nz = sf_sqrt(sf_max(0.f, 1.f - u * u)), nxv = gx * u, nyv = gy * u;
      float fres = sf_pow(1.f - sf_sat(nz), 2.2f);
      float side = 0.55f + 0.45f * (nxv * 0.7071f - nyv * 0.7071f) / sf_max(1e-4f, sf_sqrt(nxv * nxv + nyv * nyv));
      float lam = sf_sat(nxv * -0.4f + nyv * 0.5f + nz * 0.75f);
      float rz = 2.f * nz * nz - 1.f, rx = 2.f * nz * nxv, ry = 2.f * nz * nyv;
      float spec = sf_pow(sf_sat((rx * -0.45f + ry * 0.55f + rz * 0.7f) / 1.0416f), 24.f);
      float a = 1.f - sf_smooth(0.f, pxs * 1.5f, d);
      for (int c = 0; c < 3; c++) {
        float v = body[c] * (0.55f + 0.45f * lam);
        v = sf_mix(v, back[c], fres * rim * side * 0.75f) + back[c] * spec * 0.08f * gloss;
        col[c] = sf_mix(col[c], v, a);
      }
    }
    float *p = px + ((size_t)y * w + x) * 4;
    if (au.bg == 1) {                                           /* transparent: only the fluid, over whatever is below */
      float a = sf_sat(1.f - (col[0] + col[1] + col[2]) / sf_max(0.05f, back[0] + back[1] + back[2]));
      p[0] = col[0] * a; p[1] = col[1] * a; p[2] = col[2] * a; p[3] = a;
    } else { p[0] = col[0]; p[1] = col[1]; p[2] = col[2]; p[3] = 1.f; }
  }
  return 0;
}

#include "sf_abi.h"
