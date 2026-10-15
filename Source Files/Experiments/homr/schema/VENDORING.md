# Schema: homr-tei

Official TEI machinery for the per-page score TEI format:

- `homr-tei.odd` — the ODD customization (source of truth). A minimal
  `schemaSpec` (modules `tei`, `header`, `core`, `textstructure`, `transcr`,
  `linking`) with three changes:
  - a new no-namespace element `score-partwise` (member of `model.common`),
    opaque content, for the embedded MusicXML document
  - `surface` and `zone` content models tightened (`mode="change"`): fully
    required `@ulx/@uly/@lrx/@lry`, a required `<graphic>` child on
    `<surface>`, and `<path>`-only content for staff `<zone>`s
  - three ISO Schematron `<constraintSpec>`s (XPath 1.0 compatible so they
    run under any processor): one `<surface>` per `<facsimile>`, at least
    five `<path>`s per staff `<zone>`, and exactly one embedded
    `<score-partwise>` (and nothing else) in the score `<div>`
- `homr-tei.rng` — the compiled Relax NG schema **derived artifact**,
  including the compiled Schematron patterns. Do not edit by hand.

## Compilation

Compiled with the TEI's official ODD processor, TEIGarage
(https://teigarage.tei-c.org/, the service behind ROMA at
https://roma.tei-c.org/):

```bash
curl -sS -X POST \
  -F "file=@schema/homr-tei.odd" \
  "https://teigarage.tei-c.org/ege-webservice/Conversions/ODD%3Atext%3Axml/ODDC%3Atext%3Axml/relaxng%3Aapplication%3Axml-relaxng/conversion?properties=<conversions><conversion%20index=%220%22><property%20id=%22oxgarage.getImages%22>false</property><property%20id=%22oxgarage.getOnlineImages%22>false</property><property%20id=%22oxgarage.lang%22>en</property><property%20id=%22oxgarage.textOnly%22>true</property><property%20id=%22pl.psnc.dl.ege.tei.profileNames%22>default</property></conversion><conversion%20index=%221%22><property%20id=%22oxgarage.getImages%22>false</property><property%20id=%22oxgarage.getOnlineImages%22>false</property><property%20id=%22oxgarage.lang%22>en</property><property%20id=%22oxgarage.textOnly%22>true</property><property%20id=%22pl.psnc.dl.ege.tei.profileNames%22>default</property></conversion></conversions>" \
  -o schema/homr-tei.rng
```

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
