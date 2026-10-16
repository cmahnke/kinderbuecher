export interface PageResult {
  image: string
  hasScore: boolean
  /** static IIIF rendition for the overview grid, scaled by the client */
  thumbnail: string
  /** notation references, resolved to same-origin paths (the manifest ids
   * point at the deployment host — see makeResolver); the detail view hands
   * the TEI to the score plugin so it fetches locally */
  homr?: { musicxml?: string; tei?: string }
}

interface ManifestCanvas {
  id?: string
  type?: string
  thumbnail?: Array<{ id?: string }>
  /** notation references: the TEI wrapper and the plain MusicXML. The
   * manifest carries no metadata: OMR run info lives in the TEI header. */
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

function toPageResult(
  canvas: ManifestCanvas,
  resolve: (url: string | undefined) => string | undefined,
): PageResult | null {
  const name = canvasName(canvas)
  if (!name || canvas.type !== 'Canvas') return null

  // the plugin discovers the TEI/MusicXML renderings itself; here the
  // MusicXML presence only drives the grid's score badge
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

  return {
    image: `${name}.jpg`,
    hasScore: musicxml !== undefined,
    thumbnail: resolve(canvas.thumbnail?.[0]?.id) ?? `/thumbnails/${name}.jpg`,
    homr: musicxml || tei ? { musicxml, tei } : undefined,
  }
}

/**
 * Loads the IIIF manifest (static file; see scripts/generate_manifest.py)
 * and maps its canvases into the page data the overview grid renders. `url`
 * is the manifest to load — one per book (see the book selector in main.ts);
 * the embedded TIFY detail view loads the same manifest itself.
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
