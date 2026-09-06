import OpenSeadragon from 'openseadragon'

export interface OsdHandle {
  viewer: OpenSeadragon.Viewer
  dispose: () => void
}

/**
 * Wraps OpenSeadragon for displaying IIIF image pyramids. Overlays are added
 * in original image pixel coordinates and scale with the viewport.
 */
export function createOsdViewer(container: HTMLElement, imageUrl: string): OsdHandle {
  const viewer = OpenSeadragon({
    id: container.id,
    prefixUrl: '/openseadragon/images/',
    tileSources: imageUrl,
    showNavigator: true,
    navigatorSizeRatio: 0.18,
    maxZoomPixelRatio: 4,
    minZoomImageRatio: 0.4,
    sequenceMode: false,
    showSequenceControl: false,
    animationTime: 0.3,
    visibilityRatio: 0.5,
    constrainDuringPan: true,
    defaultZoomLevel: 0.8,
  })

  return {
    viewer,
    dispose: () => {
      viewer.destroy()
    },
  }
}

export function addPixelOverlay(
  viewer: OpenSeadragon.Viewer,
  element: Element,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const pxRect = new OpenSeadragon.Rect(x, y, width, height)
  const add = (): void => {
    const viewportRect = viewer.viewport.imageToViewportRectangle(pxRect)
    viewer.addOverlay(element, viewportRect)
  }
  if (viewer.world.getItemCount() > 0) {
    // Image already loaded: viewport bounds are valid, convert now.
    add()
  } else {
    // Image not open yet: converting now would use the 1x1 placeholder
    // content bounds and produce a garbage rect. Wait for the tile source
    // to load (fired after world.addItem) before converting.
    const onOpen = (): void => {
      viewer.removeHandler('open', onOpen)
      add()
    }
    const onFailed = (): void => {
      viewer.removeHandler('open', onOpen)
      viewer.removeHandler('open-failed', onFailed)
    }
    viewer.addHandler('open', onOpen)
    viewer.addHandler('open-failed', onFailed)
  }
}
