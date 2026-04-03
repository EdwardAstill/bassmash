import pytest
import json
from pathlib import Path
import tempfile
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_index_served(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    assert "Bassmash" in resp.text


@pytest.fixture
def projects_dir(tmp_path):
    """Create a temp directory for projects and patch the app."""
    import routes
    original = routes.PROJECTS_DIR
    routes.PROJECTS_DIR = tmp_path
    yield tmp_path
    routes.PROJECTS_DIR = original


@pytest.mark.asyncio
async def test_list_projects_empty(client, projects_dir):
    resp = await client.get("/api/projects")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_project(client, projects_dir):
    resp = await client.post("/api/projects", json={"name": "my-beat"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "my-beat"
    assert (projects_dir / "my-beat" / "project.json").exists()
    assert (projects_dir / "my-beat" / "samples").is_dir()


@pytest.mark.asyncio
async def test_list_projects_after_create(client, projects_dir):
    await client.post("/api/projects", json={"name": "beat-1"})
    await client.post("/api/projects", json={"name": "beat-2"})
    resp = await client.get("/api/projects")
    names = resp.json()
    assert "beat-1" in names
    assert "beat-2" in names


@pytest.mark.asyncio
async def test_get_project(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.get("/api/projects/my-beat")
    assert resp.status_code == 200
    data = resp.json()
    assert data["bpm"] == 140
    assert data["tracks"] == []


@pytest.mark.asyncio
async def test_update_project(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    update = {"bpm": 160, "timeSignature": "3/4", "tracks": []}
    resp = await client.put("/api/projects/my-beat", json=update)
    assert resp.status_code == 200
    resp2 = await client.get("/api/projects/my-beat")
    assert resp2.json()["bpm"] == 160


@pytest.mark.asyncio
async def test_get_nonexistent_project(client, projects_dir):
    resp = await client.get("/api/projects/nope")
    assert resp.status_code == 404
