# mnx2musicxml

A TypeScript MNX → MusicXML converter (the reverse direction of the vendored
`vendor/mnxconverter-ts`, which only implements MusicXML → MNX). First-party
code, self-contained; it imports nothing from `src/` or `vendor/` at runtime.

## Usage

```ts
import { getMusicXmlFromMnx } from './mnx2musicxml/index'

const xml = getMusicXmlFromMnx(mnxJson)
```

`getMusicXmlFromMnx` accepts the MNX JSON document (as produced by the vendored
converter or the W3C Python converter) and returns a `score-partwise` 3.1
MusicXML string. Invalid input (unknown note-value bases, dangling tie/slur
targets, unsupported content) throws a descriptive `Error`.

## Supported MNX subset

- Parts (names, staves), measures, sequences (voices/staff), events
- Notes (pitch/alter/octave, chords), rests
- Note values with dots; tuplets (nested, with brackets); grace note groups
- Ties and slurs (target resolution by id)
- Event markings: accent, strong-accent, staccato, tenuto, staccatissimo,
  spiccato, soft-accent, stress, unstress, breath, single tremolo
- Keys, time signatures (incl. common/cut display), clefs (incl. mid-measure
  changes and per-staff clefs), ottavas, repeats, endings, barline styles,
  tempo marks, lyrics, fermatas

Not supported: multi-note tremolos, kits/percussion, transpositions,
system layouts, multimeasure rests, measure repeats (throws on the first
three; ignores the rest).

## Known simplifications

- **Staff/voice derivation for real-world MNX**: the upstream converters do
  not serialize the staff index on positioned clefs and sequences (the array
  order implies the staff; the vendored MusicXML reader even ignores the
  `<clef number>` attribute). This converter derives the staff from clef
  order (initial clefs only) and maps voices to staves by first appearance,
  capped at the part's staff count. What the MNX genuinely loses cannot be
  recovered: the rhythmic offset of voices starting mid-measure and the
  voice/staff attribution of grace groups.
- **Ottava direction convention**: the vendored converter maps MusicXML
  `<octave-shift size="8" type="down">` to MNX ottava value `1` (this matches
  the upstream W3C converter and its fixtures, but is inverted relative to the
  MusicXML spec). To round-trip through the vendored converter this module
  reproduces that convention: MNX value `1` → `type="down" size="8"`.
- **Accidental glyphs**: MNX records only _whether_ an accidental is shown,
  not which glyph, so `<accidental>` is derived from the pitch alter and the
  current key (naturals for altered key steps). Any glyph round-trips the same
  way, since the reader only records its presence.
- **`maxima`/`duplexMaxima`** note values carry no `<type>` element (MusicXML
  has no duplexMaxima symbol and the vendored reader does not know "maxima");
  their duration is derived from `<duration>`, which loses dots on round-trip.
  OSMD renders them from the duration (cosmetic only).
- **Empty part measures** (no sequences) emit an empty `<measure>`, which OSMD
  renders as a blank bar without an automatic whole rest.
- **Multiple voice-less sequences** in one measure (not producible by the
  vendored converter, which merges them) get fallback voice numbers so OSMD
  renders them as aligned voices; converting such a document and re-importing
  it with the vendored converter therefore materialises those voice ids.
- **Ignored MNX data** (transpositions, system layouts, multimeasure rests,
  measure repeats) is simply absent from the MusicXML output, so OSMD renders
  concert pitch without those elements.

## Layout

The module is self-contained (it imports nothing from `src/` or `vendor/` at
runtime):

```
mnx2musicxml/
├── index.ts     # public entry, re-exports from src/
├── src/         # converter.ts, mnx-types.ts, xml.ts
├── tests/       # mnx2musicxml.spec.ts (playwright project "mnx2musicxml")
│   └── fixtures/  # golden MNX/MusicXML pairs (shared with tests/mnx.spec.ts)
├── package.json # proxy scripts (test/lint/check delegate to the root tooling)
└── README.md
```

`npm test` inside the folder runs only this module's playwright project; it
delegates to the root tooling because the browser-side specs load the vendored
MusicXML → MNX converter and OSMD through the root vite dev server. The folder
declares no dependencies of its own.

## Round-trip testing

`tests/mnx2musicxml.spec.ts` converts every fixture in `tests/fixtures/`
through MNX → MusicXML → MNX and compares the MNX documents with all
generated ids stripped (event/note ids and tie/slur targets are assigned
freshly by the forward converter and cannot be preserved).
