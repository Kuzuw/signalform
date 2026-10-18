#!/usr/bin/env bash
# Builds the Signalform effects for EffectCraft.
#   ./build.sh          → dist/*.wasm (the plug-ins) and build/* (native test harnesses)
# Needs clang with the WebAssembly target and wasm-ld (LLVM 15 or newer).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist build
CLANG=${CLANG:-clang}
for src in src/*.c; do
  name=$(basename "$src" .c)
  # the plug-in: no imports, no C library; memory grows as needed
  $CLANG --target=wasm32 -O2 -ffast-math -fno-math-errno -nostdlib -fno-builtin -fvisibility=hidden \
    -Wl,--no-entry -Wl,--export-dynamic -Wl,--strip-all -Wl,-z,stack-size=1048576 -Wl,--initial-memory=2097152 \
    -o "dist/signalform-$name.wasm" "$src"
  # the same code, natively, for test/render.py
  $CLANG -O2 -ffast-math -o "build/$name" "$src" test/harness.c -lm
  printf '%-10s %7d bytes\n' "$name" "$(stat -c %s "dist/signalform-$name.wasm")"
done
