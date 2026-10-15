import './style.css'
import { setupPlayer, type PlayerHandle } from './playerPanel'
import type { PageResult } from './manifest'
import { loadPages } from './manifest'
import { parseTei } from './tei'
import { createOsdViewer, addPixelOverlay } from './osdViewer'
import { SHOW_PLAYBACK_HIGHLIGHTS, SHOW_STAFF_OVERLAY } from './config'

/** One selectable book (see scripts/generate_books_index.py -> /books.json). */
interface BookInfo {
  slug: string
  title: string
  manifest: string
}

const BOOKS_URL = '/books.json'
const BOOK_STORAGE_KEY = 'score-viewer-book'

/**
 * Loads the book index. Falls back to a single book at the root manifest so
 * a deployment of one book without books.json still works.
 */
async function loadBooks(): Promise<BookInfo[]> {
  try {
    const resp = await fetch(BOOKS_URL)
    if (resp.ok) {
      const data: unknown = await resp.json()
      if (
        Array.isArray(data) &&
        data.length > 0 &&
        data.every((b) => b && typeof b.manifest === 'string' && typeof b.title === 'string')
      ) {
        return data as BookInfo[]
      }
    }
  } catch {
    // fall through to the single-book fallback
  }
  return [{ slug: 'book', title: 'Score pages', manifest: '/manifest.json' }]
}

function formatConfidence(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return `${(value * 100).toFixed(1)}%`
}

function createThumbnail(page: PageResult, index: number): HTMLElement {
  const div = document.createElement('div')
  div.className = `thumb ${page.hasScore ? 'score' : 'no-score'}`
  div.dataset.index = String(index)
  div.setAttribute('role', 'button')
  div.tabIndex = 0

  const img = document.createElement('img')
  // IIIF rendition referenced by the manifest (smallest static pyramid
  // level); the browser scales it down for the overview grid.
  img.src = page.thumbnail
  img.alt = page.image
  img.addEventListener('error', () => {
    img.alt = `Failed to load ${page.image}`
    img.style.display = 'none'
    const fallback = document.createElement('div')
    fallback.className = 'thumb-fallback'
    fallback.textContent = 'Image not found'
    div.prepend(fallback)
  })
  div.appendChild(img)

  const label = document.createElement('div')
  label.className = 'label'
  label.textContent = page.image.replace(/\.[^.]+$/, '')
  div.appendChild(label)

  // the staff count arrives with the TEI (fetched by the detail view), so a
  // page starts unbadged and gets its badge once parsed
  updateThumbnail(div, page)

  return div
}

/** Refresh the staff badge and accessible label after the TEI was parsed. */
function updateThumbnail(thumb: HTMLElement, page: PageResult): void {
  thumb.querySelector('.badge')?.remove()
  if (page.hasScore && page.staves.length > 0) {
    const badge = document.createElement('div')
    badge.className = 'badge score'
    badge.textContent = `${page.staves.length} staff${page.staves.length !== 1 ? 's' : ''}`
    thumb.appendChild(badge)
  }
  thumb.setAttribute(
    'aria-label',
    `${page.image} ${
      page.hasScore
        ? page.staves.length > 0
          ? `, ${page.staves.length} staves`
          : ', score'
        : ', no score'
    }`,
  )
}

function showDetail(
  page: PageResult,
  container: HTMLElement,
  thumb: HTMLElement,
): { dispose: () => void } | null {
  container.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'detail-header'
  const h2 = document.createElement('h2')
  h2.textContent = page.image
  const tag = document.createElement('span')
  tag.className = page.hasScore ? 'score-tag' : 'no-score-tag'
  tag.textContent = page.hasScore ? 'Score' : 'No score'
  header.append(h2, tag)
  container.appendChild(header)

  const osdId = `osd-${page.image.replace(/\.[^.]+$/, '')}`
  const imgContainer = document.createElement('div')
  imgContainer.className = 'detail-image'
  imgContainer.id = osdId

  const playerHost = document.createElement('div')
  playerHost.className = 'player-host'

  // the staff-dependent sections (info list, overlay) land here once the
  // TEI is parsed, keeping the header/player/scan order stable
  const staffInfoHost = document.createElement('div')
  staffInfoHost.className = 'staff-info-host'

  container.appendChild(playerHost)
  container.appendChild(imgContainer)
  container.appendChild(staffInfoHost)

  const osd = createOsdViewer(imgContainer, page.imageService)

  if (page.homr) {
    if (page.homr.status === 'error' && page.homr.error) {
      const errDiv = document.createElement('div')
      errDiv.className = 'detail-info homr-error'
      const title = document.createElement('p')
      title.innerHTML = '<strong>OMR:</strong>'
      const msg = document.createElement('p')
      msg.textContent = page.homr.error
      msg.className = 'error-text'
      errDiv.append(title, msg)
      container.appendChild(errDiv)
    } else {
      const notationLinks = (
        label: string,
        href: string | undefined,
      ): HTMLParagraphElement | null => {
        if (!href) return null
        const link = document.createElement('a')
        link.href = href.replace(/^\.\//, '/')
        link.textContent = href
        link.target = '_blank'
        link.rel = 'noopener'
        const p = document.createElement('p')
        p.innerHTML = `<strong>${label}:</strong> `
        p.appendChild(link)
        return p
      }
      const xmlInfo = document.createElement('div')
      xmlInfo.className = 'detail-info'
      const musicxmlP = notationLinks('MusicXML', page.homr.musicxml)
      const teiP = notationLinks('TEI', page.homr.tei)
      if (musicxmlP) xmlInfo.appendChild(musicxmlP)
      if (teiP) xmlInfo.appendChild(teiP)
      if (xmlInfo.childElementCount > 0) container.appendChild(xmlInfo)
    }
  }

  let activePlayer: PlayerHandle | null = null
  if (page.homr && page.homr.status === 'ok' && page.homr.tei) {
    const href = page.homr.tei.replace(/^\.\//, '/')
    fetch(href)
      .then((resp) => {
        if (!resp.ok) throw new Error(`Failed to load ${href}: ${resp.status}`)
        return resp.text()
      })
      .then((teiText) => {
        const parsed = parseTei(teiText)
        if (!parsed) throw new Error('TEI carries no staff geometry or embedded score')
        return parsed
      })
      .then(({ staves, musicxmlText }) => {
        if (!playerHost.isConnected) return
        page.staves = staves
        updateThumbnail(thumb, page)

        // staff overlay: the orange staff rects and (when enabled) the
        // playback highlight layers drawn by the player
        let overlaySvg: SVGSVGElement | null = null
        if (SHOW_STAFF_OVERLAY || SHOW_PLAYBACK_HIGHLIGHTS) {
          overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          overlaySvg.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`)
          overlaySvg.setAttribute('width', String(page.width))
          overlaySvg.setAttribute('height', String(page.height))
          overlaySvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
          overlaySvg.classList.add('staff-overlay')

          if (SHOW_STAFF_OVERLAY) {
            for (const staff of page.staves) {
              const [x0, y0, x1, y1] = staff.bbox
              const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
              rect.setAttribute('x', String(x0))
              rect.setAttribute('y', String(y0))
              rect.setAttribute('width', String(Math.max(0, x1 - x0)))
              rect.setAttribute('height', String(Math.max(0, y1 - y0)))
              rect.setAttribute('fill', 'rgba(255, 100, 0, 0.25)')
              rect.setAttribute('stroke', 'rgba(255, 100, 0, 0.9)')
              rect.setAttribute('stroke-width', '3')
              overlaySvg.appendChild(rect)
            }
          }
          addPixelOverlay(osd.viewer, overlaySvg, 0, 0, page.width, page.height)
        }

        const info = document.createElement('div')
        info.className = 'detail-info'
        const res = document.createElement('p')
        res.innerHTML = `<strong>Resolution:</strong> ${page.width} × ${page.height}`
        const stavesP = document.createElement('p')
        stavesP.innerHTML = `<strong>Staves:</strong> ${page.staves.length}`
        const confP = document.createElement('p')
        confP.innerHTML = `<strong>Confidence:</strong> ${formatConfidence(page.confidence)}`
        info.append(res, stavesP, confP)
        for (const [i, s] of page.staves.entries()) {
          const p = document.createElement('p')
          p.className = 'staff-detail'
          p.textContent = `Staff ${String(i + 1)}: ${String(s.lineCount)} lines, bbox [${s.bbox.join(', ')}]`
          info.appendChild(p)
        }
        if (staffInfoHost.isConnected) staffInfoHost.replaceWith(info)

        activePlayer = setupPlayer(playerHost, osd, overlaySvg, {
          width: page.width,
          height: page.height,
          staves: page.staves,
          musicxmlText,
        })
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        const p = document.createElement('p')
        p.className = 'detail-info player-error'
        p.textContent = `Player unavailable: ${msg}`
        if (container.isConnected) container.appendChild(p)
      })
  } else {
    const empty = document.createElement('p')
    empty.className = 'detail-info'
    empty.textContent = page.hasScore
      ? 'No staves found (detection flagged but no bbox)'
      : 'No staves detected.'
    staffInfoHost.replaceWith(empty)
  }

  return {
    dispose: () => {
      if (activePlayer) activePlayer.dispose()
      osd.dispose()
    },
  }
}

function showError(app: HTMLElement, message: string): void {
  app.innerHTML = `<div class="error"><h1>Score Page Viewer</h1><p class="error-text">${message}</p><p>Check that <code>/books.json</code> and the book manifests exist (run <code>scripts/generate_manifest.py</code> and <code>scripts/generate_books_index.py</code>).</p></div>`
}

async function main(): Promise<void> {
  const app = document.getElementById('app')
  if (!app) {
    console.error('Missing #app element')
    return
  }

  const books = await loadBooks()

  app.innerHTML = `
    <header>
      <div class="title-row">
        <h1>Score Page Viewer</h1>
        <label class="book-select">
          Book
          <select id="book-select">
            ${books.map((b) => `<option value="${b.manifest}">${b.title}</option>`).join('')}
          </select>
        </label>
      </div>
      <p></p>
    </header>
    <div class="container">
      <div class="grid" id="grid"></div>
      <div class="detail" id="detail">
        <p class="placeholder">Select a page to view details</p>
      </div>
    </div>
  `

  const grid = document.getElementById('grid')
  const detail = document.getElementById('detail')
  const select = document.getElementById('book-select') as HTMLSelectElement | null
  const countLine = app.querySelector('header p')
  if (!grid || !detail || !select) return

  // restore the previous selection, if it is still offered
  const remembered = localStorage.getItem(BOOK_STORAGE_KEY)
  if (remembered && books.some((b) => b.manifest === remembered)) {
    select.value = remembered
  }

  let activePlayer: PlayerHandle | null = null

  const showBook = async (manifestUrl: string): Promise<void> => {
    if (activePlayer) {
      activePlayer.dispose()
      activePlayer = null
    }
    grid.innerHTML = ''
    detail.innerHTML = '<p class="placeholder">Select a page to view details</p>'

    let pages: PageResult[]
    try {
      pages = await loadPages(manifestUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(msg)
      grid.innerHTML = `<div class="error"><p class="error-text">${msg}</p></div>`
      return
    }

    const scoreCount = pages.filter((p) => p.hasScore).length
    if (countLine)
      countLine.textContent = `${String(scoreCount)} of ${String(pages.length)} pages contain scores`

    for (const [index, page] of pages.entries()) {
      const thumb = createThumbnail(page, index)
      const activate = (): void => {
        if (activePlayer) {
          activePlayer.dispose()
          activePlayer = null
        }
        grid.querySelectorAll('.thumb.selected').forEach((el) => el.classList.remove('selected'))
        thumb.classList.add('selected')
        activePlayer = showDetail(page, detail, thumb)
      }
      thumb.addEventListener('click', activate)
      thumb.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activate()
        }
      })
      grid.appendChild(thumb)
    }
  }

  select.addEventListener('change', () => {
    localStorage.setItem(BOOK_STORAGE_KEY, select.value)
    void showBook(select.value)
  })

  await showBook(select.value)
}

void main().catch((err: unknown) => {
  console.error(err)
  const app = document.getElementById('app')
  if (app) showError(app, err instanceof Error ? err.message : String(err))
})
