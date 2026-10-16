/**
 * Viewer defaults, passed to the musicxml plugin when the detail view spins
 * up its embedded TIFY instance (see main.ts). The playback controls work in
 * every combination; the panel offers runtime toggles for score, regions and
 * highlights.
 */

/** Show the staff-region rects over the homr-detected staff regions. Off by
 * default; the panel's Regions group (on/off + rgba selector) turns them on. */
export const SHOW_STAFF_OVERLAY = false

/** Default RGB of the staff-region rects, hex '#rrggbb'. */
export const REGION_COLOR = '#ff6400'

/** Default region alpha 0–1 (fill and border share it). */
export const REGION_FILL_OPACITY = 0.25

/** The rendered score (OpenSheetMusicDisplay) mapped onto the scan. */
export const SHOW_SCORE_OVERLAY = false

/** Playhead line, note marker and staff band while playing. */
export const SHOW_PLAYBACK_HIGHLIGHTS = true
