/* Signalform CRT Screen for EffectCraft: the layer seen on a cathode-ray tube.
 * A CPU port of Signalform's CRT screen effect (renderer/crt.js): the picture is turned into a video
 * signal (RGB, S-Video, or composite NTSC with its subcarrier, so fine detail turns into rainbows and
 * colour edges bleed), drawn by an electron beam whose scan lines widen on bright parts, filtered
 * through a phosphor mask, and shown through curved glass with halation and a bezel. */
#include "sf.h"

#define SF_MANIFEST "{\"api\":1,\"id\":\"org.signalform.crt\",\"name\":\"Signalform CRT Screen\",\"category\":\"Signalform\",\"version\":\"1.0.0\"," \
  "\"author\":\"Signalform contributors\",\"description\":\"The layer on a cathode-ray tube: video signal, scan lines, phosphor mask, curved glass.\",\"params\":[" \
  "{\"id\":\"signal\",\"name\":\"Signal\",\"type\":\"popup\",\"options\":[\"RGB\",\"S-Video\",\"Composite\"],\"default\":2}," \
  "{\"id\":\"lines\",\"name\":\"Scan Lines\",\"type\":\"slider\",\"default\":240,\"min\":60,\"max\":1080,\"sliderMin\":120,\"sliderMax\":720,\"decimals\":0}," \
  "{\"id\":\"sharp\",\"name\":\"Sharpness\",\"type\":\"slider\",\"default\":50,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"scan\",\"name\":\"Scanline Depth\",\"type\":\"slider\",\"default\":55,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"bloom\",\"name\":\"Beam Bloom\",\"type\":\"slider\",\"default\":70,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"mask\",\"name\":\"Phosphor Mask\",\"type\":\"popup\",\"options\":[\"Aperture Grille\",\"Slot Mask\",\"Shadow Mask\",\"None\"],\"default\":1}," \
  "{\"id\":\"maskAmt\",\"name\":\"Mask Strength\",\"type\":\"slider\",\"default\":60,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"pitch\",\"name\":\"Mask Pitch\",\"type\":\"slider\",\"default\":3,\"min\":2,\"max\":16,\"decimals\":1}," \
  "{\"id\":\"curve\",\"name\":\"Curvature\",\"type\":\"slider\",\"default\":14,\"min\":0,\"max\":40,\"decimals\":1}," \
  "{\"id\":\"corner\",\"name\":\"Corner Rounding\",\"type\":\"slider\",\"default\":7,\"min\":0,\"max\":25,\"decimals\":1}," \
  "{\"id\":\"overscan\",\"name\":\"Overscan\",\"type\":\"slider\",\"default\":4,\"min\":-10,\"max\":15,\"decimals\":1}," \
  "{\"id\":\"halation\",\"name\":\"Halation\",\"type\":\"slider\",\"default\":45,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"vignette\",\"name\":\"Edge Falloff\",\"type\":\"slider\",\"default\":45,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"snow\",\"name\":\"Snow\",\"type\":\"slider\",\"default\":3,\"min\":0,\"max\":100,\"decimals\":0}," \
  "{\"id\":\"bright\",\"name\":\"Brightness\",\"type\":\"slider\",\"default\":0,\"min\":-30,\"max\":30,\"decimals\":1}," \
  "{\"id\":\"color\",\"name\":\"Colour\",\"type\":\"slider\",\"default\":105,\"min\":0,\"max\":200,\"decimals\":0}," \
  "{\"id\":\"bezel\",\"name\":\"Bezel\",\"type\":\"checkbox\",\"default\":true}," \
  "{\"id\":\"bezelColor\",\"name\":\"Bezel Colour\",\"type\":\"color\",\"default\":[0.1,0.1,0.11,1]}" \
  "]}"

enum { P_SIGNAL, P_LINES, P_SHARP, P_SCAN, P_BLOOM, P_MASK, P_MASKAMT, P_PITCH, P_CURVE, P_CORNER, P_OVERSCAN, P_HAL, P_VIG, P_SNOW, P_BRIGHT, P_COLOR, P_BEZEL, P_BEZC, P_N = P_BEZC + 4 };

/* horizontal decoder kernels (17 taps): luma (with notch, peaking and a little subcarrier leak) and chroma */
#define KT 8
static float KL[17], KC[17], KS[17];
static void gauss(float *k, float s) { float sum = 0; for (int i = -KT; i <= KT; i++) { k[i + KT] = sf_exp(-(float)(i * i) / (2.f * s * s)); sum += k[i + KT]; } for (int i = 0; i < 17; i++) k[i] /= sum; }
static const float BOX[5] = { 0.125f, 0.25f, 0.25f, 0.25f, 0.125f };
static void conv_box(float *k) { float t[17]; for (int i = 0; i < 17; i++) { float s = 0; for (int j = 0; j < 5; j++) { int q = i + j - 2; if (q >= 0 && q < 17) s += BOX[j] * k[q]; } t[i] = s; } float sum = 0; for (int i = 0; i < 17; i++) sum += t[i]; for (int i = 0; i < 17; i++) k[i] = t[i] / sum; }
static void kernels(int sig, float sharp) {
  int comp = sig == 2;
  float sy = comp ? 1.25f - 0.95f * sharp : 1.4f - 1.15f * sharp, sw = sf_min(3.2f, sy * 2.f + 1.2f), ky[17], kw[17], kc[17];
  gauss(ky, sy); gauss(kw, sw);
  if (comp) { conv_box(ky); conv_box(kw); }
  float r = 0.35f * 1.4f;
  for (int i = 0; i < 17; i++) KL[i] = (1.f + r) * ky[i] - r * kw[i];
  if (comp) { KL[KT] += 0.12f; for (int j = 0; j < 5; j++) KL[KT + j - 2] -= 0.12f * BOX[j]; }
  gauss(kc, sig == 2 ? 2.3f : 1.5f);
  static const float C4[4] = { 1, 0, -1, 0 }, S4[4] = { 0, 1, 0, -1 };
  for (int i = 0; i < 17; i++) { int m = ((i - KT) % 4 + 4) % 4; KC[i] = comp ? kc[i] * C4[m] : kc[i]; KS[i] = comp ? kc[i] * S4[m] : kc[i]; }
}

/* coverage of a periodic box (period 1, centred on c, width w) over [u - e, u + e] */
static inline float pF(float x, float w) { return sf_floor(x) * w + sf_min(sf_fract(x), w); }
static inline float pbox(float u, float e, float c, float w) { float s = c - 0.5f * w; return (pF(u + e - s, w) - pF(u - e - s, w)) / (2.f * e); }
static void maskAt(int type, float P, float fx, float fy, float *m) {
  if (type < 2) {
    const float W = 0.28f; float u = fx / P, e = 0.5f / P;
    float v = 1.f;
    if (type == 1) { float hc = P * 1.8f; v = pbox(fy / hc + 0.5f * (float)(((int)sf_floor(u)) & 1), 0.5f / hc, 0.5f, 0.8f) / 0.8f; }
    m[0] = sf_min(1.f, pbox(u, e, 1.f / 6.f, W) / W * v); m[1] = sf_min(1.f, pbox(u, e, 0.5f, W) / W * v); m[2] = sf_min(1.f, pbox(u, e, 5.f / 6.f, W) / W * v);
    return;
  }
  float a = P / 3.f, hh = a * 0.8660254f, r = sf_max(a * 0.46f, 0.5f), j0 = sf_floor(fy / hh + 0.5f), dm[3] = { 1e9f, 1e9f, 1e9f };
  for (int dj = -1; dj <= 1; dj++) {
    float j = j0 + (float)dj, dy = fy - j * hh, sh = 1.5f * (float)(((int)j) & 1);
    for (int c = 0; c < 3; c++) { float dx = fx - ((float)c + sh) * a; dx -= 3.f * a * sf_floor(dx / (3.f * a) + 0.5f); float d = dx * dx + dy * dy; if (d < dm[c]) dm[c] = d; }
  }
  for (int c = 0; c < 3; c++) m[c] = sf_sat(r - sf_sqrt(dm[c]) + 0.5f);
}
static inline float sdRBox(float px, float py, float bx, float by, float r) {
  float qx = sf_abs(px) - bx + r, qy = sf_abs(py) - by + r;
  float ox = sf_max(qx, 0.f), oy = sf_max(qy, 0.f);
  return sf_sqrt(ox * ox + oy * oy) + sf_min(sf_max(qx, qy), 0.f) - r;
}
/* bilinear sample of a 3-channel float image */
static inline void samp3(const float *img, int W, int H, float x, float y, float *o) {
  x = sf_clamp(x, 0.f, (float)W - 1.001f); y = sf_clamp(y, 0.f, (float)H - 1.001f);
  int x0 = (int)x, y0 = (int)y; float fx = x - x0, fy = y - y0;
  const float *a = img + (y0 * W + x0) * 3, *b = a + 3, *c = a + W * 3, *d = c + 3;
  for (int k = 0; k < 3; k++) o[k] = (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy;
}
static void boxblur(float *a, float *tmp, int W, int H, int r) {
  if (r < 1) return;
  float inv = 1.f / (float)(2 * r + 1);
  for (int y = 0; y < H; y++) for (int c = 0; c < 3; c++) {
    float s = 0; for (int i = -r; i <= r; i++) s += a[(y * W + (i < 0 ? 0 : i >= W ? W - 1 : i)) * 3 + c];
    for (int x = 0; x < W; x++) { tmp[(y * W + x) * 3 + c] = s * inv; int xo = x - r, xi = x + r + 1; s += a[(y * W + (xi >= W ? W - 1 : xi)) * 3 + c] - a[(y * W + (xo < 0 ? 0 : xo)) * 3 + c]; }
  }
  for (int x = 0; x < W; x++) for (int c = 0; c < 3; c++) {
    float s = 0; for (int i = -r; i <= r; i++) s += tmp[((i < 0 ? 0 : i >= H ? H - 1 : i) * W + x) * 3 + c];
    for (int y = 0; y < H; y++) { a[(y * W + x) * 3 + c] = s * inv; int yo = y - r, yi = y + r + 1; s += tmp[((yi >= H ? H - 1 : yi) * W + x) * 3 + c] - tmp[((yo < 0 ? 0 : yo) * W + x) * 3 + c]; }
  }
}

static int sf_render(float *px, int w, int h, const double *pr, int np, double t, double scale) {
  if (np < P_N) return 1;
  sf_lut_init();
  int sig = (int)pr[P_SIGNAL], maskType = (int)pr[P_MASK], bezel = pr[P_BEZEL] > 0.5;
  float A = (float)w / (float)h;
  int R = (int)sf_clamp((float)pr[P_LINES] * (float)h / sf_max(1.f, (float)h / (float)scale), 30.f, (float)h);
  R = (int)sf_clamp((float)pr[P_LINES], 30.f, (float)h);
  int Ws = (int)sf_min((float)w, sf_floor(564.f * A + 0.5f)); if (Ws < 64) Ws = 64 > w ? w : 64;
  int gw = w / 8 > 8 ? w / 8 : 8, gh = h / 8 > 8 ? h / 8 : 8;
  float *S = (float *)sf_scratch((u32)(Ws * R * 3 * 2 + gw * gh * 3 * 2) * 4u);
  if (!S) return 2;
  float *L = S + Ws * R * 3, *G = L + Ws * R * 3, *G2 = G + gw * gh * 3;
  int frame = (int)sf_floor((float)t * 60.f);
  float snow = (float)pr[P_SNOW] / 100.f;

  /* 1. the signal: box-filter the layer into R scan lines of Ws samples, as YIQ (or composite) */
  for (int r = 0; r < R; r++) {
    int y0 = r * h / R, y1 = (r + 1) * h / R; if (y1 <= y0) y1 = y0 + 1;
    for (int s = 0; s < Ws; s++) {
      int x0 = s * w / Ws, x1 = (s + 1) * w / Ws; if (x1 <= x0) x1 = x0 + 1;
      float cr = 0, cg = 0, cb = 0; int n = 0;
      for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) { const float *p = px + ((size_t)y * w + x) * 4; cr += p[0]; cg += p[1]; cb += p[2]; n++; }
      cr /= n; cg /= n; cb /= n;
      float Y = 0.299f * cr + 0.587f * cg + 0.114f * cb, I = 0.596f * cr - 0.274f * cg - 0.322f * cb, Q = 0.211f * cr - 0.523f * cg + 0.312f * cb;
      float nz = (sf_hash2((float)s, (float)r + (float)(frame % 997) * 1.37f) - 0.5f) * snow;
      float *o = S + (r * Ws + s) * 3;
      if (sig == 2) { int ph = (s + 2 * (r + frame)) & 3; float cs = ph == 0 ? 1.f : ph == 2 ? -1.f : 0.f, sn = ph == 1 ? 1.f : ph == 3 ? -1.f : 0.f; o[0] = Y + I * cs + Q * sn + nz * 0.5f; o[1] = o[2] = 0; }
      else if (sig == 1) { o[0] = Y + nz * 0.25f; o[1] = I; o[2] = Q; }
      else { o[0] = cr + nz * 0.25f; o[1] = cg + nz * 0.25f; o[2] = cb + nz * 0.25f; }
    }
  }
  /* 2. the decoder: notch + low-pass for luma, product detector + low-pass for chroma; TV knobs; the tube's 2.4 curve */
  kernels(sig, (float)pr[P_SHARP] / 100.f);
  float sat = (float)pr[P_COLOR] / 100.f, bright = (float)pr[P_BRIGHT] / 100.f;
  for (int r = 0; r < R; r++) for (int s = 0; s < Ws; s++) {
    float a0 = 0, a1 = 0, a2 = 0;
    for (int k = -KT; k <= KT; k++) {
      int q = s + k; q = q < 0 ? 0 : q >= Ws ? Ws - 1 : q;
      const float *v = S + (r * Ws + q) * 3;
      if (sig == 2) { a0 += KL[k + KT] * v[0]; a1 += KC[k + KT] * v[0]; a2 += KS[k + KT] * v[0]; }
      else if (sig == 1) { a0 += KL[k + KT] * v[0]; a1 += KC[k + KT] * v[1]; a2 += KC[k + KT] * v[2]; }
      else { a0 += KL[k + KT] * v[0]; a1 += KL[k + KT] * v[1]; a2 += KL[k + KT] * v[2]; }
    }
    float Y, I, Q;
    if (sig == 2) { int ph = (s + 2 * (r + frame)) & 3; float ca = ph == 0 ? 1.f : ph == 2 ? -1.f : 0.f, sa = ph == 1 ? 1.f : ph == 3 ? -1.f : 0.f; Y = a0; I = 2.f * (ca * a1 - sa * a2); Q = 2.f * (sa * a1 + ca * a2); }
    else if (sig == 1) { Y = a0; I = a1; Q = a2; }
    else { Y = 0.299f * a0 + 0.587f * a1 + 0.114f * a2; I = 0.596f * a0 - 0.274f * a1 - 0.322f * a2; Q = 0.211f * a0 - 0.523f * a1 + 0.312f * a2; }
    I *= sat; Q *= sat;
    float cr = Y + 0.956f * I + 0.621f * Q + bright, cg = Y - 0.272f * I - 0.647f * Q + bright, cb = Y - 1.106f * I + 1.703f * Q + bright;
    float *o = L + (r * Ws + s) * 3;
    o[0] = sf_pow(sf_clamp(cr, 0.f, 1.4f), 2.4f); o[1] = sf_pow(sf_clamp(cg, 0.f, 1.4f), 2.4f); o[2] = sf_pow(sf_clamp(cb, 0.f, 1.4f), 2.4f);
  }
  /* 3. halation and the bezel's reflection: a small blurred copy */
  for (int y = 0; y < gh; y++) for (int x = 0; x < gw; x++) samp3(L, Ws, R, ((float)x + 0.5f) / gw * Ws - 0.5f, ((float)y + 0.5f) / gh * R - 0.5f, G + (y * gw + x) * 3);
  int br = (int)(gh * 0.04f) + 1;
  boxblur(G, G2, gw, gh, br); boxblur(G, G2, gw, gh, br); boxblur(G, G2, gw, gh, br * 2);

  /* 4. the tube, per output pixel */
  float bz = bezel ? sf_floor(0.07f * (float)(w < h ? w : h)) : 0.f;
  float inX = 0.5f - bz / w, inY = 0.5f - bz / h, halfX = w * inX, halfY = h * inY;
  float curve = (float)pr[P_CURVE] / 100.f, aw = sf_sqrt(halfX / halfY), over = 1.f + (float)pr[P_OVERSCAN] / 100.f;
  float cornerPx = (float)pr[P_CORNER] / 100.f * sf_min(halfX, halfY);
  float scanv = (float)pr[P_SCAN] / 100.f, bloomv = (float)pr[P_BLOOM] / 100.f;
  float smin = 0.45f - 0.33f * scanv, smax = smin + bloomv * (0.55f - 0.33f * scanv - smin);
  float hw = 0.5f * (float)R / (2.f * halfY) * over;            /* scan lines per output pixel, halved: the box filter */
  float mAmt = maskType < 3 ? (float)pr[P_MASKAMT] / 100.f : 0.f, P = sf_max(2.f, (float)pr[P_PITCH] * (float)scale);
  float hal = (float)pr[P_HAL] / 100.f, vig = (float)pr[P_VIG] / 100.f;
  float bzc[3] = { (float)(pr[P_BEZC] * pr[P_BEZC]), (float)(pr[P_BEZC + 1] * pr[P_BEZC + 1]), (float)(pr[P_BEZC + 2] * pr[P_BEZC + 2]) };
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    float ux = ((float)x + 0.5f) / w, uy = 1.f - ((float)y + 0.5f) / h;      /* uy up, so the bezel is lit from above */
    float qx = (ux - 0.5f) / inX, qy = (uy - 0.5f) / inY;
    float pcx = qx * (1.f + curve * 0.5f * qy * qy / aw), pcy = qy * (1.f + curve * 0.5f * qx * qx * aw);
    float dpx = sdRBox(pcx * halfX, pcy * halfY, halfX, halfY, cornerPx);
    float inside = sf_sat(0.5f - dpx);
    float col[3] = { 0, 0, 0 }, outc[3] = { 0, 0, 0 };
    float tx = pcx / over * 0.5f + 0.5f, ty = pcy / over * 0.5f + 0.5f;     /* picture coordinates (ty up) */
    if (inside > 0.f) {
      float rc = (1.f - ty) * R - 0.5f, r0 = sf_floor(rc + 0.5f), sx = tx * Ws - 0.5f;
      float acc[3] = { 0, 0, 0 };
      for (int k = -1; k <= 1; k++) {
        float row = r0 + (float)k;
        if (row < 0.f || row > (float)R - 1.f) continue;
        float c[3]; samp3(L, Ws, R, sx, row, c);
        float d = rc - row;
        for (int ch = 0; ch < 3; ch++) {
          float sg = sf_mix(smin, smax, sf_sqrt(sf_sat(c[ch]))), s2 = sg * sg + hw * hw * 0.33333f;
          acc[ch] += c[ch] * sf_exp(-d * d / (2.f * s2)) / sf_sqrt(s2);
        }
      }
      float edge = 0.5f / halfX, inX2 = sf_smooth(-edge, edge, tx) * sf_smooth(-edge, edge, 1.f - tx);
      float m[3] = { 1, 1, 1 };
      if (mAmt > 0.f) { maskAt(maskType, P, (float)x, (float)y, m); for (int ch = 0; ch < 3; ch++) m[ch] = sf_mix(1.f - 0.75f * mAmt, 1.f + 0.6f * mAmt, m[ch]); }
      float g[3]; samp3(G, gw, gh, tx * gw - 0.5f, (1.f - ty) * gh - 0.5f, g);
      float vg = sf_mix(1.f, sf_pow(sf_sat(16.f * tx * ty * (1.f - tx) * (1.f - ty)), 0.5f), vig);
      for (int ch = 0; ch < 3; ch++) {
        float v = acc[ch] * 0.39894228f * inX2 * m[ch] + g[ch] * hal * 0.3f;
        v *= vg;
        if (v > 0.72f) v = 0.72f + 0.28f * (1.f - sf_exp(-(v - 0.72f) / 0.28f));
        col[ch] = v;
      }
    }
    if (inside < 1.f && bezel) {
      float tb = sf_sat(dpx / (bz * 0.5f)), chm = 1.f - tb;
      float mx = 1.f - sf_abs(1.f - sf_abs(tx)), my = 1.f - sf_abs(1.f - sf_abs(ty));
      float g[3]; samp3(G, gw, gh, mx * gw - 0.5f, (1.f - my) * gh - 0.5f, g);
      float lit = 0.5f + 0.5f * sf_smooth(-1.3f, 1.3f, qy), seam = 0.35f + 0.65f * sf_smooth(0.f, 3.f, dpx);
      for (int ch = 0; ch < 3; ch++) outc[ch] = (bzc[ch] * lit + g[ch] * (0.03f + 0.3f * chm * chm)) * seam;
    }
    float *p = px + ((size_t)y * w + x) * 4;
    for (int ch = 0; ch < 3; ch++) p[ch] = sf_encode(sf_mix(outc[ch], col[ch], inside));
    p[3] = 1.f;
  }
  return 0;
}

#include "sf_abi.h"
