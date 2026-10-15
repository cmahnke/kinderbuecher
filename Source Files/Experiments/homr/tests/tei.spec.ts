import { test, expect, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(here, '..')
const TEI_MODULE = '/src/tei.ts'
const PARSER_MODULE = '/src/musicxml.ts'

interface ParsedTei {
  staves: Array<{
    bbox: [number, number, number, number]
    lineCount: number
    grid: Array<{ x: number; y: number[] }>
  }>
  musicxmlText: string
}

async function parseTei(page: Page, teiText: string): Promise<ParsedTei | null> {
  return page.evaluate(
    async ([moduleUrl, text]) => {
      const m = await import(moduleUrl as string)
      return (m.parseTei(text as string) ?? null) as ParsedTei | null
    },
    [TEI_MODULE, teiText],
  )
}

test.describe('TEI page wrapper (src/tei.ts)', () => {
  test('module loads in the browser', async ({ page }) => {
    await page.goto('/')
    const exported = await page.evaluate(async (moduleUrl) => {
      const m = await import(moduleUrl as string)
      return Object.keys(m).sort()
    }, TEI_MODULE)
    expect(exported).toContain('parseTei')
  })

  test('page006 TEI parses to the results.json staff geometry', async ({ page }) => {
    const teiPath = path.join(rootDir, 'public', 'tei', 'page006.tei.xml')
    const resultsPath = path.join(rootDir, 'data', 'results.json')
    test.skip(!existsSync(teiPath) || !existsSync(resultsPath), 'generated artefacts not present')
    await page.goto('/')

    const parsed = await parseTei(page, readFileSync(teiPath, 'utf8'))
    expect(parsed).not.toBeNull()
    const expected = (
      JSON.parse(readFileSync(resultsPath, 'utf8')) as {
        pages: Array<{
          image: string
          staves: Array<{ bbox: number[]; grid: Array<{ x: number; y: number[] }> }>
        }>
      }
    ).pages.find((p) => p.image === 'page006.jpg')?.staves
    expect(expected).toBeTruthy()

    // one StaffEntry per zone, bboxes verbatim
    expect(parsed!.staves).toHaveLength(expected!.length)
    for (const [i, staff] of parsed!.staves.entries()) {
      expect(staff.bbox).toEqual(expected![i].bbox)
      // the <path> polylines regroup losslessly into grid samples
      expect(staff.grid.length).toBeGreaterThan(0)
      const sample = staff.grid[0]
      expect(sample.y).toHaveLength(expected![i].grid[0].y.length)
      expect(sample.x).toBe(expected![i].grid[0].x)
      expect(sample.y).toEqual(expected![i].grid[0].y)
      for (const point of staff.grid) {
        expect(point.y).toHaveLength(sample.y.length)
      }
    }
  })

  test('embedded MusicXML extracts as a standalone, playable document', async ({ page }) => {
    const teiPath = path.join(rootDir, 'public', 'tei', 'page006.tei.xml')
    test.skip(!existsSync(teiPath), 'generated artefacts not present')
    await page.goto('/')

    const parsed = await parseTei(page, readFileSync(teiPath, 'utf8'))
    expect(parsed).not.toBeNull()
    expect(parsed!.musicxmlText).toContain('<score-partwise')
    expect(parsed!.musicxmlText).not.toContain('http://www.tei-c.org/ns/1.0')

    // the extracted XML re-parses cleanly and feeds the playback parser
    const timeline = await page.evaluate(
      async ([parserUrl, xml]) => {
        const m = await import(parserUrl as string)
        return m.parseMusicXML(xml as string) as { notes: unknown[] }
      },
      [PARSER_MODULE, parsed!.musicxmlText],
    )
    expect(timeline.notes.length).toBeGreaterThan(0)
  })

  test('documents without staff geometry or score return null', async ({ page }) => {
    await page.goto('/')
    const empty = await parseTei(
      page,
      '<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>t</title></titleStmt><publicationStmt><p>x</p></publicationStmt><sourceDesc><p>x</p></sourceDesc></fileDesc></teiHeader><text><body><div type="score"/></body></text></TEI>',
    )
    expect(empty).toBeNull()
    const malformed = await parseTei(page, 'not xml at all')
    expect(malformed).toBeNull()
  })
})
