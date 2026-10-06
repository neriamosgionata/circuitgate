#!/usr/bin/env bash
#
# Reproducible license-clean ngspice -> WebAssembly build for CircuitGate.
#
# Run inside an emscripten/emsdk container (pinned version recorded in
# docs/operations.md):
#
#   docker run --rm -v "$PWD:/work" -w /work \
#     emscripten/emsdk:6.0.11 \
#     bash frontend/src/lib/engine/analog/ngspice/build/build-ngspice-wasm.sh \
#     /work/ngspice-src /work/out
#
# The script:
#   1. replaces ngspice's LGPL-2.1 `numparam` module with the pass-through
#      shim in ./patches/numparam-shim (KLU, XSPICE, OSDI, CIDER, tcl and
#      pthreads are excluded through configure flags),
#   2. configures with static analysis only (no dynamic execution, no
#      threads, no dynamic loading),
#   3. emits `ngspice.js` + `ngspice.wasm` and a build-meta.json recording
#      the exact ngspice commit and Emscripten version.

set -euo pipefail

SRC="${1:?usage: build-ngspice-wasm.sh SRC_DIR OUT_DIR}"
OUT="${2:?usage: build-ngspice-wasm.sh SRC_DIR OUT_DIR}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v emcc >/dev/null 2>&1; then
	echo "error: emcc not found; run inside emscripten/emsdk" >&2
	exit 1
fi

if ! command -v autoconf >/dev/null 2>&1 || \
   ! command -v libtoolize >/dev/null 2>&1 || \
   ! command -v bison >/dev/null 2>&1 || \
   ! command -v flex >/dev/null 2>&1; then
	echo "==> installing autotools"
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq
	apt-get install -y -qq --no-install-recommends \
		autoconf automake libtool bison flex m4 pkg-config
fi

NGSPICE_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
NGSPICE_TAG="$(git -C "$SRC" describe --tags --exact-match 2>/dev/null || echo unknown)"
EMCC_VERSION="$(emcc --version | head -n 1)"

echo "==> replacing numparam (LGPL-2.1) with pass-through shim"
rm -rf "$SRC/src/frontend/numparam"
mkdir -p "$SRC/src/frontend/numparam"
cp "$HERE"/patches/numparam-shim/general.h "$SRC/src/frontend/numparam/"
cp "$HERE"/patches/numparam-shim/numpaif.h "$SRC/src/frontend/numparam/"
cp "$HERE"/patches/numparam-shim/numparam_stub.c "$SRC/src/frontend/numparam/"
cp "$HERE"/patches/numparam-shim/Makefile.am "$SRC/src/frontend/numparam/"

echo "==> applying Emscripten compatibility patches"
# Emscripten has no getrusage; avoid a configure probe that fails hard.
sed -i 's/AC_CHECK_FUNCS(\[time getrusage\])/AC_CHECK_FUNCS([time])/g' "$SRC/configure.ac" || true
# Clang 20+ rejects the old empty-argument declaration in outitf.c.
sed -i 's/sh_vecinit(void/sh_vecinit(int/' "$SRC/src/frontend/outitf.c" || true

# Upstream --disable-xspice bug: cktsopt.c#else references the XSPICE-only
# OPT_ENH_RSHUNT enum constant. Remove the dead branch.
python3 - "$SRC/src/spicelib/analysis/cktsopt.c" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source = path.read_text()
needle = """#else
    case OPT_ENH_RSHUNT:
        fprintf(stderr, "WARNING - Option Rshunt available only with XSPICE enabled.\\n");
        break;
#endif"""
if needle in source:
    path.write_text(source.replace(needle, "#endif", 1))
PY

# HICUM2 is C++ and fails to link under Emscripten without the C++ runtime;
# remove it from the build (upstream ngspice bug #793).
sed -i '/AC_CHECK_LIB(stdc++/d' "$SRC/configure.ac"
sed -i '/AC_SUBST(XTRALIBS/d' "$SRC/configure.ac"
sed -i '/src\/spicelib\/devices\/hicum2\/Makefile/d' "$SRC/configure.ac"
sed -i '/tests\/hicum2\/Makefile/d' "$SRC/configure.ac"
sed -i '/spicelib\/devices\/hicum2\/libhicum2.la/d' "$SRC/src/Makefile.am"
sed -i '/^[[:space:]]*hicum2[[:space:]]*\\\?/d' "$SRC/src/spicelib/devices/Makefile.am"
sed -i '/get_hicum_info/d' "$SRC/src/spicelib/devices/dev.c"
sed -i '/^[[:space:]]*hicum2[[:space:]]*\\\?[[:space:]]*$/d' "$SRC/tests/Makefile.am"

echo "==> autogen"
( cd "$SRC" && ./autogen.sh >/dev/null )

echo "==> configure"
rm -rf "$SRC/build"
mkdir -p "$SRC/build"
cd "$SRC/build"
emconfigure ../configure \
	--host=wasm32-unknown-emscripten \
	--enable-static --disable-shared \
	--with-readline=no \
	--without-x \
	--disable-debug \
	--disable-openmp \
	--disable-pthread \
	--disable-xspice \
	--disable-osdi \
	--disable-klu \
	--with-fftw3=no \
	--without-tcl \
	CFLAGS="-O2" \
	LDFLAGS="-O2" \
	>configure.log 2>&1 || { tail -n 40 configure.log; exit 1; }

EM_LDFLAGS="-O2"
EM_LDFLAGS="$EM_LDFLAGS -sMODULARIZE=1"
EM_LDFLAGS="$EM_LDFLAGS -sEXPORT_ES6=1"
EM_LDFLAGS="$EM_LDFLAGS -sEXPORT_NAME=createNgspiceModule"
EM_LDFLAGS="$EM_LDFLAGS -sENVIRONMENT=web,worker,node"
EM_LDFLAGS="$EM_LDFLAGS -sALLOW_MEMORY_GROWTH=1"
EM_LDFLAGS="$EM_LDFLAGS -sINITIAL_MEMORY=33554432"
EM_LDFLAGS="$EM_LDFLAGS -sSTACK_SIZE=5242880"
EM_LDFLAGS="$EM_LDFLAGS -sINVOKE_RUN=0"
EM_LDFLAGS="$EM_LDFLAGS -sNO_EXIT_RUNTIME=1"
EM_LDFLAGS="$EM_LDFLAGS -sFORCE_FILESYSTEM=1"
EM_LDFLAGS="$EM_LDFLAGS -sEXPORTED_RUNTIME_METHODS=FS,callMain"
EM_LDFLAGS="$EM_LDFLAGS -sEXPORTED_FUNCTIONS=_main,_malloc,_free"
EM_LDFLAGS="$EM_LDFLAGS -sDYNAMIC_EXECUTION=0"
EM_LDFLAGS="$EM_LDFLAGS -sASSERTIONS=0"
EM_LDFLAGS="$EM_LDFLAGS -sERROR_ON_UNDEFINED_SYMBOLS=0"
EM_LDFLAGS="$EM_LDFLAGS -sSUPPORT_LONGJMP=emscripten"

echo "==> make"
emmake make -j"$(nproc)" LDFLAGS="$EM_LDFLAGS" >make.log 2>&1 || {
	tail -n 60 make.log
	exit 1
}

echo "==> collecting artifacts"
mkdir -p "$OUT"
if [ -f src/ngspice ]; then
	JS_SOURCE=src/ngspice
elif [ -f src/ngspice.js ]; then
	JS_SOURCE=src/ngspice.js
else
	echo "error: compiled JS not found under $SRC/build/src" >&2
	exit 1
fi
{
	echo '// @ts-nocheck'
	echo '// Vendored ngspice WebAssembly glue generated by build/build-ngspice-wasm.sh.'
	echo '// Types for importers live in ngspice.d.ts; see manifest.json for provenance.'
	cat "$JS_SOURCE"
} >"$OUT/ngspice.js"
cp src/ngspice.wasm "$OUT/ngspice.wasm"

cat >"$OUT/build-meta.json" <<EOF
{
	"ngspiceTag": "$NGSPICE_TAG",
	"ngspiceCommit": "$NGSPICE_COMMIT",
	"emscripten": "$EMCC_VERSION",
	"configureFlags": [
		"--host=wasm32-unknown-emscripten",
		"--enable-static --disable-shared",
		"--with-readline=no --without-x",
		"--disable-debug --disable-openmp --disable-pthread",
		"--disable-xspice --disable-osdi --disable-klu",
		"--with-fftw3=no --without-tcl"
	],
	"numparam": "replaced by MIT pass-through shim (patches/numparam-shim)"
}
EOF

echo "==> done:"
ls -l "$OUT"
