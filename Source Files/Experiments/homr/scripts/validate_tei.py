#!/usr/bin/env python3
"""Validate the generated per-page TEI files (official schemas, no homemade checks).

Three namespace-aware layers, all using lxml (libxml2):

1. Relax NG validation against schema/homr-tei.rng — the compiled TEI ODD
   customization (TEI namespace required, surface/zone/path structure,
   required coordinates, embedded no-namespace MusicXML slot). Hard gate.
2. ISO Schematron: the homr-tei-* constraint patterns compiled into the RNG
   by TEIGarage are extracted and run as a standalone Schematron document
   (single surface per facsimile, >= 5 staff-line paths per zone, exactly one
   embedded score-partwise). Hard gate.
3. MusicXML validation: the embedded <score-partwise> element is validated
   against the official MusicXML 4.0 XSD (vendor/musicxml/schema/). Report
   only — homr's own output has a known validity bug (<rest/> combined with
   <chord/>, see NOTES.md), so this layer cannot gate the pipeline. Use
   --strict-musicxml to turn failures into errors anyway.

Usage:
    python3 scripts/validate_tei.py [paths ...]
        [--rng schema/homr-tei.rng]
        [--musicxml-xsd vendor/musicxml/schema/musicxml.xsd]
        [--strict-musicxml] [--skip-musicxml]

Paths may be TEI files or directories containing *.tei.xml files.
Exit codes: 0 = all valid, 1 = validation failures, 2 = usage/setup error.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.parse

from lxml import etree, isoschematron

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_RNG = os.path.join(ROOT, "schema", "homr-tei.rng")
DEFAULT_MUSICXML_XSD = os.path.join(ROOT, "vendor", "musicxml", "schema", "musicxml.xsd")
SCHEMATRON_NS = "http://purl.oclc.org/dsdl/schematron"
SVRL_NS = "http://purl.oclc.org/dsdl/svrl"
TEI_NS = "http://www.tei-c.org/ns/1.0"
# constraintSpec identifiers from schema/homr-tei.odd; TEIGarage compiles
# each into Schematron patterns with these ids (plus a running rule number)
CONSTRAINT_SPECS = ("facsimile-single-surface", "staff-zone-shape", "score-div-shape")


def iter_tei_files(paths: list[str]) -> list[str]:
    files: list[str] = []
    for path in paths:
        if os.path.isdir(path):
            files.extend(
                os.path.join(path, f)
                for f in sorted(os.listdir(path))
                if f.endswith(".tei.xml")
            )
        else:
            files.append(path)
    if not files:
        raise SystemExit("No *.tei.xml files found in the given paths")
    return files


def load_rng(path: str) -> etree.RelaxNG:
    return etree.RelaxNG(etree.parse(path))


def schematron_from_rng(rng_path: str) -> isoschematron.Schematron:
    """Extract the homr-tei-* constraint patterns from the compiled RNG and
    build a standalone ISO Schematron document from them."""
    rng = etree.parse(rng_path)
    patterns = [
        p
        for p in rng.findall(f".//{{{SCHEMATRON_NS}}}pattern")
        for ident in CONSTRAINT_SPECS
        if (p.get("id") or "").startswith(f"homr-tei-{ident}-")
    ]
    if not patterns:
        raise SystemExit(
            f"{rng_path}: no homr-tei constraint patterns found — "
            "recompile the schema (see schema/VENDORING.md)"
        )
    schema = etree.Element(f"{{{SCHEMATRON_NS}}}schema", nsmap={"sch": SCHEMATRON_NS})
    etree.SubElement(
        schema, f"{{{SCHEMATRON_NS}}}ns", prefix="tei", uri=TEI_NS
    )
    for pattern in patterns:
        schema.append(pattern)
    # rules carry the TEI prefix in their @context; the <ns> declaration
    # above makes them resolvable under XSLT 1 processors
    for rule in schema.iter(f"{{{SCHEMATRON_NS}}}rule"):
        rule.attrib.pop("xmlns", None)
    return isoschematron.Schematron(etree.ElementTree(schema))


def load_musicxml_xsd(path: str) -> etree.XMLSchema:
    """Compile the official MusicXML XSD, pointing its two xs:import
    schemaLocations (xml.xsd, xlink.xsd) at the local vendored copies."""
    doc = etree.parse(path)
    base = os.path.dirname(path)
    for imp in doc.iter(f"{{http://www.w3.org/2001/XMLSchema}}import"):
        loc = imp.get("schemaLocation")
        if loc and loc.startswith("http://"):
            # file:// URI: schemaLocation is resolved as a URI, which breaks
            # on paths containing spaces
            imp.set(
                "schemaLocation",
                "file://" + urllib.parse.quote(os.path.abspath(os.path.join(base, os.path.basename(loc)))),
            )
    return etree.XMLSchema(doc)


def extract_embedded_musicxml(doc: etree._ElementTree) -> bytes | None:
    for el in doc.iter("score-partwise"):
        return etree.tostring(el, xml_declaration=True, encoding="UTF-8")
    return None


def report(log: etree._ErrorLog) -> list[str]:
    lines = []
    for entry in log:
        message = entry.message
        # Schematron (SVRL) entries come back as serialized failed-assert
        # elements; unwrap them to the human-readable text
        if "svrl:failed-assert" in message or "svrl:successful-report" in message:
            try:
                svrl = etree.fromstring(message)
                text = svrl.findtext(f"{{{SVRL_NS}}}text") or message
                location = svrl.get("location", "")
                message = f"{text.strip()} (at {location})" if location else text.strip()
            except etree.XMLSyntaxError:
                pass
        lines.append(f"{entry.line}:{entry.column}: {message}")
    return lines


def validate_file(
    path: str,
    rng: etree.RelaxNG,
    schematron: isoschematron.Schematron,
    xsd: etree.XMLSchema | None,
    strict_musicxml: bool,
) -> tuple[list[str], list[str]]:
    """Validate one file; returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        doc = etree.parse(path)
    except etree.XMLSyntaxError as exc:
        return [f"{path}: not well-formed XML: {exc}"], warnings

    if not rng.validate(doc):
        errors.extend(f"{path}: Relax NG: {line}" for line in report(rng.error_log))
    if not schematron.validate(doc):
        errors.extend(
            f"{path}: Schematron: {line}" for line in report(schematron.error_log)
        )

    if xsd is not None:
        musicxml = extract_embedded_musicxml(doc)
        if musicxml is None:
            warnings.append(f"{path}: no embedded score-partwise (page without score?)")
        elif not xsd.validate(etree.fromstring(musicxml)):
            for line in report(xsd.error_log):
                if strict_musicxml:
                    errors.append(f"{path}: MusicXML XSD: {line}")
                else:
                    warnings.append(f"{path}: MusicXML XSD (report-only): {line}")
    return errors, warnings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", default=["public/tei"], help="TEI files or directories")
    parser.add_argument("--rng", default=DEFAULT_RNG)
    parser.add_argument("--musicxml-xsd", default=DEFAULT_MUSICXML_XSD)
    parser.add_argument("--strict-musicxml", action="store_true", help="fail on MusicXML XSD errors")
    parser.add_argument("--skip-musicxml", action="store_true", help="skip the MusicXML XSD layer")
    args = parser.parse_args()

    os.chdir(ROOT)
    files = iter_tei_files(args.paths)
    try:
        rng = load_rng(args.rng)
        schematron = schematron_from_rng(args.rng)
        xsd = None if args.skip_musicxml else load_musicxml_xsd(args.musicxml_xsd)
    except (etree.RelaxNGParseError, etree.XMLSchemaParseError, OSError) as exc:
        print(f"Schema setup failed: {exc}", file=sys.stderr)
        sys.exit(2)

    all_errors: list[str] = []
    all_warnings: list[str] = []
    for path in files:
        errors, warnings = validate_file(path, rng, schematron, xsd, args.strict_musicxml)
        all_errors.extend(errors)
        all_warnings.extend(warnings)

    for warning in all_warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    for error in all_errors:
        print(f"ERROR: {error}", file=sys.stderr)

    print(f"Validated {len(files)} file(s): {len(all_errors)} error(s), {len(all_warnings)} warning(s)")
    sys.exit(1 if all_errors else 0)


if __name__ == "__main__":
    main()
