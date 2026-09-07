import Fraction from 'fraction.js'
import type {
  MnxContent,
  MnxDocument,
  MnxEnding,
  MnxEvent,
  MnxMeasureGlobal,
  MnxNote,
  MnxNoteValueQuantity,
  MnxOttava,
  MnxPart,
  MnxPartMeasure,
  MnxPositionedClef,
  MnxSequence,
  MnxTempo,
  MnxTuplet,
} from './mnx-types'
import { el, serializeXml, type XmlElement } from './xml'

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'
const XML_DOCTYPE =
  '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'

/** Whole-note fraction of every MNX note-value base. */
const BASE_FRACTIONS = new Map<string, Fraction>(
  Object.entries({
    duplexMaxima: [16, 1],
    maxima: [8, 1],
    longa: [4, 1],
    breve: [2, 1],
    whole: [1, 1],
    half: [1, 2],
    quarter: [1, 4],
    eighth: [1, 8],
    '16th': [1, 16],
    '32nd': [1, 32],
    '64th': [1, 64],
    '128th': [1, 128],
    '256th': [1, 256],
    '512th': [1, 512],
    '1024th': [1, 1024],
    '2048th': [1, 2048],
    '4096th': [1, 4096],
  }).map(([base, [n, d]]) => [base, new Fraction(n, d)]),
)

/**
 * MusicXML <type> names. MusicXML has no duplexMaxima symbol and the vendored
 * MusicXML reader does not know "maxima", so notes with those bases carry no
 * <type> and their duration is derived from <duration> instead.
 */
const XML_TYPE_NAMES = new Map<string, string | null>(
  Object.entries({
    duplexMaxima: null,
    maxima: null,
    longa: 'long',
    breve: 'breve',
    whole: 'whole',
    half: 'half',
    quarter: 'quarter',
    eighth: 'eighth',
    '16th': '16th',
    '32nd': '32nd',
    '64th': '64th',
    '128th': '128th',
    '256th': '256th',
    '512th': '512th',
    '1024th': '1024th',
    '2048th': '2048th',
    '4096th': '4096th',
  }),
)

/**
 * Maps MNX ottava values to MusicXML octave-shift type/size. This follows the
 * vendored converter's convention (its octave-shift importer maps size 8 /
 * type "down" to ottava value 1), not the MusicXML spec's.
 */
const OTTAVA_TO_MUSICXML = new Map<number, { type: string; size: number }>([
  [1, { type: 'down', size: 8 }],
  [-1, { type: 'up', size: 8 }],
  [2, { type: 'down', size: 15 }],
  [-2, { type: 'up', size: 15 }],
  [3, { type: 'down', size: 22 }],
  [-3, { type: 'up', size: 22 }],
])

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

const BARLINE_STYLES = new Map<string, string>([
  ['regular', 'regular'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
  ['heavy', 'heavy'],
  ['double', 'light-light'],
  ['final', 'light-heavy'],
  ['heavyLight', 'heavy-light'],
  ['heavyHeavy', 'heavy-heavy'],
  ['tick', 'tick'],
  ['short', 'short'],
  ['noBarline', 'none'],
])

const LYRIC_SYLLABIC = new Map<string, string>([
  ['start', 'begin'],
  ['middle', 'middle'],
  ['end', 'end'],
  ['whole', 'single'],
])

interface NoteMarks {
  tieStarts: Array<{ side?: string }>
  tieStop: boolean
  slurStarts: Array<{ number: number; placement?: string }>
  slurStops: Array<{ number: number }>
}

function emptyNoteMarks(): NoteMarks {
  return { tieStarts: [], tieStop: false, slurStarts: [], slurStops: [] }
}

interface EventWrap {
  event: MnxEvent
  partIdx: number
  measureIdx: number
  grace: boolean
  tuplets: MnxTuplet[]
  sounded: Fraction
  voice?: string
  staff?: number
  noteMarks: NoteMarks[]
  bracketStart: number[]
  bracketStop: number[]
}

interface PositionedItem {
  fraction: Fraction
  order: number
  element: XmlElement
  /**
   * Whether the item is placed at (or before) the event starting exactly at
   * `fraction` (directions starting a span) or strictly after it (directions
   * ending a span: the reader records the enclosing span's end as the start
   * of the last event it contains).
   */
  inclusive: boolean
}

interface AnalyzeContext {
  partIdx: number
  measureIdx: number
  grace: boolean
  tuplets: MnxTuplet[]
  voice?: string
  staff?: number
}

function requireValue<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message)
  return value
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b)
}

function dotted(unit: Fraction, dots: number | undefined): Fraction {
  let add = unit
  let frac = unit
  for (let i = 0; i < (dots ?? 0); i++) {
    add = add.div(2)
    frac = frac.add(add)
  }
  return frac
}

function tupletQuantity(value: MnxNoteValueQuantity | undefined, label: string): Fraction {
  const base = requireValue(value?.duration?.base, `tuplet ${label} is missing a duration base`)
  const unit = requireValue(BASE_FRACTIONS.get(base), `unknown note-value base "${base}"`)
  return dotted(unit, value?.duration?.dots).mul(value?.multiple ?? 1)
}

function parseFraction(fraction: [number, number] | undefined, label: string): Fraction {
  const [n, d] = requireValue(fraction, `${label} is missing a fraction`)
  return new Fraction(n, d)
}

function compareFraction(a: Fraction, b: Fraction): number {
  return a.n * b.d - b.n * a.d
}

function keyAlteredSteps(fifths: number): Set<string> {
  const order = fifths > 0 ? SHARP_ORDER : FLAT_ORDER
  return new Set(order.slice(0, Math.min(Math.abs(fifths), 7)))
}

/**
 * Simplified accidental glyph selection: naturals are always shown for
 * unaltered pitches, sharps/flats/double accidentals follow the pitch alter.
 * MNX only records *that* an accidental must be shown, not which glyph.
 */
function accidentalGlyph(alter: number | undefined, fifths: number, step: string): string {
  const value = alter ?? 0
  if (value === 2) return 'double-sharp'
  if (value === 1) return 'sharp'
  if (value === -1) return 'flat'
  if (value === -2) return 'flat-flat'
  if (value === 0) return 'natural'
  if (keyAlteredSteps(fifths).has(step)) return 'natural'
  throw new Error(`unsupported pitch alter ${String(value)} for <accidental>`)
}

function clefLine(staffPosition: number, sign: string): number {
  if (staffPosition % 2 !== 0) {
    throw new Error(`clef ${sign} has an odd staffPosition ${String(staffPosition)}`)
  }
  const line = 3 + staffPosition / 2
  if (!Number.isInteger(line) || line < 1 || line > 5) {
    throw new Error(`clef ${sign} staffPosition ${String(staffPosition)} is out of range`)
  }
  return line
}

export function getMusicXmlFromMnx(mnx: MnxDocument): string {
  return new MnxToMusicXml(mnx).toXmlString()
}

class MnxToMusicXml {
  private readonly globalMeasures: MnxMeasureGlobal[]
  private readonly parts: MnxPart[]
  private readonly wraps: EventWrap[] = []
  private readonly eventById = new Map<string, EventWrap>()
  private readonly noteById = new Map<string, { wrap: EventWrap; idx: number }>()
  private readonly soundedFractions: Fraction[] = []
  private readonly ottavas: Array<Array<{ ottava: MnxOttava; startMeasure: number }>> = []
  private readonly endingCloses = new Map<number, { type: string; numbers: number[] }>()
  private divisions = 1
  private slurCounter = 0

  constructor(mnx: MnxDocument) {
    this.globalMeasures = mnx.global?.measures ?? []
    this.parts = requireValue(mnx.parts, 'the MNX document has no parts')
    for (const part of this.parts) this.withDerivedSequenceStaffs(part)
    for (const part of this.parts) this.analyzePart(part)
    this.resolveCrossReferences()
    this.divisions = this.computeDivisions()
    this.collectEndingCloses()
  }

  toXmlString(): string {
    const root = el('score-partwise', { version: '3.1' }, [
      el(
        'part-list',
        {},
        this.parts.map((_, i) => this.partListEntry(i)),
      ),
      ...this.parts.map((part, partIdx) =>
        el(
          'part',
          { id: this.partId(partIdx) },
          (part.measures ?? []).map((_, measureIdx) =>
            this.partMeasureElement(part, partIdx, measureIdx),
          ),
        ),
      ),
    ])
    return `${XML_DECLARATION}\n${XML_DOCTYPE}\n\n${serializeXml(root)}\n`
  }

  private partId(partIdx: number): string {
    return `P${partIdx + 1}`
  }

  private partListEntry(partIdx: number): XmlElement {
    const name = this.parts[partIdx]?.name
    return el(
      'score-part',
      { id: this.partId(partIdx) },
      name === undefined ? [] : [el('part-name', {}, [name])],
    )
  }

  // ---------------------------------------------------------------- analysis

  private analyzePart(part: MnxPart): void {
    const partIdx = this.parts.indexOf(part)
    const ottavas: Array<{ ottava: MnxOttava; startMeasure: number }> = []
    ;(part.measures ?? []).forEach((measure, measureIdx) => {
      for (const ottava of measure.ottavas ?? []) ottavas.push({ ottava, startMeasure: measureIdx })
      ;(measure.sequences ?? []).forEach((sequence) => {
        this.analyzeContent(sequence.content ?? [], {
          partIdx,
          measureIdx,
          grace: false,
          tuplets: [],
          voice: sequence.voice,
          staff: sequence.staff,
        })
      })
    })
    this.ottavas[partIdx] = ottavas
  }

  /** Analyzes content in document order and returns the events it produced. */
  private analyzeContent(content: MnxContent[], ctx: AnalyzeContext): EventWrap[] {
    const wraps: EventWrap[] = []
    content.forEach((item) => {
      if (item.type === 'grace') {
        if (ctx.grace) throw new Error('nested grace groups are not supported')
        const inner = requireValue(item.content, 'grace content is missing')
        wraps.push(...this.analyzeContent(inner, { ...ctx, grace: true, tuplets: [] }))
        return
      }
      if (item.type === 'tuplet') {
        if (ctx.grace) throw new Error('grace content may only contain events')
        requireValue(item.inner, 'tuplet is missing "inner"')
        requireValue(item.outer, 'tuplet is missing "outer"')
        const childContent = requireValue(item.content, 'tuplet content is missing')
        const depth = ctx.tuplets.length + 1
        const childWraps = this.analyzeContent(childContent, {
          ...ctx,
          tuplets: [...ctx.tuplets, item],
        })
        const members = childWraps.filter((wrap) => wrap.tuplets[depth - 1] === item)
        if (members.length > 0) {
          members[0].bracketStart.push(depth)
          members[members.length - 1].bracketStop.push(depth)
        }
        wraps.push(...childWraps)
        return
      }
      if (ctx.grace && item.type !== undefined) {
        throw new Error(`grace content may only contain events, got "${item.type}"`)
      }
      if (item.type === 'space') {
        const frac = parseFraction(item.duration, 'space')
        if (compareFraction(frac, new Fraction(0)) > 0) this.soundedFractions.push(frac)
        return
      }
      if (item.type === 'tremolo') {
        throw new Error('multi-note tremolo events are not supported by mnx2musicxml')
      }
      wraps.push(this.analyzeEvent(item as MnxEvent, ctx))
    })
    return wraps
  }

  private analyzeEvent(event: MnxEvent, ctx: AnalyzeContext): EventWrap {
    const hasRest = event.rest !== undefined && event.rest !== null
    const notes = event.notes ?? []
    if (!hasRest && notes.length === 0) {
      throw new Error(
        `event at part ${ctx.partIdx + 1} measure ${ctx.measureIdx + 1} has neither rest nor notes`,
      )
    }
    if (hasRest && notes.length > 0) {
      throw new Error(
        `event at part ${ctx.partIdx + 1} measure ${ctx.measureIdx + 1} has both rest and notes`,
      )
    }
    const duration = requireValue(event.duration, 'event is missing a duration')
    const base = requireValue(
      BASE_FRACTIONS.get(requireValue(duration.base, 'event duration is missing a base')),
      'unknown note-value base',
    )
    const written = dotted(base, duration.dots)
    const sounded = ctx.tuplets.reduce(
      (acc, tuplet) =>
        acc.mul(tupletQuantity(tuplet.outer, 'outer')).div(tupletQuantity(tuplet.inner, 'inner')),
      written,
    )
    const wrap: EventWrap = {
      event,
      partIdx: ctx.partIdx,
      measureIdx: ctx.measureIdx,
      grace: ctx.grace,
      tuplets: ctx.tuplets,
      sounded: ctx.grace ? new Fraction(0) : sounded,
      voice: ctx.voice,
      staff: ctx.staff,
      noteMarks: notes.map(() => emptyNoteMarks()),
      bracketStart: [],
      bracketStop: [],
    }
    this.wraps.push(wrap)
    if (!ctx.grace) this.soundedFractions.push(wrap.sounded)
    if (event.id !== undefined && !this.eventById.has(event.id)) this.eventById.set(event.id, wrap)
    notes.forEach((note, noteIdx) => {
      if (note.id !== undefined && !this.noteById.has(note.id)) {
        this.noteById.set(note.id, { wrap, idx: noteIdx })
      }
    })
    return wrap
  }

  private resolveCrossReferences(): void {
    for (const wrap of this.wraps) {
      const notes = wrap.event.notes ?? []
      notes.forEach((note, noteIdx) => {
        for (const tie of note.ties ?? []) {
          if (tie.target === undefined) continue
          const target = requireValue(
            this.noteById.get(tie.target),
            `tie target note "${tie.target}" not found`,
          )
          wrap.noteMarks[noteIdx].tieStarts.push({ side: tie.side })
          target.wrap.noteMarks[target.idx].tieStop = true
        }
      })
      for (const slur of wrap.event.slurs ?? []) {
        const target = requireValue(
          slur.target === undefined ? undefined : this.eventById.get(slur.target),
          `slur target event "${String(slur.target)}" not found`,
        )
        const number = ++this.slurCounter
        wrap.noteMarks[this.noteIdxOf(wrap, slur.startNote)].slurStarts.push({
          number,
          placement: slur.side,
        })
        target.noteMarks[this.noteIdxOf(target, slur.endNote)].slurStops.push({ number })
      }
    }
  }

  private noteIdxOf(wrap: EventWrap, noteId: string | undefined): number {
    if (noteId === undefined) return 0
    const idx = (wrap.event.notes ?? []).findIndex((note) => note.id === noteId)
    return idx >= 0 ? idx : 0
  }

  private computeDivisions(): number {
    let denominator = 1
    for (const frac of this.soundedFractions) denominator = lcm(denominator, frac.d)
    return denominator * 4
  }

  /** MusicXML <duration> for a whole-note fraction: divisions are per quarter. */
  private durationOf(frac: Fraction): number {
    const numer = frac.n * this.divisions * 4
    if (numer % frac.d !== 0) {
      throw new Error(
        `duration ${frac.toString()} is not representable with divisions ${String(this.divisions)}`,
      )
    }
    return numer / frac.d
  }

  private collectEndingCloses(): void {
    const last = this.globalMeasures.length - 1
    this.globalMeasures.forEach((gm, index) => {
      const ending = gm.ending
      if (!ending) return
      const duration = Math.max(1, ending.duration ?? 1)
      const closeIdx = Math.min(index + duration - 1, last)
      const existing = this.endingCloses.get(closeIdx)
      if (existing) {
        existing.numbers.push(...(ending.numbers ?? []))
      } else {
        this.endingCloses.set(closeIdx, {
          type: ending.open ? 'discontinue' : 'stop',
          numbers: [...(ending.numbers ?? [])],
        })
      }
    })
  }

  // ---------------------------------------------------------------- emission

  private partMeasureElement(part: MnxPart, partIdx: number, measureIdx: number): XmlElement {
    const gm = this.globalMeasures[measureIdx] ?? null
    const measure = (part.measures ?? [])[measureIdx] ?? {}
    const children: XmlElement[] = []

    const left = this.leftBarlineChildren(gm)
    if (left.length > 0) children.push(el('barline', { location: 'left' }, left))

    const attributes = this.startAttributes(part, measure, measureIdx)
    if (attributes) children.push(attributes)

    const sequences = measure.sequences ?? []
    // Multiple voice-less sequences in one measure need distinct voices for
    // MusicXML readers (OSMD ignores the <backup> otherwise and stacks all
    // notes into one timeline); the vendored converter merges voice-less
    // sequences, so this only triggers for foreign MNX documents.
    const voicelessCount = sequences.filter((seq) => seq.voice === undefined).length
    let fallbackVoice = 0
    sequences.forEach((sequence, seqIdx) => {
      const fallback =
        sequence.voice === undefined && voicelessCount > 1 ? String(++fallbackVoice) : undefined
      const positioned = this.positionedItems(measure, partIdx, measureIdx, seqIdx, gm)
      const emitted = this.emitSequence(sequence, positioned, fallback)
      children.push(...emitted.elements)
      if (seqIdx < sequences.length - 1 && compareFraction(emitted.sounded, new Fraction(0)) > 0) {
        children.push(
          el('backup', {}, [el('duration', {}, [String(this.durationOf(emitted.sounded))])]),
        )
      }
    })

    const right = this.rightBarlineChildren(measureIdx, gm)
    if (right.length > 0) children.push(el('barline', { location: 'right' }, right))

    return el('measure', { number: String(gm?.number ?? measureIdx + 1) }, children)
  }

  /**
   * The converters (vendored and ours) do not serialize the staff index on
   * positioned clefs — the array order implies the staff (the vendored
   * MusicXML reader ignores the <clef number> attribute too). Only the
   * initial clefs (rhythmic position 0) are derived from the index — one
   * clef per staff; later entries are mid-measure clef changes whose staff
   * is genuinely unknown, so they keep the default (staff 1).
   */
  private withDerivedClefStaffs(measure: MnxPartMeasure): MnxPositionedClef[] {
    let zeroIndex = 0
    return (measure.clefs ?? []).map((positioned) => {
      if (positioned.staff !== undefined) return positioned
      const fraction = positioned.position?.fraction
      if (fraction && (fraction[0] ?? 0) !== 0) return positioned
      zeroIndex += 1
      return { ...positioned, staff: zeroIndex }
    })
  }

  /**
   * The vendored converters lose the staff on sequences entirely (only the
   * voice survives). Derive a staff per voice from its first appearance in
   * measure order, capped at the part's staff count: a single-staff part
   * keeps every voice on staff 1, a grand staff maps its first two voices
   * to staves 1 and 2. Applied in measure order so the mapping is stable.
   */
  private withDerivedSequenceStaffs(part: MnxPart): void {
    const measures = part.measures ?? []
    const maxStaff = Math.max(
      1,
      ...measures.map((measure) =>
        Math.max(1, ...this.withDerivedClefStaffs(measure).map((c) => c.staff ?? 1)),
      ),
    )
    const voiceStaff = new Map<string, number>()
    for (const measure of measures) {
      for (const sequence of measure.sequences ?? []) {
        if (sequence.staff !== undefined) continue
        const voice = sequence.voice ?? ''
        if (!voiceStaff.has(voice)) {
          voiceStaff.set(voice, Math.min(maxStaff, voiceStaff.size + 1))
        }
        sequence.staff = voiceStaff.get(voice)
      }
    }
  }

  private startAttributes(
    part: MnxPart,
    measure: MnxPartMeasure,
    measureIdx: number,
  ): XmlElement | null {
    const gm = this.globalMeasures[measureIdx] ?? null
    const children: XmlElement[] = []
    if (measureIdx === 0) children.push(el('divisions', {}, [String(this.divisions)]))
    if (gm?.key?.fifths !== undefined) {
      children.push(el('key', {}, [el('fifths', {}, [String(gm.key.fifths)])]))
    }
    if (gm?.time) {
      children.push(
        el('time', gm.time.display ? { symbol: gm.time.display } : {}, [
          el('beats', {}, [String(gm.time.count ?? 4)]),
          el('beat-type', {}, [String(gm.time.unit ?? 4)]),
        ]),
      )
    }
    if (measureIdx === 0 && this.staffCount(part, measure) > 1) {
      children.push(el('staves', {}, [String(this.staffCount(part, measure))]))
    }
    for (const positioned of this.withDerivedClefStaffs(measure)) {
      const fraction = parseFraction(positioned.position?.fraction ?? [0, 1], 'clef position')
      if (compareFraction(fraction, new Fraction(0)) !== 0) continue
      children.push(this.clefElement(positioned))
    }
    return children.length > 0 ? el('attributes', {}, children) : null
  }

  private staffCount(part: MnxPart, measure: MnxPartMeasure): number {
    let max = part.staves ?? 1
    for (const positioned of this.withDerivedClefStaffs(measure))
      max = Math.max(max, positioned.staff ?? 1)
    for (const sequence of measure.sequences ?? []) max = Math.max(max, sequence.staff ?? 1)
    return max
  }

  private clefElement(positioned: MnxPositionedClef): XmlElement {
    const clef = requireValue(positioned.clef, 'positioned clef is missing its clef')
    const sign = requireValue(clef.sign, 'clef is missing a sign')
    const staffPosition = requireValue(clef.staffPosition, 'clef is missing a staffPosition')
    const children: XmlElement[] = [
      el('sign', {}, [sign]),
      el('line', {}, [String(clefLine(staffPosition, sign))]),
    ]
    if (clef.octave) children.push(el('clef-octave-change', {}, [String(clef.octave)]))
    return el(
      'clef',
      positioned.staff && positioned.staff > 1 ? { number: String(positioned.staff) } : {},
      children,
    )
  }

  private leftBarlineChildren(gm: MnxMeasureGlobal | null): XmlElement[] {
    const children: XmlElement[] = []
    if (gm?.repeatStart) children.push(el('repeat', { direction: 'forward' }))
    if (gm?.ending) children.push(this.endingElement('start', gm.ending))
    return children
  }

  private rightBarlineChildren(measureIdx: number, gm: MnxMeasureGlobal | null): XmlElement[] {
    const children: XmlElement[] = []
    if (gm?.barline?.type !== undefined) {
      const style = BARLINE_STYLES.get(gm.barline.type)
      if (style) children.push(el('bar-style', {}, [style]))
    }
    if (gm?.repeatEnd) {
      const times = gm.repeatEnd.times
      children.push(
        el(
          'repeat',
          times !== undefined && times > 2
            ? { direction: 'backward', times }
            : { direction: 'backward' },
        ),
      )
    }
    const close = this.endingCloses.get(measureIdx)
    if (close) children.push(this.endingElement(close.type, { numbers: close.numbers }))
    return children
  }

  private endingElement(type: string, ending: MnxEnding): XmlElement {
    const numbers = ending.numbers ?? []
    const attrs: Record<string, string> = { type }
    if (numbers.length > 0) attrs.number = numbers.join(',')
    return el('ending', attrs, numbers.length > 0 ? [numbers.join(', ')] : [])
  }

  /** Directions / mid-measure attributes that belong into the given sequence. */
  private positionedItems(
    measure: MnxPartMeasure,
    partIdx: number,
    measureIdx: number,
    seqIdx: number,
    gm: MnxMeasureGlobal | null,
  ): PositionedItem[] {
    const items: PositionedItem[] = []
    const sequences = measure.sequences ?? []
    const ownsTarget = (staff: number | undefined, voice: string | undefined): boolean => {
      if (staff !== undefined || voice !== undefined) {
        const sequence = sequences[seqIdx]
        return sequence?.staff === staff && (voice === undefined || sequence?.voice === voice)
      }
      return seqIdx === 0
    }

    for (const entry of this.ottavas[partIdx] ?? []) {
      const ottava = entry.ottava
      if (!ownsTarget(ottava.staff, ottava.voice)) continue
      if (entry.startMeasure === measureIdx) {
        const shift = OTTAVA_TO_MUSICXML.get(
          requireValue(ottava.value ?? null, 'ottava is missing a value'),
        )
        if (!shift) throw new Error(`unsupported ottava value ${String(ottava.value)}`)
        items.push({
          fraction: parseFraction(ottava.position?.fraction ?? [0, 1], 'ottava position'),
          order: 1,
          element: this.octaveShiftDirection(shift),
          inclusive: true,
        })
      }
      if (this.ottavaEndMeasure(ottava) === measureIdx) {
        items.push({
          fraction: parseFraction(ottava.end?.position?.fraction ?? [0, 1], 'ottava end'),
          order: 0,
          element: this.octaveShiftDirection({ type: 'stop' }),
          inclusive: false,
        })
      }
    }

    for (const positioned of this.withDerivedClefStaffs(measure)) {
      const fraction = parseFraction(positioned.position?.fraction ?? [0, 1], 'clef position')
      if (compareFraction(fraction, new Fraction(0)) === 0) continue
      if (!ownsTarget(positioned.staff, undefined)) continue
      items.push({
        fraction,
        order: 2,
        element: el('attributes', {}, [this.clefElement(positioned)]),
        inclusive: true,
      })
    }

    if (partIdx === 0 && seqIdx === 0) {
      for (const tempo of gm?.tempos ?? []) {
        items.push({
          fraction: parseFraction(tempo.location?.fraction ?? [0, 1], 'tempo location'),
          order: 3,
          element: this.tempoElement(tempo),
          inclusive: true,
        })
      }
    }
    return items
  }

  private ottavaEndMeasure(ottava: MnxOttava): number {
    const id = requireValue(ottava.end?.measure, 'ottava end is missing a measure id')
    const byId = this.globalMeasures.findIndex((gm) => gm.id === id)
    if (byId >= 0) return byId
    const match = /^m(\d+)$/.exec(id)
    if (match) {
      const index = parseInt(match[1], 10) - 1
      if (index >= 0 && index < this.globalMeasures.length) return index
    }
    throw new Error(`ottava end measure "${id}" not found`)
  }

  private octaveShiftDirection(shift: { type: string; size?: number }): XmlElement {
    return el('direction', { placement: 'above' }, [
      el('direction-type', {}, [
        el(
          'octave-shift',
          shift.size === undefined ? { type: shift.type } : { type: shift.type, size: shift.size },
        ),
      ]),
    ])
  }

  private tempoElement(tempo: MnxTempo): XmlElement {
    const bpm = requireValue(tempo.bpm ?? null, 'tempo is missing bpm')
    const baseName = requireValue(tempo.value?.base, 'tempo is missing a note value')
    const typeName = XML_TYPE_NAMES.get(baseName)
    if (!typeName) throw new Error(`tempo note-value base "${baseName}" has no MusicXML beat-unit`)
    const metronome: XmlElement[] = [el('beat-unit', {}, [typeName])]
    for (let i = 0; i < (tempo.value?.dots ?? 0); i++) metronome.push(el('beat-unit-dot'))
    metronome.push(el('per-minute', {}, [String(bpm)]))
    const quarterBpm =
      bpm * 4 * dotted(BASE_FRACTIONS.get(baseName) ?? new Fraction(1), tempo.value?.dots).valueOf()
    return el('direction', { placement: 'above' }, [
      el('direction-type', {}, [el('metronome', { parentheses: 'no' }, metronome)]),
      el('sound', { tempo: String(Math.round(quarterBpm * 1000) / 1000) }),
    ])
  }

  private emitSequence(
    sequence: MnxSequence,
    positioned: PositionedItem[],
    voiceOverride?: string,
  ): { elements: XmlElement[]; sounded: Fraction } {
    const elements: XmlElement[] = []
    const pending = [...positioned].sort(
      (a, b) => compareFraction(a.fraction, b.fraction) || a.order - b.order,
    )
    let cursor = new Fraction(0)
    const flush = (): void => {
      while (pending.length > 0) {
        const item = pending[0]
        const cmp = compareFraction(item.fraction, cursor)
        if (cmp > 0 || (cmp === 0 && !item.inclusive)) break
        elements.push(requireValue(pending.shift(), 'internal error: empty pending queue').element)
      }
    }
    const walk = (content: MnxContent[]): void => {
      for (const item of content) {
        flush()
        if (item.type === 'grace') {
          this.emitGraceElements(
            requireValue(item.content, 'grace content is missing'),
            elements,
            voiceOverride,
          )
          continue
        }
        if (item.type === 'tuplet') {
          cursor = cursor.add(this.emitTuplet(item, elements, voiceOverride))
          continue
        }
        if (item.type === 'space') {
          const frac = parseFraction(item.duration, 'space')
          if (compareFraction(frac, new Fraction(0)) > 0) {
            elements.push(el('forward', {}, [el('duration', {}, [String(this.durationOf(frac))])]))
            cursor = cursor.add(frac)
          }
          continue
        }
        const wrap = requireValue(
          this.wraps.find((candidate) => candidate.event === item),
          'internal error: event wrap missing during emission',
        )
        elements.push(...this.eventElements(wrap, voiceOverride))
        cursor = cursor.add(wrap.sounded)
      }
    }
    walk(sequence.content ?? [])
    flush()
    while (pending.length > 0) {
      elements.push(requireValue(pending.shift(), 'internal error: empty pending queue').element)
    }
    return { elements, sounded: cursor }
  }

  private emitTuplet(tuplet: MnxTuplet, elements: XmlElement[], voiceOverride?: string): Fraction {
    let sounded = new Fraction(0)
    const content = requireValue(tuplet.content, 'tuplet content is missing')
    for (const item of content) {
      if (item.type === 'grace') {
        this.emitGraceElements(
          requireValue(item.content, 'grace content is missing'),
          elements,
          voiceOverride,
        )
        continue
      }
      if (item.type === 'tuplet') {
        const nestedSounded = this.emitTuplet(item, elements, voiceOverride)
        sounded = sounded.add(nestedSounded)
        continue
      }
      if (item.type === 'space') {
        const frac = parseFraction(item.duration, 'space')
        if (compareFraction(frac, new Fraction(0)) > 0) {
          elements.push(el('forward', {}, [el('duration', {}, [String(this.durationOf(frac))])]))
          sounded = sounded.add(frac)
        }
        continue
      }
      const wrap = requireValue(
        this.wraps.find((candidate) => candidate.event === item),
        'internal error: tuplet event wrap missing during emission',
      )
      elements.push(...this.eventElements(wrap, voiceOverride))
      sounded = sounded.add(wrap.sounded)
    }
    return sounded
  }

  private emitGraceElements(
    content: MnxContent[],
    elements: XmlElement[],
    voiceOverride?: string,
  ): void {
    for (const item of content) {
      if (item.type !== undefined) {
        throw new Error(`grace content may only contain events, got "${item.type}"`)
      }
      const wrap = requireValue(
        this.wraps.find((candidate) => candidate.event === item && candidate.grace),
        'internal error: grace wrap missing during emission',
      )
      elements.push(...this.eventElements(wrap, voiceOverride))
    }
  }

  private eventElements(wrap: EventWrap, voiceOverride?: string): XmlElement[] {
    const event = wrap.event
    if (event.rest !== undefined && event.rest !== null) {
      return [this.noteElement(wrap, null, 0, voiceOverride)]
    }
    const notes = requireValue(event.notes, 'event has neither rest nor notes')
    return notes.map((note, noteIdx) => this.noteElement(wrap, note, noteIdx, voiceOverride))
  }

  private fifthsAt(measureIdx: number): number {
    let fifths = 0
    for (let i = 0; i <= measureIdx; i++) {
      const key = this.globalMeasures[i]?.key
      if (key?.fifths !== undefined) fifths = key.fifths
    }
    return fifths
  }

  private noteElement(
    wrap: EventWrap,
    note: MnxNote | null,
    noteIdx: number,
    voiceOverride?: string,
  ): XmlElement {
    const event = wrap.event
    const children: XmlElement[] = []
    if (wrap.grace) children.push(el('grace'))
    if (noteIdx > 0) children.push(el('chord'))
    if (note === null) {
      children.push(el('rest'))
    } else {
      const pitch = requireValue(note.pitch, 'note is missing a pitch')
      const pitchChildren: XmlElement[] = [
        el('step', {}, [requireValue(pitch.step, 'pitch is missing a step')]),
      ]
      if (pitch.alter) pitchChildren.push(el('alter', {}, [String(pitch.alter)]))
      pitchChildren.push(el('octave', {}, [String(pitch.octave ?? 4)]))
      children.push(el('pitch', {}, pitchChildren))
    }
    if (!wrap.grace) children.push(el('duration', {}, [String(this.durationOf(wrap.sounded))]))

    const marks = wrap.noteMarks[noteIdx] ?? emptyNoteMarks()
    if (marks.tieStop) children.push(el('tie', { type: 'stop' }))
    for (let i = 0; i < marks.tieStarts.length; i++) children.push(el('tie', { type: 'start' }))
    const voice = voiceOverride ?? wrap.voice
    if (voice !== undefined) children.push(el('voice', {}, [voice]))

    const duration = requireValue(event.duration, 'event is missing a duration')
    const typeName = XML_TYPE_NAMES.get(
      requireValue(duration.base, 'event duration is missing a base'),
    )
    if (typeName) {
      children.push(el('type', {}, [typeName]))
      for (let i = 0; i < (duration.dots ?? 0); i++) children.push(el('dot'))
    }
    if (note?.accidentalDisplay?.show) {
      const pitch = requireValue(note.pitch, 'note is missing a pitch')
      const step = requireValue(pitch.step, 'pitch is missing a step')
      children.push(
        el('accidental', {}, [accidentalGlyph(pitch.alter, this.fifthsAt(wrap.measureIdx), step)]),
      )
    }
    if (wrap.tuplets.length > 0) {
      const innermost = wrap.tuplets[wrap.tuplets.length - 1]
      const inner = requireValue(innermost.inner, 'tuplet is missing "inner"')
      const outer = requireValue(innermost.outer, 'tuplet is missing "outer"')
      const timeMod: XmlElement[] = [
        el('actual-notes', {}, [String(inner.multiple ?? 1)]),
        el('normal-notes', {}, [String(outer.multiple ?? 1)]),
      ]
      const normalBase = requireValue(outer.duration?.base, 'tuplet outer is missing a base')
      const normalType = XML_TYPE_NAMES.get(normalBase)
      if (normalType) {
        timeMod.push(el('normal-type', {}, [normalType]))
        for (let i = 0; i < (outer.duration?.dots ?? 0); i++) timeMod.push(el('normal-dot'))
      }
      children.push(el('time-modification', {}, timeMod))
    }
    if (wrap.staff !== undefined) children.push(el('staff', {}, [String(wrap.staff)]))

    const notations: XmlElement[] = []
    if (marks.tieStop) notations.push(el('tied', { type: 'stop' }))
    for (const tieStart of marks.tieStarts) {
      const attrs: Record<string, string> = { type: 'start' }
      if (tieStart.side === 'up') attrs.orientation = 'over'
      if (tieStart.side === 'down') attrs.orientation = 'under'
      notations.push(el('tied', attrs))
    }
    for (const slurStop of marks.slurStops) {
      notations.push(el('slur', { type: 'stop', number: String(slurStop.number) }))
    }
    for (const slurStart of marks.slurStarts) {
      const attrs: Record<string, string> = { type: 'start', number: String(slurStart.number) }
      if (slurStart.placement === 'up') attrs.placement = 'above'
      if (slurStart.placement === 'down') attrs.placement = 'below'
      notations.push(el('slur', attrs))
    }
    for (const depth of wrap.bracketStart)
      notations.push(el('tuplet', { number: String(depth), type: 'start' }))
    for (const depth of wrap.bracketStop)
      notations.push(el('tuplet', { number: String(depth), type: 'stop' }))
    if (noteIdx === 0 && event.markings) {
      const markings = event.markings
      const articulations: XmlElement[] = []
      if (markings.accent) articulations.push(el('accent'))
      if (markings.strongAccent) articulations.push(el('strong-accent'))
      if (markings.staccato) articulations.push(el('staccato'))
      if (markings.tenuto) articulations.push(el('tenuto'))
      if (markings.staccatissimo) articulations.push(el('staccatissimo'))
      if (markings.spiccato) articulations.push(el('spiccato'))
      if (markings.softAccent) articulations.push(el('soft-accent'))
      if (markings.stress) articulations.push(el('stress'))
      if (markings.unstress) articulations.push(el('unstress'))
      if (markings.breath) articulations.push(el('breath-mark'))
      if (articulations.length > 0) notations.push(el('articulations', {}, articulations))
      if (markings.tremolo?.marks) {
        notations.push(el('ornaments', {}, [el('tremolo', {}, [String(markings.tremolo.marks)])]))
      }
      if (event.fermata) notations.push(el('fermata'))
    }
    if (notations.length > 0) children.push(el('notations', {}, notations))

    for (const [lineId, line] of Object.entries(event.lyrics?.lines ?? {})) {
      const text = requireValue(line.text ?? null, 'lyric line is missing text')
      children.push(
        el('lyric', { number: lineId }, [
          el('syllabic', {}, [LYRIC_SYLLABIC.get(line.type ?? 'whole') ?? 'single']),
          el('text', {}, [text]),
        ]),
      )
    }
    return el('note', {}, children)
  }
}
