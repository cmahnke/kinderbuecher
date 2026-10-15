import type { StaffEntry } from './noteMap'

export interface PageResult {
  image: string
  width: number
  height: number
  hasScore: boolean
  confidence: number
  /** static IIIF rendition for the overview grid, scaled by the client */
  thumbnail: string
  /** IIIF image service endpoint (info.json) OpenSeadragon consumes */
  imageService: string
  /** staff regions live only in the TEI: empty at load, populated by the
   * detail view once it fetches and parses the page's TEI document */
  staves: StaffEntry[]
  homr?: { status: string; musicxml?: string; tei?: string; error?: string }
}

interface ManifestCanvas {
  id?: string
  type?: string
  label?: Record<string, string[]>
  width?: number
  height?: number
  thumbnail?: Array<{ id?: string }>
  /** painting annotation page (page canvases) */
  items?: Array<{
    items?: Array<{
      body?: { id?: string }
    }>
  }>
  metadata?: Array<{ label?: Record<string, string[]>; value?: Record<string, string[]> }>
  /** notation references: the TEI wrapper and the plain MusicXML */
  rendering?: Array<{ id?: string; format?: string }>
}

interface ManifestJson {
  id?: string
  items?: ManifestCanvas[]
}

const MUSICXML_FORMAT = 'application/vnd.recordare.musicxml+xml'
const TEI_FORMAT = 'application/tei+xml'

/**
 * The manifest uses absolute IIIF URIs with a configurable base (see
 * scripts/generate_manifest.py). Referenced URLs are resolved relative to
 * where the manifest itself is served from: same-origin URLs keep their
 * pathname (production, or a manifest generated for localhost), while
 * remote-origin URLs (dev, with a manifest generated for the deployment
 * host) have the declared base path stripped and resolve against the
 * directory the manifest was fetched from — the per-book folder of the
 * local static files.
 */
function makeResolver(
  manifestId: string | undefined,
  localDir: string,
): (url: string | undefined) => string | undefined {
  let remoteBasePath = '/'
  if (manifestId) {
    try {
      remoteBasePath = new URL(manifestId).pathname.replace(/[^/]*$/, '')
    } catch {
      remoteBasePath = '/'
    }
  }
  return (url) => {
    if (!url) return undefined
    try {
      const parsed = new URL(url)
      if (parsed.origin === window.location.origin || !parsed.pathname.startsWith(remoteBasePath)) {
        return parsed.pathname
      }
      return localDir + parsed.pathname.slice(remoteBasePath.length)
    } catch {
      return url
    }
  }
}

function canvasName(canvas: ManifestCanvas): string {
  const parts = (canvas.id ?? '').split('/').filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

function metadataValue(canvas: ManifestCanvas, label: string): string | undefined {
  const entry = (canvas.metadata ?? []).find((m) => (m.label?.en ?? []).includes(label))
  return entry?.value?.en?.[0]
}

function toPageResult(
  canvas: ManifestCanvas,
  resolve: (url: string | undefined) => string | undefined,
): PageResult | null {
  const name = canvasName(canvas)
  if (!name || canvas.type !== 'Canvas') return null
  const width = canvas.width ?? 0
  const height = canvas.height ?? 0
  if (width <= 0 || height <= 0) return null

  const musicxml = resolve(
    (canvas.rendering ?? []).find(
      (r) => r.id && (r.format === MUSICXML_FORMAT || r.id.endsWith('.musicxml')),
    )?.id,
  )
  const tei = resolve(
    (canvas.rendering ?? []).find(
      (r) => r.id && (r.format === TEI_FORMAT || r.id.endsWith('.tei.xml')),
    )?.id,
  )
  const confidenceStr = metadataValue(canvas, 'OMR confidence')
  const confidence = confidenceStr ? Number.parseFloat(confidenceStr) : 0
  const status = metadataValue(canvas, 'OMR status')
  const error = metadataValue(canvas, 'OMR error')

  return {
    image: `${name}.jpg`,
    width,
    height,
    hasScore: musicxml !== undefined,
    confidence,
    thumbnail: resolve(canvas.thumbnail?.[0]?.id) ?? `/thumbnails/${name}.jpg`,
    imageService: resolve(canvas.items?.[0]?.items?.[0]?.body?.id) ?? `/iiif/${name}/info.json`,
    // the staff regions come from the TEI (fetched by the detail view), so
    // the manifest contributes no staves here
    staves: [],
    homr:
      status || musicxml || tei
        ? {
            status: status ?? '',
            musicxml,
            tei,
            error,
          }
        : undefined,
  }
}

/**
 * Loads the IIIF manifest (static file; see scripts/generate_manifest.py)
 * and maps its canvases into the page data the viewer renders. `url` is the
 * manifest to load — one per book (see the book selector in main.ts).
 */
export async function loadPages(url = '/manifest.json'): Promise<PageResult[]> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`Failed to load manifest: ${resp.status} ${resp.statusText}`)
  }
  const data: unknown = await resp.json()
  if (!data || typeof data !== 'object' || !('items' in data)) {
    throw new Error('Invalid manifest format')
  }
  const manifest = data as ManifestJson
  const canvases = manifest.items ?? []
  const localDir = new URL(url, window.location.href).pathname.replace(/[^/]*$/, '')
  const resolve = makeResolver(manifest.id, localDir)

  const pages: PageResult[] = []
  for (const canvas of canvases) {
    const page = toPageResult(canvas, resolve)
    if (page) pages.push(page)
  }
  if (pages.length === 0) throw new Error('Manifest contains no page canvases')
  return pages
}
