import { test, expect } from '@playwright/test'

test.describe('Score Page Viewer', () => {
  test('loads without console errors or 404s', async ({ page }) => {
    const errors: string[] = []
    const notFound: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('ERR_CONTENT_LENGTH_MISMATCH')) {
        errors.push(msg.text())
      }
    })
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('response', (resp) => {
      if (resp.status() === 404 && !resp.url().includes('favicon.svg')) notFound.push(resp.url())
    })

    await page.goto('/')
    await expect(page.locator('h1')).toContainText('Score Page Viewer')
    await expect(page.locator('.thumb').first()).toBeVisible({ timeout: 10000 })

    expect(errors).toEqual([])
    expect(notFound).toEqual([])
  })

  test('displays correct page count', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('header p')).toContainText('36 of 50 pages contain scores')
  })

  test('shows thumbnails grid with score and no-score markers', async ({ page }) => {
    await page.goto('/')
    const grid = page.locator('#grid')
    await expect(grid).toBeVisible()
    const thumbnails = page.locator('.thumb')
    await expect(thumbnails).toHaveCount(50)
    const scoreThumbs = page.locator('.thumb.score')
    await expect(scoreThumbs).toHaveCount(36)
    const noScoreThumbs = page.locator('.thumb.no-score')
    await expect(noScoreThumbs).toHaveCount(14)
    // badges only for score pages with staves
    const badges = page.locator('.thumb .badge')
    await expect(badges).toHaveCount(36)
    await expect(badges.first()).toContainText(/staff/)
    // the sidebar takes 30% of the container width, the detail view the rest
    const ratio = await page.evaluate(() => {
      const sidebar = document.querySelector('#grid')
      const container = document.querySelector('.container')
      if (!sidebar || !container) return NaN
      return sidebar.getBoundingClientRect().width / container.getBoundingClientRect().width
    })
    expect(ratio).toBeGreaterThan(0.28)
    expect(ratio).toBeLessThan(0.32)
  })

  test('clicking thumbnail shows detail with staff overlay', async ({ page }) => {
    await page.goto('/')
    // click first score thumbnail (should be page006 after sorting by filename)
    const scoreThumb = page.locator('.thumb.score').first()
    await expect(scoreThumb).toBeVisible()
    await scoreThumb.click()
    const detail = page.locator('#detail')
    await expect(detail.locator('h2')).toBeVisible()
    // OpenSeadragon renders the IIIF image into a canvas
    await expect(detail.locator('.detail-image canvas').first()).toBeVisible()
    // overlay SVG should exist for score pages (the highlight layer only —
    // the score overlay also carries the staff-overlay class)
    const overlay = detail.locator('svg.staff-overlay:not(.score-overlay)')
    await expect(overlay).toBeVisible()
    const rects = overlay.locator('rect')
    // page006 has 3 staves after dedup
    await expect(rects).toHaveCount(3)
    // detail info (first .detail-info holds resolution)
    await expect(detail.locator('.detail-info').first()).toContainText('Resolution')
    await expect(detail.locator('.detail-info').first()).toContainText('Staves: 3')
    await expect(detail.locator('.detail-info').first()).toContainText('Confidence')
  })

  test('detail for score page shows MusicXML link', async ({ page }) => {
    await page.goto('/')
    const scoreThumb = page.locator('.thumb.score').first()
    await scoreThumb.click()
    const detail = page.locator('#detail')
    const link = detail.locator('a[href$=".musicxml"]')
    await expect(link).toBeVisible()
    await expect(link).toContainText('.musicxml')
  })

  test('score page renders player with controls and scan highlights', async ({ page }) => {
    await page.goto('/')
    const scoreThumb = page.locator('.thumb.score').first()
    await scoreThumb.click()
    // OSMD renders the score into per-system SVGs nested in the overlay (the
    // OSMD source svg itself lives in <defs> and must not match)
    const score = page.locator('.score-overlay > svg').first()
    await expect(score).toBeVisible({ timeout: 30000 })
    await expect(page.locator('.player-btn').first()).toHaveText('Play')
    // staff + note highlight layers are added to the scan overlay when
    // playing. NB: the *computed* visibility must be checked — a CSS
    // visibility rule would silently override the visibility ATTRIBUTE and
    // hide the layers without failing attribute assertions.
    await page.locator('.player-btn').first().click()
    await expect(page.locator('.staff-current')).toHaveAttribute('visibility', 'visible')
    await expect(page.locator('.staff-current')).toHaveCSS('visibility', 'visible')
    await expect(page.locator('.note-marker')).toHaveAttribute('visibility', 'visible')
    await expect(page.locator('.note-marker')).toHaveCSS('visibility', 'visible')
    await expect(page.locator('.play-pos')).toHaveAttribute('visibility', 'visible')
    await expect(page.locator('.play-pos')).toHaveCSS('visibility', 'visible')
  })

  test('detail for non-score page shows no overlay', async ({ page }) => {
    await page.goto('/')
    const noScoreThumb = page.locator('.thumb.no-score').first()
    await noScoreThumb.click()
    const detail = page.locator('#detail')
    await expect(detail.locator('h2')).toBeVisible()
    await expect(detail.locator('.detail-image canvas').first()).toBeVisible()
    await expect(detail.locator('.staff-overlay')).toHaveCount(0)
    await expect(detail).toContainText('No staves detected')
  })

  test('page008 has multiple staff overlay (homr detection)', async ({ page }) => {
    await page.goto('/')
    const thumb = page.locator('.thumb').filter({ hasText: 'page008' })
    await thumb.click()
    const rects = page.locator('#detail svg.staff-overlay:not(.score-overlay) rect')
    await expect(rects).toHaveCount(3)
  })

  test('keyboard activation via Enter', async ({ page }) => {
    await page.goto('/')
    const thumb = page.locator('.thumb.score').first()
    await thumb.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#detail h2')).toBeVisible()
    await expect(page.locator('#detail svg.staff-overlay:not(.score-overlay)')).toBeVisible()
  })

  test('overview grid shows generated thumbnails and all of them load', async ({ page }) => {
    await page.goto('/')
    const imgs = page.locator('.thumb img')
    await expect(imgs).toHaveCount(50)
    await expect(imgs.first()).toHaveAttribute('src', /^\/\w+\/full\/\d+,\/0\/default\.jpg$/)
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLImageElement>('.thumb img')).every(
              (img) => img.complete && img.naturalWidth > 0,
            ),
          ),
        { timeout: 15000 },
      )
      .toBe(true)
    await expect(page.locator('.thumb-fallback')).toHaveCount(0)
  })

  test('note marker is sized proportionally to the detected staff geometry', async ({ page }) => {
    const manifest = (await (await page.request.get('/manifest.json')).json()) as {
      items: Array<{
        id?: string
        annotations?: Array<{
          items?: Array<{ body?: { value?: string }; target?: string }>
        }>
      }>
    }
    // ids are absolute (configurable --base-url); match on the path
    const pageCanvas = manifest.items.find((c) => c.id?.endsWith('/page006/canvas'))
    expect(pageCanvas).toBeTruthy()
    // staff data lives in the describing annotations' JSON bodies
    const staffBodies = (pageCanvas!.annotations ?? [])
      .flatMap((ap) => ap.items ?? [])
      .filter((a) => a.target?.includes('#xywh='))
      .map((a) => JSON.parse(a.body?.value ?? '{}') as { staffGrid?: { y: number[] }[] })
    const units = staffBodies
      .map((b) => {
        const y = b.staffGrid?.[0]?.y ?? []
        return y.length > 1 ? y[1] - y[0] : NaN
      })
      .filter((u) => Number.isFinite(u) && u > 0)
    const minUnit = Math.min(...units)
    const maxUnit = Math.max(...units)

    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 30000 })
    await page.locator('.player-btn').first().click()
    const marker = page.locator('.note-marker')
    await expect(marker).toHaveAttribute('visibility', 'visible')
    const r = parseFloat((await marker.getAttribute('r')) ?? '0')
    // The marker radius must track the detected staff line spacing (a fixed
    // pixel size would not scale with scan resolution).
    expect(r).toBeGreaterThanOrEqual(0.2 * minUnit)
    expect(r).toBeLessThanOrEqual(0.5 * maxUnit)
  })

  test('playback plays a single track: no simultaneous onsets, selector switches staff', async ({
    page,
  }) => {
    // Record every scheduled oscillator start (time + frequency + waveform)
    // so the test can assert that notes never fire at the same instant (two
    // stacked staves would produce simultaneous onsets on every beat).
    await page.addInitScript(() => {
      const starts: { t: number; f: number; w: string }[] = []
      Object.assign(window, { __oscStarts: starts })
      const RealCtx = window.AudioContext
      const WrappedCtx = class extends RealCtx {
        createOscillator(): OscillatorNode {
          const osc = super.createOscillator()
          const realStart = osc.start.bind(osc)
          osc.start = (when?: number): void => {
            starts.push({ t: when ?? 0, f: osc.frequency.value, w: osc.type })
            realStart(when)
          }
          return osc
        }
      }
      window.AudioContext = WrappedCtx as unknown as typeof AudioContext
    })

    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 30000 })

    const readStarts = () =>
      page.evaluate(() =>
        (
          window as unknown as { __oscStarts: { t: number; f: number; w: string }[] }
        ).__oscStarts.map((s) => ({
          ...s,
        })),
      )
    // Oscillators are scheduled on the exact musical grid (seconds), so a
    // stacked second staff would produce identical start times. Legitimate
    // successive notes are at least an eighth note (0.25 s) apart at 120 bpm.
    const expectMonophonic = (starts: { t: number; f: number }[]): void => {
      const times = starts.map((s) => s.t).sort((a, b) => a - b)
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThan(0.1)
      }
    }

    // default track (staff 1)
    await page.locator('.player-btn').first().click()
    await page.waitForTimeout(2200)
    const firstRun = await readStarts()
    expect(firstRun.length).toBeGreaterThanOrEqual(3)
    expectMonophonic(firstRun)
    const firstFreq = firstRun[0].f

    // switch to staff 2: still monophonic, and the first onset pitch changes
    const track = page.locator('.player-track')
    await expect(track).toBeVisible()
    await track.selectOption('2')
    const before = (await readStarts()).length
    await page.waitForTimeout(1600)
    const secondRun = (await readStarts()).slice(before)
    expect(secondRun.length).toBeGreaterThanOrEqual(2)
    expectMonophonic(secondRun)
    expect(secondRun[0].f).not.toBeCloseTo(firstFreq, 0)
  })

  test('dual mode plays two tracks simultaneously with per-track instruments', async ({ page }) => {
    await page.addInitScript(() => {
      const starts: { t: number; f: number; w: string }[] = []
      Object.assign(window, { __oscStarts: starts })
      const RealCtx = window.AudioContext
      const WrappedCtx = class extends RealCtx {
        createOscillator(): OscillatorNode {
          const osc = super.createOscillator()
          const realStart = osc.start.bind(osc)
          osc.start = (when?: number): void => {
            starts.push({ t: when ?? 0, f: osc.frequency.value, w: osc.type })
            realStart(when)
          }
          return osc
        }
      }
      window.AudioContext = WrappedCtx as unknown as typeof AudioContext
    })

    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 30000 })

    // enable dual playback: both staves are scheduled, so many onsets now
    // carry two simultaneous notes (one per staff)
    await page.locator('.player-dual').check()
    await page.locator('.player-btn').first().click()
    await page.waitForTimeout(2500)
    const starts = await page.evaluate(() =>
      (
        window as unknown as { __oscStarts: { t: number; f: number; w: string }[] }
      ).__oscStarts.slice(),
    )
    expect(starts.length).toBeGreaterThanOrEqual(4)
    // group onsets by start time: at least two groups must pair two pitches
    const byTime = new Map<string, number[]>()
    for (const s of starts) {
      const key = s.t.toFixed(3)
      byTime.set(key, [...(byTime.get(key) ?? []), s.f])
    }
    const pairs = [...byTime.values()].filter((fs) => fs.length >= 2)
    expect(pairs.length).toBeGreaterThanOrEqual(2)
    // track B gets the instrument chosen for it (organ = sine stack)
    await page.locator('.player-instrument-b').selectOption('organ')
    await page.waitForTimeout(1200)
    const after = await page.evaluate(
      () => (window as unknown as { __oscStarts: { w: string }[] }).__oscStarts.length,
    )
    // switching the instrument reschedules the playback
    expect(after).toBeGreaterThan(starts.length)
  })

  test('instrument selection per track reschedules playback', async ({ page }) => {
    await page.addInitScript(() => {
      const starts: { t: number; f: number; w: string }[] = []
      Object.assign(window, { __oscStarts: starts })
      const RealCtx = window.AudioContext
      const WrappedCtx = class extends RealCtx {
        createOscillator(): OscillatorNode {
          const osc = super.createOscillator()
          const realStart = osc.start.bind(osc)
          osc.start = (when?: number): void => {
            starts.push({ t: when ?? 0, f: osc.frequency.value, w: osc.type })
            realStart(when)
          }
          return osc
        }
      }
      window.AudioContext = WrappedCtx as unknown as typeof AudioContext
    })

    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 30000 })
    await page.locator('.player-btn').first().click()
    await page.waitForTimeout(1800)
    const first = await page.evaluate(() =>
      (window as unknown as { __oscStarts: { w: string }[] }).__oscStarts.slice(),
    )
    expect(first.length).toBeGreaterThanOrEqual(2)
    // default is piano (triangle)
    expect(first[0].w).toBe('triangle')
    // switching the instrument restarts the playback with the new waveform
    await page.locator('.player-instrument-a').selectOption('synth')
    await page.waitForTimeout(1500)
    const second = await page.evaluate(
      () => (window as unknown as { __oscStarts: { w: string }[] }).__oscStarts,
    )
    expect(second.length).toBeGreaterThan(first.length)
    expect(second[first.length]).toBeTruthy()
    expect(second[first.length].w).toBe('square')
  })

  test('handles manifest load failure gracefully', async ({ page }) => {
    await page.route('/manifest.json', (route) =>
      route.fulfill({ status: 500, body: 'Server error' }),
    )
    await page.goto('/')
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.error')).toContainText('Failed to load manifest')
  })
})
