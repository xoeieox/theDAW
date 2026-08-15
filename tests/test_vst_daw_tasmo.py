"""Smoke tests for the VST hosting and .tasmo project modules."""

import sys
import os

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_tasmo_project():
    from backend.modules.project.tasmo_project import TasmoProject, Track

    p = TasmoProject(project_name="My Song", tempo=128.0)
    assert p.format_version == 1
    assert p.tempo == 128.0
    assert p.time_signature == [4, 4]
    t = Track(id="t1", name="Bass", type="audio")
    p.tracks.append(t)
    d = p.model_dump()
    assert d["tracks"][0]["name"] == "Bass"
    print("  TasmoProject OK")


def test_tasmo_file_roundtrip(tmp_path=None):
    import tempfile
    from backend.modules.project.tasmo_project import TasmoProject, Track
    from backend.modules.project.tasmo_file import TasmoFile

    project = TasmoProject(project_name="Roundtrip Test", tempo=110.0)
    project.tracks.append(Track(id="t1", name="Drums", type="audio"))

    if tmp_path is None:
        tmp_path = tempfile.mkdtemp()
    path = os.path.join(tmp_path, "test.tasmo")

    # Save
    manifest = TasmoFile.save(project, path)
    assert manifest["format"] == "tasmo"
    assert manifest["project_name"] == "Roundtrip Test"
    print("  TasmoFile.save OK")

    # Info (manifest-only read)
    info = TasmoFile.info(path)
    assert info["format_version"] == 1
    print("  TasmoFile.info OK")

    # Load
    loaded, lmanifest = TasmoFile.load(path)
    assert loaded.project_name == "Roundtrip Test"
    assert loaded.tempo == 110.0
    assert len(loaded.tracks) == 1
    assert loaded.tracks[0].name == "Drums"
    print("  TasmoFile.load OK")


def test_tasmo_embed_roundtrip(tmp_path=None):
    import tempfile
    from backend.modules.project.tasmo_project import TasmoProject, Track, Clip
    from backend.modules.project.tasmo_file import TasmoFile

    if tmp_path is None:
        tmp_path = tempfile.mkdtemp()

    # A fake on-disk audio file (embedding stores bytes, does not decode).
    audio_src = os.path.join(tmp_path, "kick.wav")
    payload = b"RIFF....fake-wav-bytes-0123456789"
    with open(audio_src, "wb") as f:
        f.write(payload)

    project = TasmoProject(project_name="Embed Test", tempo=128.0)
    track = Track(id="t1", name="Drums", type="audio")
    track.clips.append(
        Clip(
            id="c1", name="Kick", clip_type="audio", track_id="t1", audio_file=audio_src
        )
    )
    # Second clip points at the same source -> must be stored once.
    track.clips.append(
        Clip(
            id="c2",
            name="Kick2",
            clip_type="audio",
            track_id="t1",
            audio_file=audio_src,
        )
    )
    project.tracks.append(track)

    path = os.path.join(tmp_path, "embed.tasmo")
    manifest = TasmoFile.save(project, path, embed_audio=True)
    assert manifest["audio_mode"] == "embedded"
    embedded = TasmoFile.list_audio(path)
    assert len(embedded) == 1, f"expected 1 embedded file, got {embedded}"
    print(f"  embed: stored {embedded}")

    # Load into a fresh media dir; clips relink to a real extracted file.
    media = os.path.join(tmp_path, "media_out")
    loaded, _ = TasmoFile.load(path, media_dir=media)
    c1, c2 = loaded.tracks[0].clips
    assert c1.audio_file is not None
    assert c1.audio_file.startswith(media), c1.audio_file
    assert os.path.isfile(c1.audio_file)
    with open(c1.audio_file, "rb") as f:
        assert f.read() == payload
    assert c2.audio_file == c1.audio_file  # shared source -> shared extraction
    assert (c1.audio_file_checksum or "").startswith("sha256:")
    print("  TasmoFile embed round-trip OK")


def test_vst_scanner():
    from backend.modules.vst.scanner import _default_vst3_dirs, Vst3PluginInfo

    dirs = _default_vst3_dirs()
    print(f"  VST3 dirs found: {len(dirs)}")
    # Vst3PluginInfo creation
    info = Vst3PluginInfo(name="Test.vst3", path="/tmp/Test.vst3", category="effect")
    assert info.name == "Test.vst3"
    print("  Vst3PluginInfo OK")


def test_vst_host():
    from backend.modules.vst.host import list_instances

    instances = list_instances()
    assert isinstance(instances, list)
    # list_builtin_effects requires pedalboard; skip if not installed
    try:
        from backend.modules.vst.host import list_builtin_effects

        builtins = list_builtin_effects()
        assert len(builtins) > 0
        assert any(b["name"] == "Reverb" for b in builtins)
        print(f"  Built-in effects: {len(builtins)}")
    except ImportError:
        print("  Built-in effects: skipped (pedalboard not installed)")


if __name__ == "__main__":
    print("Running VST / .tasmo smoke tests...")
    test_tasmo_project()
    test_tasmo_file_roundtrip()
    test_tasmo_embed_roundtrip()
    test_vst_scanner()
    test_vst_host()
    print("\nAll tests passed!")
