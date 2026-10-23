import Tify from 'tify'
import { musicxmlPlugin } from '@projektemacher/tify-plugin-musicxml'
import type { MusicXmlPlugin } from '@projektemacher/tify-plugin-musicxml'

const TEI_FORMAT = 'application/tei+xml'
const MUSICXML_FORMAT = 'application/vnd.recordare.musicxml+xml'

interface NotationRendering {
  id?: string
  format?: string
}

interface NotationCanvas {
  rendering?: NotationRendering[]
}

interface NotationManifest {
  items?: NotationCanvas[]
}

const MUSICXML_DEFAULTS = {
  showScoreOverlay: false,
  showHighlights: true,
  regionOverlay: {
    enabled: false,
    color: '#ff6400',
    opacity: 0.25,
  },
}

export interface CreateTifyOptions {
  container: string
  manifestUrl: string
  language?: string
  pages?: number[]
}

export interface AttachMusicxmlOptions {
  panelEl: HTMLElement
  /** TEI URL/raw XML, or a per-page resolver (1-based page → URL/raw XML). */
  tei?: string | ((page: number) => string | undefined)
  /** MusicXML URL/raw XML, or a per-page resolver; wins over the TEI-embedded score. */
  musicxml?: string | ((page: number) => string | undefined)
  showScoreOverlay?: boolean
  showHighlights?: boolean
  regionOverlay?: {
    enabled?: boolean
    color?: string
    opacity?: number
  }
}

export function hasNotationRenderings(manifest: NotationManifest): boolean {
  return (manifest.items ?? []).some((canvas) =>
    (canvas.rendering ?? []).some(
      (rendering) =>
        rendering.format === TEI_FORMAT ||
        rendering.format === MUSICXML_FORMAT ||
        /\.(tei\.xml|musicxml)$/.test(rendering.id ?? ''),
    ))
}

export function createTify(options: CreateTifyOptions): Tify {
  return new Tify({
    container: options.container,
    manifestUrl: options.manifestUrl,
    // only override when set: spreading `language: undefined` would clobber
    // TIFY's default ('en'), breaking its header (localize throws without a
    // language — no double-page toggle, no pagination)
    ...(options.language !== undefined && { language: options.language }),
    pages: options.pages,
    translationsDirUrl: '/tify/translations/',
  })
}

export async function attachMusicxml(tify: Tify, options: AttachMusicxmlOptions): Promise<MusicXmlPlugin> {
  return musicxmlPlugin(tify, {
    panelEl: options.panelEl,
    ...(options.tei !== undefined && { tei: options.tei }),
    ...(options.musicxml !== undefined && { musicxml: options.musicxml }),
    showScoreOverlay: options.showScoreOverlay ?? MUSICXML_DEFAULTS.showScoreOverlay,
    showHighlights: options.showHighlights ?? MUSICXML_DEFAULTS.showHighlights,
    regionOverlay: {
      ...MUSICXML_DEFAULTS.regionOverlay,
      ...options.regionOverlay,
    },
  })
}

export async function enableMusicxml(
  tify: Tify,
  selector: string,
  uri: string,
): Promise<MusicXmlPlugin | undefined> {
  try {
    const response = await fetch(uri)
    if (!response.ok) return undefined
    const manifest: NotationManifest = await response.json()
    if (!hasNotationRenderings(manifest)) return undefined

    const viewer = document.querySelector(selector)
    if (!viewer) return undefined
    const panelHost = document.createElement('div')
    panelHost.className = 'player-host'
    viewer.after(panelHost)

    return await attachMusicxml(tify, { panelEl: panelHost })
  } catch (error) {
    console.error('musicxml plugin:', error)
    return undefined
  }
}

export function addTify(selector: string, uri: string, lang = 'en'): Tify {
  if (document.documentElement.lang !== undefined) {
    lang = document.documentElement.lang
  }
  const tify = createTify({ container: selector, manifestUrl: uri, language: lang })
  void enableMusicxml(tify, selector, uri)
  return tify
}

;(window as unknown as Record<string, unknown>).iiifPresentationViewer = addTify
