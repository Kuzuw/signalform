/* Shared parameters of the Signalform generators (they draw a picture of their own on the layer).
 * Plug-ins see only the current time, so the music reaches them as six sliders, 0–100 %, which the
 * "Signalform Audio Link" script connects to keyframes: either the "Signalform Audio" null that
 * Signalform exports from a track (bass, mids, highs, kicks, drops…), or EffectCraft's own
 * Convert Audio to Keyframes (loudness only). */
#ifndef SF_GEN_H
#define SF_GEN_H

#define SF_AUDIO_JSON \
  ",{\"id\":\"background\",\"name\":\"Background\",\"type\":\"popup\",\"options\":[\"Black\",\"Transparent\"],\"default\":0}" \
  ",{\"id\":\"aLevel\",\"name\":\"Audio: Level\",\"type\":\"slider\",\"default\":40,\"min\":0,\"max\":100,\"decimals\":1}" \
  ",{\"id\":\"aBass\",\"name\":\"Audio: Bass\",\"type\":\"slider\",\"default\":40,\"min\":0,\"max\":100,\"decimals\":1}" \
  ",{\"id\":\"aMid\",\"name\":\"Audio: Mids\",\"type\":\"slider\",\"default\":30,\"min\":0,\"max\":100,\"decimals\":1}" \
  ",{\"id\":\"aHigh\",\"name\":\"Audio: Highs\",\"type\":\"slider\",\"default\":20,\"min\":0,\"max\":100,\"decimals\":1}" \
  ",{\"id\":\"aKick\",\"name\":\"Audio: Kick\",\"type\":\"slider\",\"default\":0,\"min\":0,\"max\":100,\"decimals\":1}" \
  ",{\"id\":\"aDrop\",\"name\":\"Audio: Drop\",\"type\":\"slider\",\"default\":0,\"min\":0,\"max\":100,\"decimals\":1}" \
  ",{\"id\":\"aGain\",\"name\":\"Audio: Reactivity\",\"type\":\"slider\",\"default\":100,\"min\":0,\"max\":300,\"decimals\":0}"
#define SF_AUDIO_N 8

typedef struct { int bg; float level, bass, mid, high, kick, drop; } SfAudio;
/* read the shared block that starts at pr[at] */
static inline SfAudio sf_audio(const double *pr, int at) {
  SfAudio a; float g = (float)pr[at + 7] / 100.f;
  a.bg = (int)pr[at];
  a.level = sf_sat((float)pr[at + 1] / 100.f * g); a.bass = sf_sat((float)pr[at + 2] / 100.f * g); a.mid = sf_sat((float)pr[at + 3] / 100.f * g);
  a.high = sf_sat((float)pr[at + 4] / 100.f * g); a.kick = sf_sat((float)pr[at + 5] / 100.f * g); a.drop = sf_sat((float)pr[at + 6] / 100.f * g);
  return a;
}
/* the energy of a slice of the spectrum, f = 0 (lows) … 1 (highs), from the three bands */
static inline float sf_band(const SfAudio *a, float f) {
  return f < 0.5f ? sf_mix(a->bass, a->mid, f * 2.f) : sf_mix(a->mid, a->high, f * 2.f - 1.f);
}
/* colours as the user picked them (display values, as in Signalform's modules) */
#define SF_COLOR(pr, at, c) do { (c)[0] = (float)(pr)[at]; (c)[1] = (float)(pr)[(at) + 1]; (c)[2] = (float)(pr)[(at) + 2]; } while (0)

#endif
