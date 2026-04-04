import json
import subprocess
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api")

PROJECTS_DIR = Path.home() / "bassmash-projects"
KIT_DIR = Path(__file__).parent.parent / "kit"


def _ensure_projects_dir():
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


DEFAULT_PROJECT = {
    "bpm": 140,
    "timeSignature": "4/4",
    "tracks": [],
    "patterns": [],
    "arrangement": [],
}


class CreateProject(BaseModel):
    name: str


@router.get("/projects")
def list_projects():
    _ensure_projects_dir()
    return [
        d.name for d in sorted(PROJECTS_DIR.iterdir())
        if d.is_dir() and (d / "project.json").exists()
    ]


@router.post("/projects", status_code=201)
def create_project(body: CreateProject):
    _ensure_projects_dir()
    project_dir = PROJECTS_DIR / body.name
    if project_dir.exists():
        raise HTTPException(400, "Project already exists")
    project_dir.mkdir()
    (project_dir / "samples").mkdir()
    (project_dir / "audio").mkdir()
    (project_dir / "project.json").write_text(json.dumps(DEFAULT_PROJECT, indent=2))
    return {"name": body.name}


@router.get("/projects/{name}")
def get_project(name: str):
    project_file = PROJECTS_DIR / name / "project.json"
    if not project_file.exists():
        raise HTTPException(404, "Project not found")
    return json.loads(project_file.read_text())


@router.put("/projects/{name}")
def update_project(name: str, body: dict):
    project_file = PROJECTS_DIR / name / "project.json"
    if not project_file.exists():
        raise HTTPException(404, "Project not found")
    project_file.write_text(json.dumps(body, indent=2))
    return {"status": "saved"}


@router.post("/projects/{name}/samples", status_code=201)
async def upload_sample(name: str, file: UploadFile = File(...)):
    samples_dir = PROJECTS_DIR / name / "samples"
    if not samples_dir.exists():
        raise HTTPException(404, "Project not found")
    dest = samples_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"filename": file.filename}


@router.get("/projects/{name}/samples/{filename}")
def get_sample(name: str, filename: str):
    sample_path = PROJECTS_DIR / name / "samples" / filename
    if not sample_path.exists():
        raise HTTPException(404, "Sample not found")
    return FileResponse(sample_path, media_type="audio/wav")


@router.post("/projects/{name}/audio", status_code=201)
async def upload_audio(name: str, file: UploadFile = File(...)):
    audio_dir = PROJECTS_DIR / name / "audio"
    if not audio_dir.exists():
        raise HTTPException(404, "Project not found")
    dest = audio_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"filename": file.filename}


@router.get("/projects/{name}/audio")
def list_audio(name: str):
    audio_dir = PROJECTS_DIR / name / "audio"
    if not audio_dir.exists():
        raise HTTPException(404, "Project not found")
    return [
        f.name for f in sorted(audio_dir.iterdir())
        if f.suffix.lower() in (".mp3", ".wav", ".ogg", ".flac")
    ]


@router.get("/projects/{name}/audio/{filename}")
def get_audio_file(name: str, filename: str):
    audio_path = PROJECTS_DIR / name / "audio" / filename
    if not audio_path.exists():
        raise HTTPException(404, "Audio file not found")
    suffix = audio_path.suffix.lower()
    media_type = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac"}.get(suffix, "audio/mpeg")
    return FileResponse(audio_path, media_type=media_type)


@router.get("/kit")
def list_kit():
    if not KIT_DIR.exists():
        return []
    return [f.name for f in sorted(KIT_DIR.iterdir()) if f.suffix in (".wav", ".mp3")]


@router.get("/kit/{filename}")
def get_kit_sample(filename: str):
    sample_path = KIT_DIR / filename
    if not sample_path.exists():
        raise HTTPException(404, "Kit sample not found")
    return FileResponse(sample_path, media_type="audio/wav")


@router.post("/projects/{name}/export")
async def export_mp3(name: str, request: Request):
    project_dir = PROJECTS_DIR / name
    if not project_dir.exists():
        raise HTTPException(404, "Project not found")
    wav_data = await request.body()
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
    return {"path": str(mp3_path), "filename": "export.mp3"}
