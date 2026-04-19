# Design Influences

**Purpose.** Pull the best ideas from the DAWs people actually love, reject the ideas that are bad or irrelevant, and synthesise the result into a coherent direction for Bassmash. Not a clone. Not "baby FL." A set of deliberate choices.

---

## 1. Survey of references

For each tool: what the community genuinely praises, what it gets wrong, what — if anything — Bassmash should adopt.

### FL Studio

**Loved.**
- Pattern-based workflow. Create a loop quickly, then paint it across the arrangement.
- Channel Rack: one unified place to see every instrument at once, open any of them with a click.
- Piano Roll is widely held to be the best in any DAW. Ghost notes, chord/scale helpers, strumize, arpeggiate, flip/mirror, glue.
- Right-click-everything discoverability.
- Mixer with visible send cables.

**Bad.**
- Clip-grid session view: doesn't really have one.
- Audio warping is weaker than Ableton/Logic.
- Stock plugins look dated; UX is crowded.

**Takeaway for Bassmash.**
- Adopt the *universal row* idea: every track is a row in one place. Drums show step cells inline, melodic tracks show a compact piano-roll preview that opens full on click. But **don't call it "Channel Rack"** — it's just the track list.
- Steal piano-roll gestures: ghost notes, strumize/arpeggiate as commands, flip horizontally/vertically.
- Right-click as a first-class input method for power users.

### Ableton Live

**Loved.**
- Session view. A grid of clip slots per track for idea capture and live performance. This alone keeps many producers on Ableton.
- Warping (elastic time-stretch to grid) is the gold standard. Lets you throw any audio at any tempo and it fits.
- Racks: group devices, expose macros, map any knob to any parameter.
- Follow actions: clips can chain probabilistically. Enables generative arrangements.

**Bad.**
- Automation editing clumsier than Logic or Bitwig.
- MIDI editing is weaker than FL or Cubase.

**Takeaway for Bassmash.**
- **The Session/Arrangement split is the single biggest UX idea in modern DAWs.** Bassmash should have both: a grid view for sketching ideas, an arrangement view for committing them. They are the same data, two views.
- Warping is table-stakes for any audio workflow. Put it in Phase 5.
- Follow actions are low cost, high coolness factor. Add post-Phase-5.

### Bitwig Studio

**Loved.**
- The Grid: a node-based modular synth/fx builder. Users make their own devices.
- Modulator routing: drag any modulator (LFO, envelope follower, step mod, etc.) onto any parameter — on any plugin, on any device. Universal automation without drawing lanes.
- Unified track type: one track holds audio *and* MIDI, promoted automatically by what you drop into it.
- Nested device chains. Drag-split a chain into parallel branches.

**Bad.**
- Less mature third-party plugin ecosystem than Ableton.
- Fewer tutorials; smaller community.

**Takeaway for Bassmash.**
- **Modulation-drag is revolutionary UX and nobody should ship a new DAW without it.** Design the parameter system so *any* modulator source can be dropped on *any* parameter without a dedicated "automation lane" ceremony.
- Unified track type: don't force the user to pick "audio track" vs "MIDI track" up front. Infer from content.
- Nested device chains: add once the effect system is registry-based (Phase 6).

### Logic Pro

**Loved.**
- Stock plugin quality is top-tier — Space Designer, ChromaVerb, Vintage EQ collection. Users ship final products using only stock plugins.
- Flex Time + Flex Pitch: warp and tune recorded audio non-destructively.
- Smart Tempo: detect the tempo of a recording automatically.
- Drummer: AI-generated virtual drummers that follow the project.

**Bad.**
- macOS only.
- Window management fiddly.
- Expensive one-time purchase is fine, but project format is closed.

**Takeaway for Bassmash.**
- **Ship good-sounding stock effects and instruments.** A DAW lives or dies by whether your first beat made with only built-ins sounds good.
- Smart Tempo detection: doable in a web worker with onset detection; worth Phase 5.
- Drummer-style generators: natural home for the existing `mcp-server/`.
- Flex Pitch / Flex Time: Phase 5 composition work.

### Reaper

**Loved.**
- Lightweight, fast install, runs anywhere.
- Everything scriptable (Lua, Python). Community has built wild extensions.
- Transparent: nothing is magic, every behaviour has a config checkbox.
- Cheap license, no DRM, respects the user.

**Bad.**
- Default UI is spartan-verging-on-ugly.
- New users hit a wall of options with no opinionated defaults.

**Takeaway for Bassmash.**
- **Transparency and scriptability are the right ethos for an AI-collaborative DAW.** The files-on-disk, CLI-drives-everything architecture already matches this philosophy. Lean into it.
- Have an opinionated default configuration so a new user isn't drowning. But expose everything.
- "Nothing is magic" is the right promise: project files are text, every action is a command, every mutation is a diff.

### Renoise (tracker)

**Loved.**
- Text-like grid editing: notes in a column, numeric effects columns. Keyboard-driven, no mouse needed. Extremely fast for dense composition.
- Phrases: reusable rhythmic/melodic units.
- Niche but passionate user base.

**Takeaway for Bassmash.**
- A *tracker view* of the piano roll is a Phase 4+ stretch goal. Sits naturally alongside the text-file project format — a tracker is basically a pattern file displayed in a grid.
- Keyboard-only editing should be a first-class mode at every view.

### Reason

**Loved.**
- Visible signal flow: flip the rack around and you see the actual patch cables. Huge learning tool.
- Combinators and the device rack metaphor.

**Takeaway for Bassmash.**
- Consider an *optional* cables-visible view of a track's effect chain — not the default, but available. Fits with the "nothing is magic" ethos.

### Studio One, Cubase, Pro Tools

**Loved in brief.**
- **Studio One:** drag-drop everything, everywhere. No mode switching.
- **Cubase:** Chord Track (map out the song's chord progression, instruments snap to it).
- **Pro Tools:** industry-standard mix console layout.

**Takeaway.**
- Drag-drop everywhere is cheap to commit to early and pays off forever. Any UI interaction that could be "a menu and a picker" should first try "drag this thing into that thing."
- Chord Track is a great Phase 5 feature for the intended hip-hop/beatmaking use case.

---

## 2. What Bassmash is (and isn't)

### Is

- **Browser-first.** Zero install for the user. Share by link. Collaborate later (Phase 10).
- **Files-on-disk, text where reasonable.** Every project is a folder you can open in any editor. Git works. `grep` works. Diffs are meaningful. Me — Claude — can read the files as native input and edit them as native output.
- **CLI-native.** The CLI is a first-class way to edit a project. Anything the UI can do, the CLI can do. MCP server reuses the CLI primitives.
- **AI-collaborative by design.** The MCP server + typed project format + atomic writes + history = an AI can drive the DAW competently.
- **Performance-grade.** The roadmap in `plan.md` takes it from browser-toy to studio-quality audio.

### Is not

- Not "baby FL." Not a clone of anything.
- Not aimed at a specific genre. Hip-hop/beatmaking is the early adopter, but the engine is general.
- Not trying to be Ableton's session view + FL's channel rack + Bitwig's grid simultaneously. Pick one great idea per workflow stage, not all of them.
- Not plugin-host-focused in the short term. Stock sound quality first. Plugin hosting comes later (Phase 8 / 9).

---

## 3. Synthesised direction

A short list of deliberate choices, each drawn from above.

1. **Unified track list (from FL).** One panel shows every track. Drum tracks render inline step cells. Melodic tracks render a compact piano-roll preview that opens full on click. No second panel called "Channel Rack" that's empty for most tracks. Replaces the current `channel-rack` + `timeline-headers` duplication.

2. **Session view + Arrangement view (from Ableton).** Two presentations of the same data. Session for idea capture; Arrangement for committing the song. A clip in the session can be "promoted" to a timeline clip. Lands Phase 3 or 4 once panels are proper components.

3. **Modulation-drag (from Bitwig).** Every parameter accepts a dropped modulator. No first-class / second-class params, no separate automation lane ceremony for simple cases. Lanes still exist for explicit automation curves. Architectural prerequisite: parameter system with unique IDs (comes out of Phase 1 command layer naturally).

4. **Stock sound quality as a non-negotiable (from Logic).** The built-in synth, effects, and drum kit must sound *good*. Not placeholder-good. Landmark to hit by end of Phase 6 (effects maturity).

5. **Transparency + scriptability (from Reaper).** Files are text. CLI can do everything. No hidden magic. Already in place; protect it as the project grows.

6. **Drag-drop as primary interaction (from Studio One).** New rule: any common action should be reachable by drag-drop before it gets a menu. Audio file onto timeline → create audio track. Sample onto step row → assign sample. Effect onto track → insert effect. Modulator onto parameter → mod link. Apply as we revisit each panel.

7. **Keyboard-only mode (from Reaper + Renoise).** Nothing requires the mouse. Phase 3 hotkeys cover this for the primary flows.

8. **CLI / MCP equivalence (Bassmash-native).** Every UI action corresponds to a CLI / MCP command. Running `bassmash-cli tune demo foo` and clicking through the UI to build the same tune produce identical `project.json`.

---

## 4. What this changes in the roadmap

The roadmap in `docs/plan.md` and `docs/architecture-and-roadmap.md` already covers most of what's here. Three specific adjustments:

- **Drop the "baby FL" framing everywhere.** Done in `idea.md`. Anywhere else that language appears, replace with "modern browser DAW" or the specific influence being drawn from.
- **Phase 3 UX parity work now includes a unified track list** (replacing the Channel Rack + timeline-header split), not a polish of the existing layout.
- **Phase 5 composition work includes modulation-drag** as a first-class requirement of the parameter system, not an afterthought.

No phase re-ordering; these fit inside the existing phases.
