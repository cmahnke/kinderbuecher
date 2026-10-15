#!/usr/bin/env python3
"""Generate public/books.json, the viewer's book selector index.

Reads the pipeline's book registry (books.json at the repository root: slug,
title, imageDir, baseUrl per book) and verifies that every book has a
generated manifest at public/<slug>/manifest.json. The index entries carry
root-relative manifest URLs so the viewer fetches them from wherever the
public/ tree is served.

Usage:   python3 scripts/generate_books_index.py [-b books.json] [-o public/books.json]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-b", "--books", default="books.json", help="book registry at repo root")
    parser.add_argument("-o", "--output", default="public/books.json")
    args = parser.parse_args()

    registry_path = os.path.join(ROOT, args.books)
    with open(registry_path, encoding="utf-8") as fh:
        books = json.load(fh)
    if not books:
        print(f"No books in {registry_path}", file=sys.stderr)
        sys.exit(1)

    index: list[dict] = []
    failures: list[str] = []
    for book in books:
        slug = book["slug"]
        manifest_fs = os.path.join(ROOT, os.path.dirname(args.output), slug, "manifest.json")
        if not os.path.exists(manifest_fs):
            failures.append(f"{slug}: no manifest at {manifest_fs} (run generate_manifest.py)")
            continue
        index.append(
            {
                "slug": slug,
                "title": book.get("title", slug),
                # root-relative so the index works wherever public/ is served
                "manifest": f"/{slug}/manifest.json",
            }
        )

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        sys.exit(1)

    out_path = os.path.join(ROOT, args.output)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2)
    print(f"Wrote {out_path} ({len(index)} books)")


if __name__ == "__main__":
    main()
