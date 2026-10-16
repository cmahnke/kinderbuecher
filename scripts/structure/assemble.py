#!/usr/bin/env python
"""Assembles the structure shorthand drafts for the books from reports.tsv.

- Validates every reported page reference against the book's front matter
  resources (same matching chain as the theme's structures partial and pdf.py)
- Adds mechanical ranges (Umschlag/Vorsatz/Titelseite/Nachsatz/...) derived
  from resource names; skipped where an extracted entry already references
  the same page
- Emits one draft YAML per book into scripts/structure/drafts/ for review
- `--write` splices the reviewed structure into the book's index.md
  (replacing an existing `iiif.structure` block or creating one)

Usage:
  scripts/structure/assemble.py            # generate drafts
  scripts/structure/assemble.py --write    # splice drafts into index.md
"""
import argparse
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
REPORTS = pathlib.Path(__file__).resolve().parent / "reports.tsv"
DRAFTS = pathlib.Path(__file__).resolve().parent / "drafts"

FRONT_MECHANICAL = {"front": "Umschlag", "front-verso": "Vorsatz", "front-recto": "Vorsatz", "title": "Titelseite"}
END_MECHANICAL = {"end-verso": "Nachsatz", "end-recto": "Nachsatz", "end": "Rückendeckel", "back": "Rückendeckel"}
LANGS = {"quenottes-et-menottes": "fr", "vieilles-chansons-et-rondes": "fr", "girls-pastimes-in-japan": "en"}


class FlowDict(dict):
    pass


class Dumper(yaml.SafeDumper):
    pass


Dumper.add_representer(FlowDict, lambda d, x: d.represent_mapping("tag:yaml.org,2002:map", x, flow_style=True))


def read_front_matter(path: pathlib.Path):
    match = re.match(r"(?s)^---\n(.*?)\n---\n", path.read_text())
    if not match:
        raise ValueError(f"No front matter in {path}")
    return yaml.safe_load(match.group(1))


def src_basename(src: str) -> str:
    return pathlib.Path(src).stem


def resource_refs(resources: list) -> dict:
    """src basename / name / params.iiif dir -> resource entry (first match wins)."""
    refs = {}
    for res in resources:
        src = str(res.get("src", ""))
        keys = [src_basename(src)]
        params = res.get("params") or {}
        if params.get("iiif"):
            keys.append(pathlib.Path(str(params["iiif"]).rstrip("/")).parent.name)
        if res.get("name"):
            keys.append(str(res["name"]))
        for key in filter(None, keys):
            refs.setdefault(key, res)
    return refs


def mechanical_entry(base: str, label: str) -> dict:
    return {
        "label": FlowDict({"de": [label]}),
        "page": base,
        "_comment": f"{base}.jpg",
    }


def build_structure(book: str, reports: list, resources: list) -> tuple[list, list]:
    refs = resource_refs(resources)
    order = [str(res.get("src", "")) for res in resources]
    structure, problems = [], []

    extracted = []
    for row in reports:
        file, label = row["file"], row["label"].strip()
        base = src_basename(file)
        if base not in refs:
            problems.append(f"unknown page reference '{file}'")
            continue
        extracted.append({
            "label": FlowDict({LANGS.get(book, "de"): [label]}),
            "page": base,
            "_comment": f"{file}, gedruckt: {row['printed'] or '—'}",
        })

    extracted_pages = {entry["page"] for entry in extracted}
    front_block = [mechanical_entry(src_basename(src), FRONT_MECHANICAL[src_basename(src)])
                   for src in order if src_basename(src) in FRONT_MECHANICAL]
    end_block = [mechanical_entry(src_basename(src), END_MECHANICAL[src_basename(src)])
                 for src in order if src_basename(src) in END_MECHANICAL]
    structure = ([entry for entry in front_block if entry["page"] not in extracted_pages]
                 + extracted
                 + [entry for entry in end_block if entry["page"] not in extracted_pages])
    return structure, problems


def dump_entry(entry: dict) -> list[str]:
    lines = []
    label_line = yaml.dump({"label": entry["label"]}, Dumper=Dumper, default_flow_style=False,
                           allow_unicode=True, width=10**6, sort_keys=False).strip()
    lines.append(f"  - {label_line}")
    rest = {k: v for k, v in entry.items() if k not in ("label", "_comment")}
    rest_lines = yaml.dump(rest, Dumper=Dumper, default_flow_style=False,
                           allow_unicode=True, width=10**6, sort_keys=False).rstrip("\n").split("\n")
    lines.extend(f"    {line}" for line in rest_lines)
    lines.append(f"    # {entry['_comment']}")
    return lines


def emit_yaml(structure: list) -> str:
    lines = ["---", "structure:"]
    for entry in structure:
        lines.extend(dump_entry(entry))
    return "\n".join(lines)


def validate(book: str, structure: list, resources: list) -> list:
    """Schema + reference validation of a structure list against the resources."""
    refs = resource_refs(resources)
    problems = []

    def walk(entries):
        for entry in entries:
            if not isinstance(entry, dict):
                problems.append(f"entry is not an object: {entry!r}")
                continue
            if set(entry) - {"label", "page", "end", "items"}:
                problems.append(f"entry has unsupported keys: {entry!r}")
            label = entry.get("label")
            if not isinstance(label, dict) or not label:
                problems.append(f"entry without label object: {entry!r}")
            ref = entry.get("page")
            if ref and str(ref) not in refs:
                problems.append(f"unknown page reference '{ref}'")
            end = entry.get("end")
            if end and str(end) not in refs:
                problems.append(f"unknown end reference '{end}'")
            if not ref and not entry.get("items"):
                problems.append(f"entry needs 'page' or 'items': {entry!r}")
            walk(entry.get("items") or [])

    walk(structure)
    return problems


def splice(book: str, structure_yaml: str) -> None:
    """Inserts the structure shorthand into the book's `iiif:` front matter block."""
    path = ROOT / "content" / "post" / book / "index.md"
    lines = path.read_text().split("\n")
    try:
        iiif_idx = next(i for i, line in enumerate(lines) if line.rstrip() == "iiif:")
    except StopIteration:
        raise ValueError(f"{path}: no 'iiif:' front matter block")
    block_end = len(lines)
    for j in range(iiif_idx + 1, len(lines)):
        line = lines[j]
        if not line.strip():
            break
        if len(line) - len(line.lstrip(" ")) < 2:
            block_end = j
            break
    block = lines[iiif_idx + 1:block_end]
    kept = []
    for line in block:
        if line.strip() == "structure:":
            break
        kept.append(line)
    entry_lines = [f"  {line}" for line in structure_yaml.split("\n")
                   if line.strip() and line.strip() != "---" and not line.strip().startswith("#")]
    lines[iiif_idx + 1:block_end] = kept + entry_lines
    path.write_text("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="splice drafts into index.md")
    parser.add_argument("--reports", type=pathlib.Path, default=REPORTS)
    args = parser.parse_args()

    books: dict[str, list] = {}
    with open(args.reports) as handle:
        header = handle.readline().rstrip("\n").split("\t")
        for line in handle:
            line = line.rstrip("\n")
            if not line:
                continue
            row = dict(zip(header, line.split("\t")))
            books.setdefault(row["book"], []).append(row)

    DRAFTS.mkdir(exist_ok=True)
    failures = 0
    all_books = sorted(pathlib.Path.glob(ROOT / "content" / "post", "*"))
    all_books = [path.name for path in all_books if (path / "index.md").exists()]
    for book in all_books:
        reports = books.get(book, [])
        post = ROOT / "content" / "post" / book
        if not (post / "index.md").exists():
            print(f"[FAIL] {book}: no index.md")
            failures += 1
            continue
        front = read_front_matter(post / "index.md")
        resources = front.get("resources") or []
        if not resources:
            print(f"[FAIL] {book}: no resources")
            failures += 1
            continue
        structure, problems = build_structure(book, reports, resources)
        draft = emit_yaml(structure)
        draft_path = DRAFTS / f"{book}.yaml"
        if not draft_path.exists():
            draft_path.write_text(
                f"# Structure draft for content/post/{book}/index.md\n"
                f"# Generated by scripts/structure/assemble.py — review before encoding!\n"
                f"# Comments show the canvas file and the printed page number (— = unpaginated)\n"
                f"{draft}\n")
        status = "OK" if not problems else "FAIL"
        failures += bool(problems)
        print(f"[{status}] {book}: {len(structure)} entries, {len(reports)} extracted")
        for problem in problems:
            print(f"       {problem}")
        if args.write and not problems:
            try:
                splice(book, draft_path.read_text())
            except ValueError as error:
                print(f"[FAIL] {error}")
                failures += 1
                continue
            front = read_front_matter(post / "index.md")
            spliced = front["iiif"]["structure"]
            spliced_problems = validate(book, spliced, resources)
            if spliced_problems:
                failures += 1
                print(f"[FAIL] {book}: spliced front matter failed validation")
                for problem in spliced_problems:
                    print(f"       {problem}")
            else:
                print(f"       written to content/post/{book}/index.md ({len(spliced)} entries)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
