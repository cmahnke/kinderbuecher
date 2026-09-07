/**
 * mnx2musicxml — converts MNX JSON documents to MusicXML (score-partwise).
 *
 * Public API:
 *   getMusicXmlFromMnx(mnx) -> MusicXML string
 */

export { getMusicXmlFromMnx } from './src/converter'
export type {
  MnxContent,
  MnxDocument,
  MnxEnding,
  MnxEvent,
  MnxGlobal,
  MnxMeasureGlobal,
  MnxNote,
  MnxPart,
  MnxPartMeasure,
  MnxSequence,
  MnxTempo,
  MnxTime,
  MnxTuplet,
} from './src/mnx-types'
