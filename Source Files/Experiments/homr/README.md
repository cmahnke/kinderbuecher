# Score Page Detection and OMR Pipeline

Pipeline for detecting musical score pages in scanned children's book images,
running OMR (Optical Music Recognition) via [homr](https://github.com/liebharc/homr),
and viewing results in a browser-based viewer with playback and note highlighting.

homr is the **single detector** — no OpenCV/classical CV is used. homr's segnet
finds the staffs, and its staff grid points are converted back to original image
pixel coordinates for the viewer overlay.

The staff regions and the MusicXML travel together in per-page TEI documents
(`public/<slug>/tei/*.tei.xml`), referenced from the book's IIIF manifest —
see `IMPLEMENTATION.md` for the exchange format and setup guide.

## Project Structure

```
├── setup.sh                    # one-shot setup per book in books.json: deps, icons,
│                               #   OMR, TEI, images, manifest
├── scripts/
│   ├── run_homr.py             # homr OMR processing wrapper (sole detector)
│   ├── generate_tei.py         # results.json + MusicXML -> per-page TEI wrappers
│   ├── validate_tei.py         # TEI validation (Relax NG + Schematron + MusicXML XSD)
│   ├── generate_iiif.py        # build IIIF image pyramids + thumbnails (VIPS/pyvips)
│   ├── generate_manifest.py    # per-book IIIF manifest (public/<slug>/manifest.json)
│   └── generate_books_index.py # books.json -> public/books.json (viewer book index)
├── schema/
│   ├── homr-tei.odd            # ODD customization: TEI + embedded MusicXML
│   ├── homr-tei.rng            # Relax NG compiled by the TEI's ROMA/TEIGarage
│   └── VENDORING.md            # how the schema was produced
├── mnx2musicxml/               # MNX -> MusicXML converter (self-contained module)
│   ├── index.ts                # public entry (re-exports src/)
│   ├── src/                    # converter, types, XML writer
│   ├── tests/                  # specs + fixtures/ (golden MNX/MusicXML pairs)
│   ├── package.json            # proxy scripts to the root tooling
│   └── README.md
├── src/
│   ├── main.ts                 # TypeScript viewer: grid, book selector, TIFY detail view
│   ├── manifest.ts             # IIIF manifest loader (grid data source)
│   ├── config.ts               # plugin option defaults (overlays, regions)
│   └── style.css               # Viewer styles
│                               # The whole score stack (TEI parsing, OSMD
│                               # rendering, playback, regions panel) lives in
│                               # @projektemacher/tify-plugin-musicxml
│                               # (installed from npm, @0.2.0);
│                               # the detail view embeds TIFY + the plugin.
├── data/
│   └── <slug>/results.json     # homr detection + staff grid results, per book
│                               #   (pipeline source)
├── public/
│   ├── favicon.svg
│   ├── books.json              # generated book selector index for the viewer
│   ├── <slug>/                 # generated per book:
│   │   ├── manifest.json       #   IIIF manifest: page canvases, image endpoints
│   │   │                       #     and notation refs
│   │   ├── <page>/             #   IIIF pyramid per page
│   │   ├── tei/                #   per-page TEI wrappers referenced by the manifest
│   │   ├── musicxml/           #   plain MusicXML copies referenced by the manifest
│   │   └── thumbnails/         #   small overview-grid thumbnails
│   └── openseadragon/          # OpenSeadragon button images
├── vendor/
│   ├── mnxconverter/           # vendored W3C MNX converter (alpha, pinned commit)
│   └── mnxconverter-ts/        # vendored TS MusicXML -> MNX converter (pinned commit)
├── dist/                       # Built viewer (generated, not committed)
├── index.html                  # Viewer entry
├── books.json                  # Book registry: slug, title, imageDir, baseUrl per book
└── books/
    └── <slug>/                 # Scanned page images (~12 MP, gitignored large files)
                                #   + homr's pageNNN.musicxml side outputs
```

## Usage

### 0. Install

Everything below (plus the OpenSeadragon button icons and the homr model
weights) is done by the setup script — including the OMR run, MNX conversion
and image generation:

```bash
./setup.sh                     # full pipeline for every book in books.json
./setup.sh --book <slug>       # limit the run to a single book
./setup.sh --deps-only         # just dependencies + icons
./setup.sh --skip-omr          # re-run images/MNX/manifest without the slow OMR step
```

Manually, the individual steps are:

```bash
npm install
pip install homr pillow pyvips lxml
python3 -c "from homr.main import download_weights; download_weights(False, False, False)"
```

### 1. Run homr OMR

```bash
python3 scripts/run_homr.py books/deutsche-wiegenlieder \
  -o data/deutsche-wiegenlieder/results.json --resume
```

Runs homr on every page of the book's `imageDir`. homr is authoritative:
pages with no detected staffs are marked `hasScore:false`; score pages get
`hasScore:true`, per-staff page bounding boxes plus the 5-line staff grid
(`staves[].grid`), and the generated `pageNNN.musicxml` next to the scans.
The run also normalizes the MusicXML root to carry `xmlns=""`, so the files
embed cleanly under the TEI namespace later. Output is written to
`data/<slug>/results.json`. With `--resume` the progress is saved to the
output JSON after every page, and already-processed pages (status
`ok`/`no-score`) are skipped on a re-run.

Which homr runs is configurable: by default the installed package is used.
`--homr-path` (or `HOMR_PATH`, same `os.pathsep`-separated syntax) points at
a local checkout that shadows it — e.g. the vendored development checkout:

```bash
python3 scripts/run_homr.py books/deutsche-wiegenlieder \
  -o data/deutsche-wiegenlieder/results.json --resume \
  --homr-path vendor/homr:vendor/homr-deps
```

See `vendor/homr/VENDORING.md` (pinned dev commit, its weights, and why
`vendor/homr-deps` exists); `python3 scripts/fetch_homr.py` (re)creates the
checkout from GitHub — nothing under `vendor/` is committed. The script adapts to both the released (0.7.0)
and the development homr API, so either source works.

### 2. Build IIIF image pyramids

```bash
pip install pyvips          # plus the VIPS system library
python3 scripts/generate_iiif.py books/deutsche-wiegenlieder \
  -o public/deutsche-wiegenlieder -t public/deutsche-wiegenlieder/thumbnails \
  --base-url https://static.projektemacher.org/kinderbuecher/post/deutsche-wiegenlieder/
```

Creates a DZI/IIIF pyramid (`info.json` + tile folders) for every page under
`public/<slug>/<page>/` (the URLs carry no `iiif/`
segment). The pyramids are what OpenSeadragon streams, so the
viewer stays smooth at any zoom without loading the ~12 MP originals. It also
writes a ~300 px wide thumbnail per page to
`public/<slug>/thumbnails/<name>.jpg` —
that is what the overview grid shows (use `--thumbs-only` to regenerate just
those).

`setup.sh` also copies the OpenSeadragon button images from
`node_modules/openseadragon/build/openseadragon/images` to
`public/openseadragon/images` (the npm package only ships them under `build/`,
and that target is gitignored); `favicon.svg` and `icons.svg` in `public/` are
source assets and need no generation step.

### 3. Generate TEI wrappers (staff regions + MusicXML)

```bash
python3 scripts/generate_tei.py -i data/deutsche-wiegenlieder/results.json \
  -o public/deutsche-wiegenlieder/tei \
  --base-url https://static.projektemacher.org/kinderbuecher/post/deutsche-wiegenlieder/ \
  --book-title "Deutsche Wiegenlieder"
python3 scripts/validate_tei.py        # same validation, standalone
```

Wraps each generated `pageNNN.musicxml` in a per-page TEI document
(`public/<slug>/tei/pageNNN.tei.xml`), adding the detected staff regions from
`data/<slug>/results.json`: one `<surface>` per page (the scan, in original image
pixels, referencing the IIIF canvas), one `<zone type="staff">` per staff
(the bbox), and each staff line as a `<path points="x,y …">` polyline
(homr's staff grid). `--book-title` supplies the book title for the TEI
headers (default: the Vieilles Chansons title). See `IMPLEMENTATION.md` for
the format.

Every generated file is validated before it is kept: Relax NG + ISO
Schematron from the compiled ODD customization (`schema/homr-tei.odd` →
`schema/homr-tei.rng`, built with the TEI's ROMA/TEIGarage — see
`schema/VENDORING.md`), plus the embedded MusicXML against the official
MusicXML 4.0 XSD (`vendor/musicxml/`, report-only — homr's own output has a
known validity bug, see `NOTES.md`). Any Relax NG/Schematron failure fails
the run, so only schema-valid TEI reaches `public/`.

(MNX is no longer generated: the staff regions moved into the TEI and the
viewer doesn't consume MNX. The TypeScript MNX tooling — the
`mnx2musicxml/` module, its specs, and the vendored `mnxconverter-ts` — is
untouched and still tested; it exists for a future MNX → MusicXML step.)

### 4. View Results

```bash
# Dev (recommended)
npm run dev
# → http://localhost:5199/

# Build + preview
npm run build
npm run preview
# → http://localhost:5199/
```

The header has a book selector (dropdown) fed by `/books.json` (generated by
`scripts/generate_books_index.py`); switching books disposes the current
detail/player view and rebuilds the overview grid from that book's manifest
(`/<slug>/manifest.json`, generated by `scripts/generate_manifest.py`). The
selected book is remembered in `localStorage`; if `/books.json` is missing,
the viewer falls back to the single root manifest `/manifest.json`. All data
loads via absolute paths from domain root — there is no IIIF server, the
level-0 pyramids are static files. Vite `base:'/'` is configured accordingly.
Detail views render the page in **OpenSeadragon** from its IIIF pyramid
(`<slug>/<page>/info.json`); the staff bounding boxes and the rendered score are
drawn as viewport overlays that track pan/zoom.

### IIIF manifest

Each book's `public/<slug>/manifest.json` (Presentation 3 style) is the
viewer's data source for that book; `public/books.json` — generated by
`scripts/generate_books_index.py` from `books.json` — is the index the book
selector reads (per entry: slug, title, root-relative
`/<slug>/manifest.json`). All IIIF URIs are **absolute**, built from a
per-book base URL (default
`https://static.projektemacher.org/kinderbuecher/post/vieilles-chansons-et-rondes/`,
settable with `--base-url` on `generate_manifest.py` and `generate_iiif.py` —
the pyramid `info.json` `@id`s are kept in sync automatically; `--label`
sets the manifest label). The viewer resolves referenced URLs relative to
the directory the manifest was fetched from (the per-book folder), so the
same manifest works when served locally and from the deployment host. The
manifest is modeled natively, and it carries **no staff data at all**:

- one **canvas per page** painted by its IIIF image service
  (`<page>/info.json` — the pyramids sit directly under the base URL, there
  is no `iiif/` URL segment)
- the smallest full pyramid rendition (`<page>/full/<w,/0/default.jpg`)
  as the canvas **thumbnail** — the overview grid shows it, scaled by the
  client (no pre-generated `/thumbnails/*.jpg` needed by the viewer anymore)
- the notation files as **Alternative Representations** (canvas `rendering`):
  the TEI wrapper (`<slug>/tei/<name>.tei.xml`) and the plain MusicXML
  (`<slug>/musicxml/<name>.musicxml`), so `public/` alone is deployable
- no metadata of its own: the OMR run information (status, confidence) lives
  in the TEI files' `<application>` header element, next to the staff
  geometry it describes
- `behavior: ["paged"]` marks the sequential book pages — the default; the
  viewer opens the detail view as a double-page spread like an opened book
  (`generate_manifest.py --single` instead generates
  `behavior: ["individuals"]`, the single-page presentation)

The staff regions live only in the TEI files: each `<zone type="staff">` is
the region of one detected staff on its page canvas (pointed at via the
`<surface>`'s `corresp`), each `<path>` is a staff line, and the MusicXML
the zones belong to is embedded in the same TEI. The viewer fetches the TEI
(per page, when a detail view opens) and derives the overlay rects, the
note-position mapping, and the playable score from it. See
`IMPLEMENTATION.md` for the exchange format and how to consume the TEI
outside this viewer.

### Adding a book

1. Register the book in `books.json` at the repository root — a JSON array
   with one entry per book: `slug`, `title`, `imageDir` and `baseUrl` (the
   deployment base URL for the IIIF URIs).
2. Copy the scanned pages into `books/<slug>/` (gitignored).
3. Run `./setup.sh` (all books, or `--book <slug>` for just the new one) —
   it runs OMR → TEI → IIIF → manifest per book into the per-book paths and
   refreshes `public/books.json` — or the individual steps 1–4 above with
   the new book's paths, then `python3 scripts/generate_books_index.py` so
   the viewer's book selector lists it.

### 5. Play & Highlight

Select a score page and use the player panel:

- **Pages** — with TIFY's double-page mode on, the panel gains a **Page**
  dropdown listing the two shown pages; tapping or clicking one of the shown
  pages plays it (deliberately without any visual indicator). The score,
  staff regions and highlights follow the selected page.
- **Play / Pause / Stop / Tempo** — plays the page's MusicXML via Web Audio.
  Every detected staff gets its own track row, all on by default (the page
  sounds as written): each staff can be muted individually and gets its own
  **instrument** selector.
- **Rendered score** — the page's MusicXML is rendered with OpenSheetMusicDisplay;
  the current note is highlighted on the score during playback. The rendered
  overlay is hidden behind a **Score** toggle (off by default); each rendered
  system is mapped exactly onto its staff region, so the notation fills the
  detected staves.
- **Scan highlights** — the current staff system is highlighted on the scan, and
  a marker tracks the exact note being played (positions reconstructed from
  homr's staff grid + the MusicXML pitch/timing; approximate). Every playing
  staff gets its own highlight set, so the position is shown on all playing
  staves.
- **Regions** — the orange staff-region rects (from `SHOW_STAFF_OVERLAY`, off
  by default) can be toggled in the panel and styled with one **rgba
  selector** (color picker + alpha slider; fill and border share the alpha).

## Playback / highlighting details

- The score stack is the `@projektemacher/tify-plugin-musicxml` TIFY plugin
  (installed from npm, ≥ 0.3.0 for the double-page page selector; during
  development a linked tify-plugins checkout is aliased in
  `vite.config.ts`). Its `src/musicxml-timeline.ts` parses each `score-partwise`
  MusicXML into a note timeline, tracking `<print new-system>` to assign
  notes to physical staff systems; `src/note-map.ts` maps a played note to
  page coordinates using homr's staff
  grid: X by the note's time position across the system, Y by pitch mapped onto
  the staff lines (clef-aware). The marker radius is scaled to the detected
  staff line spacing so it matches note-head size on the scan. Staffs are
  near-straight in these scans, so the nonlinear dewarp is ignored; the marker
  may be off by a few px.
- the plugin's `src/audio.ts` synthesizes tones with the Web Audio API, so no
  soundfont files are required.
- TIFY embeds OpenSeadragon. The plugin's overlays are added in original image
  pixel coordinates, converted to viewport space only **after** the tile source
  opens (converting earlier would use the 1×1 placeholder bounds and place the
  overlay off-screen).

On the test set ("Vieilles Chansons et Danses et Rondes", Boutet de Monvel):

- homr detects 37 of 50 pages as score pages (`hasScore:true`).

For "Deutsche Wiegenlieder": 70 of 104 pages contain scores.

## OMR source and recognition statistics

The pipeline runs a development homr (GitHub `main` past the 0.7.0 release,
pinned commit — see `vendor/homr/VENDORING.md`, selectable via
`--homr-path`/`HOMR_PATH`, reproducible with `scripts/fetch_homr.py`)
because the unreleased upstream commits fix exactly this project's pain
points (staff-detection robustness, clefs/barlines split out of chords,
grace-note handling). Measured against the 0.7.0 output on the same 50
pages:

- score pages: **36 → 37** (`page009` recovered; the remaining 13
  scoreless pages were verified to contain no notation — covers, lyrics
  and illustration pages)
- invalid `<chord/>`+`<rest/>` notes: **3 pages → 0** (`page019`,
  `page023`, `page030` fixed upstream — the `NOTES.md` workaround stays as
  a safety net)
- staff splits: `page028` gained a proper 1/2 split (dual mode now
  available there); recognized notes total **3891 → 3929**
- known regression: `page015` lost its 1/2 split (all notes on staff 1, no
  dual mode there) — watch for upstream fixes
- caveat: the dev MusicXML writer emits some elements out of XSD order
  (`<key>`, `<voice>` placement — e.g. `page006` raises 139 report-only XSD
  notes where 0.7.0 raised none). Order-insensitive consumers (OSMD,
  DOMParser, the playback parser) are unaffected; the XSD layer stays
  report-only.

## Testing

```bash
npm test                        # everything except the unused MNX path
npm run test:mnx                 # only the MNX converter specs (tagged @mnx)
cd mnx2musicxml && npm test     # only the converter module's project
```

Playwright runs two projects (see `playwright.config.ts`): `core` — viewer,
pipeline and converter round-trip tests in `tests/` — and `mnx2musicxml` — the
self-contained converter module's specs in `mnx2musicxml/tests/` (with its
golden fixtures). Both projects share the root vite dev server, which also
serves `vendor/` and OSMD to the browser-side tests. The viewer specs use the
per-book paths and include a book-selector round-trip test. The module's own
`package.json` holds proxy scripts (`test`/`lint`/`check` delegate to the root
tooling), so the folder can be worked on standalone; it declares no
dependencies of its own.
