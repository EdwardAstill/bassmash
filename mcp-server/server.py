import json
import random
from pathlib import Path
from typing import Annotated

from fastmcp import FastMCP

mcp = FastMCP(
    "Bassmash",
    instructions=(
        "Music production MCP server for Bassmash DAW. "
        "Use generate_beat to create beats from text descriptions. "
        "Use replicate_from_audio to analyze an MP3 and recreate its beat pattern. "
        "Projects are saved to ~/bassmash-projects/ and can be opened in Bassmash."
    ),
)

PROJECTS_DIR = Path.home() / "bassmash-projects"

KIT_SAMPLES = {
    "kicks": ["kit://kick-punchy.wav", "kit://kick-deep.wav", "kit://kick-808.wav"],
    "snares": ["kit://snare-crisp.wav", "kit://snare-trap.wav", "kit://snare-clap.wav"],
    "hihats_closed": ["kit://hihat-closed.wav"],
    "hihats_open": ["kit://hihat-open.wav"],
    "hihats_pedal": ["kit://hihat-pedal.wav"],
    "bass": ["kit://bass-808-long.wav", "kit://bass-808-short.wav", "kit://bass-808-dist.wav"],
    "perc": ["kit://shaker.wav", "kit://cowbell.wav"],
}

# Genre templates: each maps genre keywords to typical pattern structures
GENRE_TEMPLATES = {
    "trap": {
        "bpm_range": (130, 160),
        "kick_pattern":    [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
        "snare_pattern":   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        "hihat_pattern":   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
        "hihat_vels":      [100,60,80,60, 100,60,80,60, 100,60,80,60, 100,60,80,60],
        "open_hat_pattern":[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
        "preferred_kick": "kit://kick-808.wav",
        "preferred_snare": "kit://snare-trap.wav",
    },
    "boom_bap": {
        "bpm_range": (85, 100),
        "kick_pattern":    [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
        "snare_pattern":   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        "hihat_pattern":   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
        "hihat_vels":      [100,0,80,0, 100,0,80,0, 100,0,80,0, 100,0,80,0],
        "open_hat_pattern":[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        "preferred_kick": "kit://kick-punchy.wav",
        "preferred_snare": "kit://snare-crisp.wav",
    },
    "drill": {
        "bpm_range": (140, 150),
        "kick_pattern":    [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
        "snare_pattern":   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
        "hihat_pattern":   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
        "hihat_vels":      [100,50,90,50, 100,50,90,50, 100,50,90,50, 100,50,90,50],
        "open_hat_pattern":[0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0],
        "preferred_kick": "kit://kick-deep.wav",
        "preferred_snare": "kit://snare-clap.wav",
    },
    "lofi": {
        "bpm_range": (70, 90),
        "kick_pattern":    [1,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,0,0],
        "snare_pattern":   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        "hihat_pattern":   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
        "hihat_vels":      [80,0,60,0, 80,0,60,0, 80,0,60,0, 80,0,60,0],
        "open_hat_pattern":[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        "preferred_kick": "kit://kick-deep.wav",
        "preferred_snare": "kit://snare-crisp.wav",
    },
    "default": {
        "bpm_range": (120, 140),
        "kick_pattern":    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        "snare_pattern":   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        "hihat_pattern":   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
        "hihat_vels":      [100,0,80,0, 100,0,80,0, 100,0,80,0, 100,0,80,0],
        "open_hat_pattern":[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        "preferred_kick": "kit://kick-punchy.wav",
        "preferred_snare": "kit://snare-crisp.wav",
    },
}


def _detect_genre(prompt: str) -> str:
    prompt_lower = prompt.lower()
    for genre in ["trap", "drill", "boom_bap", "lofi"]:
        if genre.replace("_", " ") in prompt_lower or genre.replace("_", "") in prompt_lower:
            return genre
    if "boom bap" in prompt_lower or "boombap" in prompt_lower:
        return "boom_bap"
    if "lo-fi" in prompt_lower or "lo fi" in prompt_lower:
        return "lofi"
    return "default"


def _parse_bpm(prompt: str, default_range: tuple[int, int]) -> int:
    import re
    match = re.search(r"(\d{2,3})\s*bpm", prompt.lower())
    if match:
        return int(match.group(1))
    return random.randint(*default_range)


def _apply_variations(pattern: list[int], prompt: str) -> list[int]:
    """Add musical variations based on prompt keywords."""
    result = list(pattern)
    prompt_lower = prompt.lower()
    if "heavy" in prompt_lower or "hard" in prompt_lower:
        # Add extra hits
        for i in range(len(result)):
            if result[i] == 0 and random.random() < 0.15:
                result[i] = 1
    if "sparse" in prompt_lower or "minimal" in prompt_lower:
        # Remove some hits
        for i in range(len(result)):
            if result[i] == 1 and random.random() < 0.3:
                result[i] = 0
    return result


def _make_hihat_rolls(pattern: list[int], velocities: list[int], prompt: str) -> tuple[list[int], list[int]]:
    """Add hi-hat rolls if requested."""
    prompt_lower = prompt.lower()
    if "roll" in prompt_lower or "rapid" in prompt_lower:
        result = [1] * 16
        vels = []
        for i in range(16):
            if pattern[i]:
                vels.append(velocities[i] if i < len(velocities) else 100)
            else:
                vels.append(random.randint(40, 70))
        return result, vels
    return list(pattern), list(velocities)


def _build_project(
    name: str,
    bpm: int,
    kick_sample: str,
    snare_sample: str,
    kick_pattern: list[int],
    snare_pattern: list[int],
    hihat_pattern: list[int],
    hihat_vels: list[int],
    open_hat_pattern: list[int],
    add_808: bool = False,
    bars: int = 4,
) -> dict:
    """Build a complete Bassmash project dict."""
    steps = [
        {"name": "Kick", "sampleRef": kick_sample, "cells": [bool(c) for c in kick_pattern], "velocities": [100 if c else 0 for c in kick_pattern]},
        {"name": "Snare", "sampleRef": snare_sample, "cells": [bool(c) for c in snare_pattern], "velocities": [100 if c else 0 for c in snare_pattern]},
        {"name": "HH Closed", "sampleRef": "kit://hihat-closed.wav", "cells": [bool(c) for c in hihat_pattern], "velocities": hihat_vels},
        {"name": "HH Open", "sampleRef": "kit://hihat-open.wav", "cells": [bool(c) for c in open_hat_pattern], "velocities": [100 if c else 0 for c in open_hat_pattern]},
    ]

    tracks = [
        {"name": "Drums 1", "type": "drums", "muted": False, "soloed": False, "volume": 100, "pan": 0, "effects": {"eq": False, "distortion": False, "delay": False, "reverb": False}},
    ]
    patterns = [
        {"name": "Drums 1", "type": "drums", "stepCount": 16, "steps": steps},
    ]
    arrangement = [
        {"trackIndex": 0, "patternIndex": 0, "startBeat": 0, "lengthBeats": bars * 4, "patternName": "Drums 1"},
    ]

    if add_808:
        # Simple 808 bass pattern — root note on kick hits
        bass_notes = []
        for i, c in enumerate(kick_pattern):
            if c:
                bass_notes.append({"pitch": 36, "start": i, "duration": 2, "velocity": 100})
        tracks.append({"name": "808 Bass", "type": "synth", "muted": False, "soloed": False, "volume": 100, "pan": 0, "effects": {"eq": False, "distortion": False, "delay": False, "reverb": False}})
        patterns.append({"name": "808 Bass", "type": "synth", "stepCount": 16, "notes": bass_notes, "length": 16})
        arrangement.append({"trackIndex": 1, "patternIndex": 1, "startBeat": 0, "lengthBeats": bars * 4, "patternName": "808 Bass"})

    return {
        "bpm": bpm,
        "timeSignature": "4/4",
        "tracks": tracks,
        "patterns": patterns,
        "arrangement": arrangement,
    }


def _save_project(name: str, project: dict) -> Path:
    """Save project to disk and return path."""
    project_dir = PROJECTS_DIR / name
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "samples").mkdir(exist_ok=True)
    project_path = project_dir / "project.json"
    project_path.write_text(json.dumps(project, indent=2))
    return project_path


@mcp.tool()
def generate_beat(
    prompt: Annotated[str, "Describe the beat you want, e.g. 'trap beat 140bpm with heavy 808s and hi-hat rolls'"],
    project_name: Annotated[str, "Name for the project (used as folder name)"],
    bars: Annotated[int, "Number of bars to generate"] = 4,
) -> str:
    """Generate a beat from a text description and save it as a Bassmash project.

    Supports genres: trap, boom bap, drill, lofi.
    Mention specific elements like '808s', 'hi-hat rolls', 'heavy kicks', 'sparse', 'minimal'.
    Specify BPM like '140bpm' or let the genre default decide.
    """
    genre = _detect_genre(prompt)
    template = GENRE_TEMPLATES[genre]
    bpm = _parse_bpm(prompt, template["bpm_range"])

    kick_pattern = _apply_variations(template["kick_pattern"], prompt)
    snare_pattern = _apply_variations(template["snare_pattern"], prompt)
    hihat_pattern, hihat_vels = _make_hihat_rolls(
        template["hihat_pattern"], template["hihat_vels"], prompt
    )
    open_hat_pattern = list(template["open_hat_pattern"])

    add_808 = "808" in prompt.lower() or genre == "trap"

    project = _build_project(
        name=project_name,
        bpm=bpm,
        kick_sample=template["preferred_kick"],
        snare_sample=template["preferred_snare"],
        kick_pattern=kick_pattern,
        snare_pattern=snare_pattern,
        hihat_pattern=hihat_pattern,
        hihat_vels=hihat_vels,
        open_hat_pattern=open_hat_pattern,
        add_808=add_808,
        bars=bars,
    )

    path = _save_project(project_name, project)

    summary_lines = [
        f"Created project '{project_name}' at {path}",
        f"Genre: {genre}, BPM: {bpm}, Bars: {bars}",
        f"Tracks: {', '.join(t['name'] for t in project['tracks'])}",
        f"Kick: {template['preferred_kick']}, Snare: {template['preferred_snare']}",
    ]
    if add_808:
        summary_lines.append("808 bass: enabled (follows kick pattern)")

    return "\n".join(summary_lines)


@mcp.tool()
def replicate_from_audio(
    audio_path: Annotated[str, "Absolute path to an MP3 or WAV file to analyze"],
    project_name: Annotated[str, "Name for the output project"],
    bars: Annotated[int, "Number of bars to extract from the beginning"] = 4,
) -> str:
    """Analyze an audio file and create a Bassmash project that approximates its beat pattern.

    Detects tempo, extracts onset patterns, and maps them to kick/snare/hihat rows.
    Works best with drum-heavy tracks. Supports MP3 and WAV.
    """
    import librosa
    import numpy as np

    audio_file = Path(audio_path).expanduser()
    if not audio_file.exists():
        return f"Error: file not found: {audio_file}"

    # Load audio
    y, sr = librosa.load(str(audio_file), sr=22050, mono=True)

    # Detect tempo
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    if hasattr(tempo, '__len__'):
        tempo = float(tempo[0])
    else:
        tempo = float(tempo)
    bpm = round(tempo)

    # Duration of one 16th note
    sixteenth = 60.0 / bpm / 4.0
    total_sixteenths = bars * 16

    # Onset strength in different frequency bands
    # Low (kick): 20-150 Hz
    # Mid (snare): 200-1000 Hz
    # High (hihat): 5000-15000 Hz
    S = np.abs(librosa.stft(y))
    freqs = librosa.fft_frequencies(sr=sr)

    def band_onsets(low_hz: float, high_hz: float) -> list[float]:
        mask = (freqs >= low_hz) & (freqs <= high_hz)
        S_band = S[mask, :]
        onset_env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S_band), sr=sr)
        return onset_env

    kick_env = band_onsets(20, 150)
    snare_env = band_onsets(200, 1000)
    hihat_env = band_onsets(5000, 15000)

    def env_to_pattern(env, threshold_percentile: float = 70) -> tuple[list[int], list[int]]:
        """Convert onset envelope to 16-step pattern."""
        cells = [0] * 16
        vels = [0] * 16
        hop_length = 512
        for step in range(min(total_sixteenths, 16)):
            t_start = step * sixteenth
            t_end = (step + 1) * sixteenth
            frame_start = int(t_start * sr / hop_length)
            frame_end = int(t_end * sr / hop_length)
            frame_start = min(frame_start, len(env) - 1)
            frame_end = min(frame_end, len(env))
            if frame_start >= frame_end:
                continue
            segment = env[frame_start:frame_end]
            peak = float(np.max(segment))
            threshold = float(np.percentile(env[:min(len(env), frame_end + 100)], threshold_percentile))
            if peak > threshold:
                cells[step] = 1
                vels[step] = min(127, int(peak / (float(np.max(env)) + 1e-6) * 127))
        return cells, vels

    kick_cells, kick_vels = env_to_pattern(kick_env, 75)
    snare_cells, snare_vels = env_to_pattern(snare_env, 75)
    hihat_cells, hihat_vels = env_to_pattern(hihat_env, 60)

    # Ensure at least some hits
    if sum(kick_cells) == 0:
        kick_cells[0] = 1; kick_vels[0] = 100
    if sum(snare_cells) == 0:
        snare_cells[4] = 1; snare_vels[4] = 100

    project = _build_project(
        name=project_name,
        bpm=bpm,
        kick_sample="kit://kick-punchy.wav",
        snare_sample="kit://snare-crisp.wav",
        kick_pattern=kick_cells,
        snare_pattern=snare_cells,
        hihat_pattern=hihat_cells,
        hihat_vels=hihat_vels,
        open_hat_pattern=[0] * 16,
        bars=bars,
    )

    path = _save_project(project_name, project)

    kick_hits = sum(kick_cells)
    snare_hits = sum(snare_cells)
    hihat_hits = sum(hihat_cells)

    return "\n".join([
        f"Analyzed: {audio_file.name}",
        f"Detected BPM: {bpm}",
        f"Created project '{project_name}' at {path}",
        f"Pattern: {kick_hits} kicks, {snare_hits} snares, {hihat_hits} hihats per bar",
        f"Bars: {bars}",
        "Open in Bassmash to hear and edit the replicated beat.",
    ])


def _load_project(name: str) -> dict | None:
    path = PROJECTS_DIR / name / "project.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


@mcp.tool(annotations={"readOnlyHint": True})
def list_projects() -> str:
    """List all Bassmash projects in ~/bassmash-projects/."""
    if not PROJECTS_DIR.exists():
        return "No projects directory found."
    projects = [d.name for d in PROJECTS_DIR.iterdir() if d.is_dir() and (d / "project.json").exists()]
    if not projects:
        return "No projects found."
    lines = [f"Found {len(projects)} project(s):"]
    for name in sorted(projects):
        proj = _load_project(name)
        if proj:
            tracks = len(proj.get("tracks", []))
            bpm = proj.get("bpm", "?")
            lines.append(f"  - {name} ({tracks} tracks, {bpm} BPM)")
    return "\n".join(lines)


@mcp.tool(annotations={"readOnlyHint": True})
def get_project(
    project_name: Annotated[str, "Name of the project to inspect"],
) -> str:
    """Get full details of a Bassmash project including tracks, patterns, and arrangement."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    return json.dumps(proj, indent=2)


@mcp.tool()
def set_bpm(
    project_name: Annotated[str, "Project to modify"],
    bpm: Annotated[int, "New BPM (20-300)"],
) -> str:
    """Change the BPM of a project."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    bpm = max(20, min(300, bpm))
    proj["bpm"] = bpm
    _save_project(project_name, proj)
    return f"Set BPM to {bpm} for project '{project_name}'."


@mcp.tool()
def add_drum_track(
    project_name: Annotated[str, "Project to add the track to"],
    track_name: Annotated[str, "Name for the new drum track"] = "Drums",
    kick: Annotated[str, "Kick sample from kit"] = "kit://kick-punchy.wav",
    snare: Annotated[str, "Snare sample from kit"] = "kit://snare-crisp.wav",
    hihat_closed: Annotated[str, "Closed hihat sample"] = "kit://hihat-closed.wav",
    hihat_open: Annotated[str, "Open hihat sample"] = "kit://hihat-open.wav",
    bars: Annotated[int, "Clip length in bars"] = 4,
) -> str:
    """Add a new drum track with 4 rows (kick, snare, hihat closed, hihat open) to a project."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    track_idx = len(proj["tracks"])
    pattern_idx = len(proj["patterns"])
    proj["tracks"].append({
        "name": track_name, "type": "drums", "muted": False, "soloed": False,
        "volume": 100, "pan": 0,
        "effects": {"eq": False, "distortion": False, "delay": False, "reverb": False},
    })
    proj["patterns"].append({
        "name": track_name, "type": "drums", "stepCount": 16,
        "steps": [
            {"name": "Kick", "sampleRef": kick, "cells": [False]*16, "velocities": [100]*16},
            {"name": "Snare", "sampleRef": snare, "cells": [False]*16, "velocities": [100]*16},
            {"name": "HH Closed", "sampleRef": hihat_closed, "cells": [False]*16, "velocities": [100]*16},
            {"name": "HH Open", "sampleRef": hihat_open, "cells": [False]*16, "velocities": [100]*16},
        ],
    })
    proj["arrangement"].append({
        "trackIndex": track_idx, "patternIndex": pattern_idx,
        "startBeat": 0, "lengthBeats": bars * 4, "patternName": track_name,
    })
    _save_project(project_name, proj)
    return f"Added drum track '{track_name}' (track {track_idx}) with empty 16-step pattern."


@mcp.tool()
def add_synth_track(
    project_name: Annotated[str, "Project to add the track to"],
    track_name: Annotated[str, "Name for the new synth track"] = "Synth",
    bars: Annotated[int, "Clip length in bars"] = 4,
) -> str:
    """Add a new synth track with an empty piano roll pattern to a project."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    track_idx = len(proj["tracks"])
    pattern_idx = len(proj["patterns"])
    proj["tracks"].append({
        "name": track_name, "type": "synth", "muted": False, "soloed": False,
        "volume": 100, "pan": 0, "synthParams": {},
        "effects": {"eq": False, "distortion": False, "delay": False, "reverb": False},
    })
    proj["patterns"].append({
        "name": track_name, "type": "synth", "stepCount": 16,
        "notes": [], "length": 64,
    })
    proj["arrangement"].append({
        "trackIndex": track_idx, "patternIndex": pattern_idx,
        "startBeat": 0, "lengthBeats": bars * 4, "patternName": track_name,
    })
    _save_project(project_name, proj)
    return f"Added synth track '{track_name}' (track {track_idx}) with empty piano roll."


@mcp.tool()
def edit_drum_pattern(
    project_name: Annotated[str, "Project to modify"],
    pattern_index: Annotated[int, "Index of the pattern to edit (0-based)"],
    row_name: Annotated[str, "Name of the row to edit, e.g. 'Kick', 'Snare', 'HH Closed', 'HH Open'"],
    steps: Annotated[list[int], "List of step numbers (1-16) where hits should be ON. All other steps will be OFF."],
    velocities: Annotated[list[int] | None, "Optional velocity (0-127) for each step in 'steps'. Same length as steps."] = None,
) -> str:
    """Set which steps are active for a specific row in a drum pattern.

    Example: steps=[1,5,9,13] sets hits on every beat.
    Steps are 1-indexed (1-16).
    """
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    if pattern_index >= len(proj["patterns"]):
        return f"Pattern index {pattern_index} out of range (have {len(proj['patterns'])} patterns)."
    pattern = proj["patterns"][pattern_index]
    if "steps" not in pattern:
        return f"Pattern {pattern_index} ('{pattern.get('name')}') is not a drum pattern."
    row = None
    for r in pattern["steps"]:
        if r["name"].lower() == row_name.lower():
            row = r
            break
    if not row:
        available = [r["name"] for r in pattern["steps"]]
        return f"Row '{row_name}' not found. Available: {', '.join(available)}"
    num_steps = pattern.get("stepCount", 16)
    row["cells"] = [False] * num_steps
    row["velocities"] = [0] * num_steps
    for i, s in enumerate(steps):
        idx = s - 1  # 1-indexed to 0-indexed
        if 0 <= idx < num_steps:
            row["cells"][idx] = True
            row["velocities"][idx] = (velocities[i] if velocities and i < len(velocities) else 100)
    _save_project(project_name, proj)
    hits = sum(1 for c in row["cells"] if c)
    return f"Set {hits} hits on '{row_name}' in pattern '{pattern.get('name')}'. Active steps: {steps}"


@mcp.tool()
def edit_notes(
    project_name: Annotated[str, "Project to modify"],
    pattern_index: Annotated[int, "Index of the synth pattern to edit (0-based)"],
    notes: Annotated[list[dict], "List of note objects: [{pitch: MIDI 0-127, start: step (0-based), duration: steps, velocity: 0-127}]"],
    append: Annotated[bool, "If true, add to existing notes. If false, replace all notes."] = False,
) -> str:
    """Set or add notes in a synth/piano roll pattern.

    MIDI pitch: 60=C4, 64=E4, 67=G4. Duration in 16th note steps.
    """
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    if pattern_index >= len(proj["patterns"]):
        return f"Pattern index {pattern_index} out of range."
    pattern = proj["patterns"][pattern_index]
    if "steps" in pattern and "notes" not in pattern:
        return f"Pattern {pattern_index} is a drum pattern, not a synth pattern."
    if not append:
        pattern["notes"] = []
    if "notes" not in pattern:
        pattern["notes"] = []
    for n in notes:
        pattern["notes"].append({
            "pitch": n.get("pitch", 60),
            "start": n.get("start", 0),
            "duration": n.get("duration", 1),
            "velocity": n.get("velocity", 100),
        })
    _save_project(project_name, proj)
    total = len(pattern["notes"])
    return f"Pattern '{pattern.get('name')}' now has {total} notes."


@mcp.tool()
def mix_track(
    project_name: Annotated[str, "Project to modify"],
    track_index: Annotated[int, "Track index (0-based)"],
    volume: Annotated[int | None, "Volume 0-100"] = None,
    pan: Annotated[int | None, "Pan -100 (left) to 100 (right)"] = None,
    muted: Annotated[bool | None, "Mute state"] = None,
    soloed: Annotated[bool | None, "Solo state"] = None,
) -> str:
    """Adjust the mix settings for a track — volume, pan, mute, solo."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    if track_index >= len(proj["tracks"]):
        return f"Track index {track_index} out of range."
    track = proj["tracks"][track_index]
    changes = []
    if volume is not None:
        track["volume"] = max(0, min(100, volume))
        changes.append(f"volume={volume}")
    if pan is not None:
        track["pan"] = max(-100, min(100, pan))
        changes.append(f"pan={pan}")
    if muted is not None:
        track["muted"] = muted
        changes.append(f"muted={muted}")
    if soloed is not None:
        track["soloed"] = soloed
        changes.append(f"soloed={soloed}")
    _save_project(project_name, proj)
    return f"Updated track '{track.get('name')}': {', '.join(changes)}"


@mcp.tool()
def set_effects(
    project_name: Annotated[str, "Project to modify"],
    track_index: Annotated[int, "Track index (0-based)"],
    eq: Annotated[bool | None, "Enable/disable EQ"] = None,
    distortion: Annotated[bool | None, "Enable/disable distortion"] = None,
    delay: Annotated[bool | None, "Enable/disable delay"] = None,
    reverb: Annotated[bool | None, "Enable/disable reverb"] = None,
) -> str:
    """Toggle effects on/off for a track."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    if track_index >= len(proj["tracks"]):
        return f"Track index {track_index} out of range."
    track = proj["tracks"][track_index]
    if "effects" not in track:
        track["effects"] = {"eq": False, "distortion": False, "delay": False, "reverb": False}
    changes = []
    if eq is not None: track["effects"]["eq"] = eq; changes.append(f"eq={eq}")
    if distortion is not None: track["effects"]["distortion"] = distortion; changes.append(f"distortion={distortion}")
    if delay is not None: track["effects"]["delay"] = delay; changes.append(f"delay={delay}")
    if reverb is not None: track["effects"]["reverb"] = reverb; changes.append(f"reverb={reverb}")
    _save_project(project_name, proj)
    return f"Effects on '{track.get('name')}': {', '.join(changes)}"


@mcp.tool()
def set_arrangement(
    project_name: Annotated[str, "Project to modify"],
    track_index: Annotated[int, "Track index"],
    pattern_index: Annotated[int, "Pattern index"],
    start_beat: Annotated[int, "Start position in beats (0-based)"] = 0,
    length_beats: Annotated[int, "Clip length in beats"] = 16,
) -> str:
    """Place or move a pattern clip on the timeline arrangement."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    # Find existing clip for this track/pattern or create new
    clip = None
    for c in proj["arrangement"]:
        if c["trackIndex"] == track_index and c["patternIndex"] == pattern_index:
            clip = c
            break
    if clip:
        clip["startBeat"] = start_beat
        clip["lengthBeats"] = length_beats
    else:
        pattern_name = proj["patterns"][pattern_index].get("name", f"P{pattern_index}") if pattern_index < len(proj["patterns"]) else f"P{pattern_index}"
        proj["arrangement"].append({
            "trackIndex": track_index, "patternIndex": pattern_index,
            "startBeat": start_beat, "lengthBeats": length_beats, "patternName": pattern_name,
        })
    _save_project(project_name, proj)
    return f"Clip: track {track_index}, pattern {pattern_index}, beats {start_beat}-{start_beat + length_beats}"


@mcp.tool()
def delete_track(
    project_name: Annotated[str, "Project to modify"],
    track_index: Annotated[int, "Track index to delete (0-based)"],
) -> str:
    """Remove a track and its arrangement clips from a project."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    if track_index >= len(proj["tracks"]):
        return f"Track index {track_index} out of range."
    name = proj["tracks"][track_index].get("name", f"Track {track_index}")
    proj["tracks"].pop(track_index)
    proj["arrangement"] = [c for c in proj["arrangement"] if c["trackIndex"] != track_index]
    # Fix indices
    for c in proj["arrangement"]:
        if c["trackIndex"] > track_index:
            c["trackIndex"] -= 1
    _save_project(project_name, proj)
    return f"Deleted track '{name}' and its clips."


@mcp.tool(annotations={"readOnlyHint": True})
def list_kit_samples() -> str:
    """List all available kit samples that can be used in drum patterns."""
    categories = {
        "Kicks": ["kit://kick-punchy.wav", "kit://kick-deep.wav", "kit://kick-808.wav"],
        "Snares": ["kit://snare-crisp.wav", "kit://snare-trap.wav", "kit://snare-clap.wav"],
        "Hi-hats": ["kit://hihat-closed.wav", "kit://hihat-open.wav", "kit://hihat-pedal.wav"],
        "808 Bass": ["kit://bass-808-long.wav", "kit://bass-808-short.wav", "kit://bass-808-dist.wav"],
        "Percussion": ["kit://shaker.wav", "kit://cowbell.wav"],
    }
    lines = ["Available kit samples:"]
    for cat, samples in categories.items():
        lines.append(f"\n{cat}:")
        for s in samples:
            lines.append(f"  - {s}")
    return "\n".join(lines)


@mcp.tool()
def duplicate_project(
    source_name: Annotated[str, "Project to copy from"],
    dest_name: Annotated[str, "Name for the new copy"],
) -> str:
    """Duplicate an entire project under a new name."""
    proj = _load_project(source_name)
    if not proj:
        return f"Project '{source_name}' not found."
    _save_project(dest_name, proj)
    return f"Duplicated '{source_name}' -> '{dest_name}'"


@mcp.tool()
def clear_pattern(
    project_name: Annotated[str, "Project to modify"],
    pattern_index: Annotated[int, "Pattern index to clear"],
) -> str:
    """Clear all steps/notes from a pattern, keeping the structure."""
    proj = _load_project(project_name)
    if not proj:
        return f"Project '{project_name}' not found."
    if pattern_index >= len(proj["patterns"]):
        return f"Pattern index {pattern_index} out of range."
    pattern = proj["patterns"][pattern_index]
    if "steps" in pattern:
        for row in pattern["steps"]:
            row["cells"] = [False] * len(row["cells"])
            row["velocities"] = [0] * len(row["velocities"])
    if "notes" in pattern:
        pattern["notes"] = []
    _save_project(project_name, proj)
    return f"Cleared pattern '{pattern.get('name')}'."


def main():
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
