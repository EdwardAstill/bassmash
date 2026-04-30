# `m8s-cli` — Command Reference

Filesystem-direct editor for M8S projects. Edits land atomically in `~/m8s-projects/<name>/project.json` (or the directory named by `$M8S_PROJECTS_DIR`) via `cli/store.py::write_project` — tempfile + fsync + `os.replace`. The browser picks the change up within ~500 ms via SSE.

Every CLI command routes through the same disk-IO layer the FastAPI backend and the MCP server use, so CLI / browser autosave / AI agent edits never corrupt each other. Last writer wins; there's no multi-writer conflict detection.

## Install

Once, from the repo root:

```bash
uv tool install --editable .
```

This puts `m8s-cli` in `~/.local/bin` and keeps it tracking the source so code changes take effect without re-installing.

```bash
m8s-cli --help
m8s-cli <subcommand> --help
```

## Environment

```bash
M8S_PROJECTS_DIR=/path/to/projects     # default: ~/m8s-projects
M8S_KIT_DIR=/path/to/kit               # default: <repo>/kit
```

## Top-level

| Command  | Purpose |
|----------|---------|
| `version` | Print CLI version. |
| `where`   | Print `$M8S_PROJECTS_DIR` and `$M8S_KIT_DIR`. |

## `project`

```bash
m8s-cli project list                          # list all projects
m8s-cli project create <name>                 # create empty project (140 BPM, no tracks)
m8s-cli project delete <name> [--yes]         # delete (prompts unless --yes)
m8s-cli project show <name> [--raw]           # dump project.json (raw = compact)
m8s-cli project summary <name>                # tracks / patterns / clips at a glance
m8s-cli project path <name>                   # print absolute path to project dir
```

Project names must match `^[A-Za-z0-9._-]+$` — the backend applies the same rule.

## `bpm`

```bash
m8s-cli bpm get <project>
m8s-cli bpm set <project> <bpm>               # 20..300
```

BPM is the base tempo. Tempo changes at specific beats are edited via the browser global strip (and persisted in `project.json::tempoChanges`).

## `track`

```bash
m8s-cli track list <project>
m8s-cli track add  <project> --name <N> --kind synth|sample|audio
m8s-cli track rm   <project> <index>
m8s-cli track set  <project> <index> \
    [--name <N>] [--volume <0..1.5>] [--pan <-1..1>] \
    [--mute | --no-mute] [--solo | --no-solo]
```

Removing a track also cleans up any arrangement clips referencing it and shifts higher track indices down.

## `pattern`

Drum / step patterns (`type: steps`) and synth / note patterns (`type: notes`).

```bash
# create
m8s-cli pattern add-drums <project> --name <N> [--steps 16]
m8s-cli pattern add-synth <project> --name <N> [--length 64]

# list
m8s-cli pattern list <project>

# drum rows — upsert-by-name
m8s-cli pattern step-row <project> <pattern_idx> \
    --name Kick \
    --sample kit://kick-deep.wav \
    --cells "1000 0000 1000 0000"
m8s-cli pattern step-clear <project> <pattern_idx>

# synth notes — pitch:start:duration[:velocity], comma-separated
m8s-cli pattern notes-add      <project> <pattern_idx> \
    --pitch 60 --start 0 --duration 4 [--velocity 100]
m8s-cli pattern notes-add-many <project> <pattern_idx> \
    --notes "60:0:4:100,64:4:4,67:8:4"
m8s-cli pattern notes-clear    <project> <pattern_idx>
```

`--cells` accepts `1`/`x`/`X` for on, anything else for off. Spaces, dashes, and underscores are ignored so you can group the string visually.

Re-using the same `--name` on `step-row` replaces that row instead of appending.

## `arrange`

Place pattern clips or audio clips on the timeline.

```bash
m8s-cli arrange list   <project>
m8s-cli arrange add    <project> --track <t> --pattern <p> --start <beat> --length <beats>
m8s-cli arrange add-audio <project> --track <t> --ref <filename> \
    --start <beat> --length <beats> [--offset <beat>]
m8s-cli arrange clear  <project>
```

`--ref` for audio clips is the filename inside the project's `audio/` folder (uploaded via the browser File tab or the `audio add` command).

## `sample` / `audio`

Copy files into the project's folders so the browser can reference them.

```bash
m8s-cli sample list <project>
m8s-cli sample add  <project> <path-to-file>        # copied into <project>/samples/

m8s-cli audio list  <project>
m8s-cli audio add   <project> <path-to-file>        # copied into <project>/audio/
```

## `kit`

```bash
m8s-cli kit list           # names under $M8S_KIT_DIR
```

Files found here are addressable as `kit://<filename>` from pattern rows and the sampler.

## `tune`

```bash
m8s-cli tune demo <project>
```

Populates the project with a Yeat-style 8-bar beat at 150 BPM / F minor — trap drums, sliding 808, bell arp. Idempotent (clears existing tracks/patterns/arrangement first). Useful as a non-trivial starting point.

## `analyse`

librosa-backed audio analysis. Reads the file directly; no project involved.

```bash
m8s-cli analyse bpm       <file>          # onset-based tempo + confidence
m8s-cli analyse key       <file>          # Krumhansl-Schmuckler key match
m8s-cli analyse loudness  <file>          # peak + RMS dBFS
m8s-cli analyse spectrum  <file>          # centroid, rolloff, flatness
m8s-cli analyse full      <file>          # all of the above
m8s-cli analyse batch     <project>       # tab-separated summary for every audio file in the project
m8s-cli analyse compare   <file> <file>   # side-by-side diff
```

## Errors

Every command exits non-zero with `error: <message>` on stderr for:

- Project / pattern / track index not found
- BPM / velocity / pitch out of range
- Invalid project name (must match `^[A-Za-z0-9._-]+$`)
- Cells string length mismatching the pattern's `stepCount`

Ranges are enforced in `cli/project_ops.py` so the CLI, the MCP server, and any future caller share the same validation.

## Gaps between CLI and MCP

CLI is the superset for audio-clip placement and the built-in `analyse` commands. MCP is the superset for generative + bulk operations (`generate_beat`, `replicate_from_audio`, `set_track_automation`, `set_synth_params`, `set_tempo_changes`, `set_markers`). The canonical data model is identical — both write the same `project.json` shape documented in [`project-format.md`](./project-format.md).

## See also

- [`project-format.md`](./project-format.md) — the on-disk schema the CLI reads and writes.
- [`mcp.md`](./mcp.md) — the 22 MCP tools for AI-driven editing.
- [`api.md`](./api.md) — the HTTP API the browser uses. Same atomic writes.
- [`development.md`](./development.md) — setup, testing, and contributing guide.
