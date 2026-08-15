"""Tests for backend/lib/inpaint_composite.py — the region-repaint contract.

The load-bearing assertion is BIT-IDENTITY outside the repainted region:
exact equality, not tolerance. If a change makes these fail, the change is
the defect — do not loosen the assertions.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.lib.inpaint_composite import composite_inpaint

SR = 44100


def _noise(channels: int, seconds: float, seed: int, sr: int = SR) -> np.ndarray:
    """Bounded noise, like real audio: the server clamps model output to
    [-1, 1] before compositing, so test signals stay inside that range too."""
    rng = np.random.default_rng(seed)
    x = rng.standard_normal((channels, int(seconds * sr))) * 0.25
    return np.clip(x, -0.99, 0.99).astype(np.float32)


def test_outside_region_is_bit_identical():
    original = _noise(2, 3.0, seed=1)
    generated = _noise(2, 3.0, seed=2)
    out = composite_inpaint(original, generated, SR, 1.0, 2.0)
    a, b = SR, 2 * SR
    np.testing.assert_array_equal(out[:, :a], original[:, :a])
    np.testing.assert_array_equal(out[:, b:], original[:, b:])


def test_inside_region_core_equals_generated():
    original = _noise(2, 3.0, seed=3)
    generated = _noise(2, 3.0, seed=4)
    out = composite_inpaint(
        original, generated, SR, 1.0, 2.0, feather_sec=0.10, match_loudness=False
    )
    a, b, f = SR, 2 * SR, int(0.10 * SR)
    np.testing.assert_array_equal(out[:, a + f : b - f], generated[:, a + f : b - f])


def test_loudness_match_scales_region():
    original = _noise(1, 3.0, seed=5)
    generated = _noise(1, 3.0, seed=6) * 0.5  # 6 dB quieter than the original
    out = composite_inpaint(original, generated, SR, 1.0, 2.0, match_loudness=True)
    a, b, f = SR, 2 * SR, int(0.10 * SR)
    core = slice(a + f, b - f)
    out_rms = float(np.sqrt(np.mean(np.square(out[:, core]))))
    orig_rms = float(np.sqrt(np.mean(np.square(original[:, a:b]))))
    # The region RMS should land near the original's (ratio computed over the
    # whole region; the core is a large sample of it).
    assert out_rms == pytest.approx(orig_rms, rel=0.05)


def test_loudness_match_skips_near_silent_original():
    original = np.zeros((1, 3 * SR), dtype=np.float32)
    generated = _noise(1, 3.0, seed=7)
    out = composite_inpaint(original, generated, SR, 1.0, 2.0, match_loudness=True)
    a, b, f = SR, 2 * SR, int(0.10 * SR)
    # No gain blow-up: the generated core passes through unscaled.
    np.testing.assert_array_equal(out[:, a + f : b - f], generated[:, a + f : b - f])


def test_no_power_dip_at_the_seams():
    # Two uncorrelated noise sources of equal power crossfaded with an
    # equal-power law must show flat power across both boundaries. A linear
    # fade would dip ~3 dB in the middle of each ramp.
    original = _noise(1, 4.0, seed=8)
    generated = _noise(1, 4.0, seed=9)
    out = composite_inpaint(
        original, generated, SR, 1.0, 3.0, feather_sec=0.10, match_loudness=False
    )
    sigma = float(np.sqrt(np.mean(np.square(original))))
    win = int(0.05 * SR)
    # Sweep windows across each seam (feather is 0.10 s wide at each edge).
    for seam in (1.0, 3.0):
        center = int(seam * SR)
        for off in range(-3 * win, 3 * win, win // 2):
            w = out[0, center + off : center + off + win]
            rms = float(np.sqrt(np.mean(np.square(w))))
            assert rms == pytest.approx(sigma, rel=0.15), (
                f"power dip/bump at seam {seam}s offset {off / SR:+.3f}s: "
                f"{rms:.4f} vs {sigma:.4f}"
            )


def test_empty_or_inverted_region_returns_original():
    original = _noise(2, 1.0, seed=10)
    generated = _noise(2, 1.0, seed=11)
    for start, end in [(0.5, 0.5), (0.8, 0.2)]:
        out = composite_inpaint(original, generated, SR, start, end)
        np.testing.assert_array_equal(out, original)


def test_region_at_the_very_start_and_end():
    original = _noise(1, 2.0, seed=12)
    generated = _noise(1, 2.0, seed=13)
    n = original.shape[-1]
    # Region starts at sample 0: no left context, feather clamps to a=0 -> f=0
    # on the left side constraint (f <= a).
    out = composite_inpaint(original, generated, SR, 0.0, 0.5, match_loudness=False)
    b = int(0.5 * SR)
    np.testing.assert_array_equal(out[:, b:], original[:, b:])
    # Region ends at the last sample: no right context (f <= n - b = 0).
    out = composite_inpaint(original, generated, SR, 1.5, 2.0, match_loudness=False)
    a = int(1.5 * SR)
    np.testing.assert_array_equal(out[:, :a], original[:, :a])
    assert out.shape[-1] == n


def test_region_shorter_than_two_feathers():
    original = _noise(1, 2.0, seed=14)
    generated = _noise(1, 2.0, seed=15)
    # 60 ms region with a 100 ms feather: the ramps clamp to half the region.
    out = composite_inpaint(
        original, generated, SR, 1.0, 1.06, feather_sec=0.10, match_loudness=False
    )
    a, b = SR, int(1.06 * SR)
    np.testing.assert_array_equal(out[:, :a], original[:, :a])
    np.testing.assert_array_equal(out[:, b:], original[:, b:])


def test_mismatched_lengths_truncate_never_pad():
    original = _noise(1, 2.0, seed=16)
    generated = _noise(1, 2.0, seed=17)[:, :-1]  # 1 sample short (rounding)
    out = composite_inpaint(original, generated, SR, 0.5, 1.5, match_loudness=False)
    assert out.shape[-1] == generated.shape[-1]
    a = int(0.5 * SR)
    np.testing.assert_array_equal(out[:, :a], original[:, :a])


def test_mono_original_stereo_generated_downmixes():
    original = _noise(1, 2.0, seed=18)
    generated = _noise(2, 2.0, seed=19)
    out = composite_inpaint(original, generated, SR, 0.5, 1.5, match_loudness=False)
    assert out.shape[0] == 1
    a, b = int(0.5 * SR), int(1.5 * SR)
    np.testing.assert_array_equal(out[:, :a], original[:, :a])
    np.testing.assert_array_equal(out[:, b:], original[:, b:])
    f = int(0.10 * SR)
    expected_core = generated.mean(axis=0, keepdims=True)[:, a + f : b - f]
    np.testing.assert_allclose(out[:, a + f : b - f], expected_core, atol=1e-6)


def test_stereo_original_mono_generated_tiles():
    original = _noise(2, 2.0, seed=20)
    generated = _noise(1, 2.0, seed=21)
    out = composite_inpaint(original, generated, SR, 0.5, 1.5, match_loudness=False)
    assert out.shape[0] == 2
    a, b = int(0.5 * SR), int(1.5 * SR)
    np.testing.assert_array_equal(out[:, :a], original[:, :a])
    np.testing.assert_array_equal(out[:, b:], original[:, b:])


def test_resample_path_no_drift_and_outside_identity():
    # 48 kHz original, generated at the model's 44.1 kHz: the generation is
    # resampled into the ORIGINAL's domain; the original is never resampled,
    # so outside-region bit-identity must still hold exactly.
    sr_in = 48000
    original = _noise(2, 2.0, seed=22, sr=sr_in)
    generated = _noise(2, 2.0, seed=23, sr=44100)
    out = composite_inpaint(
        original,
        generated,
        sr_in,
        0.5,
        1.5,
        match_loudness=False,
        generated_sample_rate=44100,
    )
    # Resampled generation spans (2.0s * 48000) samples up to filter rounding;
    # the output length is the min of the two and must be within a few samples
    # of the original's length (no cumulative drift).
    assert abs(out.shape[-1] - original.shape[-1]) <= 4
    n = out.shape[-1]
    a, b = int(0.5 * sr_in), int(1.5 * sr_in)
    np.testing.assert_array_equal(out[:, :a], original[:, :a])
    np.testing.assert_array_equal(out[:, b:n], original[:, b:n])


def test_output_is_clipped_and_float32():
    original = (_noise(1, 1.0, seed=24) * 4.0).astype(np.float32)
    generated = (_noise(1, 1.0, seed=25) * 4.0).astype(np.float32)
    out = composite_inpaint(original, generated, SR, 0.2, 0.8, match_loudness=False)
    assert out.dtype == np.float32
    region = out[:, int(0.2 * SR) : int(0.8 * SR)]
    assert float(np.max(np.abs(region))) <= 1.0
