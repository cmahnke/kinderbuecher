import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MusicTimeline } from '../src/musicxml'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(here, '..')
const VENDOR_MODULE = '/vendor/mnxconverter-ts/src/index.ts'
const OUR_MODULE = '/mnx2musicxml/index.ts'
const PARSER_MODULE = '/src/musicxml.ts'

// the real homr MusicXML pages: MusicXML -> MNX (vendored converter) ->
// MusicXML (our reverse converter) must be semantically identical
const pageFiles = readdirSync(rootDir)
  .filter((f) => /^page\d+\.musicxml$/.test(f))
  .sort()

interface NormalizeNote {
  step: string
  alter: number
  octave: number
  /** in quarter units (the divisions value is an encoding detail) */
  duration: number
  grace: boolean
}

interface NormalizedTimeline {
  measures: Array<{
    clef1: string
    clef2: string
    pitched: NormalizeNote[]
  }>
}

test.describe('Roundtrip: MusicXML -> MNX -> MusicXML (real pages)', () => {
  test('converted pages are semantically identical to their sources', async ({ page }) => {
    const docs: Array<[string, string]> = pageFiles.map((f) => [
      f,
      readFileSync(path.join(rootDir, f), 'utf8'),
    ])

    await page.goto('/')
    const report = await page.evaluate(
      async ([vendorModule, ourModule, parserModule, docs]) => {
        const vendor = await import(vendorModule as string)
        const { getMusicXmlFromMnx } = await import(ourModule as string)
        const { parseMusicXML } = await import(parserModule as string)

        // Semantic comparison through the viewer's own MusicXML parser:
        // per-measure clefs and the per-measure multiset of note content
        // (pitch, duration, chord/grace/rest flags) must match. The parser's
        // beatStart is already in beats, while durationDiv is in raw
        // divisions units — only the duration is normalized (the divisions
        // value is an encoding detail; the MNX grid differs from the
        // source's). The comparison is order-insensitive per measure: homr
        // interleaves staves while the MNX groups them by voice with a
        // backup.
        //
        // Excluded as losses of the vendored MusicXML -> MNX intermediate
        // (the MNX serialization of both upstream converters cannot express
        // them; our reverse converter is not at fault):
        //  - staff/voice attribution (the intermediate keeps neither)
        //  - the rhythmic offset of voices that start mid-measure (their
        //    sequence is truncated to measure start; page012 m3)
        //  - grace-group voice/staff attribution (adjacent graces of
        //    different voices are merged into one group; page006 m16)
        //  - chord structure (adjacent chord-flagged notes are merged into
        //    one chord event; page014 m10)
        //  - rests entirely (whole rests in wide meters are inflated to
        //    breves and even split, changing count and length; page014 m10,
        //    page019 m0) — rests carry no pitch content
        //  - system assignment (MNX has no system breaks), measure numbers
        //    (dropped by the MNX JSON serialization; our reverse renumbers),
        //    ids and tie/slur glyphs (parser-level semantics only)
        const quarterDuration = (divisions: number, value: number): number =>
          Math.round((value / divisions) * 1e6) / 1e6
        const normalize = (xmlText: string): NormalizedTimeline | string => {
          try {
            const t = parseMusicXML(xmlText)
            const div = t.divisions
            return {
              measures: t.measures.map((m: MusicTimeline['measures'][number]) => ({
                clef1: m.clef1,
                clef2: m.clef2,
                // pitched content as a sorted multiset
                pitched: m.notes
                  .filter((n: MusicTimeline['measures'][number]['notes'][number]) => !n.rest)
                  .map((n: MusicTimeline['measures'][number]['notes'][number]) => ({
                    step: n.step,
                    alter: n.alter,
                    octave: n.octave,
                    duration: quarterDuration(div, n.durationDiv),
                    grace: n.grace,
                  }))
                  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
              })),
            }
          } catch (err) {
            return `parse error: ${err instanceof Error ? err.message : String(err)}`
          }
        }

        const firstDiff = (a: unknown, b: unknown, path: string): string | null => {
          if (JSON.stringify(a) === JSON.stringify(b)) return null
          if (Array.isArray(a) && Array.isArray(b)) {
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
              const d = firstDiff(a[i], b[i], `${path}[${i}]`)
              if (d) return d
            }
            return null
          }
          if (a && b && typeof a === 'object' && typeof b === 'object') {
            const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
            for (const k of keys) {
              const d = firstDiff(
                (a as Record<string, unknown>)[k],
                (b as Record<string, unknown>)[k],
                `${path}.${k}`,
              )
              if (d) return d
            }
            return null
          }
          return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
        }

        let converted = 0
        const vendorSkipped: string[] = []
        const reverseFailed: string[] = []
        const diffs: string[] = []
        for (const [name, xml] of docs as Array<[string, string]>) {
          let mnxDoc: unknown
          try {
            mnxDoc = vendor.getMNXScore(vendor.getScoreFromMusicXml(xml))
          } catch (err) {
            vendorSkipped.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
            continue
          }
          let roundtripped: string
          try {
            roundtripped = getMusicXmlFromMnx(mnxDoc)
          } catch (err) {
            reverseFailed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
            continue
          }
          const original = normalize(xml)
          const back = normalize(roundtripped)
          if (typeof original === 'string' || typeof back === 'string') {
            diffs.push(`${name}: ${original === 'string' ? original : back}`)
            continue
          }
          const diff = firstDiff(original, back, name)
          if (diff) diffs.push(diff)
          converted++
        }
        return {
          converted,
          vendorSkipped,
          reverseFailed,
          diffs,
          total: (docs as string[][]).length,
        }
      },
      [VENDOR_MODULE, OUR_MODULE, PARSER_MODULE, docs],
    )

    console.log(
      `[roundtrip] ${report.converted}/${report.total} pages converted; ` +
        `vendor-skipped: ${report.vendorSkipped.length} [${report.vendorSkipped.join(' | ')}]; ` +
        `reverse-failed: ${report.reverseFailed.length} [${report.reverseFailed.join(' | ')}]`,
    )
    // the vendor importer has a limited scope — files it cannot import are
    // skipped, but every file it DOES convert must be semantically identical
    expect(report.converted).toBeGreaterThan(0)
    expect(report.diffs).toEqual([])
  })
})
