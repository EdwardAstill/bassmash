# MCP Server — AI Tool Catalog

`mcp-server/server.py` exposes Bassmash's filesystem-direct operations as Model Context Protocol tools, so Claude (or any MCP client) can compose, edit, and inspect projects with structured tool calls instead of raw file edits.

Tools land in the same `~/bassmash-projects/<name>/project.json` via the same atomic writes the CLI uses. Any open browser tab reloads within ~500 ms via SSE.

## Run it

```bash
cd mcp-server
uv sync
uv run python server.py
```

## Connect it

Add to your MCP client config (Claude Desktop, Claude Code, etc):

```json
{
  "mcpServers": {
    "bassmash-mcp": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/bassmash/mcp-server", "run", "python", "server.py"]
    }
  }
}
```

Restart the client. Tools show up as `mcp__bassmash-mcp__<name>`.

---

## Tool catalog (16 tools)

### Read-only — for the agent to inspect state

| Tool | Description |
|------|-------------|
| `list_projects` | Enumerate projects in `$BASSMASH_PROJECTS_DIR` with bpm + track count. |
| `get_project(project_name)` | Full dump: tracks, patterns, arrangement, markers, tempo changes. |
| `list_kit_samples` | Every sample under `$BASSMASH_KIT_DIR` — useful before picking `sample_ref`s. |

### Generative — the interesting ones

#### `generate_beat(prompt, project_name, bars=4)`

Produces a full multi-track beat from a natural-language prompt and saves it as a new project.

- **Genres** — trap, boom bap, drill, lofi (detected from prompt keywords)
- **Elements** — mention `"808s"`, `"hi-hat rolls"`, `"heavy kicks"`, `"sparse"`, `"minimal"`; they influence pattern density and velocity variations
- **BPM** — specify explicitly like `"140bpm"`; otherwise picked per genre default

Examples:

```
generate_beat(prompt="trap beat 140bpm with heavy 808s and hi-hat rolls",
              project_name="trap-demo")

generate_beat(prompt="lofi 85bpm boom bap sparse minimal",
              project_name="lofi-chill",
              bars=8)
```

The resulting project is immediately playable in the browser (open or reload).

#### `replicate_from_audio(audio_path, project_name, bars=4)`

Analyses an MP3 / WAV (librosa BPM + band-onset detection) and reconstructs a drum pattern + tempo that approximates it. Writes out a new project. Useful for "give me a template in the style of this track."

### Write operations — all atomic via `cli/store.py`

| Tool | What it edits |
|------|---------------|
| `set_bpm(project_name, bpm)` | Base tempo. |
| `add_drum_track(project_name, name, sample_ref?)` | Adds a `type: sample` track. Optional `sample_ref` autopopulates a pattern row. |
| `add_synth_track(project_name, name, waveform?, …)` | Adds a `type: synth` track with synthesiser params. |
| `edit_drum_pattern(project_name, pattern_index, row_name, sample_ref, cells, velocities?)` | Upsert-by-name drum row. `cells` is the same `"1000 0000 …"` string format the CLI uses. |
| `edit_notes(project_name, pattern_index, notes)` | Replace the notes of a synth pattern. `notes` is `"pitch:start:duration[:velocity]"` comma-separated. |
| `mix_track(project_name, track_index, volume?, pan?, mute?, solo?)` | Per-track mixer settings. |
| `set_effects(project_name, track_index, eq?, distortion?, delay?, reverb?)` | Per-track FX wet mix / enable flags. |
| `set_arrangement(project_name, clips)` | Overwrite the whole arrangement with a list of clips. |
| `delete_track(project_name, track_index)` | Remove a track + all its arrangement clips, shift indices. |
| `duplicate_project(src_name, new_name)` | Copy `project.json` + samples/ + audio/ to a new project. |
| `clear_pattern(project_name, pattern_index)` | Wipe steps (or notes) on the given pattern. |

## Typical session

```
User  : "make me a lofi beat at 85 bpm and call it chill-demo"
Agent : generate_beat(prompt="lofi 85bpm", project_name="chill-demo")
      → "Saved chill-demo · 3 tracks · 85 BPM"

User  : "make the kick pattern more sparse"
Agent : get_project(project_name="chill-demo")
      → inspects, identifies drum pattern index
      → edit_drum_pattern(project_name="chill-demo",
                          pattern_index=0, row_name="Kick",
                          sample_ref="kit://kick-soft.wav",
                          cells="1000 0000 0000 0000")

User  : "louder 808s"
Agent : mix_track(project_name="chill-demo", track_index=1, volume=1.2)
```

Every write fires SSE → the browser tab already showing `chill-demo` reloads in place.

## When to prefer MCP vs CLI vs raw Edit

| Tool | Best for |
|------|----------|
| MCP  | AI / agent sessions — validated args, structured returns, high-level ops (`generate_beat`). |
| CLI  | Humans at a terminal, shell scripts, CI. |
| Raw `Edit` on `project.json` | Escape hatch when neither MCP nor CLI exposes the op. Rare — matches go through MCP or CLI first. |

All three paths end at `cli/store.py`'s atomic write, so mixing freely is safe.
