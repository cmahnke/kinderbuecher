/**
 * Viewer feature flags: flip these to true/false to show or hide the visual
 * overlays over the scanned page. The playback controls (play/pause, track
 * and instrument selection) work in every combination.
 */

/** Orange rects over the homr-detected staff regions. */
export const SHOW_STAFF_OVERLAY = true

/** The rendered score (OpenSheetMusicDisplay) mapped onto the scan. */
export const SHOW_SCORE_OVERLAY = true

/** Playhead line, note marker and staff band while playing. */
export const SHOW_PLAYBACK_HIGHLIGHTS = true
