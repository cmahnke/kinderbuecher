# Notes

## Invalid MusicXML: `<rest />` combined with `<chord />`

**Affected source files** (project root, one occurrence each):

- `page019.musicxml`
- `page023.musicxml`
- `page030.musicxml`

**Description**

These MusicXML files contain `<note>` elements that carry both a `<chord />`
and a `<rest />` element:

```xml
<note>
  <chord />
  <rest />
  <duration>8</duration>
  <voice>1</voice>
  <type>whole</type>
  <staff>1</staff>
  <notations />
</note>
```

This is invalid MusicXML: a rest cannot be a chord member (`<chord />` marks a
note that is attached to the previous note in the same voice as a chord
second-note, which only makes sense for pitched notes). The element sequence
inside `<note>` also violates the MusicXML DTD order (`<chord />` must be
followed by `<pitch>`/`<unpitched>`, never by `<rest />`).

**Effect**

OpenSheetMusicDisplay cannot handle it: it builds a chord note without a
pitch and crashes during `GraphicalMusicSheet` construction with

```
TypeError: Cannot read properties of undefined (reading 'getHalfTone')
    at Array.sort (<anonymous>)
    at sortForVexflow (opensheetmusicdisplay.min.js)
```

so the whole page fails to render (no score overlay, no playback cursor).

**Handling**

The viewer sanitizes the XML before rendering: `sanitizeMusicXml()` in
`src/osmdRenderer.ts` strips `<chord />` from any note that contains a rest,
and `OsmdRenderer.render()` applies it before `osmd.load()`. The data files
themselves were left untouched; the playback parser (`src/musicxml.ts`)
already ignores pitchless rests, so only the OSMD path needed the fix.

If the transcription source is corrected, the affected notes should either
lose the `<chord />` or the `<rest />` element (whichever was intended).
