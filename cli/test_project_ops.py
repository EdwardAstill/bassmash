import pytest

from cli import project_ops as ops


def fresh_project() -> dict:
    return {
        "bpm": 140,
        "timeSignature": "4/4",
        "tracks": [],
        "patterns": [],
        "arrangement": [],
    }


# --- bpm ---

def test_set_bpm_valid():
    p = fresh_project()
    ops.set_bpm(p, 180)
    assert p["bpm"] == 180


@pytest.mark.parametrize("bad", [0, 19, 301, -5, 1000])
def test_set_bpm_rejects_out_of_range(bad):
    p = fresh_project()
    with pytest.raises(ValueError):
        ops.set_bpm(p, bad)


# --- tracks ---

def test_add_track_returns_index():
    p = fresh_project()
    assert ops.add_track(p, "Kick", "sample") == 0
    assert ops.add_track(p, "Snare", "sample") == 1
    assert len(p["tracks"]) == 2


def test_add_track_rejects_bad_kind():
    p = fresh_project()
    with pytest.raises(AssertionError):
        ops.add_track(p, "Oops", "banana")


def test_add_synth_track_has_synth_params():
    p = fresh_project()
    ops.add_track(p, "Lead", "synth")
    assert p["tracks"][0]["synthParams"] == {}


def test_remove_track_shifts_arrangement_indexes():
    p = fresh_project()
    ops.add_track(p, "A", "sample")
    ops.add_track(p, "B", "sample")
    ops.add_track(p, "C", "sample")
    ops.add_drum_pattern(p, "P", 16)
    ops.add_clip(p, 0, 0, 0, 4)
    ops.add_clip(p, 1, 0, 4, 4)  # on track B (index 1)
    ops.add_clip(p, 2, 0, 8, 4)  # on track C (index 2)
    ops.remove_track(p, 1)  # drop B
    tracks = [c["trackIndex"] for c in p["arrangement"]]
    assert tracks == [0, 1]  # A stays, C shifts 2→1, B's clip gone


def test_remove_track_out_of_range():
    p = fresh_project()
    ops.add_track(p, "A", "sample")
    with pytest.raises(IndexError):
        ops.remove_track(p, 5)


def test_set_track_field():
    p = fresh_project()
    ops.add_track(p, "A", "sample")
    ops.set_track_field(p, 0, "volume", 0.5)
    assert p["tracks"][0]["volume"] == 0.5


# --- patterns ---

def test_add_drum_pattern():
    p = fresh_project()
    idx = ops.add_drum_pattern(p, "Drums", 16)
    assert idx == 0
    assert p["patterns"][0]["type"] == "steps"
    assert p["patterns"][0]["stepCount"] == 16


def test_add_synth_pattern():
    p = fresh_project()
    idx = ops.add_synth_pattern(p, "Lead", 64)
    assert idx == 0
    assert p["patterns"][0]["type"] == "notes"
    assert p["patterns"][0]["length"] == 64


def test_parse_cells_standard():
    cells = ops.parse_cells("1000001000100000", 16)
    assert cells[0] is True
    assert cells[1] is False
    assert cells[6] is True
    assert len(cells) == 16


def test_parse_cells_with_separators():
    cells = ops.parse_cells("1000-0010-0010-0000", 16)
    assert len(cells) == 16
    assert cells[0] is True


def test_parse_cells_wrong_length():
    with pytest.raises(ValueError):
        ops.parse_cells("10101010", 16)


def test_set_drum_row_upsert():
    p = fresh_project()
    pidx = ops.add_drum_pattern(p, "D", 16)
    r1 = ops.set_drum_row(p, pidx, "Kick", "kit://k.wav", ops.parse_cells("1" * 16, 16))
    # Re-setting same row replaces, not appends
    r2 = ops.set_drum_row(p, pidx, "Kick", "kit://k2.wav", ops.parse_cells("0" * 16, 16))
    assert r1 == r2 == 0
    assert len(p["patterns"][pidx]["steps"]) == 1
    assert p["patterns"][pidx]["steps"][0]["sampleRef"] == "kit://k2.wav"


def test_set_drum_row_rejects_wrong_pattern_type():
    p = fresh_project()
    pidx = ops.add_synth_pattern(p, "Lead", 16)
    with pytest.raises(ValueError):
        ops.set_drum_row(p, pidx, "Kick", "x", ops.parse_cells("1" * 16, 16))


def test_set_drum_row_default_velocities():
    p = fresh_project()
    pidx = ops.add_drum_pattern(p, "D", 16)
    ops.set_drum_row(p, pidx, "Kick", "kit://k.wav", ops.parse_cells("1" * 16, 16))
    vels = p["patterns"][pidx]["steps"][0]["velocities"]
    assert vels == [100] * 16


def test_clear_drum_pattern():
    p = fresh_project()
    pidx = ops.add_drum_pattern(p, "D", 16)
    ops.set_drum_row(p, pidx, "Kick", "x", ops.parse_cells("1" * 16, 16))
    ops.clear_drum_pattern(p, pidx)
    assert p["patterns"][pidx]["steps"] == []


# --- notes ---

def test_add_note_valid():
    p = fresh_project()
    pidx = ops.add_synth_pattern(p, "Lead", 64)
    ops.add_note(p, pidx, pitch=60, start=0, duration=4, velocity=100)
    assert len(p["patterns"][pidx]["notes"]) == 1


@pytest.mark.parametrize("pitch", [-1, 128, 256])
def test_add_note_rejects_bad_pitch(pitch):
    p = fresh_project()
    pidx = ops.add_synth_pattern(p, "Lead", 64)
    with pytest.raises(ValueError):
        ops.add_note(p, pidx, pitch=pitch, start=0, duration=4)


@pytest.mark.parametrize("vel", [0, 128, -1])
def test_add_note_rejects_bad_velocity(vel):
    p = fresh_project()
    pidx = ops.add_synth_pattern(p, "Lead", 64)
    with pytest.raises(ValueError):
        ops.add_note(p, pidx, pitch=60, start=0, duration=4, velocity=vel)


def test_parse_notes_basic():
    notes = ops.parse_notes("60:0:4:100,64:4:4,67:8:4")
    assert len(notes) == 3
    assert notes[0] == {"pitch": 60, "start": 0, "duration": 4, "velocity": 100}
    # No velocity → default 100
    assert notes[1]["velocity"] == 100


def test_parse_notes_rejects_malformed():
    with pytest.raises(ValueError):
        ops.parse_notes("60:0")  # too few parts


# --- arrangement ---

def test_add_clip_validates_track_and_pattern_indexes():
    p = fresh_project()
    ops.add_track(p, "A", "sample")
    ops.add_drum_pattern(p, "D", 16)
    with pytest.raises(IndexError):
        ops.add_clip(p, 5, 0, 0, 4)
    with pytest.raises(IndexError):
        ops.add_clip(p, 0, 5, 0, 4)


def test_add_audio_clip_shape():
    p = fresh_project()
    ops.add_track(p, "Audio", "audio")
    ops.add_audio_clip(p, 0, "audio://loop.wav", 0, 8, offset=4)
    clip = p["arrangement"][0]
    assert clip["type"] == "audio"
    assert clip["audioRef"] == "audio://loop.wav"
    assert clip["offset"] == 4


def test_clear_arrangement():
    p = fresh_project()
    ops.add_track(p, "A", "sample")
    ops.add_drum_pattern(p, "D", 16)
    ops.add_clip(p, 0, 0, 0, 4)
    ops.clear_arrangement(p)
    assert p["arrangement"] == []


# --- demo tune ---

def test_build_demo_tune_is_idempotent():
    p = fresh_project()
    ops.build_demo_tune(p)
    first_tracks = len(p["tracks"])
    first_patterns = len(p["patterns"])
    first_clips = len(p["arrangement"])

    ops.build_demo_tune(p)
    assert len(p["tracks"]) == first_tracks
    assert len(p["patterns"]) == first_patterns
    assert len(p["arrangement"]) == first_clips


def test_build_demo_tune_has_expected_tracks():
    p = fresh_project()
    ops.build_demo_tune(p)
    names = [t["name"] for t in p["tracks"]]
    assert "Drums" in names
    assert "808" in names
    assert "Bells" in names
    assert p["bpm"] == 143
