import json
import re
import shutil
import subprocess
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from cli import store

router = APIRouter(prefix="/api")

# Module-level so tests can monkeypatch.
PROJECTS_DIR = store.projects_dir()
KIT_DIR = store.kit_dir()

AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".flac", ".aif", ".aiff"}
KIT_EXTENSIONS = {".wav", ".mp3"}
MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
}

_SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


class CreateProject(BaseModel):
    name: str


def _safe_name(name: str) -> str:
    if not name or name in (".", "..") or not _SAFE_NAME.match(name):
        raise HTTPException(400, "invalid name")
    return name


def _projects_root() -> Path:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    return PROJECTS_DIR


def _project_dir(name: str) -> Path:
    _safe_name(name)
    pdir = _projects_root() / name
    if not pdir.exists():
        raise HTTPException(404, "Project not found")
    return pdir


def _child_dir(name: str, sub: str) -> Path:
    return _project_dir(name) / sub


def _resolve_inside(root: Path, filename: str) -> Path:
    _safe_name(filename)
    target = (root / filename).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        raise HTTPException(400, "invalid filename")
    return target


# --- projects ---

@router.get("/projects")
def list_projects():
    root = _projects_root()
    return sorted(
        d.name for d in root.iterdir()
        if d.is_dir() and (d / "project.json").exists()
    )


@router.post("/projects", status_code=201)
def create_project(body: CreateProject):
    _safe_name(body.name)
    root = _projects_root()
    pdir = root / body.name
    if pdir.exists():
        raise HTTPException(400, "Project already exists")
    pdir.mkdir()
    (pdir / "samples").mkdir()
    (pdir / "audio").mkdir()
    _write_project(body.name, dict(store.DEFAULT_PROJECT))
    return {"name": body.name}


def _write_project(name: str, data: dict) -> None:
    """Atomic write via cli.store, scoped to our PROJECTS_DIR."""
    original = store.projects_dir
    store.projects_dir = lambda: PROJECTS_DIR
    try:
        store.write_project(name, data)
    finally:
        store.projects_dir = original


@router.get("/projects/{name}")
def get_project(name: str):
    pdir = _project_dir(name)
    pfile = pdir / "project.json"
    if not pfile.exists():
        raise HTTPException(404, "Project not found")
    return json.loads(pfile.read_text())


@router.delete("/projects/{name}")
def delete_project(name: str):
    pdir = _project_dir(name)
    shutil.rmtree(pdir)
    return {"deleted": name}


@router.put("/projects/{name}")
def update_project(name: str, body: dict):
    _project_dir(name)  # 404 if missing
    _write_project(name, body)
    return {"status": "saved"}


# --- samples ---

@router.post("/projects/{name}/samples", status_code=201)
async def upload_sample(name: str, file: UploadFile = File(...)):
    samples_dir = _child_dir(name, "samples")
    safe_filename = Path(file.filename or "").name
    dest = _resolve_inside(samples_dir, safe_filename)
    dest.write_bytes(await file.read())
    return {"filename": safe_filename}


@router.get("/projects/{name}/samples/{filename}")
def get_sample(name: str, filename: str):
    samples_dir = _child_dir(name, "samples")
    sample_path = _resolve_inside(samples_dir, filename)
    if not sample_path.exists():
        raise HTTPException(404, "Sample not found")
    return FileResponse(sample_path, media_type="audio/wav")


# --- audio ---

@router.post("/projects/{name}/audio", status_code=201)
async def upload_audio(name: str, file: UploadFile = File(...)):
    audio_dir = _child_dir(name, "audio")
    safe_filename = Path(file.filename or "").name
    dest = _resolve_inside(audio_dir, safe_filename)
    dest.write_bytes(await file.read())
    return {"filename": safe_filename}


@router.get("/projects/{name}/audio")
def list_audio(name: str):
    audio_dir = _child_dir(name, "audio")
    return [
        f.name for f in sorted(audio_dir.iterdir())
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS
    ]


@router.get("/projects/{name}/audio/{filename}")
def get_audio_file(name: str, filename: str):
    audio_dir = _child_dir(name, "audio")
    audio_path = _resolve_inside(audio_dir, filename)
    if not audio_path.exists():
        raise HTTPException(404, "Audio file not found")
    suffix = audio_path.suffix.lower()
    return FileResponse(audio_path, media_type=MEDIA_TYPES.get(suffix, "audio/mpeg"))


class RenameBody(BaseModel):
    newName: str


@router.put("/projects/{name}/audio/{filename}")
def rename_audio_file(name: str, filename: str, body: RenameBody):
    audio_dir = _child_dir(name, "audio")
    src = _resolve_inside(audio_dir, filename)
    if not src.exists():
        raise HTTPException(404, "Audio file not found")
    dst = _resolve_inside(audio_dir, body.newName)
    if dst.exists():
        raise HTTPException(409, "Target filename already exists")
    src.rename(dst)
    return {"filename": body.newName}


@router.delete("/projects/{name}/audio/{filename}")
def delete_audio_file(name: str, filename: str):
    audio_dir = _child_dir(name, "audio")
    audio_path = _resolve_inside(audio_dir, filename)
    if not audio_path.exists():
        raise HTTPException(404, "Audio file not found")
    audio_path.unlink()
    return {"deleted": filename}


# --- kit ---

@router.get("/kit")
def list_kit():
    if not KIT_DIR.exists():
        return []
    return [
        f.name for f in sorted(KIT_DIR.iterdir())
        if f.is_file() and f.suffix.lower() in KIT_EXTENSIONS
    ]


@router.get("/kit/{filename}")
def get_kit_sample(filename: str):
    if not KIT_DIR.exists():
        raise HTTPException(404, "Kit sample not found")
    sample_path = _resolve_inside(KIT_DIR, filename)
    if not sample_path.exists():
        raise HTTPException(404, "Kit sample not found")
    return FileResponse(sample_path, media_type="audio/wav")


# --- export ---

@router.post("/projects/{name}/export")
async def export_mp3(name: str, request: Request):
    project_dir = _project_dir(name)
    wav_data = await request.body()
    if not wav_data:
        raise HTTPException(400, "Empty WAV body")
    wav_path = project_dir / "export.wav"
    mp3_path = project_dir / "export.mp3"
    wav_path.write_bytes(wav_data)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path), "-b:a", "192k", str(mp3_path)],
            check=True, capture_output=True,
        )
    except FileNotFoundError:
        raise HTTPException(500, "ffmpeg not found — install ffmpeg to export MP3")
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"ffmpeg error: {e.stderr.decode()}")
    finally:
        wav_path.unlink(missing_ok=True)
    # Return the encoded MP3 bytes directly so the browser can trigger a
    # download in a single round-trip. The file is also kept on disk at
    # `project_dir/export.mp3` for server-side inspection.
    return FileResponse(
        mp3_path,
        media_type="audio/mpeg",
        filename=f"{name}.mp3",
    )
