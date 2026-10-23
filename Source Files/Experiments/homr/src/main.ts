import './style.css'
import 'tify/dist/tify.css'
import '@projektemacher/tify-plugin-core/style.css'
import '@projektemacher/tify-plugin-musicxml/musicxml.css'
import type Tify from 'tify'
import type { MusicXmlPlugin } from '@projektemacher/tify-plugin-musicxml'
import type { LoadedManifest, PageResult } from './manifest'
import { loadPages } from './manifest'
import { attachMusicxml, createTify } from './tify-musicxml'

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

  div.setAttribute('aria-label', `${page.image}, ${page.hasScore ? 'score' : 'no score'}`)

  return div
}

/**
 * Detail view: the page in an embedded TIFY viewer (same per-book manifest
 * the overview grid was built from) plus the musicxml score plugin, which
 * owns the whole score stack — it fetches the page's TEI (via the canvas
 * rendering reference), draws the staff regions and the rendered score,
 * and provides the player panel (playback, regions, highlights).
 */
function showDetail(
  page: PageResult,
  container: HTMLElement,
  pageIndex: number,
  manifestUrl: string,
  pages: PageResult[],
  doubleSided: boolean,
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

  const viewerRow = document.createElement('div')
  viewerRow.className = 'detail-viewer'

  const tifyId = `tify-${page.image.replace(/\.[^.]+$/, '')}`
  const tifyHost = document.createElement('div')
  tifyHost.className = 'detail-image'
  tifyHost.id = tifyId

  const panelHost = document.createElement('div')
  panelHost.className = 'player-host'

  viewerRow.append(tifyHost, panelHost)
  container.appendChild(viewerRow)

  let disposed = false
  let plugin: MusicXmlPlugin | null = null
  let tify: Tify | null = null
  void (async (): Promise<void> => {
    tify = createTify({
      container: `#${tifyId}`,
      manifestUrl,
      // TIFY pages are 1-based and the option is the pages array (TIFY 0.36
      // dropped the singular `page` option)
      pages: [pageIndex + 1],
    })
    plugin = await attachMusicxml(tify, {
      panelEl: panelHost,
      // the TEI/MusicXML ids in the manifest point at the deployment host;
      // resolve every page's copy so the plugin fetches same-origin — also
      // when a double-page spread switches to the facing page
      tei: (n: number) => pages[n - 1]?.homr?.tei,
      musicxml: (n: number) => pages[n - 1]?.homr?.musicxml,
    })
    if (doubleSided) {
      // The panel is attached BEFORE the spread opens: the plugin keeps the
      // page it already plays (the selected one) when TIFY's page selection
      // changes (toggleDoublePage(true) applies TIFY's own facing-page
      // logic — parity, first/last page, non-paged canvases — so the spread
      // parity is not duplicated here). Toggling before the attach would
      // instead make the plugin start on the spread's first page.
      //
      // TIFY maps the final even page to a facing page of 0 (no left
      // neighbor); that [0, n] spread with n > 1 crashes TIFY's overlay
      // update (it positions the "0" slot against the page-1 tile source,
      // which is not loaded then) — so the last page stays single.
      const pageNumber = pageIndex + 1
      const degenerateSpread = pageNumber === pages.length && pageNumber % 2 === 0
      if (!degenerateSpread) {
        await tify.ready
        tify.toggleDoublePage(true)
      }
    }
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__tify = tify
    }
  })().catch((err: unknown) => {
    if (disposed) return
    console.error(err)
    const msg = err instanceof Error ? err.message : String(err)
    const p = document.createElement('p')
    p.className = 'detail-info player-error'
    p.textContent = `Player unavailable: ${msg}`
    if (container.isConnected) container.appendChild(p)
  })

  return {
    dispose: () => {
      disposed = true
      plugin?.destroy()
      tify?.destroy()
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

  let activeDetail: { dispose: () => void } | null = null

  const closeDetail = (): void => {
    activeDetail?.dispose()
    activeDetail = null
  }

  const showBook = async (manifestUrl: string): Promise<void> => {
    closeDetail()
    grid.innerHTML = ''
    detail.innerHTML = '<p class="placeholder">Select a page to view details</p>'

    let loaded: LoadedManifest
    try {
      loaded = await loadPages(manifestUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(msg)
      grid.innerHTML = `<div class="error"><p class="error-text">${msg}</p></div>`
      return
    }
    const pages = loaded.pages
    const { doubleSided } = loaded

    const scoreCount = pages.filter((p) => p.hasScore).length
    if (countLine)
      countLine.textContent = `${String(scoreCount)} of ${String(pages.length)} pages contain scores`

    for (const [index, page] of pages.entries()) {
      const thumb = createThumbnail(page, index)
      const activate = (): void => {
        closeDetail()
        grid.querySelectorAll('.thumb.selected').forEach((el) => el.classList.remove('selected'))
        thumb.classList.add('selected')
        activeDetail = showDetail(page, detail, index, manifestUrl, pages, doubleSided)
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
