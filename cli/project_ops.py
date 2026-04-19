"""Pure functions that mutate a project dict. No I/O."""
from __future__ import annotations

from typing import Any

# --- defaults mirrored from app/js/topbar.js and state.js ---

DEFAULT_EFFECTS = {"eq": False, "distortion": False, "delay": False, "reverb": False}


def _new_track(name: str, kind: str) -> dict[str, Any]:
    assert kind in ("synth", "sample", "audio"), f"unknown track kind: {kind}"
    t: dict[str, Any] = {
        "name": name,
        "type": kind,
        "volume": 1,
        "pan": 0,
        "muted": False,
        "soloed": False,
        "effects": dict(DEFAULT_EFFECTS),
    }
    if kind == "synth":
        t["synthParams"] = {}
    return t


def _new_drum_pattern(name: str, step_count: int = 16) -> dict[str, Any]:
    return {"name": name, "type": "steps", "stepCount": step_count, "steps": []}


def _new_synth_pattern(name: str, length: int = 64) -> dict[str, Any]:
    return {"name": name, "type": "notes", "length": length, "notes": []}


# --- BPM ---

def set_bpm(project: dict[str, Any], bpm: int) -> None:
    if not 20 <= bpm <= 300:
        raise ValueError(f"bpm must be 20..300, got {bpm}")
    project["bpm"] = bpm


# --- tracks ---

def add_track(project: dict[str, Any], name: str, kind: str) -> int:
    project.setdefault("tracks", []).append(_new_track(name, kind))
    return len(project["tracks"]) - 1


def remove_track(project: dict[str, Any], index: int) -> None:
    tracks = project.get("tracks", [])
    if not 0 <= index < len(tracks):
        raise IndexError(f"track index {index} out of range (0..{len(tracks) - 1})")
    tracks.pop(index)
    arrangement = project.get("arrangement", [])
    project["arrangement"] = [
        (c if c.get("trackIndex", 0) < index
         else {**c, "trackIndex": c["trackIndex"] - 1})
        for c in arrangement
        if c.get("trackIndex") != index
    ]


def set_track_field(project: dict[str, Any], index: int, field: str, value: Any) -> None:
    tracks = project.get("tracks", [])
    if not 0 <= index < len(tracks):
        raise IndexError(f"track index {index} out of range")
    tracks[index][field] = value


# --- patterns ---

def add_drum_pattern(project: dict[str, Any], name: str, step_count: int = 16) -> int:
    project.setdefault("patterns", []).append(_new_drum_pattern(name, step_count))
    return len(project["patterns"]) - 1


def add_synth_pattern(project: dict[str, Any], name: str, length: int = 64) -> int:
    project.setdefault("patterns", []).append(_new_synth_pattern(name, length))
    return len(project["patterns"]) - 1


def _get_pattern(project: dict[str, Any], index: int) -> dict[str, Any]:
    patterns = project.get("patterns", [])
    if not 0 <= index < len(patterns):
        raise IndexError(f"pattern index {index} out of range (0..{len(patterns) - 1})")
    return patterns[index]


def parse_cells(cells: str, step_count: int) -> list[bool]:
    """Parse '1000100010001000' or '1.0.1.0.' (dots = off, anything else = on).

    Length must match step_count.
    """
    stripped = cells.replace(" ", "").replace("-", "").replace("_", "")
    if len(stripped) != step_count:
        raise ValueError(f"cells length {len(stripped)} != step count {step_count}")
    return [c == "1" or c.lower() == "x" for c in stripped]


def set_drum_row(
    project: dict[str, Any],
    pattern_index: int,
    row_name: str,
    sample_ref: str,
    cells: list[bool],
    velocities: list[int] | None = None,
) -> int:
    """Upsert a drum row on a steps pattern. Returns row index.

    If a row with the same name exists, replace it. Otherwise append.
    """
    pattern = _get_pattern(project, pattern_index)
    if pattern.get("type") != "steps":
        raise ValueError(f"pattern {pattern_index} is not a drum/steps pattern")
    step_count = pattern.get("stepCount", 16)
    if len(cells) != step_count:
        raise ValueError(f"cells length {len(cells)} != pattern stepCount {step_count}")
    vel: list[int] = list(velocities) if velocities is not None else [100] * step_count
    if len(vel) != step_count:
        raise ValueError(f"velocities length {len(vel)} != stepCount {step_count}")

    rows = pattern.setdefault("steps", [])
    for i, r in enumerate(rows):
        if r.get("name") == row_name:
            rows[i] = {"name": row_name, "sampleRef": sample_ref,
                       "cells": list(cells), "velocities": list(vel)}
            return i
    rows.append({"name": row_name, "sampleRef": sample_ref,
                 "cells": list(cells), "velocities": list(vel)})
    return len(rows) - 1


def clear_drum_pattern(project: dict[str, Any], pattern_index: int) -> None:
    pattern = _get_pattern(project, pattern_index)
    if pattern.get("type") != "steps":
        raise ValueError(f"pattern {pattern_index} is not a steps pattern")
    pattern["steps"] = []


def add_note(
    project: dict[str, Any],
    pattern_index: int,
    pitch: int,
    start: int,
    duration: int,
    velocity: int = 100,
) -> None:
    pattern = _get_pattern(project, pattern_index)
    if pattern.get("type") != "notes":
        raise ValueError(f"pattern {pattern_index} is not a notes pattern")
    if not 0 <= pitch <= 127:
        raise ValueError(f"pitch must be 0..127, got {pitch}")
    if not 1 <= velocity <= 127:
        raise ValueError(f"velocity must be 1..127, got {velocity}")
    pattern.setdefault("notes", []).append({
        "pitch": pitch, "start": start, "duration": duration, "velocity": velocity,
    })


def parse_notes(spec: str) -> list[dict[str, int]]:
    """Parse 'pitch:start:duration[:velocity],...' into note dicts.

    Example: '60:0:4:100,64:4:4,67:8:4'
    """
    out: list[dict[str, int]] = []
    for part in (p.strip() for p in spec.split(",") if p.strip()):
        bits = part.split(":")
        if len(bits) < 3 or len(bits) > 4:
            raise ValueError(f"bad note spec '{part}' (want pitch:start:duration[:velocity])")
        pitch, start, duration = int(bits[0]), int(bits[1]), int(bits[2])
        velocity = int(bits[3]) if len(bits) == 4 else 100
        out.append({"pitch": pitch, "start": start, "duration": duration, "velocity": velocity})
    return out


def clear_notes(project: dict[str, Any], pattern_index: int) -> None:
    pattern = _get_pattern(project, pattern_index)
    if pattern.get("type") != "notes":
        raise ValueError(f"pattern {pattern_index} is not a notes pattern")
    pattern["notes"] = []


# --- arrangement ---

def add_clip(
    project: dict[str, Any],
    track_index: int,
    pattern_index: int,
    start_beat: int,
    length_beats: int,
) -> None:
    tracks = project.get("tracks", [])
    patterns = project.get("patterns", [])
    if not 0 <= track_index < len(tracks):
        raise IndexError(f"track index {track_index} out of range")
    if not 0 <= pattern_index < len(patterns):
        raise IndexError(f"pattern index {pattern_index} out of range")
    project.setdefault("arrangement", []).append({
        "trackIndex": track_index,
        "patternIndex": pattern_index,
        "patternName": patterns[pattern_index].get("name", f"P{pattern_index}"),
        "startBeat": start_beat,
        "lengthBeats": length_beats,
    })


def add_audio_clip(
    project: dict[str, Any],
    track_index: int,
    audio_ref: str,
    start_beat: int,
    length_beats: int,
    offset: int = 0,
) -> None:
    tracks = project.get("tracks", [])
    if not 0 <= track_index < len(tracks):
        raise IndexError(f"track index {track_index} out of range")
    project.setdefault("arrangement", []).append({
        "type": "audio",
        "trackIndex": track_index,
        "audioRef": audio_ref,
        "startBeat": start_beat,
        "lengthBeats": length_beats,
        "offset": offset,
    })


def clear_arrangement(project: dict[str, Any]) -> None:
    project["arrangement"] = []


# --- the demo tune ---

def build_demo_tune(project: dict[str, Any]) -> None:
    """Yeat-style type beat: 150 BPM, C minor, trap drums + sliding 808 + bell arp.

    Key validated by running librosa key-detection against the Up 2 Më instrumentals
    in audio/ — Yeat's older catalog clusters around C minor / 150 BPM.

    Idempotent: clears arrangement + tracks + patterns first.
    Steps are 16th-notes. 16 steps = 4 beats = 1 bar. Demo = 8 bars.
    """
    project["tracks"] = []
    project["patterns"] = []
    project["arrangement"] = []
    set_bpm(project, 143)

    # ---- drums ----  trap: kick 1/7/11, snare 5/13, straight 16ths, open-hat off-beats
    drums_track = add_track(project, "Drums", "sample")
    drums_pattern = add_drum_pattern(project, "Drums", step_count=16)
    set_drum_row(project, drums_pattern, "Kick",
                 "kit://kick-deep.wav",
                 parse_cells("1000001000100000", 16))
    set_drum_row(project, drums_pattern, "Snare",
                 "kit://snare-clap.wav",
                 parse_cells("0000100000001000", 16))
    # Velocity variation on hats — quieter on off-beats, accents on downbeats
    set_drum_row(project, drums_pattern, "HH Closed",
                 "kit://hihat-closed.wav",
                 parse_cells("1111111111111111", 16),
                 velocities=[105, 70, 85, 70, 105, 70, 85, 70,
                             105, 70, 85, 70, 105, 80, 90, 100])
    set_drum_row(project, drums_pattern, "HH Open",
                 "kit://hihat-open.wav",
                 parse_cells("0000001000000010", 16))
    for bar_start in (0, 4, 8, 12, 16, 20, 24, 28):
        add_clip(project, drums_track, drums_pattern, start_beat=bar_start, length_beats=4)

    # ---- 808 bass ----  sine sub, long sustain, F minor
    bass_track = add_track(project, "808", "synth")
    project["tracks"][bass_track]["synthParams"] = {
        "waveform": "sine",
        "filterType": "lowpass", "filterFreq": 500, "filterQ": 0.7,
        "attack": 0.005, "decay": 0.1, "sustain": 0.9, "release": 0.25,
    }
    # Light saturation-feel via slight distortion bleed; mild reverb for weight
    project["tracks"][bass_track]["effects"] = {
        "eq": False, "distortion": 0.1, "delay": False, "reverb": 0.15,
    }
    # 128-step through-composed 808 line (8 bars), C minor, sliding feel
    bass_pattern = add_synth_pattern(project, "808", length=128)
    # (start, midi-pitch, duration, velocity)  — root C1=24, scale C-D-Eb-F-G-Ab-Bb
    bass_notes = [
        (0,   24, 12, 115),  # C1
        (12,  24, 4,  105),
        (16,  27, 8,  115),  # Eb1
        (24,  26, 8,  108),  # D1   (chromatic glide-down feel)
        (32,  31, 12, 118),  # G1
        (44,  29, 4,  105),  # F1
        (48,  24, 16, 115),  # C1
        (64,  22, 12, 118),  # A#0 / Bb0
        (76,  24, 4,  108),  # C1
        (80,  27, 8,  115),  # Eb1
        (88,  29, 8,  112),  # F1
        (96,  31, 16, 118),  # G1
        (112, 27, 8,  112),  # Eb1
        (120, 24, 8,  115),  # C1
    ]
    for start, pitch, duration, velocity in bass_notes:
        add_note(project, bass_pattern, pitch=pitch, start=start,
                 duration=duration, velocity=velocity)
    # One long clip covers all 8 bars
    add_clip(project, bass_track, bass_pattern, start_beat=0, length_beats=32)

    # ---- bell lead ----  triangle with long decay, heavy reverb + delay
    bell_track = add_track(project, "Bells", "synth")
    project["tracks"][bell_track]["synthParams"] = {
        "waveform": "triangle",
        "filterType": "lowpass", "filterFreq": 5500, "filterQ": 1,
        "attack": 0.002, "decay": 0.35, "sustain": 0.12, "release": 0.5,
    }
    project["tracks"][bell_track]["effects"] = {
        "eq": False, "distortion": False, "delay": 0.22, "reverb": 0.55,
    }
    # Quieter in the mix so 808 + drums lead
    project["tracks"][bell_track]["volume"] = 0.65
    # 16-step arp in C minor: C4 Eb4 G4 Bb4 C5 Bb4 G4 rest
    bell_pattern = add_synth_pattern(project, "Bells", length=16)
    bell_notes = [
        (0,  60, 2, 100),  # C4
        (2,  63, 2, 100),  # Eb4
        (4,  67, 2, 105),  # G4
        (6,  70, 2, 108),  # Bb4
        (8,  72, 4, 112),  # C5 (peak)
        (12, 70, 2, 105),  # Bb4
        (14, 67, 2, 100),  # G4
    ]
    for start, pitch, duration, velocity in bell_notes:
        add_note(project, bell_pattern, pitch=pitch, start=start,
                 duration=duration, velocity=velocity)
    # Bells enter at bar 3, hold to end (6 bars)
    for bar_start in (8, 12, 16, 20, 24, 28):
        add_clip(project, bell_track, bell_pattern, start_beat=bar_start, length_beats=4)
