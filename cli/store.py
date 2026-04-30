"""Filesystem-direct access to M8S projects.

Projects live at ``$M8S_PROJECTS_DIR/<name>/`` (default ``~/m8s-projects/``).
This module owns every read and write — no HTTP, no server dependency.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

DEFAULT_PROJECT: dict[str, Any] = {
    "bpm": 140,
    "timeSignature": "4/4",
    "tracks": [],
    "patterns": [],
    "arrangement": [],
}


def projects_dir() -> Path:
    override = os.environ.get("M8S_PROJECTS_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / "m8s-projects"


def kit_dir() -> Path:
    override = os.environ.get("M8S_KIT_DIR")
    if override:
        return Path(override).expanduser()
    # ``cli/store.py`` → repo is two parents up.
    return Path(__file__).resolve().parent.parent / "kit"


def project_path(name: str) -> Path:
    return projects_dir() / name


def project_file(name: str) -> Path:
    return project_path(name) / "project.json"


def project_exists(name: str) -> bool:
    return project_file(name).exists()


def list_projects() -> list[str]:
    root = projects_dir()
    if not root.exists():
        return []
    return sorted(
        d.name for d in root.iterdir()
        if d.is_dir() and (d / "project.json").exists()
    )


def create_project(name: str) -> Path:
    root = projects_dir()
    root.mkdir(parents=True, exist_ok=True)
    pdir = root / name
    if pdir.exists():
        raise FileExistsError(f"project already exists: {name}")
    pdir.mkdir()
    (pdir / "samples").mkdir()
    (pdir / "audio").mkdir()
    write_project(name, dict(DEFAULT_PROJECT))
    return pdir


def delete_project(name: str) -> None:
    pdir = project_path(name)
    if not pdir.exists():
        raise FileNotFoundError(f"project not found: {name}")
    shutil.rmtree(pdir)


def read_project(name: str) -> dict[str, Any]:
    pfile = project_file(name)
    if not pfile.exists():
        raise FileNotFoundError(f"project not found: {name}")
    return json.loads(pfile.read_text())


def write_project(name: str, data: dict[str, Any]) -> None:
    """Atomic write: tmp file + fsync + rename."""
    pdir = project_path(name)
    pdir.mkdir(parents=True, exist_ok=True)
    serialised = json.dumps(data, indent=2)
    fd, tmp_path = tempfile.mkstemp(prefix=".project.", suffix=".json.tmp", dir=pdir)
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(serialised)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, project_file(name))
    except BaseException:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
        raise


# --- samples / audio files ---

def list_samples(name: str) -> list[str]:
    d = project_path(name) / "samples"
    if not d.exists():
        return []
    return sorted(f.name for f in d.iterdir() if f.is_file())


def add_sample(name: str, src: Path) -> str:
    d = project_path(name) / "samples"
    d.mkdir(parents=True, exist_ok=True)
    dest = d / src.name
    shutil.copyfile(src, dest)
    return dest.name


def list_audio(name: str) -> list[str]:
    d = project_path(name) / "audio"
    if not d.exists():
        return []
    return sorted(
        f.name for f in d.iterdir()
        if f.is_file() and f.suffix.lower() in {".mp3", ".wav", ".ogg", ".flac"}
    )


def add_audio(name: str, src: Path) -> str:
    d = project_path(name) / "audio"
    d.mkdir(parents=True, exist_ok=True)
    dest = d / src.name
    shutil.copyfile(src, dest)
    return dest.name


def list_kit() -> list[str]:
    d = kit_dir()
    if not d.exists():
        return []
    return sorted(
        f.name for f in d.iterdir()
        if f.is_file() and f.suffix.lower() in {".wav", ".mp3"}
    )
