import json
from pathlib import Path

import pytest

from cli import store


@pytest.fixture
def projects_root(tmp_path, monkeypatch):
    monkeypatch.setenv("BASSMASH_PROJECTS_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def kit_root(tmp_path, monkeypatch):
    kit = tmp_path / "kit"
    kit.mkdir()
    monkeypatch.setenv("BASSMASH_KIT_DIR", str(kit))
    return kit


def test_projects_dir_env_override(tmp_path, monkeypatch):
    monkeypatch.setenv("BASSMASH_PROJECTS_DIR", str(tmp_path / "weird"))
    assert store.projects_dir() == tmp_path / "weird"


def test_projects_dir_default(monkeypatch):
    monkeypatch.delenv("BASSMASH_PROJECTS_DIR", raising=False)
    assert store.projects_dir() == Path.home() / "bassmash-projects"


def test_create_and_list_project(projects_root):
    pdir = store.create_project("beat-1")
    assert pdir.is_dir()
    assert (pdir / "samples").is_dir()
    assert (pdir / "audio").is_dir()
    assert (pdir / "project.json").exists()
    assert store.list_projects() == ["beat-1"]


def test_create_project_duplicate_raises(projects_root):
    store.create_project("dup")
    with pytest.raises(FileExistsError):
        store.create_project("dup")


def test_read_write_roundtrip(projects_root):
    store.create_project("rt")
    store.write_project("rt", {"bpm": 180, "tracks": []})
    data = store.read_project("rt")
    assert data["bpm"] == 180


def test_read_nonexistent_raises(projects_root):
    with pytest.raises(FileNotFoundError):
        store.read_project("ghost")


def test_delete_project(projects_root):
    store.create_project("doomed")
    assert store.project_exists("doomed")
    store.delete_project("doomed")
    assert not store.project_exists("doomed")


def test_delete_nonexistent_raises(projects_root):
    with pytest.raises(FileNotFoundError):
        store.delete_project("ghost")


def test_write_project_is_atomic_on_crash(projects_root, monkeypatch):
    """If the write raises mid-flush, the existing project.json must be untouched."""
    store.create_project("atomic")
    original = store.read_project("atomic")

    # Corrupt json.dumps to blow up on specific payload.
    real_dumps = json.dumps

    def exploding_dumps(obj, *args, **kwargs):
        if isinstance(obj, dict) and obj.get("__explode"):
            raise RuntimeError("simulated crash")
        return real_dumps(obj, *args, **kwargs)

    monkeypatch.setattr("cli.store.json.dumps", exploding_dumps)

    with pytest.raises(RuntimeError):
        store.write_project("atomic", {"__explode": True})

    # Original file must be intact (no torn write).
    assert store.read_project("atomic") == original

    # No stale tmp files left behind.
    pdir = store.project_path("atomic")
    leftovers = [f for f in pdir.iterdir() if f.name.startswith(".project.")]
    assert leftovers == [], f"atomic write left tmp files: {leftovers}"


def test_list_projects_ignores_dirs_without_project_json(projects_root):
    (projects_root / "not-a-project").mkdir()
    store.create_project("real")
    assert store.list_projects() == ["real"]


def test_list_samples_empty(projects_root):
    store.create_project("p")
    assert store.list_samples("p") == []


def test_list_samples_sorted(projects_root):
    store.create_project("p")
    pdir = store.project_path("p")
    (pdir / "samples" / "b.wav").write_bytes(b"")
    (pdir / "samples" / "a.wav").write_bytes(b"")
    assert store.list_samples("p") == ["a.wav", "b.wav"]


def test_add_sample_copies_file(projects_root, tmp_path):
    store.create_project("p")
    src = tmp_path / "kick.wav"
    src.write_bytes(b"riff")
    name = store.add_sample("p", src)
    assert name == "kick.wav"
    assert (store.project_path("p") / "samples" / "kick.wav").read_bytes() == b"riff"


def test_list_audio_filters_by_extension(projects_root):
    store.create_project("p")
    adir = store.project_path("p") / "audio"
    (adir / "loop.wav").write_bytes(b"")
    (adir / "loop.aif").write_bytes(b"")
    (adir / "loop.mp3").write_bytes(b"")
    (adir / "notes.txt").write_bytes(b"")
    (adir / "loop.ogg").write_bytes(b"")
    (adir / "loop.flac").write_bytes(b"")
    audio = store.list_audio("p")
    assert set(audio) == {"loop.wav", "loop.mp3", "loop.ogg", "loop.flac"}
    # .aif not in cli/store.py's set; confirm that's still the case — if it
    # changes, this test pins the frontend/backend contract.
    assert "loop.aif" not in audio
    assert "notes.txt" not in audio


def test_list_kit(kit_root):
    (kit_root / "kick.wav").write_bytes(b"")
    (kit_root / "snare.mp3").write_bytes(b"")
    (kit_root / "notes.md").write_bytes(b"")
    assert set(store.list_kit()) == {"kick.wav", "snare.mp3"}


def test_list_kit_missing_dir_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("BASSMASH_KIT_DIR", str(tmp_path / "missing"))
    assert store.list_kit() == []


def test_default_project_shape():
    dp = store.DEFAULT_PROJECT
    assert dp["bpm"] == 140
    assert dp["timeSignature"] == "4/4"
    assert dp["tracks"] == []
    assert dp["patterns"] == []
    assert dp["arrangement"] == []
