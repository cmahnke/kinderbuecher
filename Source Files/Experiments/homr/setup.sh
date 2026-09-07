#!/usr/bin/env bash
#
# Setup for the Score Page Detection and OMR pipeline:
#
#   1. installs the node and python dependencies (npm, pip, homr weights)
#   2. copies the OpenSeadragon button images into public/ ("icons"; the
#      favicon.svg and icons.svg in public/ are source assets, nothing to
#      generate there)
#   3. runs the OMR detection (homr -> MusicXML, scripts/run_homr.py)
#   4. converts the MusicXML to MNX (scripts/generate_mnx.py)
#   5. builds the IIIF pyramids and thumbnails (scripts/generate_iiif.py)
#   6. generates the IIIF manifest the viewer consumes
#      (scripts/generate_manifest.py -> public/manifest.json, including
#      copies of the notation files under public/musicxml/ and public/mnx/)
#
# Every step is safe to re-run. The OMR step is by far the longest (homr
# runs its transformer per page); skip it while iterating with --skip-omr.
#
# Usage: ./setup.sh [--deps-only] [--skip-omr] [--skip-mnx] [--skip-images]
#                    [--skip-manifest]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"

DEPS_ONLY=0
SKIP_OMR=0
SKIP_MNX=0
SKIP_IMAGES=0
SKIP_MANIFEST=0
for arg in "$@"; do
  case "$arg" in
    --deps-only) DEPS_ONLY=1 ;;
    --skip-omr) SKIP_OMR=1 ;;
    --skip-mnx) SKIP_MNX=1 ;;
    --skip-images) SKIP_IMAGES=1 ;;
    --skip-manifest) SKIP_MANIFEST=1 ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--deps-only] [--skip-omr] [--skip-mnx] [--skip-images] [--skip-manifest]" >&2
      exit 2
      ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }

# --- 1. Node dependencies ---------------------------------------------------
step "Installing node dependencies (npm install)"
npm install

# --- 2. Python dependencies -------------------------------------------------
step "Checking python dependencies (homr, pillow, pyvips, lxml)"
missing=()
for mod in homr PIL pyvips lxml; do
  if ! "$PYTHON" -c "import $mod" >/dev/null 2>&1; then
    missing+=("$mod")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Installing missing python packages: ${missing[*]}"
  "$PYTHON" -m pip install "${missing[@]}"
fi
# pyvips also needs the system VIPS library; the import alone does not
# prove it is usable.
if ! "$PYTHON" -c "import pyvips; pyvips.Image.black(2, 2)" >/dev/null 2>&1; then
  echo "WARNING: pyvips is installed but the VIPS system library seems" >&2
  echo "missing. Install it (e.g. 'brew install vips' or 'apt install" >&2
  echo "libvips42'), otherwise generate_iiif.py will fail." >&2
fi

step "Ensuring homr model weights are downloaded"
"$PYTHON" -c "from homr.main import download_weights; download_weights(False, False, False)"

# --- 3. OpenSeadragon button images ------------------------------------------
# The viewer points OpenSeadragon at /openseadragon/images/ (prefixUrl in
# src/osdViewer.ts). The npm package only ships them under build/, and
# public/openseadragon/images is gitignored, so copy them from node_modules.
step "Copying OpenSeadragon button images to public/openseadragon/images"
if [ ! -d node_modules/openseadragon/build/openseadragon/images ]; then
  echo "node_modules/openseadragon/build/openseadragon/images not found" >&2
  exit 1
fi
mkdir -p public/openseadragon
rm -rf public/openseadragon/images
cp -R node_modules/openseadragon/build/openseadragon/images public/openseadragon/images

if [ "$DEPS_ONLY" -eq 1 ]; then
  step "Done (dependencies only)"
  exit 0
fi

# --- 4. OMR detection (homr -> MusicXML) -------------------------------------
# Writes data/results.json (staff bboxes + grids) and pageNNN.musicxml.
if [ "$SKIP_OMR" -eq 0 ]; then
  step "Running homr OMR detection (this is the long step)"
  "$PYTHON" scripts/run_homr.py . -o data/results.json
else
  step "Skipping OMR detection (--skip-omr)"
fi

# --- 5. MNX conversion --------------------------------------------------------
# Converts each generated pageNNN.musicxml to pageNNN.mnx (alpha converter;
# individual failures are reported and do not stop the run).
if [ "$SKIP_MNX" -eq 0 ]; then
  step "Generating MNX representations"
  "$PYTHON" scripts/generate_mnx.py .
else
  step "Skipping MNX generation (--skip-mnx)"
fi

# --- 6. IIIF pyramids + thumbnails --------------------------------------------
# One run builds public/iiif/<name>/ pyramids and public/thumbnails/*.jpg.
if [ "$SKIP_IMAGES" -eq 0 ]; then
  step "Building IIIF pyramids and thumbnails"
  "$PYTHON" scripts/generate_iiif.py . -o public/iiif
else
  step "Skipping IIIF/thumbnails (--skip-images)"
fi

# --- 7. IIIF manifest ----------------------------------------------------------
# The viewer's single data source: page canvases (IIIF endpoints), staff
# canvases, notation references and thumbnails — static files only.
if [ "$SKIP_MANIFEST" -eq 0 ]; then
  step "Generating the IIIF manifest"
  "$PYTHON" scripts/generate_manifest.py
else
  step "Skipping manifest generation (--skip-manifest)"
fi

step "Setup complete"
echo "Start the viewer with: npm run dev   (http://localhost:5199/)"
