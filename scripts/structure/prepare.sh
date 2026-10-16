#!/usr/bin/env bash
# Prepares the vision-based structure extraction (see scripts/structure/):
#
# 1. Converts JXL scans to JPEG into a temporary working directory
# 2. Dumps the front matter resource order per book (`order.txt`) — this is
#    the canvas order used by manifests and PDF generation
# 3. Runs tesseract OCR per page (`ocr/`) as a text source for heading
#    candidates (Fraktur for older books, based on `issueYear`)
# 4. Generates labeled contact sheets (`sheets/sheet-NN.jpg`, 12 pages each)
#    for the visual pass (illustrations, title pages, tables of contents)
#
# Usage: scripts/structure/prepare.sh [workdir]
#   WORKDIR defaults to ${TMPDIR:-/tmp}/kinderbuecher-structure
set -e

WORK="${1:-${TMPDIR:-/tmp}/kinderbuecher-structure}"
CONTENT="content/post"
TILE="400x533"
TILING="4x3"
PER_SHEET=12

mkdir -p "$WORK"

for POST in "$CONTENT"/*/; do
  BOOK=$(basename "$POST")
  HAS_SCANS=$(find "$POST" -maxdepth 1 \( -name '*.jpg' -o -name '*.jxl' \) | wc -l | tr -d ' ')
  if [ "$HAS_SCANS" = "0" ]; then
    echo "Skipping $BOOK (no scans)"
    continue
  fi
  echo "== $BOOK"
  OUT="$WORK/$BOOK"
  mkdir -p "$OUT/ocr" "$OUT/sheets"

  # 1. JXL -> JPEG
  for JXL in "$POST"*.jxl; do
    [ -e "$JXL" ] || continue
    BASE=$(basename "$JXL" .jxl)
    if [ ! -e "$OUT/$BASE.jpg" ]; then
      vips jxlload "$JXL" "$OUT/$BASE.jpg"
    fi
  done

  # 2. Canvas order (front matter resource order)
  grep -o 'src: "[^"]*"' "$POST/index.md" | grep -E '\.(jpg|jxl)"$' | sed 's/src: "//; s/"$//' > "$OUT/order.txt"

  # 3. OCR (language by issue year, Fraktur era ends ~1945)
  OCR_LANG="deu"
  case "$BOOK" in
    *vieilles-chansons* | *quenottes*) OCR_LANG="fra" ;;
    *girls-pastimes*) OCR_LANG="eng" ;;
    *)
      YEAR=$(grep -o 'issueYear: [0-9]*' "$POST/index.md" | grep -o '[0-9]*' || echo "0")
      [ -n "$YEAR" ] && [ "$YEAR" -lt 1945 ] && OCR_LANG="script/Fraktur"
      ;;
  esac
  echo "   OCR ($OCR_LANG)"
  export BOOK OUT OCR_LANG
  find "$POST" -maxdepth 1 \( -name '*.jpg' -o -name '*.jxl' \) -print0 | sort -z | xargs -0 -P "$(getconf _NPROCESSORS_ONLN)" -n 1 bash -c '
    BASE=$(basename "$0"); BASE="${BASE%.*}"
    [ -e "$OUT/ocr/$BASE.txt" ] || tesseract "$0" "$OUT/ocr/$BASE" -l "$OCR_LANG" --psm 6 txt 2>/dev/null || true
  '

  # 4. Contact sheets (canvas order; JXL uses the converted JPEG)
  LIST=()
  while read -r SRC; do
    if [[ "$SRC" == *.jxl ]]; then
      LIST+=("$OUT/$(basename "${SRC%.jxl}").jpg")
    else
      LIST+=("$POST$SRC")
    fi
  done < "$OUT/order.txt"
  echo "   Contact sheets (${#LIST[@]} pages)"
  magick montage "${LIST[@]}" -label '%t' -tile "$TILING" -geometry "$TILE+6+6" "$OUT/sheets/sheet-%02d.jpg"

  echo "   $(ls "$OUT/sheets" | wc -l | tr -d ' ') sheets, $(ls "$OUT/ocr" | wc -l | tr -d ' ') OCR files"
done

echo "Prepared books in $WORK"
