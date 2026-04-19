# `bassmash-cli` — Command Reference

Filesystem-direct editor for Bassmash projects. Edits land atomically in `~/bassmash-projects/<name>/project.json` (or the directory named by `$BASSMASH_PROJECTS_DIR`). The browser picks the change up within ~500 ms via SSE.

## Install

Once, from the repo root:

```bash
uv tool install --editable .
```

This puts `bassmash-cli` in `~/.local/bin` and keeps it tracking the source so code changes take effect without re-installing.

```bash
bassmash-cli --help
bassmash-cli <subcommand> --help
```

## Environment

```bash
BASSMASH_PROJECTS_DIR=/path/to/projects     # default: ~/bassmash-projects
BASSMASH_KIT_DIR=/path/to/kit               # default: <repo>/kit
```

## Top-level

| Command  | Purpose |
|----------|---------|
| `version` | Print CLI version. |
| `where`   | Print `$BASSMASH_PROJECTS_DIR` and `$BASSMASH_KIT_DIR`. |

## `project`

```bash
bassmash-cli project list                          # list all projects
bassmash-cli project create <name>                 # create empty project (140 BPM, no tracks)
bassmash-cli project delete <name> [--yes]         # delete (prompts unless --yes)
bassmash-cli project show <name> [--raw]           # dump project.json (raw = compact)
bassmash-cli project summary <name>                # tracks / patterns / clips at a glance
bassmash-cli project path <name>                   # print absolute path to project dir
```

Project names must match `^[A-Za-z0-9._-]+$` — the backend applies the same rule.

## `bpm`

```bash
bassmash-cli bpm get <project>
bassmash-cli bpm set <project> <bpm>               # 20..300
```

BPM is the base tempo. Tempo changes at specific beats are edited via the browser global strip (and persisted in `project.json::tempoChanges`).

## `track`

```bash
bassmash-cli track list <project>
bassmash-cli track add  <project> --name <N> --kind synth|sample|audio
bassmash-cli track rm   <project> <index>
bassmash-cli track set  <project> <index> \
    [--name <N>] [--volume <0..1.5>] [--pan <-1..1>] \
    [--mute | --no-mute] [--solo | --no-solo]
```

Removing a track also cleans up any arrangement clips referencing it and shifts higher track indices down.

## `pattern`

Drum / step patterns (`type: steps`) and synth / note patterns (`type: notes`).

```bash
# create
bassmash-cli pattern add-drums <project> --name <N> [--steps 16]
bassmash-cli pattern add-synth <project> --name <N> [--length 64]

# list
bassmash-cli pattern list <project>

# drum rows — upsert-by-name
bassmash-cli pattern step-row <project> <pattern_idx> \
    --name Kick \
    --sample kit://kick-deep.wav \
    --cells "1000 0000 1000 0000"
bassmash-cli pattern step-clear <project> <pattern_idx>

# synth notes — pitch:start:duration[:velocity], comma-separated
bassmash-cli pattern notes-add      <project> <pattern_idx> \
    --pitch 60 --start 0 --duration 4 [--velocity 100]
bassmash-cli pattern notes-add-many <project> <pattern_idx> \
    --notes "60:0:4:100,64:4:4,67:8:4"
bassmash-cli pattern notes-clear    <project> <pattern_idx>
```

`--cells` accepts `1`/`x`/`X` for on, anything else for off. Spaces, dashes, and underscores are ignored so you can group the string visually.

Re-using the same `--name` on `step-row` replaces that row instead of appending.

## `arrange`

Place pattern clips or audio clips on the timeline.

```bash
bassmash-cli arrange list   <project>
bassmash-cli arrange add    <project> --track <t> --pattern <p> --start <beat> --length <beats>
bassmash-cli arrange add-audio <project> --track <t> --ref <filename> \
    --start <beat> --length <beats> [--offset <beat>]
bassmash-cli arrange clear  <project>
```

`--ref` for audio clips is the filename inside the project's `audio/` folder (uploaded via the browser File tab or the `audio add` command).

## `sample` / `audio`

Copy files into the project's folders so the browser can reference them.

```bash
bassmash-cli sample list <project>
bassmash-cli sample add  <project> <path-to-file>        # copied into <project>/samples/

bassmash-cli audio list  <project>
bassmash-cli audio add   <project> <path-to-file>        # copied into <project>/audio/
```

## `kit`

```bash
bassmash-cli kit list           # names under $BASSMASH_KIT_DIR
```

Files found here are addressable as `kit://<filename>` from pattern rows and the sampler.

## `tune`

```bash
bassmash-cli tune demo <project>
```

Populates the project with a Yeat-style 8-bar beat at 150 BPM / F minor — trap drums, sliding 808, bell arp. Idempotent (clears existing tracks/patterns/arrangement first). Useful as a non-trivial starting point.

## `analyse`

librosa-backed audio analysis. Reads the file directly; no project involved.

```bash
bassmash-cli analyse bpm       <file>          # onset-based tempo + confidence
bassmash-cli analyse key       <file>          # Krumhansl-Schmuckler key match
bassmash-cli analyse loudness  <file>          # peak + RMS dBFS
bassmash-cli analyse spectrum  <file>          # centroid, rolloff, flatness
bassmash-cli analyse full      <file>          # all of the above
bassmash-cli analyse batch     <project>       # tab-separated summary for every audio file in the project
bassmash-cli analyse compare   <file> <file>   # side-by-side diff
```

## Errors

Every command exits non-zero with `error: <message>` on stderr for:

- Project / pattern / track index not found
- BPM / velocity / pitch out of range
- Invalid project name (see rule above)
- Cells string length mismatching the pattern's `stepCount`

Ranges are enforced in `cli/project_ops.py` so the CLI, the MCP server, and any future caller share the same validation.
