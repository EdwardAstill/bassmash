# Bassmash — FL Studio Layout & Audio Track Import

**Date:** 2026-04-05  
**Status:** Approved

## Overview

Redesign Bassmash to match the FL Studio layout and visual style, and add audio clip track support so users can import a vocal and an instrumental, place them on the playlist, and mix them together.

## Decisions

- **Layout:** Full FL Studio — Browser + Channel Rack + Playlist + Mixer
- **Color scheme:** Black & white — pure black backgrounds, white as the only accent, no color
- **Implementation approach:** New layout shell, migrate components (existing logic preserved, new HTML/CSS structure)
- **Piano roll:** Floating overlay, opens on double-click of a synth pattern clip, dismissed with X or Escape

---

## Layout

Five fixed regions:

```
┌──────────────────────────────────────────────────────────────────┐
│  TOOLBAR (38px) — logo, menu, transport, BPM, add track, export  │
├──────────┬───────────────┬─────────────────────────┬────────────┤
│          │               │                         │            │
│ BROWSER  │ CHANNEL RACK  │       PLAYLIST          │   MIXER    │
│  160px   │    220px      │       flex: 1           │   180px    │
│          │               │                         │            │
└──────────┴───────────────┴─────────────────────────┴────────────┘
```

### Toolbar
- Logo (B mark, 38×38px, black on white)
- Menu labels: FILE, EDIT, ADD, PATTERNS, VIEW (non-functional cosmetic labels for now)
- Transport: Play, Stop, Record buttons
- BPM input
- Project name display
- Buttons: `+ Audio`, `+ Drums`, `+ Synth`
- Export button (right-aligned)

### Browser Panel (160px, collapsible)
- Sections: Project / Audio Files / Samples
- Lists uploaded audio files (MP3, WAV) — drag from here into playlist to import
- Drop zone at bottom: drag files from OS → uploads and adds to list
- File tree is flat (no subdirectory navigation in v1)

### Channel Rack (220px)
- Step sequencer moves here permanently — no more bottom panel tabs
- One row per drum track (name button + 16-step grid)
- Active step = white; inactive = dark grey (#111)
- Name button: white background = selected row, grey = unselected
- `+ Add instrument` button at bottom
- Only shows steps for the currently selected drum pattern

### Playlist (flex: 1, center dominant view)
- Ruler across the top (bar numbers, beat subdivisions)
- Track header on left (130px): color stripe, track name, M/S buttons
- Two clip types:
  - **Audio clips** — grey body, white SVG waveform, filename label
  - **Pattern clips** — dark grey body, pattern name label, white border when selected
- Playhead: white vertical line with triangle handle at top
- Loop end marker: draggable
- Interactions: drag to move, edge-drag to resize, double-click pattern clip → open piano roll
- Drag audio file from browser panel → creates new audio track at drop position
- Drag audio file from OS directly onto playlist → same behavior

### Mixer (180px, right)
- Vertical channel strips
- Per channel: M/S buttons, vertical fader, dB label, rotated channel name
- Master channel always first, slightly distinguished (brighter name)
- Auto-creates one channel per track

### Piano Roll (floating overlay)
- `position: fixed`, centered on screen
- Width ~800px, height ~500px
- Draggable by title bar
- Dismisses on X button or Escape key
- Same piano roll logic as current — just re-housed in a floating container
- Title bar shows pattern name

---

## Color System

```css
--bg:           #000000   /* page / deepest background */
--bg-panel:     #0a0a0a   /* browser, mixer backgrounds */
--bg-surface:   #111111   /* toolbar, panel headers */
--bg-elevated:  #1a1a1a   /* channel rack rows, track headers */
--bg-hover:     #222222   /* hover states */
--border:       #1c1c1c   /* panel dividers */
--border-subtle:#111111   /* row separators */
--text:         #ffffff   /* primary text, active states */
--text-secondary:#aaaaaa  /* track names, labels */
--text-dim:     #555555   /* dimmed labels, inactive buttons */
--accent:       #ffffff   /* active steps, selected clips, playhead */
```

No other colors in the UI. Clip colors in the playlist are all grey variants — audio clips slightly lighter than pattern clips to distinguish them visually.

---

## Audio Track Feature

### New track type
```js
{
  type: 'audio',
  name: 'lead vocal',
  volume: 1,
  pan: 0,
  muted: false,
  soloed: false,
}
```

### New clip type (in `store.data.arrangement`)
```js
{
  type: 'audio',           // new field (existing pattern clips default to 'pattern')
  trackIndex: 0,
  audioRef: 'vocals.mp3',  // filename, served from project's audio/ directory
  startBeat: 0,
  lengthBeats: 32,
  offset: 0,               // start offset within the file in seconds (for trimming)
}
```

### File storage
- Server stores uploaded audio in `~/bassmash-projects/<project>/audio/`
- New API endpoints:
  - `POST /project/:name/audio` — multipart upload, returns `{ ref: 'filename.mp3' }`
  - `GET /project/:name/audio/:filename` — serves the file

### Waveform rendering
- On load: fetch audio file, decode with `OfflineAudioContext`, downsample to ~500 points
- Cache waveform data per audioRef
- Draw as SVG polyline on the clip in the playlist canvas

### Playback
- On each `beat` event: scan audio clips whose `startBeat` falls on or before current beat
- Use `AudioBufferSourceNode` scheduled to the correct `AudioContext` time
- Handle `offset` for trimmed clips
- Stop source node if clip end is reached (respects `lengthBeats`)
- Audio clips do not loop

### Import flow
1. User drags file from OS → onto browser drop zone or directly onto playlist
2. File uploaded to server via `POST /project/:name/audio`
3. New audio track created, new audio clip placed at drop beat position
4. Waveform decoded and cached, clip renders immediately

---

## Implementation Sequence

**Phase 1 — New shell**
1. New `index.html` with the 5-region layout structure
2. New `style.css` — black/white theme, FL layout, all new CSS variables
3. Toolbar ported into new layout
4. Mixer ported to right panel

**Phase 2 — Migrate playlist & channel rack**
5. Playlist canvas moved to center panel
6. Channel rack (step sequencer) moved to left-center panel — remove bottom editor tabs
7. Browser panel scaffold (file tree, drop zone — no upload yet)

**Phase 3 — Audio tracks**
8. Server: audio upload/serve endpoints
9. State: audio track type, audio clip type
10. Browser panel: file list, drag-to-playlist
11. Waveform decode + render on playlist canvas
12. Playback engine: schedule audio clips

**Phase 4 — Piano roll float**
13. Piano roll re-housed as floating overlay
14. Double-click synth clip → opens piano roll with that pattern

---

## What Is Not Changing

- Beat scheduling logic in `engine.js`
- Sampler, synth, effects, mixer audio routing
- Project save/load API
- Step sequencer step logic
- Piano roll note editing logic
- MCP server
