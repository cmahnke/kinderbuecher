#!/usr/bin/env python3
"""
Generate static IIIF Image API pyramids for the scanned page images using VIPS,
plus small overview thumbnails for the viewer grid.

Pyramid output layout (IIIF Image API 2.0, served statically):
    {outdir}/{name}/info.json
    {outdir}/{name}/{region}/{size}/{rotation}/{quality}.jpg

These are consumed directly by OpenSeadragon in the browser viewer.
Thumbnails (resized to ~300 px wide) are what the overview grid shows.

The info.json @id (the IIIF Image API id) is built from --base-url so the
pyramids are location-independent; the manifest generator rewrites it in
place when the base changes later.

Usage:
    python3 scripts/generate_iiif.py [image_dir] [-o public/iiif] [-t public/thumbnails]
        [--base-url https://.../]
    python3 scripts/generate_iiif.py . --thumbs-only
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import pyvips

DEFAULT_BASE_URL = "https://xn--kinderbcher-zhb.projektemacher.org/post/vieilles-chansons-et-rondes/"


def generate_one(path: str, outdir: str, base: str) -> str:
    img = pyvips.Image.new_from_file(path, access="sequential")
    name = os.path.splitext(os.path.basename(path))[0]
    target = os.path.join(outdir, name)
    os.makedirs(target, exist_ok=True)
    img.dzsave(target, layout="iiif", suffix=".jpg", tile_size=512, overlap=0)

    # vips writes a placeholder "@id"; point it at the absolute static URL
    # (the IIIF Image API id) so OpenSeadragon builds correct tile URLs.
    info_path = os.path.join(target, "info.json")
    with open(info_path, encoding="utf-8") as fh:
        info = json.load(fh)
    info["@id"] = base + f"iiif/{name}"
    with open(info_path, "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2)
    return name


def make_thumb(path: str, outdir: str) -> str:
    img = pyvips.Image.new_from_file(path, access="sequential")
    name = os.path.splitext(os.path.basename(path))[0]
    if img.width > 300:
        img = img.resize(300 / img.width)
    img.jpegsave(os.path.join(outdir, name + ".jpg"), Q=80)
    return name


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image_dir", nargs="?", default=".")
    parser.add_argument("-o", "--output", default="public/iiif")
    parser.add_argument("-t", "--thumbs-out", default="public/thumbnails")
    parser.add_argument(
        "--thumbs-only", action="store_true", help="only (re)generate the overview thumbnails"
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="base URL for the IIIF ids")
    args = parser.parse_args()
    base = args.base_url if args.base_url.endswith("/") else args.base_url + "/"

    exts = (".jpg", ".jpeg", ".png", ".tif", ".tiff")
    files = sorted(
        f for f in os.listdir(args.image_dir)
        if f.lower().endswith(exts) and "_teaser" not in f and "_debug" not in f
    )
    if not files:
        print(f"No images found in {args.image_dir}", file=sys.stderr)
        sys.exit(1)

    if args.thumbs_only:
        os.makedirs(args.thumbs_out, exist_ok=True)
        t0 = time.time()
        for name in files:
            path = os.path.join(args.image_dir, name)
            start = time.time()
            out_name = make_thumb(path, args.thumbs_out)
            print(f"[{out_name}] {round(time.time() - start, 1)}s", flush=True)
        print(f"\nWrote {len(files)} thumbnails to {args.thumbs_out} ({round(time.time() - t0)}s total)")
        return

    os.makedirs(args.output, exist_ok=True)
    t0 = time.time()
    for name in files:
        path = os.path.join(args.image_dir, name)
        start = time.time()
        out_name = generate_one(path, args.output)
        print(f"[{out_name}] {round(time.time() - start, 1)}s", flush=True)

    print(f"\nWrote {len(files)} pyramids to {args.output} ({round(time.time() - t0)}s total)")

    os.makedirs(args.thumbs_out, exist_ok=True)
    for name in files:
        make_thumb(os.path.join(args.image_dir, name), args.thumbs_out)
    print(f"Wrote {len(files)} thumbnails to {args.thumbs_out}")


if __name__ == "__main__":
    main()
