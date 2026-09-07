import { test, expect, type Page } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(here, 'fixtures')
const rootDir = path.join(here, '..', '..')
const MNX2_MODULE = '/mnx2musicxml/index.ts'
const VENDOR_MODULE = '/vendor/mnxconverter-ts/src/index.ts'

const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.mnx'))
  .map((f) => f.slice(0, -'.mnx'.length))
  .sort()

async function mnxToMusicXml(page: Page, mnx: unknown): Promise<string> {
  return page.evaluate(
    async ([moduleUrl, doc]) => {
      const m = await import(moduleUrl as string)
      return m.getMusicXmlFromMnx(doc) as string
    },
    [MNX2_MODULE, mnx],
  )
}

async function musicXmlToMnx(page: Page, xml: string): Promise<unknown> {
  return page.evaluate(
    async ([moduleUrl, xmlString]) => {
      const m = await import(moduleUrl as string)
      return m.getMNXScore(m.getScoreFromMusicXml(xmlString))
    },
    [VENDOR_MODULE, xml],
  )
}

/**
 * Event/note ids and tie/slur targets are assigned freshly by the forward
 * converter and cannot be preserved across a round-trip, so they are stripped
 * before comparing MNX documents.
 */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id' || key === 'target' || key === 'startNote' || key === 'endNote') continue
      out[key] = stripIds(child)
    }
    return out
  }
  return value
}

test.describe('MNX -> MusicXML (mnx2musicxml)', () => {
  test('module loads in the browser', async ({ page }) => {
    await page.goto('/')
    const exported = await page.evaluate(async (moduleUrl) => {
      const m = await import(moduleUrl as string)
      return Object.keys(m).sort()
    }, MNX2_MODULE)
    expect(exported).toContain('getMusicXmlFromMnx')
  })

  for (const name of fixtures) {
    test(`${name}: MNX -> MusicXML -> MNX round-trip`, async ({ page }) => {
      await page.goto('/')
      const mnx = JSON.parse(readFileSync(path.join(fixturesDir, `${name}.mnx`), 'utf8'))
      const xml = await mnxToMusicXml(page, mnx)
      expect(xml).toContain('<score-partwise')
      const roundTrip = await musicXmlToMnx(page, xml)
      expect(stripIds(roundTrip)).toEqual(stripIds(mnx))
    })
  }

  test('page006 homr output round-trips', async ({ page }) => {
    const xmlPath = path.join(rootDir, 'page006.musicxml')
    test.skip(!existsSync(xmlPath), 'generated artefacts not present')
    await page.goto('/')
    const mnx = await musicXmlToMnx(page, readFileSync(xmlPath, 'utf8'))
    const xml = await mnxToMusicXml(page, mnx)
    const roundTrip = await musicXmlToMnx(page, xml)
    expect(stripIds(roundTrip)).toEqual(stripIds(mnx))
  })

  test('converted fixtures and edge cases render in OSMD without errors', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(
      async ([osmdUrl, m2xUrl]) => {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = osmdUrl as string
          s.onload = resolve
          s.onerror = reject
          document.head.appendChild(s)
        })
        const w = window as unknown as Record<string, unknown>
        w.__m2x = await import(m2xUrl as string /* @vite-ignore */)
      },
      [
        '/node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js',
        '/mnx2musicxml/index.ts',
      ],
    )
    const edgeCases: Record<string, unknown> = {
      // part measure with no sequences: OSMD must not choke on an empty measure
      emptyMeasure: {
        global: { measures: [{ time: { count: 4, unit: 4 } }, { time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                sequences: [
                  {
                    content: [
                      { duration: { base: 'whole' }, notes: [{ pitch: { step: 'C', octave: 4 } }] },
                    ],
                  },
                ],
              },
              { sequences: [] },
            ],
          },
        ],
      },
      // maxima/duplexMaxima carry no <type>: OSMD must derive the duration
      maxima: {
        global: { measures: [{ time: { count: 8, unit: 1 } }] },
        parts: [
          {
            measures: [
              {
                sequences: [
                  {
                    content: [
                      {
                        duration: { base: 'maxima' },
                        notes: [{ pitch: { step: 'C', octave: 4 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      // multiple voice-less sequences: OSMD must render two aligned voices
      twoVoicelessSequences: {
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                sequences: [
                  {
                    content: [
                      { duration: { base: 'half' }, notes: [{ pitch: { step: 'C', octave: 4 } }] },
                      { duration: { base: 'half' }, notes: [{ pitch: { step: 'D', octave: 4 } }] },
                    ],
                  },
                  {
                    content: [
                      { duration: { base: 'half' }, notes: [{ pitch: { step: 'E', octave: 3 } }] },
                      { duration: { base: 'half' }, notes: [{ pitch: { step: 'G', octave: 3 } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }
    const docs: Array<[string, unknown]> = fixtures.map((name) => [
      name,
      JSON.parse(readFileSync(path.join(fixturesDir, `${name}.mnx`), 'utf8')),
    ])
    docs.push(...Object.entries(edgeCases))
    const failures = await page.evaluate(async (docs) => {
      const w = window as unknown as {
        __m2x: { getMusicXmlFromMnx: (doc: unknown) => string }
        opensheetmusicdisplay: {
          OpenSheetMusicDisplay: new (
            host: HTMLElement,
            opts: object,
          ) => { load: (xml: string) => Promise<void>; render: () => void }
        }
      }
      const OSMD = w.opensheetmusicdisplay.OpenSheetMusicDisplay
      const failures: string[] = []
      for (const [name, mnxDoc] of docs as Array<[string, unknown]>) {
        try {
          const xml = w.__m2x.getMusicXmlFromMnx(mnxDoc)
          const host = document.createElement('div')
          host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1200px;'
          document.body.appendChild(host)
          const osmd = new OSMD(host, { autoResize: false })
          await osmd.load(xml)
          osmd.render()
          host.remove()
        } catch (error) {
          failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return failures
    }, docs)
    expect(failures).toEqual([])
  })

  test('throws on a dangling tie target', async ({ page }) => {
    await page.goto('/')
    const mnx = {
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      duration: { base: 'whole' },
                      notes: [{ pitch: { step: 'C', octave: 4 }, ties: [{ target: 'note999' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    await expect(mnxToMusicXml(page, mnx)).rejects.toThrow(/tie target/)
  })

  test('double-dotted durations round-trip exactly', async ({ page }) => {
    await page.goto('/')
    // 1.75 (double-dotted quarter) + 0.25 (16th) = one 4/4 half; the double
    // dot used to compound as (3/2)^2 = 2.25 instead of 2 - 1/4 = 1.75
    const mnx = {
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      duration: { base: 'quarter', dots: 2 },
                      notes: [{ pitch: { step: 'G', octave: 4 } }],
                    },
                    {
                      duration: { base: '16th' },
                      notes: [{ pitch: { step: 'G', octave: 4 } }],
                    },
                    { duration: { base: 'half' }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const xml = await mnxToMusicXml(page, mnx)
    const round = (await musicXmlToMnx(page, xml)) as {
      parts: Array<{
        measures: Array<{
          sequences: Array<{ content: Array<{ duration?: { base?: string; dots?: number } }> }>
        }>
      }>
    }
    const content = round.parts[0].measures[0].sequences[0].content
    expect(content[0].duration).toEqual({ base: 'quarter', dots: 2 })
    expect(content[1].duration).toEqual({ base: '16th' })
    expect(content[2].duration).toEqual({ base: 'half' })
  })
})
