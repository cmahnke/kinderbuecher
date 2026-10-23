import { test, expect } from '@playwright/test'

test.describe('Score Page Viewer', () => {
  // the embedded TIFY viewer mounts the manifest + image services per detail
  // view, which is heavier than the old hand-rolled OpenSeadragon wrapper
  test.setTimeout(90_000)

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
    await expect(page.locator('header p')).toContainText('37 of 50 pages contain scores')
  })

  test('book selector switches books', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('header p')).toContainText('37 of 50 pages contain scores')
    await page.locator('#book-select').selectOption({ label: 'Deutsche Wiegenlieder' })
    await expect(page.locator('header p')).toContainText('of 104 pages contain scores')
    // the grid was rebuilt with the other book's pages
    await expect(page.locator('.thumb').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#book-select')).toHaveValue('/deutsche-wiegenlieder/manifest.json')
  })

  test('shows thumbnails grid with score and no-score markers', async ({ page }) => {
    await page.goto('/')
    const grid = page.locator('#grid')
    await expect(grid).toBeVisible()
    const thumbnails = page.locator('.thumb')
    await expect(thumbnails).toHaveCount(50)
    const scoreThumbs = page.locator('.thumb.score')
    await expect(scoreThumbs).toHaveCount(37)
    const noScoreThumbs = page.locator('.thumb.no-score')
    await expect(noScoreThumbs).toHaveCount(13)
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

  test('clicking thumbnail shows the TIFY detail view with staff regions', async ({ page }) => {
    await page.goto('/')
    // click first score thumbnail (should be page006 after sorting by filename)
    const scoreThumb = page.locator('.thumb.score').first()
    await expect(scoreThumb).toBeVisible()
    await scoreThumb.click()
    const detail = page.locator('#detail')
    await expect(detail.locator('.detail-header h2')).toBeVisible()
    // TIFY embeds OpenSeadragon, which renders the IIIF image into a canvas
    await expect(detail.locator('.detail-image canvas').first()).toBeVisible({ timeout: 30_000 })
    // the plugin fetched the page's TEI and built the (default hidden)
    // persistent staff regions; the panel's Regions switch turns them on
    const regions = detail.locator('.region-overlay .staff-region')
    // page006 has 3 staves after dedup
    await expect(regions).toHaveCount(3, { timeout: 30_000 })
    await expect(regions.first()).toHaveAttribute('visibility', 'hidden')
    await detail.locator('#player-region-toggle').check()
    await expect(regions.first()).toHaveAttribute('visibility', 'visible')
    // the score plugin's panel is up (player controls built from the TEI)
    await expect(detail.locator('.player-controls').first()).toBeVisible({ timeout: 30_000 })
  })

  test('detail for score page shows the score player panel', async ({ page }) => {
    await page.goto('/')
    const scoreThumb = page.locator('.thumb.score').first()
    await scoreThumb.click()
    const detail = page.locator('#detail')
    await expect(detail.locator('.player-controls').first()).toBeVisible({ timeout: 30_000 })
    await expect(detail.locator('.player-btn').first()).toHaveText('Play')
    // the score references stay discoverable in the panel? They live in the
    // TEI/manifest — the plugin panel exposes the player, not file links.
    await expect(detail.locator('.region-controls')).toBeVisible()
  })

  test('score overlay toggle is off by default and controls the overlay', async ({ page }) => {
    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    const detail = page.locator('#detail')
    await expect(detail.locator('.detail-header h2')).toBeVisible()
    const toggle = detail.locator('.player-score')
    await expect(toggle).toBeVisible()
    await expect(toggle).not.toBeChecked()
    await expect(detail.locator('.score-overlay')).toHaveCount(0)
    await toggle.check()
    await expect(detail.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 60_000 })
    await toggle.uncheck()
    await expect(detail.locator('.score-overlay')).toHaveCount(0)
  })

  test('region overlay controls toggle and restyle the staff regions', async ({ page }) => {
    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    const detail = page.locator('#detail')
    const region = detail.locator('.region-overlay .staff-region').first()
    const toggle = detail.locator('#player-region-toggle')
    // off by default
    await expect(toggle).toBeVisible({ timeout: 30_000 })
    await expect(toggle).not.toBeChecked()
    await expect(region).toHaveAttribute('visibility', 'hidden')
    // on: homr-orange at the default 0.25 alpha, fill and border alike
    await toggle.check()
    await expect(region).toHaveAttribute('visibility', 'visible')
    await expect(region).toHaveAttribute('fill', 'rgba(255, 100, 0, 0.25)')
    await expect(region).toHaveAttribute('stroke', 'rgba(255, 100, 0, 0.25)')
    // recolor + alpha via the rgba selector
    await detail.locator('.player-region-color').evaluate((el) => {
      ;(el as HTMLInputElement).value = '#008000'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await detail.locator('.player-region-alpha').evaluate((el) => {
      ;(el as HTMLInputElement).value = '50'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(region).toHaveAttribute('fill', 'rgba(0, 128, 0, 0.5)')
    await expect(region).toHaveAttribute('stroke', 'rgba(0, 128, 0, 0.5)')
  })

  test('every detected staff gets a track row, all on by default', async ({ page }) => {
    await page.goto('/')
    // page006 is a grand staff page: one row per staff, all playing
    await page.locator('.thumb.score').first().click()
    const rows = page.locator('#detail .player-staff-row')
    await expect(rows).toHaveCount(2, { timeout: 30_000 })
    await expect(page.locator('#detail #player-staff-1')).toBeChecked()
    await expect(page.locator('#detail #player-staff-2')).toBeChecked()
    // each row carries its own instrument selector
    await expect(rows.first().locator('.player-instrument')).toBeVisible()
    // page023 carries a single staff: exactly one row
    await page.locator('.thumb').filter({ hasText: 'page023' }).click()
    await expect(page.locator('#detail .detail-header h2')).toContainText('page023')
    await expect(page.locator('#detail .player-staff-row')).toHaveCount(1, { timeout: 30_000 })
  })

  test('score page renders player with controls and scan highlights', async ({ page }) => {
    await page.goto('/')
    const scoreThumb = page.locator('.thumb.score').first()
    await scoreThumb.click()
    // mute Staff 2 for the strict single-element assertions below
    await page.locator('#player-staff-2').uncheck({ timeout: 30_000 })
    // the rendered score overlay is opt-in
    await page.locator('.player-score').check()
    // OSMD renders the score into per-system SVGs nested in the overlay (the
    // OSMD source svg itself lives in <defs> and must not match)
    const score = page.locator('.score-overlay > svg').first()
    await expect(score).toBeVisible({ timeout: 60_000 })
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

  test('detail for non-score page shows no regions and an empty panel', async ({ page }) => {
    await page.goto('/')
    const noScoreThumb = page.locator('.thumb.no-score').first()
    await noScoreThumb.click()
    const detail = page.locator('#detail')
    await expect(detail.locator('.detail-header h2')).toBeVisible()
    await expect(detail.locator('.detail-image canvas').first()).toBeVisible({ timeout: 30_000 })
    await expect(detail.locator('.region-overlay')).toHaveCount(0)
    // the plugin panel reports that the page has no score
    await expect(detail.locator('.tify-plugin-status')).toContainText('No score on this page', {
      timeout: 30_000,
    })
  })

  test('page008 has multiple staff regions (homr detection)', async ({ page }) => {
    await page.goto('/')
    const thumb = page.locator('.thumb').filter({ hasText: 'page008' })
    await thumb.click()
    const rects = page.locator('#detail .region-overlay .staff-region')
    await expect(rects).toHaveCount(2, { timeout: 30_000 })
  })

  test('keyboard activation via Enter', async ({ page }) => {
    await page.goto('/')
    const thumb = page.locator('.thumb.score').first()
    await thumb.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#detail .detail-header h2')).toBeVisible()
    await expect(page.locator('#detail .region-overlay')).toBeVisible({ timeout: 30_000 })
  })

  test('overview grid shows generated thumbnails and all of them load', async ({ page }) => {
    await page.goto('/')
    const imgs = page.locator('.thumb img')
    await expect(imgs).toHaveCount(50)
    await expect(imgs.first()).toHaveAttribute(
      'src',
      /^\/[^/]+\/[^/]+\/full\/\d+,\/0\/default\.jpg$/,
    )
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
    // the staff geometry lives only in the TEI: the spacing between the
    // first two staff lines of each zone approximates the staff unit
    const teiText = await (
      await page.request.get('/vieilles-chansons-et-rondes/tei/page006.tei.xml')
    ).text()
    const firstPointY = (points: string): number | null => {
      const coords = (points.split(/\s+/)[0] ?? '').split(',').map(Number)
      if (coords.length !== 2 || coords.some((v) => !Number.isFinite(v))) return null
      return coords[1]
    }
    const units = [...teiText.matchAll(/<zone[^>]*>([\s\S]*?)<\/zone>/g)]
      .map((zone) =>
        [...zone[1].matchAll(/<path[^>]*points="([^"]+)"/g)]
          .map((m) => firstPointY(m[1]))
          .filter((y): y is number => y !== null),
      )
      .map((ys) => (ys.length > 1 ? Math.abs(ys[1] - ys[0]) : NaN))
      .filter((u) => Number.isFinite(u) && u > 0)
    const minUnit = Math.min(...units)
    const maxUnit = Math.max(...units)

    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    // mute Staff 2 for the strict single-marker assertions below
    await page.locator('#player-staff-2').uncheck({ timeout: 30_000 })
    await page.locator('.player-score').check()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 60_000 })
    await page.locator('.player-btn').first().click()
    const marker = page.locator('.note-marker').first()
    await expect(marker).toHaveAttribute('visibility', 'visible')
    const r = parseFloat((await marker.getAttribute('r')) ?? '0')
    // The marker radius must track the detected staff line spacing (a fixed
    // pixel size would not scale with scan resolution).
    expect(r).toBeGreaterThanOrEqual(0.2 * minUnit)
    expect(r).toBeLessThanOrEqual(0.5 * maxUnit)
  })

  test('playback plays a single staff: no simultaneous onsets, toggling switches staff', async ({
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
    await page.locator('.player-score').check()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 60_000 })

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

    // all staves play by default: mute Staff 2 first so only Staff 1 sounds
    await page.locator('#player-staff-2').uncheck()
    // default track (staff 1)
    await page.locator('.player-btn').first().click()
    await page.waitForTimeout(2200)
    const firstRun = await readStarts()
    expect(firstRun.length).toBeGreaterThanOrEqual(3)
    expectMonophonic(firstRun)
    const firstFreq = firstRun[0].f

    // switch to staff 2: still monophonic, and the first onset pitch changes
    await page.locator('#player-staff-1').uncheck()
    await page.locator('#player-staff-2').check()
    const before = (await readStarts()).length
    await page.waitForTimeout(1600)
    const secondRun = (await readStarts()).slice(before)
    expect(secondRun.length).toBeGreaterThanOrEqual(2)
    expectMonophonic(secondRun)
    expect(secondRun[0].f).not.toBeCloseTo(firstFreq, 0)
  })

  test('all staves playing show the current position on every staff', async ({ page }) => {
    await page.goto('/')
    await page.locator('.thumb.score').first().click()
    await page.locator('.player-score').check()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 60_000 })
    await page.locator('.player-btn').first().click()
    // every playing staff drives its own highlight set: one staff rect, one
    // note marker, one playhead line per staff (page006: two staves; retried
    // until both tracks fired)
    for (const selector of ['.staff-current', '.note-marker', '.play-pos']) {
      const els = page.locator(`#detail ${selector}`)
      await expect(els).toHaveCount(2, { timeout: 15000 })
      await expect(els.first()).toHaveAttribute('visibility', 'visible')
      await expect(els.nth(1)).toHaveAttribute('visibility', 'visible')
    }
    // the two playheads sit on different staves (different y extents)
    const boxes = await page
      .locator('#detail .play-pos')
      .evaluateAll((lines) => lines.map((l) => [l.getAttribute('y1'), l.getAttribute('y2')]))
    expect(boxes[0]).not.toEqual(boxes[1])
  })

  test('plays all staves simultaneously with per-staff instruments', async ({ page }) => {
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
    await page.locator('.player-score').check()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 60_000 })

    // all staves play by default, so many onsets carry two simultaneous
    // notes (one per staff)
    await expect(page.locator('#player-staff-1')).toBeChecked()
    await expect(page.locator('#player-staff-2')).toBeChecked()
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
    // staff 2 gets the instrument chosen for it (organ = sine stack)
    await page.locator('.player-staff-row[data-staff="2"] .player-instrument').selectOption('organ')
    await page.waitForTimeout(1200)
    const after = await page.evaluate(
      () => (window as unknown as { __oscStarts: { w: string }[] }).__oscStarts.length,
    )
    // switching the instrument reschedules the playback
    expect(after).toBeGreaterThan(starts.length)
  })

  test('instrument selection per staff reschedules playback', async ({ page }) => {
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
    // mute Staff 2: the assertions below assume one piano voice
    await page.locator('#player-staff-2').uncheck({ timeout: 30_000 })
    await page.locator('.player-score').check()
    await expect(page.locator('.score-overlay > svg').first()).toBeVisible({ timeout: 60_000 })
    await page.locator('.player-btn').first().click()
    await page.waitForTimeout(1800)
    const first = await page.evaluate(() =>
      (window as unknown as { __oscStarts: { w: string }[] }).__oscStarts.slice(),
    )
    expect(first.length).toBeGreaterThanOrEqual(2)
    // default is piano (triangle)
    expect(first[0].w).toBe('triangle')
    // switching the instrument restarts the playback with the new waveform
    await page.locator('.player-staff-row[data-staff="1"] .player-instrument').selectOption('synth')
    await page.waitForTimeout(1500)
    const second = await page.evaluate(
      () => (window as unknown as { __oscStarts: { w: string }[] }).__oscStarts,
    )
    expect(second.length).toBeGreaterThan(first.length)
    expect(second[first.length]).toBeTruthy()
    expect(second[first.length].w).toBe('square')
  })

  test('handles manifest load failure gracefully', async ({ page }) => {
    await page.route('/vieilles-chansons-et-rondes/manifest.json', (route) =>
      route.fulfill({ status: 500, body: 'Server error' }),
    )
    await page.goto('/')
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.error')).toContainText('Failed to load manifest')
  })

  test('double-page spread: dropdown and clicks select which page plays', async ({ page }) => {
    const teiFetches: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/tei/page')) teiFetches.push(req.url())
    })

    await page.goto('/')
    await page.locator('.thumb').filter({ hasText: 'page006' }).click()
    const detail = page.locator('#detail')
    // the paged manifest opens page006 as the book-like spread
    // [page006, page007]: the selector lists both shown pages (option
    // values are canvas numbers, which include the book's back/front
    // covers) and the score stays on the selected page — page006's three
    // staff regions
    await expect(detail.locator('.player-controls').first()).toBeVisible({ timeout: 30_000 })
    const select = detail.locator('.player-page')
    await expect(select).toBeVisible({ timeout: 30_000 })
    await expect(select.locator('option')).toHaveCount(2)
    const optionByLabel = (label: string) => select.locator('option').filter({ hasText: label })
    const page6 = await optionByLabel('page006').getAttribute('value')
    const page7 = await optionByLabel('page007').getAttribute('value')
    await expect(select).toHaveValue(page6 ?? '')
    await expect(detail.locator('.region-overlay .staff-region')).toHaveCount(3, {
      timeout: 30_000,
    })
    // page006's first staff zone (ulx=3087)
    await expect(detail.locator('.region-overlay .staff-region').first()).toHaveAttribute(
      'x',
      '3087',
    )

    // dropdown: play the facing page — its TEI loads, its regions replace
    // page006's (page007's first zone starts at ulx=1552)
    await select.selectOption({ label: 'page007' })
    await expect(select).toHaveValue(page7 ?? '')
    await expect(detail.locator('.region-overlay .staff-region').first()).toHaveAttribute(
      'x',
      '1552',
      { timeout: 30_000 },
    )
    expect(teiFetches.some((url) => url.includes('page007.tei.xml'))).toBe(true)

    // clicking a shown page plays it (deliberately without indicators);
    // the click lands on page006's half, clear of the docked panel
    const canvas = detail.locator('.openseadragon-canvas').first()
    const box = await canvas.boundingBox()
    await canvas.click({ position: { x: (box?.width ?? 0) * 0.3, y: (box?.height ?? 0) / 2 } })
    await expect(select).toHaveValue(page6 ?? '', { timeout: 30_000 })
    await expect(detail.locator('.region-overlay .staff-region').first()).toHaveAttribute(
      'x',
      '3087',
      { timeout: 30_000 },
    )

    // clicking the already-playing page re-syncs nothing: the player stays
    // on page006. The plugin's own panel re-renders may refetch the current
    // page's TEI, but never another one — a switch to the facing page would
    // fetch page007's TEI a second time.
    await expect(select).toHaveValue(page6 ?? '', { timeout: 30_000 })
    await canvas.click({ position: { x: (box?.width ?? 0) * 0.3, y: (box?.height ?? 0) / 2 } })
    await page.waitForTimeout(1200)
    await expect(select).toHaveValue(page6 ?? '')
    expect(teiFetches.filter((url) => url.includes('page007.tei.xml')).length).toBe(1)

    // the TIFY header toggle returns to single-page mode: the selector
    // disappears, the player keeps rendering the current page
    await page.locator('button[title="Toggle double-page"]').click()
    await expect(detail.locator('.player-page')).toHaveCount(0, { timeout: 30_000 })
    await expect(detail.locator('.player-controls').first()).toBeVisible()
  })
})
