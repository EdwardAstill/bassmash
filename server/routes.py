import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api")

PROJECTS_DIR = Path.home() / "bassmash-projects"


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
