import { test, expect, type Page } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(here, 'fixtures', 'mnx')
const rootDir = path.join(here, '..')
const VENDOR_MODULE = '/vendor/mnxconverter-ts/src/index.ts'

const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.musicxml'))
  .map((f) => f.slice(0, -'.musicxml'.length))
  .sort()

async function convertMusicXmlToMnx(page: Page, xml: string): Promise<unknown> {
  return page.evaluate(
    async ([moduleUrl, xmlString]) => {
      const m = await import(moduleUrl as string)
      return m.getMNXScore(m.getScoreFromMusicXml(xmlString))
    },
    [VENDOR_MODULE, xml],
  )
}

test.describe('MNX: MusicXML -> MNX (vendored mnxconverter-ts)', () => {
  test('vendor module loads in the browser', async ({ page }) => {
    await page.goto('/')
    const exported = await page.evaluate(async (moduleUrl) => {
      const m = await import(moduleUrl as string)
      return Object.keys(m).sort()
    }, VENDOR_MODULE)
    expect(exported).toContain('getScoreFromMusicXml')
    expect(exported).toContain('getMNXScore')
  })

  for (const name of fixtures) {
    test(`${name} matches expected .mnx fixture`, async ({ page }) => {
      await page.goto('/')
      const xml = readFileSync(path.join(fixturesDir, `${name}.musicxml`), 'utf8')
      const expected = JSON.parse(readFileSync(path.join(fixturesDir, `${name}.mnx`), 'utf8'))
      const actual = await convertMusicXmlToMnx(page, xml)
      expect(actual).toEqual(expected)
    })
  }
})

const BASE_BEATS: Record<string, number> = {
  duplexMaxima: 64,
  maxima: 32,
  longa: 16,
  breve: 8,
  whole: 1,
  half: 0.5,
  quarter: 0.25,
  eighth: 0.125,
  '16th': 0.0625,
  '32nd': 0.03125,
  '64th': 0.015625,
  '128th': 0.0078125,
  '256th': 0.00390625,
  '512th': 0.001953125,
  '1024th': 0.0009765625,
}

interface ExtractedPitch {
  step: string
  octave: number
  alter: number
}

interface ExtractedEvent {
  t: 'note' | 'rest'
  d: number
  p?: ExtractedPitch
}

interface ExtractedMnx {
  partCount: number
  parts: ExtractedEvent[][][]
  tempo: unknown
  times: unknown[]
}

function beatsOf(duration: { base?: string; dots?: number }): number {
  const base = BASE_BEATS[duration.base ?? '']
  if (base === undefined) throw new Error(`unknown note-value base: ${String(duration.base)}`)
  const dots = duration.dots ?? 0
  return base * (2 - Math.pow(0.5, dots))
}

interface MnxPitchLike {
  step?: string
  octave?: number
  alter?: number
}

interface MnxNoteLike {
  pitch?: MnxPitchLike
}

interface MnxEventLike {
  type?: string
  duration?: { base?: string; dots?: number }
  rest?: unknown
  notes?: MnxNoteLike[]
  content?: MnxEventLike[]
}

interface MnxDocLike {
  parts?: Array<{ measures?: Array<{ sequences?: Array<{ content?: MnxEventLike[] }> }> }>
  global?: { tempo?: unknown; measures?: Array<{ time?: unknown }> }
}

function expandEvent(ev: MnxEventLike): ExtractedEvent[] {
  if (ev.type === 'grace' || Array.isArray(ev.content)) {
    return (ev.content ?? []).flatMap(expandEvent)
  }
  const d = beatsOf(ev.duration ?? {})
  if (ev.rest) return [{ t: 'rest', d }]
  return (ev.notes ?? []).map((n): ExtractedEvent => ({
    t: 'note',
    d,
    p: {
      step: n.pitch?.step ?? '',
      octave: n.pitch?.octave ?? 0,
      alter: n.pitch?.alter ?? 0,
    },
  }))
}

function extractEvents(mnx: MnxDocLike): ExtractedMnx {
  return {
    partCount: mnx.parts?.length ?? 0,
    parts: (mnx.parts ?? []).map((part) =>
      (part.measures ?? []).map((measure) =>
        (measure.sequences ?? []).flatMap((seq) => (seq.content ?? []).flatMap(expandEvent)),
      ),
    ),
    tempo: mnx.global?.tempo ?? null,
    times: (mnx.global?.measures ?? []).map((m) => m.time ?? null),
  }
}

test.describe('MNX: cross-check on real homr output', () => {
  test('page006: TS converter agrees with the Python converter', async ({ page }) => {
    const xmlPath = path.join(rootDir, 'page006.musicxml')
    const pyMnxPath = path.join(rootDir, 'page006.mnx')
    test.skip(!existsSync(xmlPath) || !existsSync(pyMnxPath), 'generated artefacts not present')

    await page.goto('/')
    const xml = readFileSync(xmlPath, 'utf8')
    const pythonMnx = JSON.parse(readFileSync(pyMnxPath, 'utf8'))
    const tsMnx = await convertMusicXmlToMnx(page, xml)

    expect((tsMnx as { parts?: unknown[] }).parts?.length).toBeGreaterThan(0)
    expect(extractEvents(tsMnx as MnxDocLike)).toEqual(extractEvents(pythonMnx as MnxDocLike))
  })
})
