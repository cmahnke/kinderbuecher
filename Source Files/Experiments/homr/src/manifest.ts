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
  staves: StaffEntry[]
  homr?: { status: string; musicxml?: string; error?: string }
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
  /** describing staff annotations (#xywh target + JSON body) and the
   * supplementing MNX annotation (whole-canvas target) */
  annotations?: Array<{
    items?: Array<{
      body?: { id?: string; type?: string; value?: string }
      target?: string
    }>
  }>
  metadata?: Array<{ label?: Record<string, string[]>; value?: Record<string, string[]> }>
  rendering?: Array<{ id?: string; format?: string }>
}

interface ManifestJson {
  id?: string
  items?: ManifestCanvas[]
}

const MUSICXML_FORMAT = 'application/vnd.recordare.musicxml+xml'

/**
 * The manifest uses absolute IIIF URIs with a configurable base (see
 * scripts/generate_manifest.py). Referenced URLs are resolved relative to
 * where the manifest itself is served from: same-origin URLs keep their
 * pathname (production, or a manifest generated for localhost), while
 * remote-origin URLs (dev, with a manifest generated for the deployment
 * host) have the declared base path stripped so the local static files at
 * the domain root are used.
 */
function makeResolver(
  manifestId: string | undefined,
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
      return parsed.pathname.slice(remoteBasePath.length - 1)
    } catch {
      return url
    }
  }
}

function canvasName(canvas: ManifestCanvas): string {
  const parts = (canvas.id ?? '').split('/').filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

/** bbox [x, y, x1, y1] in page pixels from a "#xywh=x,y,w,h" target. */
function xywhToBbox(target: string): [number, number, number, number] | null {
  const fragment = target.split('#xywh=')[1]
  if (!fragment) return null
  const [x, y, w, h] = fragment.split(',').map((v) => Number.parseInt(v, 10))
  if (![x, y, w, h].every((v) => Number.isFinite(v))) return null
  return [x, y, x + w, y + h]
}

function metadataValue(canvas: ManifestCanvas, label: string): string | undefined {
  const entry = (canvas.metadata ?? []).find((m) => (m.label?.en ?? []).includes(label))
  return entry?.value?.en?.[0]
}

/** OMR data of one staff, carried in a describing annotation's body. */
interface StaffBody {
  staffGrid?: Array<{ x: number; y: number[] }>
  staffLineCount?: number
}

/** Parse the OMR staff data from a describing annotation's JSON body. */
function staffFromBody(value: string | undefined): StaffBody | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && 'staffGrid' in parsed) {
      return parsed as StaffBody
    }
  } catch {
    /* malformed body — ignore the annotation */
  }
  return null
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
  const confidenceStr = metadataValue(canvas, 'OMR confidence')
  const confidence = confidenceStr ? Number.parseFloat(confidenceStr) : 0
  const status = metadataValue(canvas, 'OMR status')
  const error = metadataValue(canvas, 'OMR error')

  // staff regions come from the describing annotations: the #xywh target is
  // the region on the page, the body carries grid + line count (the
  // supplementing MNX annotation has no fragment target and is skipped)
  const staves: StaffEntry[] = []
  for (const annotationPage of canvas.annotations ?? []) {
    for (const annotation of annotationPage.items ?? []) {
      if (!annotation.target) continue
      const bbox = xywhToBbox(annotation.target)
      if (!bbox) continue
      const body = staffFromBody(annotation.body?.value)
      if (!body) continue
      staves.push({
        bbox,
        lineCount: body.staffLineCount ?? 5,
        grid: body.staffGrid,
      })
    }
  }

  return {
    image: `${name}.jpg`,
    width,
    height,
    hasScore: musicxml !== undefined,
    confidence,
    thumbnail: resolve(canvas.thumbnail?.[0]?.id) ?? `/thumbnails/${name}.jpg`,
    imageService: resolve(canvas.items?.[0]?.items?.[0]?.body?.id) ?? `/iiif/${name}/info.json`,
    staves,
    homr:
      status || musicxml
        ? {
            status: status ?? '',
            musicxml,
            error,
          }
        : undefined,
  }
}

/**
 * Loads the IIIF manifest (static file; see scripts/generate_manifest.py)
 * and maps its canvases into the page data the viewer renders.
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
  const resolve = makeResolver(manifest.id)

  const pages: PageResult[] = []
  for (const canvas of canvases) {
    const page = toPageResult(canvas, resolve)
    if (page) pages.push(page)
  }
  if (pages.length === 0) throw new Error('Manifest contains no page canvases')
  return pages
}
