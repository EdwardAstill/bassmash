"""M8S CLI — filesystem-direct project editor.

Edits files under ``$M8S_PROJECTS_DIR`` (default ``~/m8s-projects``).
Does not talk to the backend. The backend serves the same files to the browser;
when this CLI changes a file, reload the project in the browser to see it.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable, NoReturn, TypeVar

import typer

from cli import project_ops as ops
from cli import store
from dataclasses import asdict as _asdict

T = TypeVar("T")

app = typer.Typer(
    name="m8s-cli",
    help="Filesystem-direct editor for M8S projects.",
    no_args_is_help=True,
    add_completion=False,
)

project_app = typer.Typer(help="Projects.", no_args_is_help=True)
bpm_app = typer.Typer(help="Tempo.", no_args_is_help=True)
track_app = typer.Typer(help="Tracks.", no_args_is_help=True)
pattern_app = typer.Typer(help="Patterns (drum grids and note sequences).", no_args_is_help=True)
arrange_app = typer.Typer(help="Arrangement clips on the timeline.", no_args_is_help=True)
sample_app = typer.Typer(help="Project samples folder.", no_args_is_help=True)
audio_app = typer.Typer(help="Project audio folder.", no_args_is_help=True)
kit_app = typer.Typer(help="Built-in drum kit.", no_args_is_help=True)
tune_app = typer.Typer(help="Prebuilt tunes and scaffolds.", no_args_is_help=True)
analyse_app = typer.Typer(help="Audio analysis (BPM, key, loudness, spectrum).", no_args_is_help=True)

app.add_typer(project_app, name="project")
app.add_typer(bpm_app, name="bpm")
app.add_typer(track_app, name="track")
app.add_typer(pattern_app, name="pattern")
app.add_typer(arrange_app, name="arrange")
app.add_typer(sample_app, name="sample")
app.add_typer(audio_app, name="audio")
app.add_typer(kit_app, name="kit")
app.add_typer(tune_app, name="tune")
app.add_typer(analyse_app, name="analyse")


def _fail(msg: str, code: int = 1) -> NoReturn:
    typer.echo(f"error: {msg}", err=True)
    raise typer.Exit(code=code)


def _do(fn: Callable[[], T]) -> T:
    """Run a filesystem op, turn common exceptions into clean CLI errors."""
    try:
        return fn()
    except FileExistsError as e:
        _fail(str(e))
    except FileNotFoundError as e:
        _fail(str(e))
    except (ValueError, IndexError) as e:
        _fail(str(e))


def _load(name: str) -> dict[str, Any]:
    return _do(lambda: store.read_project(name))


def _save(name: str, data: dict[str, Any]) -> None:
    _do(lambda: store.write_project(name, data))


# ======================= project =======================

@project_app.command("list")
def project_list() -> None:
    names = store.list_projects()
    if not names:
        typer.echo("(no projects)")
        return
    for n in names:
        typer.echo(n)


@project_app.command("create")
def project_create(name: str) -> None:
    _do(lambda: store.create_project(name))
    typer.echo(f"created: {name}  ({store.project_path(name)})")


@project_app.command("delete")
def project_delete(
    name: str,
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation."),
) -> None:
    if not yes:
        typer.confirm(f"Delete project '{name}' permanently?", abort=True)
    _do(lambda: store.delete_project(name))
    typer.echo(f"deleted: {name}")


@project_app.command("show")
def project_show(
    name: str,
    raw: bool = typer.Option(False, "--raw", help="Compact JSON."),
) -> None:
    data = _load(name)
    typer.echo(json.dumps(data, indent=None if raw else 2))


@project_app.command("summary")
def project_summary(name: str) -> None:
    data = _load(name)
    bpm = data.get("bpm", "?")
    tracks = data.get("tracks", [])
    patterns = data.get("patterns", [])
    arrangement = data.get("arrangement", [])
    typer.echo(
        f"{name}: bpm={bpm} tracks={len(tracks)} "
        f"patterns={len(patterns)} clips={len(arrangement)}"
    )
    for i, t in enumerate(tracks):
        typer.echo(f"  track[{i}] {t.get('type', '?'):<6} {t.get('name', '')}")
    for i, p in enumerate(patterns):
        kind = p.get("type", "?")
        if kind == "steps":
            rows = len(p.get("steps", []))
            sc = p.get("stepCount", 16)
            typer.echo(f"  pattern[{i}] steps  rows={rows} stepCount={sc}  name={p.get('name', '')}")
        else:
            n = len(p.get("notes", []))
            ln = p.get("length", 64)
            typer.echo(f"  pattern[{i}] notes  notes={n} length={ln}  name={p.get('name', '')}")
    for i, c in enumerate(arrangement):
        t = c.get("trackIndex")
        s, e = c.get("startBeat", 0), c.get("startBeat", 0) + c.get("lengthBeats", 0)
        if c.get("type") == "audio":
            typer.echo(f"  clip[{i}] track={t} beats={s}..{e}  audio={c.get('audioRef')}")
        else:
            typer.echo(f"  clip[{i}] track={t} pattern={c.get('patternIndex')} beats={s}..{e}")


@project_app.command("path")
def project_path_(name: str) -> None:
    typer.echo(str(store.project_path(name)))


# ======================= bpm =======================

@bpm_app.command("get")
def bpm_get(project: str) -> None:
    data = _load(project)
    typer.echo(str(data.get("bpm", "?")))


@bpm_app.command("set")
def bpm_set(project: str, bpm: int) -> None:
    data = _load(project)
    _do(lambda: ops.set_bpm(data, bpm))
    _save(project, data)
    typer.echo(f"bpm = {bpm}")


# ======================= track =======================

@track_app.command("list")
def track_list(project: str) -> None:
    data = _load(project)
    for i, t in enumerate(data.get("tracks", [])):
        typer.echo(
            f"[{i}] {t.get('type', '?'):<6} name={t.get('name', '')!r} "
            f"vol={t.get('volume', 1)} pan={t.get('pan', 0)} "
            f"mute={t.get('muted', False)} solo={t.get('soloed', False)}"
        )


@track_app.command("add")
def track_add(
    project: str,
    name: str = typer.Option(..., "--name", "-n"),
    kind: str = typer.Option("synth", "--kind", "-k", help="synth | sample | audio"),
) -> None:
    data = _load(project)
    idx = _do(lambda: ops.add_track(data, name, kind))
    _save(project, data)
    typer.echo(f"added track[{idx}] {kind}  {name!r}")


@track_app.command("rm")
def track_rm(project: str, index: int) -> None:
    data = _load(project)
    _do(lambda: ops.remove_track(data, index))
    _save(project, data)
    typer.echo(f"removed track[{index}]")


@track_app.command("set")
def track_set(
    project: str,
    index: int,
    name: str | None = typer.Option(None, "--name"),
    volume: float | None = typer.Option(None, "--volume"),
    pan: float | None = typer.Option(None, "--pan"),
    mute: bool | None = typer.Option(None, "--mute/--no-mute"),
    solo: bool | None = typer.Option(None, "--solo/--no-solo"),
) -> None:
    data = _load(project)
    updated: list[str] = []
    for field, value in [("name", name), ("volume", volume), ("pan", pan),
                         ("muted", mute), ("soloed", solo)]:
        if value is not None:
            _do(lambda f=field, v=value: ops.set_track_field(data, index, f, v))
            updated.append(f"{field}={value}")
    _save(project, data)
    typer.echo(f"track[{index}] {' '.join(updated) or '(no changes)'}")


# ======================= pattern =======================

@pattern_app.command("list")
def pattern_list(project: str) -> None:
    data = _load(project)
    for i, p in enumerate(data.get("patterns", [])):
        if p.get("type") == "steps":
            rows = len(p.get("steps", []))
            typer.echo(f"[{i}] steps  rows={rows} stepCount={p.get('stepCount', 16)}  name={p.get('name', '')!r}")
        else:
            typer.echo(f"[{i}] notes  notes={len(p.get('notes', []))} length={p.get('length', 64)}  name={p.get('name', '')!r}")


@pattern_app.command("add-drums")
def pattern_add_drums(
    project: str,
    name: str = typer.Option(..., "--name", "-n"),
    steps: int = typer.Option(16, "--steps", "-s"),
) -> None:
    data = _load(project)
    idx = ops.add_drum_pattern(data, name, step_count=steps)
    _save(project, data)
    typer.echo(f"added pattern[{idx}] drums/{steps}-step  {name!r}")


@pattern_app.command("add-synth")
def pattern_add_synth(
    project: str,
    name: str = typer.Option(..., "--name", "-n"),
    length: int = typer.Option(64, "--length", "-l"),
) -> None:
    data = _load(project)
    idx = ops.add_synth_pattern(data, name, length=length)
    _save(project, data)
    typer.echo(f"added pattern[{idx}] synth/length={length}  {name!r}")


@pattern_app.command("step-row")
def pattern_step_row(
    project: str,
    pattern: int,
    name: str = typer.Option(..., "--name", "-n", help="Row name (e.g. Kick). Re-using a name replaces the row."),
    sample: str = typer.Option(..., "--sample", "-s", help="Sample ref, e.g. kit://kick-punchy.wav"),
    cells: str = typer.Option(..., "--cells", "-c", help="Cell string, e.g. '1000 0000 1000 0000' (spaces/dashes ignored)"),
) -> None:
    data = _load(project)
    pattern_obj = data.get("patterns", [])[pattern] if pattern < len(data.get("patterns", [])) else None
    step_count = (pattern_obj or {}).get("stepCount", 16) if pattern_obj else 16
    parsed = _do(lambda: ops.parse_cells(cells, step_count))
    idx = _do(lambda: ops.set_drum_row(data, pattern, name, sample, parsed))
    _save(project, data)
    typer.echo(f"pattern[{pattern}] row[{idx}] {name!r}  -> {''.join('1' if c else '0' for c in parsed)}")


@pattern_app.command("step-clear")
def pattern_step_clear(project: str, pattern: int) -> None:
    data = _load(project)
    _do(lambda: ops.clear_drum_pattern(data, pattern))
    _save(project, data)
    typer.echo(f"pattern[{pattern}] cleared")


@pattern_app.command("notes-add")
def pattern_notes_add(
    project: str,
    pattern: int,
    pitch: int = typer.Option(..., "--pitch", "-p"),
    start: int = typer.Option(..., "--start", "-s"),
    duration: int = typer.Option(..., "--duration", "-d"),
    velocity: int = typer.Option(100, "--velocity", "-v"),
) -> None:
    data = _load(project)
    _do(lambda: ops.add_note(data, pattern, pitch, start, duration, velocity))
    _save(project, data)
    typer.echo(f"pattern[{pattern}] + note pitch={pitch} start={start} dur={duration} vel={velocity}")


@pattern_app.command("notes-add-many")
def pattern_notes_add_many(
    project: str,
    pattern: int,
    notes: str = typer.Option(..., "--notes", help="'pitch:start:duration[:velocity],...'"),
) -> None:
    data = _load(project)
    parsed = _do(lambda: ops.parse_notes(notes))
    for n in parsed:
        _do(lambda n=n: ops.add_note(data, pattern, **n))
    _save(project, data)
    typer.echo(f"pattern[{pattern}] + {len(parsed)} notes")


@pattern_app.command("notes-clear")
def pattern_notes_clear(project: str, pattern: int) -> None:
    data = _load(project)
    _do(lambda: ops.clear_notes(data, pattern))
    _save(project, data)
    typer.echo(f"pattern[{pattern}] notes cleared")


# ======================= arrange =======================

@arrange_app.command("list")
def arrange_list(project: str) -> None:
    data = _load(project)
    for i, c in enumerate(data.get("arrangement", [])):
        s = c.get("startBeat", 0)
        e = s + c.get("lengthBeats", 0)
        if c.get("type") == "audio":
            typer.echo(f"[{i}] track={c.get('trackIndex')} audio={c.get('audioRef')} beats={s}..{e}")
        else:
            typer.echo(f"[{i}] track={c.get('trackIndex')} pattern={c.get('patternIndex')} beats={s}..{e}")


@arrange_app.command("add")
def arrange_add(
    project: str,
    track: int = typer.Option(..., "--track", "-t"),
    pattern: int = typer.Option(..., "--pattern", "-p"),
    start: int = typer.Option(..., "--start", "-s", help="Start beat."),
    length: int = typer.Option(..., "--length", "-l", help="Length in beats."),
) -> None:
    data = _load(project)
    _do(lambda: ops.add_clip(data, track, pattern, start, length))
    _save(project, data)
    typer.echo(f"+ clip track={track} pattern={pattern} beats={start}..{start + length}")


@arrange_app.command("add-audio")
def arrange_add_audio(
    project: str,
    track: int = typer.Option(..., "--track", "-t"),
    ref: str = typer.Option(..., "--ref", "-r", help="Audio filename under audio/"),
    start: int = typer.Option(..., "--start", "-s"),
    length: int = typer.Option(..., "--length", "-l"),
    offset: int = typer.Option(0, "--offset", "-o"),
) -> None:
    data = _load(project)
    _do(lambda: ops.add_audio_clip(data, track, ref, start, length, offset))
    _save(project, data)
    typer.echo(f"+ audio clip track={track} ref={ref} beats={start}..{start + length}")


@arrange_app.command("clear")
def arrange_clear(project: str) -> None:
    data = _load(project)
    ops.clear_arrangement(data)
    _save(project, data)
    typer.echo("arrangement cleared")


# ======================= sample / audio / kit =======================

@sample_app.command("list")
def sample_list(project: str) -> None:
    for f in _do(lambda: store.list_samples(project)):
        typer.echo(f)


@sample_app.command("add")
def sample_add(project: str, file: Path = typer.Argument(..., exists=True, readable=True)) -> None:
    dst = _do(lambda: store.add_sample(project, file))
    typer.echo(f"copied: {dst}")


@audio_app.command("list")
def audio_list(project: str) -> None:
    for f in _do(lambda: store.list_audio(project)):
        typer.echo(f)


@audio_app.command("add")
def audio_add(project: str, file: Path = typer.Argument(..., exists=True, readable=True)) -> None:
    dst = _do(lambda: store.add_audio(project, file))
    typer.echo(f"copied: {dst}")


@kit_app.command("list")
def kit_list() -> None:
    files = store.list_kit()
    if not files:
        typer.echo("(no kit samples found — set M8S_KIT_DIR?)")
        return
    for f in files:
        typer.echo(f)


# ======================= tune =======================

@tune_app.command("demo")
def tune_demo(project: str) -> None:
    """Populate a project with a Yeat-style 8-bar beat (150bpm F-minor, trap drums + sliding 808 + bell arp)."""
    data = _load(project)
    ops.build_demo_tune(data)
    _save(project, data)
    typer.echo(f"{project}: Yeat-style demo written  (8 bars, {data['bpm']} bpm, drums + 808 + bells)")


# ======================= analyse =======================

def _resolve_audio(project: str | None, file_or_ref: str) -> Path:
    """Accept either a raw path or 'project:filename-in-audio/'."""
    p = Path(file_or_ref)
    if p.exists():
        return p
    if project:
        cand = store.project_path(project) / "audio" / file_or_ref
        if cand.exists():
            return cand
    _fail(f"audio file not found: {file_or_ref}")


def _pretty_json(obj: Any) -> str:
    return json.dumps(obj, indent=2)


@analyse_app.command("bpm")
def analyse_bpm(
    file: str,
    project: str | None = typer.Option(None, "--project", "-p"),
) -> None:
    """Detect BPM of an audio file."""
    from cli import analysis
    path = _resolve_audio(project, file)
    r = analysis.analyse_bpm(path)
    typer.echo(_pretty_json(_asdict(r)))


@analyse_app.command("key")
def analyse_key(
    file: str,
    project: str | None = typer.Option(None, "--project", "-p"),
) -> None:
    """Detect musical key (pitch + major/minor)."""
    from cli import analysis
    path = _resolve_audio(project, file)
    r = analysis.analyse_key(path)
    typer.echo(_pretty_json(_asdict(r)))


@analyse_app.command("loudness")
def analyse_loudness(
    file: str,
    project: str | None = typer.Option(None, "--project", "-p"),
) -> None:
    """Peak + RMS loudness in dBFS."""
    from cli import analysis
    path = _resolve_audio(project, file)
    r = analysis.analyse_loudness(path)
    typer.echo(_pretty_json(_asdict(r)))


@analyse_app.command("spectrum")
def analyse_spectrum_cmd(
    file: str,
    project: str | None = typer.Option(None, "--project", "-p"),
) -> None:
    """Spectral centroid, rolloff, flatness."""
    from cli import analysis
    path = _resolve_audio(project, file)
    r = analysis.analyse_spectrum(path)
    typer.echo(_pretty_json(_asdict(r)))


@analyse_app.command("full")
def analyse_full_cmd(
    file: str,
    project: str | None = typer.Option(None, "--project", "-p"),
) -> None:
    """Full report: BPM + key + loudness + spectrum."""
    from cli import analysis
    path = _resolve_audio(project, file)
    r = analysis.analyse_full(path)
    typer.echo(_pretty_json(r.as_dict()))


@analyse_app.command("batch")
def analyse_batch(
    project: str,
    bpm_only: bool = typer.Option(False, "--bpm-only", help="Only compute BPM (fast)."),
) -> None:
    """Analyse every audio file in a project. Tab-separated summary."""
    from cli import analysis
    audio_dir = store.project_path(project) / "audio"
    if not audio_dir.exists():
        _fail(f"no audio folder for project {project}")
    files = sorted(
        f for f in audio_dir.iterdir()
        if f.is_file() and f.suffix.lower() in {".mp3", ".wav", ".ogg", ".flac"}
    )
    if not files:
        typer.echo("(no audio files)")
        return

    header = "file\tbpm" if bpm_only else "file\tbpm\tkey\tkey_conf\trms_dbfs\tcentroid_hz"
    typer.echo(header)
    for f in files:
        try:
            if bpm_only:
                r = analysis.analyse_bpm(f)
                typer.echo(f"{f.name}\t{r.bpm}")
            else:
                r = analysis.analyse_full(f)
                typer.echo(
                    f"{f.name}\t{r.bpm.bpm}\t{r.key.key_mode}\t{r.key.confidence}\t"
                    f"{r.loudness.rms_dbfs}\t{r.spectrum.centroid_hz_mean}"
                )
        except Exception as e:
            typer.echo(f"{f.name}\tERROR: {e}")


@analyse_app.command("compare")
def analyse_compare(
    file_a: str,
    file_b: str,
    project: str | None = typer.Option(None, "--project", "-p"),
) -> None:
    """Side-by-side analysis of two files."""
    from cli import analysis
    a = analysis.analyse_full(_resolve_audio(project, file_a))
    b = analysis.analyse_full(_resolve_audio(project, file_b))

    def row(label: str, va: Any, vb: Any) -> str:
        return f"  {label:<22} {str(va):<20} {str(vb)}"

    typer.echo(f"A: {a.bpm.file}")
    typer.echo(f"B: {b.bpm.file}")
    typer.echo("")
    typer.echo(row("", "A", "B"))
    typer.echo(row("bpm",       a.bpm.bpm,           b.bpm.bpm))
    typer.echo(row("key",       a.key.key_mode,      b.key.key_mode))
    typer.echo(row("key conf.", a.key.confidence,    b.key.confidence))
    typer.echo(row("peak dBFS", a.loudness.peak_dbfs, b.loudness.peak_dbfs))
    typer.echo(row("rms dBFS",  a.loudness.rms_dbfs,  b.loudness.rms_dbfs))
    typer.echo(row("dyn range", a.loudness.dynamic_range_db, b.loudness.dynamic_range_db))
    typer.echo(row("centroid",  f"{a.spectrum.centroid_hz_mean} Hz", f"{b.spectrum.centroid_hz_mean} Hz"))
    typer.echo(row("rolloff",   f"{a.spectrum.rolloff_hz_mean} Hz",  f"{b.spectrum.rolloff_hz_mean} Hz"))
    typer.echo(row("flatness",  a.spectrum.flatness_mean,  b.spectrum.flatness_mean))


# ======================= misc =======================

@app.command("version")
def version() -> None:
    typer.echo("m8s-cli 0.1.0 (filesystem-direct)")


@app.command("where")
def where() -> None:
    """Print where project files live."""
    typer.echo(f"projects: {store.projects_dir()}")
    typer.echo(f"kit:      {store.kit_dir()}")


def _main() -> int:  # pragma: no cover
    try:
        app()
        return 0
    except SystemExit as e:
        return int(e.code or 0)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_main())
