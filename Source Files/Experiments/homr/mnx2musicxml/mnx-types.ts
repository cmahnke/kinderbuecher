/**
 * Structural input types for the MNX documents this converter consumes. They
 * cover the subset of the MNX JSON schema that `getMusicXmlFromMnx` maps to
 * MusicXML; every field is optional so documents carrying additional
 * (ignored) MNX data still type-check.
 */

export interface MnxPitch {
  step?: string
  octave?: number
  alter?: number
}

export interface MnxNoteValue {
  base?: string
  dots?: number
}

export interface MnxTie {
  target?: string
  side?: string
  lv?: boolean
}

export interface MnxSlur {
  target?: string
  startNote?: string
  endNote?: string
  side?: string
  lineType?: string
}

export interface MnxNote {
  id?: string
  pitch?: MnxPitch
  staff?: number
  ties?: MnxTie[]
  accidentalDisplay?: { show?: boolean } | null
}

export interface MnxEventMarkings {
  accent?: unknown
  strongAccent?: unknown
  staccato?: unknown
  tenuto?: unknown
  staccatissimo?: unknown
  spiccato?: unknown
  softAccent?: unknown
  stress?: unknown
  unstress?: unknown
  breath?: { symbol?: string } | null
  tremolo?: { marks?: number } | null
}

export interface MnxLyricLine {
  text?: string
  type?: string
}

export interface MnxLyrics {
  lines?: Record<string, MnxLyricLine>
}

export interface MnxEvent {
  type?: 'event'
  id?: string
  duration?: MnxNoteValue
  rest?: Record<string, unknown> | null
  notes?: MnxNote[]
  slurs?: MnxSlur[]
  markings?: MnxEventMarkings | null
  lyrics?: MnxLyrics | null
  fermata?: Record<string, unknown> | null
}

export interface MnxNoteValueQuantity {
  multiple?: number
  duration?: MnxNoteValue
}

export interface MnxTuplet {
  type: 'tuplet'
  id?: string
  inner?: MnxNoteValueQuantity
  outer?: MnxNoteValueQuantity
  content?: MnxContent[]
}

export interface MnxGrace {
  type: 'grace'
  id?: string
  content?: MnxContent[]
  slash?: boolean
}

export interface MnxSpace {
  type: 'space'
  id?: string
  duration?: [number, number]
}

export interface MnxMultiNoteTremolo {
  type: 'tremolo'
  id?: string
  content?: MnxContent[]
  marks?: number
}

export type MnxContent = MnxEvent | MnxTuplet | MnxGrace | MnxSpace | MnxMultiNoteTremolo

export interface MnxSequence {
  content?: MnxContent[]
  voice?: string
  staff?: number
}

export interface MnxClef {
  sign?: string
  staffPosition?: number
  octave?: number
  showOctave?: boolean
}

export interface MnxPositionedClef {
  clef?: MnxClef
  position?: { fraction?: [number, number] } | null
  staff?: number
}

export interface MnxOttava {
  position?: { fraction?: [number, number] } | null
  end?: { measure?: string; position?: { fraction?: [number, number] } | null } | null
  value?: number
  staff?: number
  voice?: string
}

export interface MnxPartMeasure {
  sequences?: MnxSequence[]
  clefs?: MnxPositionedClef[]
  ottavas?: MnxOttava[]
}

export interface MnxPart {
  measures?: MnxPartMeasure[]
  name?: string
  shortName?: string
  staves?: number
}

export interface MnxTime {
  count?: number
  unit?: number
  display?: string
}

export interface MnxEnding {
  duration?: number
  numbers?: number[]
  open?: boolean
}

export interface MnxTempo {
  bpm?: number
  value?: MnxNoteValue
  location?: { fraction?: [number, number] } | null
}

export interface MnxMeasureGlobal {
  id?: string
  number?: number
  time?: MnxTime | null
  key?: { fifths?: number } | null
  repeatStart?: Record<string, unknown> | null
  repeatEnd?: { times?: number } | null
  ending?: MnxEnding | null
  barline?: { type?: string } | null
  tempos?: MnxTempo[]
}

export interface MnxGlobal {
  measures?: MnxMeasureGlobal[]
}

export interface MnxDocument {
  mnx?: { version?: number } | null
  global?: MnxGlobal | null
  parts?: MnxPart[]
}
