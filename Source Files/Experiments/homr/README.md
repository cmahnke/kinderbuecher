# Score Page Detection and OMR Pipeline

Pipeline for detecting musical score pages in scanned children's book images,
running OMR (Optical Music Recognition) via [homr](https://github.com/liebharc/homr),
and viewing results in a browser-based viewer with playback and note highlighting.

homr is the **single detector** — no OpenCV/classical CV is used. homr's segnet
finds the staffs, and its staff grid points are converted back to original image
pixel coordinates for the viewer overlay.

## Project Structure

```
├── setup.sh                    # one-shot setup: deps, icons, OMR, MNX, images, manifest
├── scripts/
│   ├── run_homr.py             # homr OMR processing wrapper (sole detector)
│   ├── generate_iiif.py        # build IIIF image pyramids + thumbnails (VIPS/pyvips)
│   ├── generate_mnx.py         # MusicXML -> W3C MNX (vendored mnxconverter)
│   └── generate_manifest.py    # IIIF manifest for the viewer (public/manifest.json)
├── src/
│   ├── main.ts                 # TypeScript viewer
│   ├── manifest.ts             # IIIF manifest loader (viewer data source)
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
│   ├── manifest.json           # IIIF manifest: page canvases, staff canvases,
│   │                           #   image endpoints, notation refs (generated)
│   ├── musicxml/               # notation copies referenced by the manifest
│   └── mnx/                    # MNX copies referenced by the manifest
├── public/
│   ├── favicon.svg
│   ├── iiif/                   # IIIF pyramids, one dir per page (generated)
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
`./pageNNN.musicxml`. Output is written to `data/results.json`.

### 2. Build IIIF image pyramids

```bash
pip install pyvips          # plus the VIPS system library
python3 scripts/generate_iiif.py . -o public/iiif
```

Creates a DZI/IIIF pyramid (`info.json` + tile folders) for every page under
`public/iiif/<name>/`. The pyramids are what OpenSeadragon streams, so the
viewer stays smooth at any zoom without loading the ~12 MP originals. It also
writes a ~300 px wide thumbnail per page to `public/thumbnails/<name>.jpg` —
that is what the overview grid shows (use `--thumbs-only` to regenerate just
those).

`setup.sh` also copies the OpenSeadragon button images from
`node_modules/openseadragon/build/openseadragon/images` to
`public/openseadragon/images` (the npm package only ships them under `build/`,
and that target is gitignored); `favicon.svg` and `icons.svg` in `public/` are
source assets and need no generation step.

### 3. Generate MNX representations (optional)

```bash
pip install lxml
python3 scripts/generate_mnx.py .
```

Converts each generated `pageNNN.musicxml` to the W3C
[MNX](https://w3c-cg.github.io/mnx/) format, writing `pageNNN.mnx` next to the
source (gitignored). Uses the vendored
[mnxconverter](https://github.com/w3c-cg/mnxconverter) (alpha; pinned commit in
`vendor/mnxconverter/VENDORING.md`). The converter's importer is limited, so
individual files may fail — failures are reported without stopping the run. The
output is not used by the viewer; it is kept as an artefact for inspection /
future use.

The TypeScript port
[mnxconverter-ts](https://github.com/deemaagog/mnxconverter-ts) is also
vendored (`vendor/mnxconverter-ts/`, pinned commit in its `VENDORING.md`) — the
same direction (MusicXML → MNX), but running in the browser. `tests/mnx.spec.ts`
exercises it against the upstream project's MusicXML fixture pairs (golden
`.mnx` outputs under `tests/fixtures/mnx/`) and cross-checks it against the
Python converter on real homr output. It is not wired into the viewer yet; it
exists so a future MNX → MusicXML step can be built and tested in TypeScript.

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
(`/iiif/<name>/info.json`); the staff bounding boxes and the rendered score are
drawn as viewport overlays that track pan/zoom.

### IIIF manifest

`public/manifest.json` (Presentation 3 style) is the viewer's single data
source. All IIIF URIs are **absolute**, built from a configurable base URL
(default `https://xn--kinderbcher-zhb.projektemacher.org/post/vieilles-chansons-et-rondes/`,
settable with `--base-url` on `generate_manifest.py` and `generate_iiif.py` —
the pyramid `info.json` `@id`s are kept in sync automatically). The viewer
resolves referenced URLs to their pathname, so the same manifest works when
served locally and from the deployment host. The manifest is modeled
natively:

- one **canvas per page** painted by its IIIF image service
  (`/iiif/<name>/info.json`)
- the smallest full pyramid rendition (`/iiif/<name>/full/<w,/0/default.jpg`)
  as the canvas **thumbnail** — the overview grid shows it, scaled by the
  client (no pre-generated `/thumbnails/*.jpg` needed by the viewer anymore)
- the notation files as **Alternative Representations** (canvas `rendering`):
  MusicXML and MNX, copied to `/musicxml/<name>.musicxml` and
  `/mnx/<name>.mnx`, so `public/` alone is deployable
- OMR confidence/status/error as native canvas **metadata**
- each detected staff as its own top-level **canvas** (staff grid and line
  count in the `omr:` namespace — `https://projektemacher.org/ns/omr/v1`,
  mapped via a JSON-LD context extension, since there is no native IIIF
  concept for staff lines); its region on the page is expressed by a
  "describing" annotation with an `#xywh` FragmentSelector target — the
  orange highlight rects and the note-position mapping derive from these
- `behavior: ["paged"]` marks the sequential book pages

### 4. Play & Highlight

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
