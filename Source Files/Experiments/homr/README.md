# Score Page Detection and OMR Pipeline

Pipeline for detecting musical score pages in scanned children's book images,
running OMR (Optical Music Recognition) via [homr](https://github.com/liebharc/homr),
and viewing results in a browser-based viewer with playback and note highlighting.

homr is the **single detector** — no OpenCV/classical CV is used. homr's segnet
finds the staffs, and its staff grid points are converted back to original image
pixel coordinates for the viewer overlay.

The staff regions and the MusicXML travel together in per-page TEI documents
(`public/tei/*.tei.xml`), referenced from the IIIF manifest — see
`IMPLEMENTATION.md` for the exchange format and setup guide.

## Project Structure

```
├── setup.sh                    # one-shot setup: deps, icons, OMR, TEI, images, manifest
├── scripts/
│   ├── run_homr.py             # homr OMR processing wrapper (sole detector)
│   ├── generate_tei.py         # results.json + MusicXML -> per-page TEI wrappers
│   ├── validate_tei.py         # TEI validation (Relax NG + Schematron + MusicXML XSD)
│   ├── generate_iiif.py        # build IIIF image pyramids + thumbnails (VIPS/pyvips)
│   └── generate_manifest.py    # IIIF manifest for the viewer (public/manifest.json)
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
│   ├── main.ts                 # TypeScript viewer
│   ├── manifest.ts             # IIIF manifest loader (viewer data source)
│   ├── tei.ts                  # TEI parser -> staff regions + embedded MusicXML
│   ├── audio.ts                # Web Audio playback engine
│   ├── musicxml.ts             # MusicXML parser -> note timeline
│   ├── noteMap.ts              # note -> page-coordinate mapping (homr grid)
│   ├── osmdRenderer.ts         # OpenSheetMusicDisplay score renderer
│   ├── osdViewer.ts            # OpenSeadragon wrapper (IIIF + pixel overlays)
│   ├── playerPanel.ts          # player UI + scan highlight wiring
│   └── style.css               # Viewer styles
├── data/
│   └── results.json            # homr detection + staff grid results (pipeline source)
├── public/
│   ├── manifest.json           # IIIF manifest: page canvases, image endpoints
│   │                           #   and notation refs (generated)
│   ├── tei/                    # per-page TEI wrappers referenced by the manifest
│   └── musicxml/               # plain MusicXML copies referenced by the manifest
├── public/
│   ├── favicon.svg
│   ├── <name>/                 # IIIF pyramid per page, directly under public/ (generated)
│   ├── thumbnails/             # small overview-grid thumbnails (generated)
│   └── openseadragon/          # OpenSeadragon button images
├── vendor/
│   ├── mnxconverter/           # vendored W3C MNX converter (alpha, pinned commit)
│   └── mnxconverter-ts/        # vendored TS MusicXML -> MNX converter (pinned commit)
├── dist/                       # Built viewer (generated, not committed)
├── index.html                  # Viewer entry
└── *.jpg                       # Scanned page images (~12 MP, gitignored large files)
```

## Usage

### 0. Install

Everything below (plus the OpenSeadragon button icons and the homr model
weights) is done by the setup script — including the OMR run, MNX conversion
and image generation:

```bash
./setup.sh                     # full pipeline (incl. IIIF manifest)
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
python3 scripts/run_homr.py . -o data/results.json
```

Runs homr on every page. homr is authoritative: pages with no detected staffs
are marked `hasScore:false`; score pages get `hasScore:true`, per-staff page
bounding boxes plus the 5-line staff grid (`staves[].grid`), and the generated
`./pageNNN.musicxml`. The run also normalizes the MusicXML root to carry
`xmlns=""`, so the files embed cleanly under the TEI namespace later.
Output is written to `data/results.json`.

### 2. Build IIIF image pyramids

```bash
pip install pyvips          # plus the VIPS system library
python3 scripts/generate_iiif.py . -o public/iiif
```

Creates a DZI/IIIF pyramid (`info.json` + tile folders) for every page under
`public/<name>/` (directly at the public root — the URLs carry no `iiif/`
segment). The pyramids are what OpenSeadragon streams, so the
viewer stays smooth at any zoom without loading the ~12 MP originals. It also
writes a ~300 px wide thumbnail per page to `public/thumbnails/<name>.jpg` —
that is what the overview grid shows (use `--thumbs-only` to regenerate just
those).

`setup.sh` also copies the OpenSeadragon button images from
`node_modules/openseadragon/build/openseadragon/images` to
`public/openseadragon/images` (the npm package only ships them under `build/`,
and that target is gitignored); `favicon.svg` and `icons.svg` in `public/` are
source assets and need no generation step.

### 3. Generate TEI wrappers (staff regions + MusicXML)

```bash
python3 scripts/generate_tei.py .
python3 scripts/validate_tei.py        # same validation, standalone
```

Wraps each generated `pageNNN.musicxml` in a per-page TEI document
(`public/tei/pageNNN.tei.xml`), adding the detected staff regions from
`data/results.json`: one `<surface>` per page (the scan, in original image
pixels, referencing the IIIF canvas), one `<zone type="staff">` per staff
(the bbox), and each staff line as a `<path points="x,y …">` polyline
(homr's staff grid). See `IMPLEMENTATION.md` for the format.

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

The viewer fetches `/manifest.json` (generated by `scripts/generate_manifest.py`)
and all data via absolute paths from domain root — there is no IIIF server, the
level-0 pyramids are static files. Vite `base:'/'` is configured accordingly.
Detail views render the page in **OpenSeadragon** from its IIIF pyramid
(`<name>/info.json`); the staff bounding boxes and the rendered score are
drawn as viewport overlays that track pan/zoom.

### IIIF manifest

`public/manifest.json` (Presentation 3 style) is the viewer's single data
source. All IIIF URIs are **absolute**, built from a configurable base URL
(default `https://static.projektemacher.org/kinderbuecher/post/vieilles-chansons-et-rondes/`,
settable with `--base-url` on `generate_manifest.py` and `generate_iiif.py` —
the pyramid `info.json` `@id`s are kept in sync automatically). The viewer
resolves referenced URLs to their pathname, so the same manifest works when
served locally and from the deployment host. The manifest is modeled
natively, and it carries **no staff data at all**:

- one **canvas per page** painted by its IIIF image service
  (`<name>/info.json` — the pyramids sit directly under the base URL, there
  is no `iiif/` URL segment)
- the smallest full pyramid rendition (`<name>/full/<w,/0/default.jpg`)
  as the canvas **thumbnail** — the overview grid shows it, scaled by the
  client (no pre-generated `/thumbnails/*.jpg` needed by the viewer anymore)
- the notation files as **Alternative Representations** (canvas `rendering`):
  the TEI wrapper (`/tei/<name>.tei.xml`) and the plain MusicXML
  (`/musicxml/<name>.musicxml`), so `public/` alone is deployable
- OMR confidence/status/error as native canvas **metadata**
- `behavior: ["paged"]` marks the sequential book pages

The staff regions live only in the TEI files: each `<zone type="staff">` is
the region of one detected staff on its page canvas (pointed at via the
`<surface>`'s `corresp`), each `<path>` is a staff line, and the MusicXML
the zones belong to is embedded in the same TEI. The viewer fetches the TEI
(per page, when a detail view opens) and derives the overlay rects, the
note-position mapping, and the playable score from it. See
`IMPLEMENTATION.md` for the exchange format and how to consume the TEI
outside this viewer.

### 5. Play & Highlight

Select a score page and use the player panel:

- **Play / Pause / Stop / Tempo** — plays the page's MusicXML via Web Audio.
  Multi-staff pages (e.g. a grand staff) offer a **Track** selector: only the
  selected staff is played, so the staves don't sound as stacked tracks.
- **Rendered score** — the page's MusicXML is rendered with OpenSheetMusicDisplay;
  the current note is highlighted on the score during playback.
- **Scan highlights** — the current staff system is highlighted on the scan, and
  a marker tracks the exact note being played (positions reconstructed from
  homr's staff grid + the MusicXML pitch/timing; approximate).

## Playback / highlighting details

- `src/musicxml.ts` parses each `score-partwise` MusicXML into a note timeline,
  tracking `<print new-system>` to assign notes to physical staff systems.
- `src/noteMap.ts` maps a played note to page coordinates using homr's staff
  grid: X by the note's time position across the system, Y by pitch mapped onto
  the staff lines (clef-aware). The marker radius is scaled to the detected
  staff line spacing so it matches note-head size on the scan. Staffs are
  near-straight in these scans, so the nonlinear dewarp is ignored; the marker
  may be off by a few px.
- `src/audio.ts` synthesizes tones with the Web Audio API, so no soundfont
  files are required.
- `src/osdViewer.ts` wraps OpenSeadragon. Overlays are added in original image
  pixel coordinates, converted to viewport space only **after** the tile source
  opens (converting earlier would use the 1×1 placeholder bounds and place the
  overlay off-screen).

On the test set ("Vieilles Chansons et Danses et Rondes", Boutet de Monvel):

- homr detects 36 of 50 pages as score pages (`hasScore:true`).

## Testing

```bash
npm test                        # both playwright projects against one dev server
cd mnx2musicxml && npm test     # only the converter module's project
```

Playwright runs two projects (see `playwright.config.ts`): `core` — viewer,
pipeline and converter round-trip tests in `tests/` — and `mnx2musicxml` — the
self-contained converter module's specs in `mnx2musicxml/tests/` (with its
golden fixtures). Both projects share the root vite dev server, which also
serves `vendor/` and OSMD to the browser-side tests. The module's own
`package.json` holds proxy scripts (`test`/`lint`/`check` delegate to the root
tooling), so the folder can be worked on standalone; it declares no
dependencies of its own.
