#!/usr/bin/env bash
#
# Setup for the Score Page Detection and OMR pipeline:
#
#   1. installs the node and python dependencies (npm, pip, homr weights)
#   2. copies the OpenSeadragon button images into public/ ("icons"; the
#      favicon.svg and icons.svg in public/ are source assets, nothing to
#      generate there)
#   3. per book (registered in books.json): runs the OMR detection
#      (homr -> MusicXML, scripts/run_homr.py), wraps the MusicXML in TEI
#      incl. staff regions (scripts/generate_tei.py, validated by
#      scripts/validate_tei.py against schema/homr-tei.rng + the MusicXML
#      4.0 XSD), builds the IIIF pyramids and thumbnails
#      (scripts/generate_iiif.py), and generates the IIIF manifest the
#      viewer consumes (scripts/generate_manifest.py ->
#      public/<slug>/manifest.json, including copies of the notation files
#      under public/<slug>/musicxml/)
#   4. writes the book selector index (scripts/generate_books_index.py ->
#      public/books.json)
#
# Every step is safe to re-run. The OMR step is by far the longest (homr
# runs its transformer per page); skip it while iterating with --skip-omr.
#
# Usage: ./setup.sh [--deps-only] [--skip-omr] [--skip-tei] [--skip-images]
#                    [--skip-manifest] [--book SLUG]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"

DEPS_ONLY=0
SKIP_OMR=0
SKIP_TEI=0
SKIP_IMAGES=0
SKIP_MANIFEST=0
ONLY_BOOK=""
for arg in "$@"; do
  case "$arg" in
    --deps-only) DEPS_ONLY=1 ;;
    --skip-omr) SKIP_OMR=1 ;;
    --skip-tei) SKIP_TEI=1 ;;
    --skip-images) SKIP_IMAGES=1 ;;
    --skip-manifest) SKIP_MANIFEST=1 ;;
    --book) ONLY_BOOK="__NEXT__" ;;
    *)
      if [ "$ONLY_BOOK" = "__NEXT__" ]; then
        ONLY_BOOK="$arg"
      else
        echo "Unknown option: $arg" >&2
        echo "Usage: $0 [--deps-only] [--skip-omr] [--skip-tei] [--skip-images] [--skip-manifest] [--book SLUG]" >&2
        exit 2
      fi
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

# --- 3. Books ---------------------------------------------------------------
# The book registry (books.json at the repo root) drives everything below:
# one entry per book with slug, title, imageDir and the deployment baseUrl
# the IIIF URIs are built from.
step "Reading the book registry (books.json)"
BOOKS="$(python3 - "$ONLY_BOOK" <<'PY'
import json, sys

only = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "__NEXT__" else None
with open("books.json", encoding="utf-8") as fh:
    books = json.load(fh)
for book in books:
    if only and book["slug"] != only:
        continue
    print("\t".join([book["slug"], book["imageDir"], book["baseUrl"], book["title"]]))
PY
)"
if [ -z "$BOOKS" ]; then
  echo "No matching book in books.json${ONLY_BOOK:+ (filter: $ONLY_BOOK)}" >&2
  exit 1
fi

while IFS=$'\t' read -r slug image_dir base title; do
  step "Book: $title ($slug)"

  # --- OMR detection (homr -> MusicXML) --------------------------------------
  # Writes data/<slug>/results.json (staff bboxes + grids) and
  # pageNNN.musicxml next to the book's images. Uses the installed homr
  # unless HOMR_PATH points at a local checkout (e.g. export
  # HOMR_PATH="vendor/homr:vendor/homr-deps" for the vendored dev version —
  # see scripts/fetch_homr.py and scripts/run_homr.py --help).
  if [ "$SKIP_OMR" -eq 0 ]; then
    step "Running homr OMR detection (this is the long step)"
    "$PYTHON" scripts/run_homr.py "$image_dir" -o "data/$slug/results.json" --resume
  else
    step "Skipping OMR detection (--skip-omr)"
  fi

  # --- TEI wrappers (staff regions + embedded MusicXML) -----------------------
  # Builds public/<slug>/tei/pageNNN.tei.xml from data/<slug>/results.json +
  # pageNNN.musicxml and validates every file against the compiled TEI schema
  # plus the official MusicXML XSD (report only; see schema/VENDORING.md).
  if [ "$SKIP_TEI" -eq 0 ]; then
    step "Generating TEI wrappers"
    "$PYTHON" scripts/generate_tei.py -i "data/$slug/results.json" -o "public/$slug/tei" \
      --base-url "$base" --book-title "$title"
  else
    step "Skipping TEI generation (--skip-tei)"
  fi

  # --- IIIF pyramids + thumbnails ---------------------------------------------
  # One run builds public/<slug>/<page>/ pyramids and public/<slug>/thumbnails/.
  if [ "$SKIP_IMAGES" -eq 0 ]; then
    step "Building IIIF pyramids and thumbnails"
    "$PYTHON" scripts/generate_iiif.py "$image_dir" -o "public/$slug" \
      -t "public/$slug/thumbnails" --base-url "$base"
  else
    step "Skipping IIIF/thumbnails (--skip-images)"
  fi

  # --- IIIF manifest ------------------------------------------------------------
  # The viewer's per-book data source: page canvases (IIIF endpoints),
  # notation references (TEI + MusicXML renderings) and thumbnails — static
  # files only. The staff regions live only in the TEI; the manifest carries
  # no staff data.
  if [ "$SKIP_MANIFEST" -eq 0 ]; then
    step "Generating the IIIF manifest"
    "$PYTHON" scripts/generate_manifest.py -i "data/$slug/results.json" \
      -o "public/$slug/manifest.json" --base-url "$base" \
      --label "$title — score pages (kinderbücher)"
  else
    step "Skipping manifest generation (--skip-manifest)"
  fi
done <<< "$BOOKS"

# --- Book selector index --------------------------------------------------------
step "Generating the book selector index"
"$PYTHON" scripts/generate_books_index.py

step "Setup complete"
echo "Start the viewer with: npm run dev   (http://localhost:5199/)"
