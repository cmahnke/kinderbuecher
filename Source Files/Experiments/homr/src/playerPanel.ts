import { MusicPlayer, INSTRUMENTS, type Instrument, type TrackConfig } from './audio'
import { parseMusicXML, type MusicTimeline, type ParsedNote } from './musicxml'
import { noteCoordOnStaff, type StaffEntry } from './noteMap'
import { OsmdRenderer, type ScorePiece } from './osmdRenderer'
import { addPixelOverlay, type OsdHandle } from './osdViewer'
import { SHOW_PLAYBACK_HIGHLIGHTS, SHOW_SCORE_OVERLAY } from './config'

export interface PlayerPage {
  width: number
  height: number
  staves: StaffEntry[]
  musicxmlText: string
}

export interface PlayerHandle {
  dispose: () => void
}

const SVG_NS = 'http://www.w3.org/2000/svg'
let scoreMountSeq = 0

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

/**
 * Resolves once `el` is attached to the document. Overlays added while the
 * tile source is still loading only enter the DOM after OSD's first draw.
 */
function waitConnected(el: Element): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => {
      if (el.isConnected) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

/**
 * Mounts the rendered OSMD score into the page-space overlay SVG: the OSMD
 * svg itself goes into <defs> (kept live so the playback cursor propagates),
 * and every mapped piece is drawn as a nested <svg> whose viewBox maps the
 * system's OSMD-space ink rect onto the staff region of the scan.
 */
function mountScore(root: SVGSVGElement, renderer: OsmdRenderer): void {
  const layout = renderer.getLayout()
  const src = renderer.getScoreSvg()
  if (!layout || !src || !root.isConnected) return
  const id = `osmd-src-${String(++scoreMountSeq)}`
  src.setAttribute('id', id)
  const defs = document.createElementNS(SVG_NS, 'defs')
  defs.appendChild(src)
  root.appendChild(defs)
  for (const piece of layout.pieces) {
    mountPiece(root, id, piece)
  }
}

function mountPiece(root: SVGSVGElement, srcId: string, piece: ScorePiece): void {
  const nested = svgEl('svg', {
    x: String(piece.x),
    y: String(piece.y),
    width: String(piece.width),
    height: String(piece.height),
    viewBox: `${String(piece.sx)} ${String(piece.sy)} ${String(piece.sw)} ${String(piece.sh)}`,
    preserveAspectRatio: piece.fit,
    class: 'score-system',
  })
  const bg = svgEl('rect', {
    x: String(piece.sx),
    y: String(piece.sy),
    width: String(piece.sw),
    height: String(piece.sh),
    class: 'score-system-bg',
  })
  const use = svgEl('use', { href: `#${srcId}` })
  nested.append(bg, use)
  root.appendChild(nested)
}

/**
 * Drops staff-highlight rects that no score piece covers: the score mapping
 * deliberately ignores spurious homr detections, and a stray highlight over
 * an unaligned region would only read as a bug.
 */
function pruneUnmatchedRects(overlay: SVGSVGElement | null, pieces: ScorePiece[]): void {
  if (!overlay || pieces.length === 0) return
  for (const rect of Array.from(overlay.querySelectorAll('rect'))) {
    const x = Number(rect.getAttribute('x') ?? 0)
    const y = Number(rect.getAttribute('y') ?? 0)
    const w = Number(rect.getAttribute('width') ?? 0)
    const h = Number(rect.getAttribute('height') ?? 0)
    const TOL = 4
    const hit = pieces.some(
      (p) =>
        x < p.x + p.width + TOL &&
        x + w > p.x - TOL &&
        y < p.y + p.height + TOL &&
        y + h > p.y - TOL,
    )
    if (!hit) rect.remove()
  }
}

/**
 * Maps a position in the OSMD score svg's user units onto page pixel space
 * through a piece, honoring the letterboxing ('xMidYMid meet') of pieces
 * whose aspect ratio diverges from the scan's.
 */
function osmdToPage(piece: ScorePiece, pos: { x: number; y: number }): { x: number; y: number } {
  if (piece.fit === 'xMidYMid meet') {
    const scale = Math.min(piece.width / piece.sw, piece.height / piece.sh)
    const ox = (piece.width - piece.sw * scale) / 2
    const oy = (piece.height - piece.sh * scale) / 2
    return {
      x: piece.x + ox + (pos.x - piece.sx) * scale,
      y: piece.y + oy + (pos.y - piece.sy) * scale,
    }
  }
  return {
    x: piece.x + (pos.x - piece.sx) * (piece.width / piece.sw),
    y: piece.y + (pos.y - piece.sy) * (piece.height / piece.sh),
  }
}

/**
 * Builds the MusicXML player: the playback controls go into `controlsHost`
 * (a bar above the image) and the rendered score is drawn as an overlay on
 * the OpenSeadragon image (`osd`), alongside `overlaySvg`.
 */
export function setupPlayer(
  controlsHost: HTMLElement,
  osd: OsdHandle,
  overlaySvg: SVGSVGElement | null,
  page: PlayerPage,
): PlayerHandle {
  const timeline: MusicTimeline = parseMusicXML(page.musicxmlText)
  const staffEntries = page.staves

  const controls = document.createElement('div')
  controls.className = 'player-controls'

  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'player-btn'
  playBtn.textContent = 'Play'

  const pauseBtn = document.createElement('button')
  pauseBtn.type = 'button'
  pauseBtn.className = 'player-btn'
  pauseBtn.textContent = 'Pause'

  const stopBtn = document.createElement('button')
  stopBtn.type = 'button'
  stopBtn.className = 'player-btn'
  stopBtn.textContent = 'Stop'

  const tempoLabel = document.createElement('span')
  tempoLabel.className = 'player-tempo'
  tempoLabel.textContent = 'Tempo: 120'

  const tempo = document.createElement('input')
  tempo.type = 'range'
  tempo.min = '60'
  tempo.max = '180'
  tempo.value = '120'

  controls.append(playBtn, pauseBtn, stopBtn, tempoLabel, tempo)

  // A page score may carry several staves (e.g. a grand staff with two
  // voices). Dual mode plays two staves at once, each with its own
  // instrument, and is on by default whenever the score carries two note
  // streams; with a single staff only that staff plays.
  const presentStaffs = [...new Set(timeline.notes.map((n) => n.staff))].sort((a, b) => a - b)
  let trackA = presentStaffs[0] ?? 1
  let trackB = presentStaffs[1] ?? trackA
  let instrumentA: Instrument = 'piano'
  let instrumentB: Instrument = 'piano'
  let dual = presentStaffs.length > 1

  const trackLabel = document.createElement('span')
  trackLabel.className = 'player-tempo'
  trackLabel.textContent = 'Track'

  const makeStaffSelect = (initial: number): HTMLSelectElement => {
    const select = document.createElement('select')
    select.className = 'player-track'
    for (const s of presentStaffs) {
      const opt = document.createElement('option')
      opt.value = String(s)
      opt.textContent = `Staff ${String(s)}`
      select.appendChild(opt)
    }
    select.value = String(initial)
    return select
  }

  const makeInstrumentSelect = (className: string): HTMLSelectElement => {
    const select = document.createElement('select')
    select.className = `player-instrument ${className}`
    for (const inst of INSTRUMENTS) {
      const opt = document.createElement('option')
      opt.value = inst.id
      opt.textContent = inst.label
      select.appendChild(opt)
    }
    return select
  }

  const trackSelectA = makeStaffSelect(trackA)
  const instrumentSelectA = makeInstrumentSelect('player-instrument-a')
  controls.append(trackLabel, trackSelectA, instrumentSelectA)

  let dualBox: HTMLInputElement | null = null
  let trackSelectB: HTMLSelectElement | null = null
  let instrumentSelectB: HTMLSelectElement | null = null
  if (presentStaffs.length > 1) {
    dualBox = document.createElement('input')
    dualBox.type = 'checkbox'
    dualBox.className = 'player-dual'
    dualBox.id = 'player-dual-toggle'
    dualBox.checked = dual
    const dualLabel = document.createElement('label')
    dualLabel.className = 'player-tempo'
    dualLabel.htmlFor = 'player-dual-toggle'
    dualLabel.textContent = 'Dual'

    const trackBLabel = document.createElement('span')
    trackBLabel.className = 'player-tempo'
    trackBLabel.textContent = 'Track 2'
    trackSelectB = makeStaffSelect(trackB)
    // NB: not 'player-track' — that class must stay unique for track A
    trackSelectB.className = 'player-track2'
    instrumentSelectB = makeInstrumentSelect('player-instrument-b')
    const trackBWrap = document.createElement('span')
    trackBWrap.className = 'player-track-b'
    trackBWrap.append(trackBLabel, trackSelectB, instrumentSelectB)
    controls.append(dualLabel, dualBox, trackBWrap)
  } else {
    controls.classList.add('single-track')
  }

  // Toggle for the rendered score overlay (OpenSheetMusicDisplay mapped onto
  // the scan). Off by default; the OSMD render itself still runs while
  // anything consumes its alignment data (see below).
  const scoreBox = document.createElement('input')
  scoreBox.type = 'checkbox'
  scoreBox.className = 'player-score'
  scoreBox.id = 'player-score-toggle'
  scoreBox.checked = SHOW_SCORE_OVERLAY
  const scoreLabel = document.createElement('label')
  scoreLabel.className = 'player-tempo'
  scoreLabel.htmlFor = 'player-score-toggle'
  scoreLabel.textContent = 'Score'
  controls.append(scoreLabel, scoreBox)
  controlsHost.appendChild(controls)

  // The rendered score lives in a page-pixel-space SVG (same mechanism as the
  // staff highlight overlay), so OpenSeadragon scales it with pan/zoom.
  // After OSMD renders, every system (or sub-staff of a grand staff) is
  // affine-mapped onto the homr-detected staff region of the scan.
  // The render runs while anything consumes its alignment data (piece rects,
  // system-entry mapping, cursor position for the playhead); the rendered
  // overlay itself is only mounted while the Score toggle is on.
  const needsOsmd = SHOW_SCORE_OVERLAY || SHOW_PLAYBACK_HIGHLIGHTS
  const scoreSvg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  scoreSvg.setAttribute('viewBox', `0 0 ${String(page.width)} ${String(page.height)}`)
  scoreSvg.classList.add('staff-overlay', 'score-overlay')

  let osmd: OsmdRenderer | null = null
  let disposed = false
  const renderer = new OsmdRenderer()
  osmd = renderer
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__renderer = renderer
  }
  let showScore = SHOW_SCORE_OVERLAY
  let scoreOverlayAdded = false
  let scoreContentMounted = false
  // Mounts the rendered overlay once the renderer is done AND the overlay
  // has actually entered the DOM (which happens after the tile source opens).
  // The score content is mounted at most once; the toggle only adds/removes
  // the overlay itself.
  function updateScoreOverlay(): void {
    if (disposed || !osmd || !showScore || !osmd.getLayout()) return
    if (!scoreOverlayAdded) {
      addPixelOverlay(osd.viewer, scoreSvg, 0, 0, page.width, page.height)
      scoreOverlayAdded = true
    }
    if (!scoreContentMounted) {
      void waitConnected(scoreSvg).then(() => {
        if (disposed || !showScore || scoreContentMounted || !osmd) return
        mountScore(scoreSvg, osmd)
        scoreContentMounted = true
      })
    }
  }
  let rendered: Promise<void> | null = null
  function ensureRendered(): void {
    if (rendered) return
    rendered = renderer.render(page.musicxmlText, staffEntries)
    void rendered
      .then(() => {
        if (disposed) return
        updateScoreOverlay()
        pruneUnmatchedRects(overlaySvg, osmd?.getLayout()?.pieces ?? [])
      })
      .catch((err: unknown) => {
        console.error('OSMD render failed:', err)
      })
  }
  if (needsOsmd) ensureRendered()

  scoreBox.addEventListener('change', () => {
    showScore = scoreBox.checked
    if (showScore) {
      ensureRendered()
      updateScoreOverlay()
    } else if (scoreOverlayAdded) {
      osd.viewer.removeOverlay(scoreSvg)
      scoreOverlayAdded = false
    }
  })

  const player = new MusicPlayer(timeline)

  const trackConfigs = (): TrackConfig[] =>
    dual
      ? [
          { staff: trackA, instrument: instrumentA },
          { staff: trackB, instrument: instrumentB },
        ]
      : [{ staff: trackA, instrument: instrumentA }]
  player.setTracks(trackConfigs())

  // OSMD's playback cursor advances one voice entry (onset) per step —
  // including rests, which are not in timeline.notes. Compute the number of
  // onsets of the played staff strictly before a note, in performance order.
  function osmdStepsBefore(note: ParsedNote, staff: number): number {
    let k = 0
    for (const m of timeline.measures) {
      if (m.number === note.measureNumber && m.system === note.system) {
        const onsets = new Set<number>()
        for (const n of m.notes) {
          if (n.staff === staff && !n.grace) onsets.add(n.beatStart)
        }
        const sorted = [...onsets].sort((a, b) => a - b)
        return k + sorted.filter((o) => o < note.beatStart).length
      }
      const onsets = new Set<number>()
      for (const n of m.notes) {
        if (n.staff === staff && !n.grace) onsets.add(n.beatStart)
      }
      k += onsets.size
    }
    return k
  }

  /**
   * One highlight set (staff rect, note marker, playhead line) per playing
   * staff, so dual mode shows the current position on both staves instead
   * of letting the second track fight the first for a single marker.
   */
  interface TrackHighlights {
    staffRect: SVGRectElement | null
    noteMarker: SVGCircleElement | null
    posLine: SVGLineElement | null
  }
  const highlightSets = new Map<number, TrackHighlights>()
  function highlightsFor(staff: number): TrackHighlights {
    let set = highlightSets.get(staff)
    if (!set) {
      set = { staffRect: null, noteMarker: null, posLine: null }
      highlightSets.set(staff, set)
    }
    return set
  }

  function clearHighlights(): void {
    for (const set of highlightSets.values()) {
      if (set.staffRect) {
        set.staffRect.setAttribute('visibility', 'hidden')
        set.staffRect.setAttribute('width', '0')
        set.staffRect.setAttribute('height', '0')
      }
      if (set.noteMarker) set.noteMarker.setAttribute('visibility', 'hidden')
      if (set.posLine) set.posLine.setAttribute('visibility', 'hidden')
    }
  }

  /** The staff entry a MusicXML system was aligned to (-1 when unknown). */
  function entryForSystem(system: number): number {
    const layout = osmd?.getLayout()
    if (!layout) return system
    return layout.systemEntry[system] ?? -1
  }

  function pieceFor(entry: number, staff: number): ScorePiece | null {
    const pieces = osmd?.getLayout()?.pieces ?? []
    return (
      pieces.find((p) => p.entry === entry && p.subStaff === staff) ??
      pieces.find((p) => p.entry === entry) ??
      null
    )
  }

  function highlightStaff(system: number, staff: number): void {
    if (!overlaySvg || !SHOW_PLAYBACK_HIGHLIGHTS) return
    const set = highlightsFor(staff)
    const entry = entryForSystem(system)
    // Prefer the aligned piece rect: it marks exactly the sub-staff region
    // the score was mapped to, not the whole (possibly two-staff) entry.
    const piece = entry >= 0 ? pieceFor(entry, staff) : null
    let box: [number, number, number, number] | null = piece
      ? [piece.x, piece.y, piece.x + piece.width, piece.y + piece.height]
      : null
    if (!box) {
      const st = staffEntries[entry >= 0 ? entry : system]
      box = st ? st.bbox : null
    }
    if (!box) {
      clearHighlights()
      return
    }
    const [x0, y0, x1, y1] = box
    if (!set.staffRect) {
      set.staffRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      set.staffRect.setAttribute('class', 'staff-current')
      set.staffRect.setAttribute('visibility', 'hidden')
      overlaySvg.appendChild(set.staffRect)
    }
    set.staffRect.setAttribute('x', String(x0))
    set.staffRect.setAttribute('y', String(y0))
    set.staffRect.setAttribute('width', String(x1 - x0))
    set.staffRect.setAttribute('height', String(y1 - y0))
    set.staffRect.setAttribute('visibility', 'visible')
    // The position line spans the current staff region; its extent is set
    // per note in highlightNote (a bold vertical playhead).
    if (!set.posLine) {
      set.posLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      set.posLine.setAttribute('class', 'play-pos')
      set.posLine.setAttribute('visibility', 'hidden')
      overlaySvg.appendChild(set.posLine)
    }
    set.posLine.setAttribute('x1', String(x0))
    set.posLine.setAttribute('x2', String(x0))
    set.posLine.setAttribute('y1', String(y0))
    set.posLine.setAttribute('y2', String(y1))
    set.posLine.setAttribute('stroke-width', String(Math.max(6, (y1 - y0) * 0.1)))
  }

  function highlightNote(index: number): void {
    const note = timeline.notes[index]
    if (!note) return
    highlightStaff(note.system, note.staff)
    if (!overlaySvg) return
    const set = highlightsFor(note.staff)
    const entry = entryForSystem(note.system)
    const coord = noteCoordOnStaff(timeline, note, staffEntries[entry >= 0 ? entry : note.system])
    if (!coord) return
    // Refine the marker's x with OSMD's playback cursor position when it is
    // available and plausibly inside the aligned piece: the beat-proportional
    // fallback drifts from the actual note positions, but a grossly diverging
    // cursor (e.g. when OSMD's voice-entry order differs) would be worse.
    let x = coord.x
    const piece = entry >= 0 ? pieceFor(entry, note.staff) : null
    const cursor = osmd?.getCursorUserPos()
    if (piece && cursor && cursor.x >= piece.sx - 10 && cursor.x <= piece.sx + piece.sw + 10) {
      const refined = osmdToPage(piece, cursor).x
      if (Math.abs(refined - coord.x) < piece.width * 0.2) x = refined
    }
    if (!set.noteMarker) {
      set.noteMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      set.noteMarker.setAttribute('class', 'note-marker')
      set.noteMarker.setAttribute('visibility', 'hidden')
      overlaySvg.appendChild(set.noteMarker)
    }
    set.noteMarker.setAttribute('r', String(coord.r))
    set.noteMarker.setAttribute('cx', String(x))
    set.noteMarker.setAttribute('cy', String(coord.y))
    set.noteMarker.setAttribute('stroke-width', String(Math.max(4, coord.unit * 0.3)))
    set.noteMarker.setAttribute('visibility', 'visible')
    // A bold vertical playhead at the same x: at fit zoom the page is shown
    // at a fraction of its pixel size, so a note-sized dot alone is nearly
    // invisible — the line carries the position.
    if (set.posLine) {
      set.posLine.setAttribute('x1', String(x))
      set.posLine.setAttribute('x2', String(x))
      set.posLine.setAttribute('visibility', 'visible')
    }
  }

  player.setCallbacks({
    onNote: (note, index) => {
      if (!SHOW_PLAYBACK_HIGHLIGHTS) return
      // Each playing track drives its own highlight set, so dual mode shows
      // the current position on both staves; notes of staves that are not
      // playing are ignored. OSMD's single cursor still follows the primary
      // track only.
      const audible = note.staff === trackA || (dual && note.staff === trackB)
      if (!audible) return
      if (note.staff === trackA) {
        // Advance the OSMD cursor first so the marker reads the fresh position.
        osmd?.highlightNote(osmdStepsBefore(note, trackA))
      }
      highlightNote(index)
    },
    onEnd: () => {
      clearHighlights()
      osmd?.clearHighlight()
    },
  })

  function applyTracks(): void {
    player.setTracks(trackConfigs())
    osmd?.clearHighlight()
    if (player.isPlaying) {
      player.stop()
      player.play()
    }
  }

  playBtn.addEventListener('click', () => {
    if (player.isPlaying) return
    player.setTempo(parseInt(tempo.value, 10) || 120)
    player.play()
  })

  pauseBtn.addEventListener('click', () => {
    player.pause()
  })

  stopBtn.addEventListener('click', () => {
    player.stop()
    clearHighlights()
    osmd?.clearHighlight()
  })

  tempo.addEventListener('input', () => {
    player.setTempo(parseInt(tempo.value, 10) || 120)
    tempoLabel.textContent = `Tempo: ${tempo.value}`
  })

  trackSelectA.addEventListener('change', () => {
    trackA = parseInt(trackSelectA.value, 10) || trackA
    if (trackB === trackA) {
      trackB = presentStaffs.find((s) => s !== trackA) ?? trackB
      if (trackSelectB) trackSelectB.value = String(trackB)
    }
    applyTracks()
  })

  instrumentSelectA.addEventListener('change', () => {
    instrumentA = instrumentSelectA.value as Instrument
    applyTracks()
  })

  if (dualBox && trackSelectB && instrumentSelectB) {
    dualBox.addEventListener('change', () => {
      dual = dualBox.checked
      applyTracks()
    })
    trackSelectB.addEventListener('change', () => {
      trackB = parseInt(trackSelectB.value, 10) || trackB
      applyTracks()
    })
    instrumentSelectB.addEventListener('change', () => {
      instrumentB = instrumentSelectB.value as Instrument
      applyTracks()
    })
  }

  return {
    dispose: () => {
      disposed = true
      player.dispose()
      osmd?.dispose()
      controls.remove()
      if (scoreOverlayAdded) osd.viewer.removeOverlay(scoreSvg)
    },
  }
}
