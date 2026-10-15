/**
 * Viewer feature flags: flip these to true/false to show or hide the visual
 * overlays over the scanned page. The playback controls (play/pause, track
 * and instrument selection) work in every combination.
 */

/** Orange rects over the homr-detected staff regions. */
export const SHOW_STAFF_OVERLAY = true

/** The rendered score (OpenSheetMusicDisplay) mapped onto the scan. Off by
 * default; the player panel offers a "Score" toggle to show it. The OSMD
 * render itself still runs while anything consumes its alignment data. */
export const SHOW_SCORE_OVERLAY = false

/** Playhead line, note marker and staff band while playing. */
export const SHOW_PLAYBACK_HIGHLIGHTS = true
