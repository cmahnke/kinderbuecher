# Schema: homr-tei

Official TEI machinery for the per-page score TEI format:

- `homr-tei.odd` — the ODD customization (source of truth). A minimal
  `schemaSpec` (modules `tei`, `header`, `core`, `textstructure`, `transcr`,
  `linking`) with four changes:
  - a new no-namespace element `score-partwise` (member of `model.common`),
    opaque content, for the embedded MusicXML document
  - `surface` and `zone` content models tightened (`mode="change"`): fully
    required `@ulx/@uly/@lrx/@lry`, a required `<graphic>` child on
    `<surface>`, and `<path>`-only content for staff `<zone>`s
  - the homr `<application>` record tightened (`mode="change"`): required
    `@status` (`ok`/`error`) and optional `@confidence` — the machine-
    readable OMR run outcome for the page
  - four ISO Schematron `<constraintSpec>`s (XPath 1.0 compatible so they
    run under any processor): one `<surface>` per `<facsimile>`, at least
    five `<path>`s per staff `<zone>`, exactly one embedded
    `<score-partwise>` (and nothing else) in the score `<div>`, and
    `@confidence` ∈ [0,1]
- `homr-tei.rng` — the compiled Relax NG schema **derived artifact**,
  including the compiled Schematron patterns. Do not edit by hand.

## Compilation

Compiled with the TEI's official ODD processor, TEIGarage
(https://teigarage.tei-c.org/, the service behind ROMA at
https://roma.tei-c.org/):

```bash
curl -sS -X POST \
  -F "file=@schema/homr-tei.odd" \
  "https://teigarage.tei-c.org/ege-webservice/Conversions/ODD%3Atext%3Axml/ODDC%3Atext%3Axml/relaxng%3Aapplication%3Axml-relaxng/conversion?properties=%3Cconversions%3E%3Cconversion%20index%3D%220%22%3E%3Cproperty%20id%3D%22oxgarage.getImages%22%3Efalse%3C%2Fproperty%3E%3Cproperty%20id%3D%22oxgarage.getOnlineImages%22%3Efalse%3C%2Fproperty%3E%3Cproperty%20id%3D%22oxgarage.lang%22%3Een%3C%2Fproperty%3E%3Cproperty%20id%3D%22oxgarage.textOnly%22%3Etrue%3C%2Fproperty%3E%3Cproperty%20id%3D%22pl.psnc.dl.ege.tei.profileNames%22%3Edefault%3C%2Fproperty%3E%3C%2Fconversion%3E%3Cconversion%20index%3D%221%22%3E%3Cproperty%20id%3D%22oxgarage.getImages%22%3Efalse%3C%2Fproperty%3E%3Cproperty%20id%3D%22oxgarage.getOnlineImages%22%3Efalse%3C%2Fproperty%3E%3Cproperty%20id%3D%22oxgarage.lang%22%3Een%3C%2Fproperty%3E%3Cproperty%20id%3D%22oxgarage.textOnly%22%3Etrue%3C%2Fproperty%3E%3Cproperty%20id%3D%22pl.psnc.dl.ege.tei.profileNames%22%3Edefault%3C%2Fproperty%3E%3C%2Fconversion%3E%3C%2Fconversions%3E" \
  -o schema/homr-tei.rng
```

(The `properties` query value must be percent-encoded — the server rejects
raw `<`/`>` in the request target.)

(The same conversion is available interactively via ROMA: upload the ODD,
download the Relax NG schema.)

Recompile whenever `homr-tei.odd` changes, then run
`python3 scripts/validate_tei.py` over `public/tei/` to confirm the
generated files still conform.

## Runtime validation

`scripts/validate_tei.py` validates with lxml (libxml2, namespace-aware):

1. Relax NG against `homr-tei.rng` (hard gate)
2. the compiled `homr-tei-*` Schematron constraint patterns extracted from
   the RNG and run as ISO Schematron (hard gate)
3. the embedded MusicXML against the official MusicXML 4.0 XSD
   (`../vendor/musicxml/schema/musicxml.xsd`, report-only — see the note in
   that VENDORING.md)
