/* Native test harness: runs one effect's render on a frame, exactly as the plug-in does inside
 * EffectCraft, and writes the pixels as raw little-endian f32 RGBA.
 *   harness --manifest
 *   harness W H TIME SCALE IN.raw|- OUT.raw p0 p1 p2 ...   (parameters flattened as the host sends them)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

const char *sf_manifest(void);
int sf_entry(float *px, int w, int h, const double *pr, int np, double t, double scale);

int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "--manifest")) { puts(sf_manifest()); return 0; }
  if (argc < 7) { fprintf(stderr, "usage: harness W H TIME SCALE IN.raw|- OUT.raw params...\n"); return 2; }
  int w = atoi(argv[1]), h = atoi(argv[2]);
  double t = atof(argv[3]), scale = atof(argv[4]);
  size_t n = (size_t)w * h * 4;
  float *px = calloc(n, sizeof(float));
  if (strcmp(argv[5], "-")) { FILE *f = fopen(argv[5], "rb"); if (!f || fread(px, sizeof(float), n, f) != n) { fprintf(stderr, "bad input\n"); return 1; } fclose(f); }
  int np = argc - 7;
  double *pr = calloc(np ? np : 1, sizeof(double));
  for (int i = 0; i < np; i++) pr[i] = atof(argv[7 + i]);
  clock_t c0 = clock();
  int rc = sf_entry(px, w, h, pr, np, t, scale);
  double ms = (double)(clock() - c0) * 1000.0 / CLOCKS_PER_SEC;
  FILE *o = fopen(argv[6], "wb"); fwrite(px, sizeof(float), n, o); fclose(o);
  fprintf(stderr, "rc %d  %.1f ms native\n", rc, ms);
  return rc;
}
