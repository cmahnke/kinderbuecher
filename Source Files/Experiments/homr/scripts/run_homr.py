#!/usr/bin/env python3
"""
Run homr on all scanned pages: detect score pages, extract the authoritative
staff bounding boxes, and produce MusicXML output for each score page.

homr is the single detector here — no OpenCV/classical CV is used. homr's
segnet detects the staffs and we convert their bounding boxes back to the
original image pixel coordinates for the viewer overlay.

Each page is processed in its own subprocess because homr leaks file
descriptors (cache/debug images); running many pages in one process would
eventually exhaust the open-file limit.

Usage:
    python3 scripts/run_homr.py [image_dir] [-o data/results.json]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

from PIL import Image


def homr_staff_bboxes(
    multi_staffs: list,
    orig_w: int,
    orig_h: int,
    resized_w: int,
    resized_h: int,
) -> list[dict]:
    """Convert homr staff bounding boxes (resized-image space) to original pixels."""
    sx = orig_w / resized_w
    sy = orig_h / resized_h
    staves: list[dict] = []
    for ms in multi_staffs:
        for staff in ms.staffs:
            x0 = max(0, min(round(staff.min_x * sx), orig_w))
            y0 = max(0, min(round(staff.min_y * sy), orig_h))
            x1 = max(0, min(round(staff.max_x * sx), orig_w))
            y1 = max(0, min(round(staff.max_y * sy), orig_h))
            if x1 > x0 and y1 > y0:
                grid = []
                for pt in staff.grid:
                    grid.append(
                        {
                            "x": round(pt.x * sx),
                            "y": [round(yv * sy) for yv in pt.y],
                        }
                    )
                staves.append(
                    {
                        "bbox": [x0, y0, x1, y1],
                        "lineCount": len(staff.grid[0].y) // 2 if staff.grid else 5,
                        "grid": grid,
                    }
                )
    return staves


def process_one_page(image_path: str, orig_w: int, orig_h: int, debug: bool) -> dict:
    """Run homr on one page; returns a results dict. Called in a subprocess."""
    from homr.main import (
        ProcessingConfig,
        XmlGeneratorArguments,
        detect_staffs_in_image,
        generate_xml,
        parse_staffs,
    )
    from homr.transformer.configs import Config

    config = ProcessingConfig(
        enable_debug=debug,
        enable_cache=True,
        write_staff_positions=False,
        read_staff_positions=False,
        selected_staff=-1,
        transformer_use_gpu=False,
        segnet_use_gpu=False,
        coreml_encoder=False,
    )
    xml_args = XmlGeneratorArguments()
    xml_path = os.path.splitext(image_path)[0] + ".musicxml"

    try:
        multi_staffs, image, debug_obj, title_future = detect_staffs_in_image(image_path, config)
    except Exception as exc:
        return {"hasScore": False, "staves": [], "status": "no-score", "error": str(exc)}

    resized_h, resized_w = image.shape[:2]
    staves = homr_staff_bboxes(multi_staffs, orig_w, orig_h, resized_w, resized_h)

    try:
        transformer_config = Config()
        transformer_config.use_gpu_inference = config.transformer_use_gpu
        transformer_config.use_coreml_encoder = config.coreml_encoder

        result_staffs = parse_staffs(
            debug_obj,
            multi_staffs,
            image,
            selected_staff=config.selected_staff,
            config=transformer_config,
        )
        title = title_future.result(60)
        xml = generate_xml(xml_args, result_staffs, title)
        xml.write(xml_path)
    except Exception as exc:
        return {"hasScore": True, "staves": staves, "status": "error", "error": str(exc)}
    finally:
        debug_obj.clean_debug_files_from_previous_runs()

    if not os.path.exists(xml_path):
        return {
            "hasScore": True,
            "staves": staves,
            "status": "error",
            "error": f"homr succeeded but {xml_path} not found",
        }

    return {"hasScore": True, "staves": staves, "status": "ok", "musicxml": xml_path}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image_dir", nargs="?", default=".")
    parser.add_argument("-o", "--output", default="data/results.json")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument(
        "--page", metavar="IMAGE",
        help="Process a single image and print its JSON result to stdout, then exit",
    )
    args = parser.parse_args()

    if args.page:
        with Image.open(args.page) as im:
            orig_w, orig_h = im.size
        result = process_one_page(args.page, orig_w, orig_h, args.debug)
        sys.stdout.write(json.dumps(result))
        return

    exts = (".jpg", ".jpeg", ".png", ".tif", ".tiff")
    files = sorted(
        f for f in os.listdir(args.image_dir)
        if f.lower().endswith(exts) and "_teaser" not in f and "_debug" not in f
    )
    if not files:
        print(f"No images found in {args.image_dir}", file=sys.stderr)
        sys.exit(1)

    script = os.path.abspath(__file__)
    results = []
    for name in files:
        path = os.path.join(args.image_dir, name)
        print(f"Running homr on {name}...", flush=True)
        try:
            cmd = [sys.executable, script, "--page", path]
            if args.debug:
                cmd.append("--debug")
            proc = subprocess.run(cmd, capture_output=True, text=True)
            payload = proc.stdout.strip()
            if not payload:
                raise RuntimeError(f"worker produced no output: {proc.stderr[-500:]}")
            homr_result = json.loads(payload.splitlines()[-1])
        except Exception as exc:
            homr_result = {"hasScore": False, "staves": [], "status": "error", "error": str(exc)}

        if homr_result["status"] == "ok":
            print(f"  OK ({len(homr_result['staves'])} staves) -> {homr_result['musicxml']}")
        elif homr_result["status"] == "no-score":
            print(f"  no score: {homr_result['error']}")
        else:
            print(f"  ERROR: {homr_result['error']}")

        with Image.open(path) as im:
            orig_w, orig_h = im.size

        results.append(
            {
                "image": name,
                "width": orig_w,
                "height": orig_h,
                "hasScore": homr_result["hasScore"],
                "confidence": 1.0 if homr_result["staves"] else 0.0,
                "staves": homr_result["staves"],
                "homr": {
                    "status": homr_result["status"],
                    "musicxml": homr_result.get("musicxml"),
                    "error": homr_result.get("error"),
                },
            }
        )

    score_pages = [r for r in results if r["hasScore"]]
    print(f"\n{len(score_pages)} of {len(results)} pages contain scores")

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump({"pages": results}, fh, indent=2)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
