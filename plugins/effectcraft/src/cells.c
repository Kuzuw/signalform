/* Signalform Cells for EffectCraft: a living Voronoi tissue; every cell listens to its own slice of the spectrum.
 * A CPU port of Signalform's Cells module (frosted glass, organic, crystal and stained glass looks). */
#include "sf.h"
#include "sf_gen.h"

#define SF_MANIFEST "{\"api\":1,\"id\":\"org.signalform.cells\",\"name\":\"Signalform Cells\",\"category\":\"Signalform\",\"version\":\"1.0.0\"," \
  "\"author\":\"Signalform contributors\",\"description\":\"A living tissue of cells, each one lit by its own slice of the music.\",\"params\":[" \
  "{\"id\":\"style\",\"name\":\"Style\",\"type\":\"popup\",\"options\":[\"Frosted Glass\",\"Organic\",\"Crystal\",\"Stained Glass\"],\"default\":0}," \
  "{\"id\":\"map\",\"name\":\"Cells Follow\",\"type\":\"popup\",\"options\":[\"A Random Slice Each\",\"Centre Lows, Edge Highs\",\"Lows Left, Highs Right\"],\"default\":0}," \
  "{\"id\":\"scale\",\"name\":\"Cell Count\",\"type\":\"slider\",\"default\":7,\"min\":2,\"max\":30,\"decimals\":1}," \
  "{\"id\":\"jitter\",\"name\":\"Movement Range\",\"type\":\"slider\",\"default\":80,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"speed\",\"name\":\"Movement Speed\",\"type\":\"slider\",\"default\":0.6,\"min\":0,\"max\":3,\"decimals\":2}," \
  "{\"id\":\"flinch\",\"name\":\"Flinch on Kicks\",\"type\":\"slider\",\"default\":0.8,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"edge\",\"name\":\"Wall Width\",\"type\":\"slider\",\"default\":0.45,\"min\":0.1,\"max\":4,\"decimals\":2}," \
  "{\"id\":\"edgeGlow\",\"name\":\"Wall Glow\",\"type\":\"slider\",\"default\":0.85,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"fill\",\"name\":\"Cell Light\",\"type\":\"slider\",\"default\":0.85,\"min\":0,\"max\":2,\"decimals\":2}," \
  "{\"id\":\"bevel\",\"name\":\"Depth\",\"type\":\"slider\",\"default\":0.5,\"min\":0,\"max\":1,\"decimals\":2}," \
  "{\"id\":\"colorA\",\"name\":\"Colour A\",\"type\":\"color\",\"default\":[0.25,0.42,1,1]}," \
  "{\"id\":\"colorB\",\"name\":\"Colour B\",\"type\":\"color\",\"default\":[0.13,0.83,0.76,1]}," \
  "{\"id\":\"edgeColor\",\"name\":\"Wall Colour\",\"type\":\"color\",\"default\":[0.89,0.92,1,1]}," \
  "{\"id\":\"bright\",\"name\":\"Brightness\",\"type\":\"slider\",\"default\":1,\"min\":0.2,\"max\":3,\"decimals\":2}" \
  SF_AUDIO_JSON "]}"

enum { P_STYLE, P_MAP, P_SCALE, P_JIT, P_SPEED, P_FLINCH, P_EDGE, P_EGLOW, P_FILL, P_BEVEL, P_CA, P_CB = P_CA + 4, P_CE = P_CB + 4, P_BRIGHT = P_CE + 4, P_AUDIO, P_N = P_AUDIO + SF_AUDIO_N };

static float T, JIT, PULSE;
static inline void site(float nx, float ny, float *ox, float *oy) {
  float hx = sf_hash2(nx * 1.7f + 0.3f, ny * 3.1f + 0.7f), hy = sf_hash2(nx * 2.3f + 5.1f, ny * 1.3f + 2.9f);
  *ox = 0.5f + 0.5f * sf_sin(T + SF_TAU * hx) * JIT + (hx - 0.5f) * PULSE * 0.5f;
  *oy = 0.5f + 0.5f * sf_sin(T * 0.9f + SF_TAU * hy) * JIT + (hy - 0.5f) * PULSE * 0.5f;
}

static int sf_render(float *px, int w, int h, const double *pr, int np, double t, double scale) {
  if (np < P_N) return 1;
  (void)scale;
  SfAudio au = sf_audio(pr, P_AUDIO);
  int style = (int)pr[P_STYLE], map = (int)pr[P_MAP];
  float sc = (float)pr[P_SCALE] * (1.f - au.drop * 0.2f);
  T = (float)t * (float)pr[P_SPEED] * (0.6f + au.mid * 0.8f);
  JIT = (float)pr[P_JIT] / 100.f;
  PULSE = au.kick * (float)pr[P_FLINCH] * 0.35f + au.drop * (float)pr[P_FLINCH] * 0.5f;
  float ca[3], cb[3], ce[3]; SF_COLOR(pr, P_CA, ca); SF_COLOR(pr, P_CB, cb); SF_COLOR(pr, P_CE, ce);
  float edgeW = (float)pr[P_EDGE] * 0.04f, eglow = (float)pr[P_EGLOW], fillK = (float)pr[P_FILL], bevel = (float)pr[P_BEVEL], bright = (float)pr[P_BRIGHT];
  float aspect = (float)w / (float)h, inv = 1.f / (float)h, aa = sc * inv * 1.5f;
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    float ux = ((float)x + 0.5f - 0.5f * w) * inv, uy = (0.5f * h - (float)y - 0.5f) * inv;
    float X = ux * sc, Y = uy * sc, nx = sf_floor(X), ny = sf_floor(Y), fx = X - nx, fy = Y - ny;
    /* nearest and second-nearest site; the wall is where the two are equally far */
    float d1 = 9.f, d2 = 9.f, r1x = 0, r1y = 0, id1x = 0, id1y = 0, r2x = 0, r2y = 0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      float ox, oy; site(nx + i, ny + j, &ox, &oy);
      float rx = (float)i + ox - fx, ry = (float)j + oy - fy, d = rx * rx + ry * ry;
      if (d < d1) { d2 = d1; r2x = r1x; r2y = r1y; d1 = d; r1x = rx; r1y = ry; id1x = nx + i; id1y = ny + j; }
      else if (d < d2) { d2 = d; r2x = rx; r2y = ry; }
    }
    /* exact distance to the bisector between the two sites */
    float mx = 0.5f * (r1x + r2x), my = 0.5f * (r1y + r2y), dx = r2x - r1x, dy = r2y - r1y, dl = sf_sqrt(dx * dx + dy * dy) + 1e-6f;
    float border = (mx * dx + my * dy) / dl;
    float hsh = sf_hash2(id1x + 0.37f, id1y + 0.11f);
    float cx = (X + r1x) / sc, cy = (Y + r1y) / sc;
    float f = map == 0 ? hsh : map == 1 ? sf_sat(sf_sqrt(cx * cx + cy * cy) / (0.5f * aspect + 0.2f)) : sf_sat(cx / aspect + 0.5f);
    float e = sf_band(&au, f) * (0.7f + 0.6f * sf_noise1(hsh * 40.f + (float)t * 3.f));
    e = e * e * 2.2f + e * 0.4f;
    float tint[3]; for (int c = 0; c < 3; c++) tint[c] = sf_mix(ca[c], cb[c], f);
    float wall = 1.f - sf_smooth(edgeW, edgeW + aa, border), lit = fillK * (0.06f + e);
    float col[3];
    if (style == 0) {
      float rim = sf_exp(-border * 9.f);
      float k = (1.2f + bevel * 2.f) * sf_smooth(0.f, 0.35f, border), nxv = -r1x * k, nyv = -r1y * k, nl = sf_sqrt(nxv * nxv + nyv * nyv + 1.f);
      float sheen = sf_pow(sf_max((nxv * -0.5f + nyv * 0.6f + 0.62f) / nl / 0.9539f, 0.f), 7.f);
      float depth = 0.55f + 0.45f * sf_hash2(id1x + 5.7f, id1y + 1.3f), halo = sf_exp(-border * 34.f);
      for (int c = 0; c < 3; c++) col[c] = tint[c] * lit * (0.22f + 0.85f * rim) * depth + sf_mix(tint[c], 1.f, 0.6f) * sheen * (0.05f + e * 0.25f) * bevel
                                         + ce[c] * (wall * 0.85f + halo * 0.22f) * (0.3f + eglow * (0.45f + e * 1.4f + au.high * 0.6f));
    } else if (style == 1) {
      float body = sf_smooth(0.f, 0.25f + 0.15f * bevel, border), nucleus = sf_exp(-(r1x * r1x + r1y * r1y) * 60.f) * (0.4f + e);
      float shade = 0.55f + 0.45f * (1.f - sf_sqrt(r1x * r1x + r1y * r1y)), memb = (1.f - sf_smooth(0.f, 0.06f + aa, border)) * 0.08f * eglow * (0.3f + e);
      for (int c = 0; c < 3; c++) col[c] = tint[c] * (lit * 1.5f + 0.04f) * body * shade + tint[c] * nucleus * 0.8f * fillK + ce[c] * memb;
    } else if (style == 2) {
      float k = (1.f + bevel * 3.f) * sf_smooth(0.f, 0.3f, border), nxv = -r1x * k, nyv = -r1y * k, nl = sf_sqrt(nxv * nxv + nyv * nyv + 1.f);
      float l = sf_max((nxv * -0.5f + nyv * 0.6f + 0.65f) / nl / 1.0062f, 0.f);
      float rz = 1.f / nl, rx2 = 2.f * rz * nxv / nl, ry2 = 2.f * rz * nyv / nl, rz2 = -1.f + 2.f * rz * rz;
      float sp = sf_pow(sf_max((rx2 * -0.4f + ry2 * 0.5f + rz2 * 0.8f) / 1.0247f, 0.f), 24.f);
      for (int c = 0; c < 3; c++) col[c] = tint[c] * lit * (0.25f + 1.1f * l) + sp * (0.2f + e) * bevel + ce[c] * wall * 0.5f * eglow;
    } else {
      float lead = 1.f - sf_smooth(edgeW * 1.25f, edgeW * 1.25f + aa, border), var = 0.75f + 0.25f * sf_hash2(id1x + 3.3f, id1y);
      for (int c = 0; c < 3; c++) col[c] = tint[c] * (0.18f + e * 1.4f) * fillK * var * (1.f - lead * 0.95f) + ce[c] * lead * 0.04f * eglow;
    }
    float k2 = bright * (1.f + au.drop * 0.6f);
    sf_put(px + ((size_t)y * w + x) * 4, sf_tone(col[0] * k2 * 1.4f), sf_tone(col[1] * k2 * 1.4f), sf_tone(col[2] * k2 * 1.4f), au.bg == 0 ? 1 : 0);
  }
  return 0;
}

#include "sf_abi.h"
