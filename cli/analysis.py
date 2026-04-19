"""Audio analysis primitives.

Pure functions that take a file path and return structured results.
Used by the CLI ``analyse`` commands and reusable for tests / MCP / future tools.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import librosa
import numpy as np

# --- Krumhansl-Schmuckler key profiles (averaged correlations from human listeners).
# Indices are pitch classes starting at C.
_KRUMHANSL_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_KRUMHANSL_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
_PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _load(path: Path, sr: int = 22050, mono: bool = True) -> tuple[np.ndarray, int]:
    y, sr_out = librosa.load(str(path), sr=sr, mono=mono)
    return y, sr_out


# ============================== tempo / beats ==============================

@dataclass
class BpmResult:
    bpm: float
    beat_count: int
    beat_strength_mean: float
    confidence: float
    file: str


def analyse_bpm(path: Path) -> BpmResult:
    """Onset-based tempo estimation. Returns BPM + confidence + beat count."""
    y, sr = _load(path)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, aggregate=np.median)
    tempo_arr, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
    tempo = float(np.atleast_1d(tempo_arr)[0])
    # Confidence: ratio of beat-strength at detected beats vs average onset envelope.
    if beats.size and onset_env.size:
        peak_strengths = onset_env[np.clip(beats, 0, onset_env.size - 1)]
        confidence = float(peak_strengths.mean() / (onset_env.mean() + 1e-9))
    else:
        confidence = 0.0
    return BpmResult(
        bpm=round(tempo, 2),
        beat_count=int(beats.size),
        beat_strength_mean=float(onset_env.mean()),
        confidence=round(confidence, 3),
        file=str(path),
    )


# ============================== key / tonality ==============================

@dataclass
class KeyResult:
    key: str              # e.g. "F"
    mode: str             # "major" | "minor"
    key_mode: str         # e.g. "F minor"
    confidence: float     # 0..1, how much it beats the runner-up
    file: str


def _chroma(y: np.ndarray, sr: int) -> np.ndarray:
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    return chroma.mean(axis=1)


def analyse_key(path: Path) -> KeyResult:
    """Pitch-class-histogram + Krumhansl-Schmuckler profile matching.

    Normalises input and major/minor profiles, then correlates each tonic rotation.
    """
    y, sr = _load(path)
    pcp = _chroma(y, sr)
    pcp = pcp / (pcp.sum() + 1e-9)

    def _norm(v: np.ndarray) -> np.ndarray:
        return (v - v.mean()) / (v.std() + 1e-9)

    pcp_n = _norm(pcp)
    maj_n = _norm(_KRUMHANSL_MAJOR)
    min_n = _norm(_KRUMHANSL_MINOR)

    scores: list[tuple[float, str, str]] = []
    for i in range(12):
        scores.append((float((np.roll(maj_n, i) * pcp_n).sum()), _PITCH_NAMES[i], "major"))
        scores.append((float((np.roll(min_n, i) * pcp_n).sum()), _PITCH_NAMES[i], "minor"))
    scores.sort(reverse=True)

    top, runner = scores[0], scores[1]
    # Confidence: how much does #1 beat #2, normalised.
    gap = max(top[0] - runner[0], 0.0)
    span = max(top[0] - scores[-1][0], 1e-9)
    confidence = round(min(gap / span * 2.0, 1.0), 3)
    return KeyResult(
        key=top[1],
        mode=top[2],
        key_mode=f"{top[1]} {top[2]}",
        confidence=confidence,
        file=str(path),
    )


# ============================== loudness ==============================

@dataclass
class LoudnessResult:
    peak_dbfs: float
    rms_dbfs: float
    dynamic_range_db: float
    duration_sec: float
    file: str


def _to_dbfs(v: float) -> float:
    return float(20 * np.log10(max(v, 1e-9)))


def analyse_loudness(path: Path) -> LoudnessResult:
    """Peak + RMS in dBFS (negative = quieter than 0 dB full-scale)."""
    y, sr = _load(path, mono=True)
    peak = float(np.abs(y).max()) if y.size else 0.0
    rms = float(np.sqrt((y ** 2).mean())) if y.size else 0.0
    peak_db = _to_dbfs(peak)
    rms_db = _to_dbfs(rms)
    return LoudnessResult(
        peak_dbfs=round(peak_db, 2),
        rms_dbfs=round(rms_db, 2),
        dynamic_range_db=round(peak_db - rms_db, 2),
        duration_sec=round(len(y) / sr, 2),
        file=str(path),
    )


# ============================== spectrum ==============================

@dataclass
class SpectrumResult:
    centroid_hz_mean: float
    centroid_hz_std: float
    rolloff_hz_mean: float
    flatness_mean: float
    file: str


def analyse_spectrum(path: Path) -> SpectrumResult:
    """Spectral centroid (brightness), rolloff (85th percentile), flatness (noisiness)."""
    y, sr = _load(path)
    cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    roll = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]
    flat = librosa.feature.spectral_flatness(y=y)[0]
    return SpectrumResult(
        centroid_hz_mean=round(float(cent.mean()), 1),
        centroid_hz_std=round(float(cent.std()), 1),
        rolloff_hz_mean=round(float(roll.mean()), 1),
        flatness_mean=round(float(flat.mean()), 4),
        file=str(path),
    )


# ============================== full report ==============================

@dataclass
class FullReport:
    bpm: BpmResult
    key: KeyResult
    loudness: LoudnessResult
    spectrum: SpectrumResult

    def as_dict(self) -> dict[str, Any]:
        return {
            "bpm": asdict(self.bpm),
            "key": asdict(self.key),
            "loudness": asdict(self.loudness),
            "spectrum": asdict(self.spectrum),
        }


def analyse_full(path: Path) -> FullReport:
    return FullReport(
        bpm=analyse_bpm(path),
        key=analyse_key(path),
        loudness=analyse_loudness(path),
        spectrum=analyse_spectrum(path),
    )
