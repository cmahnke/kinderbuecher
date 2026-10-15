#!/usr/bin/env python3
"""Fetch the vendored development homr checkout from GitHub.

Clones https://github.com/liebharc/homr at the pinned commit into
vendor/homr, installs the one missing runtime dependency (pypdfium2) into
vendor/homr-deps without touching site-packages, and downloads the model
weights into the checkout. Everything lives under vendor/ (gitignored) —
nothing is installed globally. Re-run to update; pass --commit to try a
different upstream commit.

Usage:
    python3 scripts/fetch_homr.py [--commit <sha>] [--skip-weights]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "vendor")
HOMR_DIR = os.path.join(VENDOR, "homr")
HOMR_DEPS = os.path.join(VENDOR, "homr-deps")
HOMR_REPO = "https://github.com/liebharc/homr.git"

# Pinned upstream commit (see vendor/homr/VENDORING.md for why this one).
HOMR_COMMIT = "92f2344f1f1192227e930d3d3b4c17dd8aaf4e8f"


def run(cmd: list[str], **kwargs) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, **kwargs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", default=HOMR_COMMIT, help="upstream commit to check out")
    parser.add_argument("--skip-weights", action="store_true", help="skip the model weight download")
    args = parser.parse_args()

    if os.path.isdir(os.path.join(HOMR_DIR, ".git")):
        run(["git", "-C", HOMR_DIR, "fetch", "--quiet", "origin"])
    else:
        os.makedirs(VENDOR, exist_ok=True)
        run(["git", "clone", "--quiet", HOMR_REPO, HOMR_DIR])
    run(["git", "-C", HOMR_DIR, "checkout", "--quiet", args.commit])
    actual = subprocess.run(
        ["git", "-C", HOMR_DIR, "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    print(f"homr checkout at {actual}")

    # pypdfium2 is the only dev-homr runtime dependency missing from this
    # machine's site-packages; install it into vendor/homr-deps (local only)
    run([sys.executable, "-m", "pip", "install", "--quiet", "--target", HOMR_DEPS, "pypdfium2"])

    if not args.skip_weights:
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join(
            [HOMR_DIR, HOMR_DEPS, env.get("PYTHONPATH", "")]
        ).strip(os.pathsep)
        run(
            [sys.executable, "-c",
             "from homr.main import download_weights; download_weights(False, False, False)"],
            env=env,
        )

    print(f"\nUse it with: python3 scripts/run_homr.py . --homr-path vendor/homr:vendor/homr-deps")


if __name__ == "__main__":
    main()
