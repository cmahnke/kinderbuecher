#!/usr/bin/env python3
"""
Convert the generated MusicXML pages to the W3C MNX (Music Notation XML)
format using the vendored mnxconverter package (alpha).

The converter is alpha software with a limited importer scope, so individual
files may fail; failures are reported and do not stop the run. The output is
currently an unused artefact, kept for inspection / future use.

Usage:
    python3 scripts/generate_mnx.py [musicxml_dir] [-o output_dir]
"""

from __future__ import annotations

import argparse
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "vendor", "mnxconverter"))

from mnxconverter.mnx import put_score
from mnxconverter.musicxml import (
    NotationDataError,
    NotationImportError,
    get_score,
)


def convert_one(path: str, outdir: str) -> str:
    with open(path, "rb") as fh:
        data = fh.read()
    score = get_score(data)
    name = os.path.splitext(os.path.basename(path))[0]
    out_path = os.path.join(outdir, name + ".mnx")
    with open(out_path, "wb") as fh:
        fh.write(put_score(score))
    return name


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("musicxml_dir", nargs="?", default=".")
    parser.add_argument("-o", "--output", default=".")
    args = parser.parse_args()

    files = sorted(f for f in os.listdir(args.musicxml_dir) if f.endswith(".musicxml"))
    if not files:
        print(f"No MusicXML files found in {args.musicxml_dir}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)
    ok = 0
    failed: list[tuple[str, str]] = []
    t0 = time.time()
    for name in files:
        path = os.path.join(args.musicxml_dir, name)
        start = time.time()
        try:
            out_name = convert_one(path, args.output)
        except (NotationDataError, NotationImportError) as e:
            msg = e.args[0] if e.args else str(e)
            failed.append((name, str(msg)))
            print(f"[{name}] ERROR: {msg}", flush=True)
            continue
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            failed.append((name, msg))
            print(f"[{name}] ERROR: {msg}", flush=True)
            continue
        ok += 1
        print(f"[{out_name}] {round(time.time() - start, 1)}s", flush=True)

    print(
        f"\nWrote {ok} of {len(files)} MNX files to {args.output} "
        f"({round(time.time() - t0)}s total)"
    )
    if failed:
        print(f"Failed: {len(failed)}", file=sys.stderr)
        for name, reason in failed:
            print(f"  {name}: {reason}", file=sys.stderr)
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
