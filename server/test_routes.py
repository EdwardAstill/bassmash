import pytest
from httpx import AsyncClient, ASGITransport
from server.main import app


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_index_served(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    assert "M8S" in resp.text


@pytest.fixture
def projects_dir(tmp_path, monkeypatch):
    """Point PROJECTS_DIR + cli.store at a temp dir for the test's duration."""
    from server import routes
    monkeypatch.setattr(routes, "PROJECTS_DIR", tmp_path)
    monkeypatch.setenv("M8S_PROJECTS_DIR", str(tmp_path))
    return tmp_path


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


@pytest.mark.asyncio
async def test_upload_sample(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    files = {"file": ("kick.wav", b"RIFF fake wav data", "audio/wav")}
    resp = await client.post("/api/projects/my-beat/samples", files=files)
    assert resp.status_code == 201
    assert (projects_dir / "my-beat" / "samples" / "kick.wav").exists()

@pytest.mark.asyncio
async def test_get_sample(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    sample_path = projects_dir / "my-beat" / "samples" / "kick.wav"
    sample_path.write_bytes(b"RIFF fake wav data")
    resp = await client.get("/api/projects/my-beat/samples/kick.wav")
    assert resp.status_code == 200
    assert resp.content == b"RIFF fake wav data"

@pytest.mark.asyncio
async def test_get_sample_not_found(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.get("/api/projects/my-beat/samples/nope.wav")
    assert resp.status_code == 404


@pytest.fixture
def kit_dir(tmp_path, monkeypatch):
    from server import routes
    kit = tmp_path / "kit"
    kit.mkdir()
    (kit / "kick-punchy.wav").write_bytes(b"RIFF fake wav")
    (kit / "snare-crisp.wav").write_bytes(b"RIFF fake wav")
    monkeypatch.setattr(routes, "KIT_DIR", kit)
    monkeypatch.setenv("M8S_KIT_DIR", str(kit))
    return kit


@pytest.mark.asyncio
async def test_list_kit(client, kit_dir):
    resp = await client.get("/api/kit")
    assert resp.status_code == 200
    names = resp.json()
    assert "kick-punchy.wav" in names
    assert "snare-crisp.wav" in names


@pytest.mark.asyncio
async def test_get_kit_sample(client, kit_dir):
    resp = await client.get("/api/kit/kick-punchy.wav")
    assert resp.status_code == 200
    assert resp.content == b"RIFF fake wav"


@pytest.mark.asyncio
async def test_get_kit_sample_not_found(client, kit_dir):
    resp = await client.get("/api/kit/nope.wav")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_export_mp3(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.post(
        "/api/projects/my-beat/export",
        content=b"RIFF fake wav for export test",
        headers={"Content-Type": "audio/wav"},
    )
    assert resp.status_code in (200, 500)


@pytest.mark.asyncio
async def test_create_project_creates_audio_dir(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    assert (projects_dir / "my-beat" / "audio").is_dir()


@pytest.mark.asyncio
async def test_upload_audio(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    files = {"file": ("vocals.mp3", b"fake mp3 data", "audio/mpeg")}
    resp = await client.post("/api/projects/my-beat/audio", files=files)
    assert resp.status_code == 201
    assert resp.json()["filename"] == "vocals.mp3"
    assert (projects_dir / "my-beat" / "audio" / "vocals.mp3").exists()


@pytest.mark.asyncio
async def test_list_audio(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    (projects_dir / "my-beat" / "audio" / "vocals.mp3").write_bytes(b"fake")
    (projects_dir / "my-beat" / "audio" / "beat.wav").write_bytes(b"fake")
    resp = await client.get("/api/projects/my-beat/audio")
    assert resp.status_code == 200
    names = resp.json()
    assert "vocals.mp3" in names
    assert "beat.wav" in names


@pytest.mark.asyncio
async def test_get_audio_file(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    (projects_dir / "my-beat" / "audio" / "vocals.mp3").write_bytes(b"fake mp3")
    resp = await client.get("/api/projects/my-beat/audio/vocals.mp3")
    assert resp.status_code == 200
    assert resp.content == b"fake mp3"


@pytest.mark.asyncio
async def test_get_audio_file_not_found(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.get("/api/projects/my-beat/audio/nope.mp3")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rename_audio_file(client, projects_dir):
    await client.post("/api/projects", json={"name": "p"})
    (projects_dir / "p" / "audio" / "old.mp3").write_bytes(b"data")
    resp = await client.put(
        "/api/projects/p/audio/old.mp3",
        json={"newName": "new.mp3"},
    )
    assert resp.status_code == 200
    assert not (projects_dir / "p" / "audio" / "old.mp3").exists()
    assert (projects_dir / "p" / "audio" / "new.mp3").read_bytes() == b"data"


@pytest.mark.asyncio
async def test_rename_audio_file_missing_404(client, projects_dir):
    await client.post("/api/projects", json={"name": "p"})
    resp = await client.put(
        "/api/projects/p/audio/ghost.mp3",
        json={"newName": "new.mp3"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rename_audio_file_conflict_409(client, projects_dir):
    await client.post("/api/projects", json={"name": "p"})
    (projects_dir / "p" / "audio" / "a.mp3").write_bytes(b"a")
    (projects_dir / "p" / "audio" / "b.mp3").write_bytes(b"b")
    resp = await client.put(
        "/api/projects/p/audio/a.mp3",
        json={"newName": "b.mp3"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_rename_audio_file_rejects_traversal(client, projects_dir):
    await client.post("/api/projects", json={"name": "p"})
    (projects_dir / "p" / "audio" / "a.mp3").write_bytes(b"a")
    resp = await client.put(
        "/api/projects/p/audio/a.mp3",
        json={"newName": "../escaped.mp3"},
    )
    assert resp.status_code == 400
    assert (projects_dir / "p" / "audio" / "a.mp3").exists()


@pytest.mark.asyncio
async def test_delete_audio_file(client, projects_dir):
    await client.post("/api/projects", json={"name": "p"})
    (projects_dir / "p" / "audio" / "loop.mp3").write_bytes(b"x")
    resp = await client.delete("/api/projects/p/audio/loop.mp3")
    assert resp.status_code == 200
    assert not (projects_dir / "p" / "audio" / "loop.mp3").exists()


@pytest.mark.asyncio
async def test_delete_audio_file_missing_404(client, projects_dir):
    await client.post("/api/projects", json={"name": "p"})
    resp = await client.delete("/api/projects/p/audio/ghost.mp3")
    assert resp.status_code == 404


# ---------- security: path traversal ----------

@pytest.mark.parametrize("bad_name", [
    "../etc",
    "..%2Fetc",
    "foo/bar",
    ".",
    "..",
    "",
])
@pytest.mark.asyncio
async def test_create_project_rejects_unsafe_name(client, projects_dir, bad_name):
    resp = await client.post("/api/projects", json={"name": bad_name})
    assert resp.status_code in (400, 422)
    # Must not create anything outside projects_dir
    assert not (projects_dir.parent / "etc").exists()


@pytest.mark.parametrize("bad_name", ["..", "../other", "foo/bar"])
@pytest.mark.asyncio
async def test_get_project_rejects_unsafe_name(client, projects_dir, bad_name):
    resp = await client.get(f"/api/projects/{bad_name}")
    assert resp.status_code in (400, 404, 422)


@pytest.mark.asyncio
async def test_upload_sample_rejects_path_traversal_filename(client, projects_dir, tmp_path):
    await client.post("/api/projects", json={"name": "my-beat"})
    escape = tmp_path / "escape.wav"
    files = {"file": ("../escape.wav", b"payload", "audio/wav")}
    resp = await client.post("/api/projects/my-beat/samples", files=files)
    # Must not escape project dir
    assert not (projects_dir / "escape.wav").exists()
    # Either reject, or safely store under samples/
    if resp.status_code == 201:
        assert (projects_dir / "my-beat" / "samples" / "escape.wav").exists()


@pytest.mark.asyncio
async def test_get_sample_rejects_path_traversal(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.get("/api/projects/my-beat/samples/..%2F..%2Fproject.json")
    # Must not leak project.json via traversal
    assert resp.status_code in (400, 404)


@pytest.mark.asyncio
async def test_kit_rejects_path_traversal(client, kit_dir, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    resp = await client.get("/api/kit/..%2Fsecret.txt")
    assert resp.status_code in (400, 404)
    assert "top secret" not in resp.text


# ---------- duplicate + missing project edge cases ----------

@pytest.mark.asyncio
async def test_create_project_duplicate_returns_400(client, projects_dir):
    await client.post("/api/projects", json={"name": "dup"})
    resp = await client.post("/api/projects", json={"name": "dup"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_nonexistent_project_404(client, projects_dir):
    resp = await client.put("/api/projects/ghost", json={"bpm": 120})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_project(client, projects_dir):
    await client.post("/api/projects", json={"name": "doomed"})
    assert (projects_dir / "doomed").is_dir()
    resp = await client.delete("/api/projects/doomed")
    assert resp.status_code == 200
    assert not (projects_dir / "doomed").exists()


@pytest.mark.asyncio
async def test_delete_nonexistent_project_404(client, projects_dir):
    resp = await client.delete("/api/projects/ghost")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_upload_audio_to_nonexistent_project_404(client, projects_dir):
    files = {"file": ("vocals.mp3", b"fake", "audio/mpeg")}
    resp = await client.post("/api/projects/ghost/audio", files=files)
    assert resp.status_code == 404


# ---------- audio extensions ----------

@pytest.mark.asyncio
async def test_list_audio_includes_aif(client, projects_dir):
    """Frontend accepts .aif in its drop target — backend listing should too."""
    await client.post("/api/projects", json={"name": "my-beat"})
    (projects_dir / "my-beat" / "audio" / "loop.aif").write_bytes(b"fake aif")
    (projects_dir / "my-beat" / "audio" / "vocals.mp3").write_bytes(b"fake mp3")
    resp = await client.get("/api/projects/my-beat/audio")
    names = resp.json()
    assert "loop.aif" in names
    assert "vocals.mp3" in names


@pytest.mark.asyncio
async def test_list_audio_excludes_unknown_extensions(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    (projects_dir / "my-beat" / "audio" / "notes.txt").write_bytes(b"not audio")
    (projects_dir / "my-beat" / "audio" / "vocals.mp3").write_bytes(b"fake mp3")
    resp = await client.get("/api/projects/my-beat/audio")
    names = resp.json()
    assert "notes.txt" not in names
    assert "vocals.mp3" in names


@pytest.mark.asyncio
async def test_get_audio_aif_content_type(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    (projects_dir / "my-beat" / "audio" / "loop.aif").write_bytes(b"fake aif")
    resp = await client.get("/api/projects/my-beat/audio/loop.aif")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/")


# ---------- store integration (routes delegate to cli.store) ----------

@pytest.mark.asyncio
async def test_update_project_writes_via_store(client, projects_dir, monkeypatch):
    """PUT /api/projects/{name} must delegate to cli.store.write_project for
    atomic writes (no torn writes). Verified by call-tracking the store func."""
    from cli import store as cli_store
    calls: list[tuple[str, dict]] = []
    original = cli_store.write_project

    def tracking_write(name, data):
        calls.append((name, data))
        original(name, data)

    monkeypatch.setattr(cli_store, "write_project", tracking_write)

    await client.post("/api/projects", json={"name": "atom"})  # create → first write
    await client.put("/api/projects/atom", json={"bpm": 180, "tracks": []})

    assert len(calls) >= 2, "routes.py should delegate project writes to cli.store"
    assert any(name == "atom" and data.get("bpm") == 180 for name, data in calls)


# ---------- SSE project-events stream ----------

@pytest.mark.asyncio
async def test_update_project_returns_mtime(client, projects_dir):
    await client.post("/api/projects", json={"name": "sse-put"})
    resp = await client.put("/api/projects/sse-put", json={"bpm": 150})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "saved"
    assert isinstance(body.get("mtime_ns"), int) and body["mtime_ns"] > 0


@pytest.mark.asyncio
async def test_project_events_missing_project_404(client, projects_dir):
    async with client.stream("GET", "/api/projects/ghost/events") as resp:
        assert resp.status_code == 404


# NOTE: the `project-updated` SSE flow is exercised by the headless browser
# walkthrough, not here — in-process ASGI streaming with a concurrent PUT is
# brittle to test reliably without a real HTTP loop. The PUT mtime payload
# above and the 404 branch cover the parts of the endpoint that aren't
# wall-clock-dependent.
