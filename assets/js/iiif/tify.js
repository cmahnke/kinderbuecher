import 'tify';
import { musicxmlPlugin } from '@projektemacher/tify-plugin-musicxml';

const TEI_FORMAT = 'application/tei+xml';
const MUSICXML_FORMAT = 'application/vnd.recordare.musicxml+xml';

function hasNotationRenderings (manifest) {
  return (manifest?.items ?? []).some((canvas) =>
    (canvas?.rendering ?? []).some((rendering) =>
      [TEI_FORMAT, MUSICXML_FORMAT].includes(rendering?.format) ||
      /\.(tei\.xml|musicxml)$/.test(rendering?.id ?? '')));
}

async function enableMusicxml (tify, selector, uri) {
  try {
    const response = await fetch(uri);
    if (!response.ok) return;
    const manifest = await response.json();
    if (!hasNotationRenderings(manifest)) return;

    const viewer = document.querySelector(selector);
    if (!viewer) return;
    const panelHost = document.createElement('div');
    panelHost.className = 'player-host';
    viewer.after(panelHost);

    await musicxmlPlugin(tify, {
      panelEl: panelHost,
      showScoreOverlay: false,
      showHighlights: true,
      regionOverlay: {
        enabled: false,
        color: '#ff6400',
        opacity: 0.25
      }
    });
  } catch (err) {
    console.error('musicxml plugin:', err);
  }
}

function addTify (selector, uri, lang = 'en') {
  if (document.documentElement.lang !== undefined) {
    lang = document.documentElement.lang;
  }

  const tify = new Tify({
    container: selector,
    manifestUrl: uri,
    language: lang,
    translationsDirUrl: '/tify/translations/'
  });
  void enableMusicxml(tify, selector, uri);
  return tify;
}

window.iiifPresentationViewer = addTify;
