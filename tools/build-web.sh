#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="$PROJECT_ROOT/tools/emsdk"
if [[ -f "$SDK_ROOT/emsdk_env.sh" ]]; then
    source "$SDK_ROOT/emsdk_env.sh"
elif ! command -v emcc >/dev/null; then
    echo 'Emscripten is missing. Install the SDK or use deploy/Dockerfile.' >&2
    exit 1
fi
GL4ES_DIR="$PROJECT_ROOT/tools/gl4es"
WEB_DIR="$PROJECT_ROOT/web"
BUILD_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/quakesrc-web"
mkdir -p "$BUILD_ROOT/engine" "$WEB_DIR/dist/engine"
export EM_CACHE="$BUILD_ROOT/emscripten-cache"
mkdir -p "$EM_CACHE"
# Warm the ports once before parallel compilation, on the Linux filesystem.
emcc --check
mkdir -p "$EM_CACHE/sysroot/lib/pkgconfig"
embuilder build sdl2 zlib vorbis
emcmake cmake -S "$GL4ES_DIR" -B "$BUILD_ROOT/gl4es" \
    -DCMAKE_BUILD_TYPE=Release -DNOX11=ON -DNOEGL=ON -DSTATICLIB=ON \
    -DNO_LOADER=ON -DNO_INIT_CONSTRUCTOR=ON -DDEFAULT_ES=2 \
    -DCMAKE_C_FLAGS="-Wno-error=implicit-function-declaration"
cmake --build "$BUILD_ROOT/gl4es" --parallel 8
cp -ru "$PROJECT_ROOT/source/Quake/." "$BUILD_ROOT/engine/"
emmake make -C "$BUILD_ROOT/engine" -f "$WEB_DIR/Makefile" \
    CC=emcc STRIP=emstrip GL4ES_DIR="$GL4ES_DIR" WEB_DIR="$WEB_DIR" -j8
cp "$BUILD_ROOT/engine/quakespasm.js" "$BUILD_ROOT/engine/quakespasm.wasm" "$WEB_DIR/dist/engine/"
cp "$BUILD_ROOT/engine/quakespasm.js" "$WEB_DIR/dist/engine/quakespasm.cjs"
cp "$PROJECT_ROOT/source/LICENSE.txt" "$WEB_DIR/dist/engine/LICENSE.txt"
cp "$GL4ES_DIR/LICENSE" "$WEB_DIR/dist/engine/GL4ES-LICENSE.txt"
echo 'Web build ready in web/dist/engine'
