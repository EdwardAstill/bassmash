"""Integration tests for the bassmash CLI. Exercises main.py → ops → store end-to-end."""
import json

import pytest
from typer.testing import CliRunner

from cli.main import app


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def projects_root(tmp_path, monkeypatch):
    monkeypatch.setenv("BASSMASH_PROJECTS_DIR", str(tmp_path))
    return tmp_path


def ok(result):
    assert result.exit_code == 0, f"exit={result.exit_code} output={result.output!r}"
    return result


def make_project(runner, name="p"):
    return ok(runner.invoke(app, ["project", "create", name]))


# --- project ---

def test_project_create_and_list(runner, projects_root):
    make_project(runner, "beat-1")
    result = ok(runner.invoke(app, ["project", "list"]))
    assert "beat-1" in result.stdout


def test_project_list_empty(runner, projects_root):
    result = ok(runner.invoke(app, ["project", "list"]))
    assert "(no projects)" in result.stdout


def test_project_create_duplicate_fails(runner, projects_root):
    make_project(runner, "dup")
    result = runner.invoke(app, ["project", "create", "dup"])
    assert result.exit_code != 0
    assert "already exists" in result.output.lower()


def test_project_delete_needs_flag(runner, projects_root):
    make_project(runner, "p")
    # Without --yes, prompts → input is empty → aborts
    result = runner.invoke(app, ["project", "delete", "p"], input="\n")
    assert result.exit_code != 0


def test_project_delete_with_yes(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["project", "delete", "p", "--yes"]))
    result = ok(runner.invoke(app, ["project", "list"]))
    assert "(no projects)" in result.stdout


def test_project_show(runner, projects_root):
    make_project(runner, "p")
    result = ok(runner.invoke(app, ["project", "show", "p"]))
    data = json.loads(result.stdout)
    assert data["bpm"] == 140
    assert data["tracks"] == []


def test_project_summary(runner, projects_root):
    make_project(runner, "p")
    result = ok(runner.invoke(app, ["project", "summary", "p"]))
    assert "bpm=140" in result.stdout
    assert "tracks=0" in result.stdout


# --- bpm ---

def test_bpm_get_set(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["bpm", "set", "p", "180"]))
    result = ok(runner.invoke(app, ["bpm", "get", "p"]))
    assert result.stdout.strip() == "180"


def test_bpm_set_out_of_range_fails(runner, projects_root):
    make_project(runner, "p")
    result = runner.invoke(app, ["bpm", "set", "p", "500"])
    assert result.exit_code != 0


# --- track ---

def test_track_add_list_set_rm(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["track", "add", "p", "--name", "Kick", "--kind", "sample"]))
    ok(runner.invoke(app, ["track", "add", "p", "--name", "Bass", "--kind", "synth"]))

    result = ok(runner.invoke(app, ["track", "list", "p"]))
    assert "Kick" in result.stdout
    assert "Bass" in result.stdout

    ok(runner.invoke(app, ["track", "set", "p", "0", "--volume", "0.5", "--mute"]))
    result = ok(runner.invoke(app, ["track", "list", "p"]))
    assert "vol=0.5" in result.stdout
    assert "mute=True" in result.stdout

    ok(runner.invoke(app, ["track", "rm", "p", "0"]))
    result = ok(runner.invoke(app, ["track", "list", "p"]))
    assert "Kick" not in result.stdout
    assert "Bass" in result.stdout


def test_track_add_bad_kind(runner, projects_root):
    make_project(runner, "p")
    result = runner.invoke(app, ["track", "add", "p", "--name", "X", "--kind", "banana"])
    assert result.exit_code != 0


# --- pattern ---

def test_drum_pattern_flow(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["pattern", "add-drums", "p", "--name", "Beat", "--steps", "16"]))
    ok(runner.invoke(app, [
        "pattern", "step-row", "p", "0",
        "--name", "Kick",
        "--sample", "kit://kick.wav",
        "--cells", "1000 0000 1000 0000",
    ]))
    result = ok(runner.invoke(app, ["project", "show", "p"]))
    data = json.loads(result.stdout)
    row = data["patterns"][0]["steps"][0]
    assert row["name"] == "Kick"
    assert row["sampleRef"] == "kit://kick.wav"
    expected = [False] * 16
    expected[0] = True
    expected[8] = True
    assert row["cells"] == expected

    ok(runner.invoke(app, ["pattern", "step-clear", "p", "0"]))
    result = ok(runner.invoke(app, ["project", "show", "p"]))
    assert json.loads(result.stdout)["patterns"][0]["steps"] == []


def test_synth_pattern_notes(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["pattern", "add-synth", "p", "--name", "Lead", "--length", "64"]))
    ok(runner.invoke(app, [
        "pattern", "notes-add-many", "p", "0",
        "--notes", "60:0:4:100,64:4:4,67:8:4",
    ]))
    data = json.loads(ok(runner.invoke(app, ["project", "show", "p"])).stdout)
    notes = data["patterns"][0]["notes"]
    assert len(notes) == 3
    assert notes[0]["pitch"] == 60

    ok(runner.invoke(app, ["pattern", "notes-clear", "p", "0"]))
    data = json.loads(ok(runner.invoke(app, ["project", "show", "p"])).stdout)
    assert data["patterns"][0]["notes"] == []


def test_pattern_step_row_wrong_length_fails(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["pattern", "add-drums", "p", "--name", "B", "--steps", "16"]))
    result = runner.invoke(app, [
        "pattern", "step-row", "p", "0",
        "--name", "Kick", "--sample", "kit://k.wav",
        "--cells", "10101010",  # only 8 cells, want 16
    ])
    assert result.exit_code != 0


# --- arrange ---

def test_arrange_add_and_clear(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["track", "add", "p", "--name", "T", "--kind", "sample"]))
    ok(runner.invoke(app, ["pattern", "add-drums", "p", "--name", "Pat", "--steps", "16"]))
    ok(runner.invoke(app, [
        "arrange", "add", "p",
        "--track", "0", "--pattern", "0",
        "--start", "0", "--length", "4",
    ]))
    data = json.loads(ok(runner.invoke(app, ["project", "show", "p"])).stdout)
    assert len(data["arrangement"]) == 1

    ok(runner.invoke(app, ["arrange", "clear", "p"]))
    data = json.loads(ok(runner.invoke(app, ["project", "show", "p"])).stdout)
    assert data["arrangement"] == []


def test_arrange_add_audio(runner, projects_root):
    make_project(runner, "p")
    ok(runner.invoke(app, ["track", "add", "p", "--name", "A", "--kind", "audio"]))
    ok(runner.invoke(app, [
        "arrange", "add-audio", "p",
        "--track", "0",
        "--ref", "loop.wav",
        "--start", "0", "--length", "8",
        "--offset", "2",
    ]))
    data = json.loads(ok(runner.invoke(app, ["project", "show", "p"])).stdout)
    clip = data["arrangement"][0]
    assert clip["type"] == "audio"
    assert clip["audioRef"] == "loop.wav"
    assert clip["offset"] == 2


# --- sample / audio copy ---

def test_sample_add_and_list(runner, projects_root, tmp_path):
    make_project(runner, "p")
    src = tmp_path / "kick.wav"
    src.write_bytes(b"riff")
    ok(runner.invoke(app, ["sample", "add", "p", str(src)]))
    result = ok(runner.invoke(app, ["sample", "list", "p"]))
    assert "kick.wav" in result.stdout


def test_audio_add_and_list(runner, projects_root, tmp_path):
    make_project(runner, "p")
    src = tmp_path / "vocals.mp3"
    src.write_bytes(b"fake mp3")
    ok(runner.invoke(app, ["audio", "add", "p", str(src)]))
    result = ok(runner.invoke(app, ["audio", "list", "p"]))
    assert "vocals.mp3" in result.stdout


# --- missing project error paths ---

def test_bpm_get_missing_project(runner, projects_root):
    result = runner.invoke(app, ["bpm", "get", "ghost"])
    assert result.exit_code != 0
