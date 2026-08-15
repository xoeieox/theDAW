"""Composite a model-generated inpaint back into the original audio.

The Stable Audio 3 inpaint path passes the mask and masked audio to the model
as *conditioning only*: the sampler starts from pure noise and returns a full
reconstruction of the whole window. Without this module the audio the user did
NOT select would be model-reconstructed (it drifts) and the region boundary
would be whatever the model happened to do — the "patched-in" seam people
report against every model's repaint feature.

``composite_inpaint`` substitutes the original audio back outside the mask and
crossfades each boundary with an equal-power feather that ramps *inside* the
region, so everything outside ``[mask_start, mask_end]`` is **bit-identical**
to the input. That guarantee is the contract of the operating-table fork;
``tests/test_inpaint_composite.py`` asserts it exactly.
"""

from __future__ import annotations

import math

import numpy as np

# The model's edit boundary is quantised to the latent grid: the mask is
# built at audio rate and nearest-interpolated onto latents at 4096x
# downsampling / 44.1 kHz ≈ 93 ms per latent frame. The feather must span at
# least one latent frame or it crossfades inside a region the model already
# smeared — do not lower this default below ~0.093 s.
DEFAULT_FEATHER_SEC = 0.10

# A gentle loudness match is clamped so it can never fight a deliberate
# dynamic change (repainting a quiet bar into a loud one).
_MAX_LOUDNESS_GAIN_DB = 6.0
# Below this RMS the original region is effectively silent and a ratio match
# would blow the gain up; skip the match entirely.
_SILENCE_RMS = 1e-5


def _match_domains(
    original: np.ndarray,
    generated: np.ndarray,
    sample_rate: int,
    generated_sample_rate: int | None,
) -> np.ndarray:
    """Convert ``generated`` into the original's domain (rate + channels).

    Working in the original's domain is what makes outside-region bit-identity
    possible at all: the original is never resampled or remixed. On the main
    timeline path both conversions are no-ops (the editor crop is always
    44.1 kHz and the model output matches); the Make tab can upload arbitrary
    files, which is where these paths run.
    """
    if generated.ndim == 1:
        generated = generated[None, :]
    if generated_sample_rate is not None and int(generated_sample_rate) != int(
        sample_rate
    ):
        from scipy.signal import resample_poly

        g = math.gcd(int(generated_sample_rate), int(sample_rate))
        up = int(sample_rate) // g
        down = int(generated_sample_rate) // g
        generated = resample_poly(generated, up, down, axis=-1).astype(np.float32)

    ch = original.shape[0]
    if generated.shape[0] != ch:
        if ch == 1:
            # Mean-downmix to mono (timeline crops preserve the source clip's
            # channel count, so a mono clip must come back mono).
            generated = generated.mean(axis=0, keepdims=True)
        else:
            # Original has more channels than the generation: tile the last
            # channel out (mono -> stereo duplicates the single channel).
            reps = ch - generated.shape[0]
            generated = np.concatenate([generated] + [generated[-1:]] * reps, axis=0)
    return np.ascontiguousarray(generated, dtype=np.float32)


def composite_inpaint(
    original: np.ndarray,
    generated: np.ndarray,
    sample_rate: int,
    mask_start_sec: float,
    mask_end_sec: float,
    feather_sec: float = DEFAULT_FEATHER_SEC,
    match_loudness: bool = True,
    generated_sample_rate: int | None = None,
) -> np.ndarray:
    """Substitute ``original`` back outside the mask and feather the seams.

    Args:
        original: ``(channels, samples)`` float32 — the audio sent to the model.
        generated: ``(channels, samples)`` float32 — the model output. May be
            in a different domain; pass ``generated_sample_rate`` when its rate
            differs from ``sample_rate`` and it is resampled in (the original
            is never touched).
        sample_rate: the ORIGINAL's sample rate; the output is in this domain.
        mask_start_sec / mask_end_sec: the repainted region, in seconds.
        feather_sec: crossfade length at each boundary, ramping INSIDE the
            region so audio outside ``[start, end]`` stays bit-identical.
        match_loudness: scale ``generated`` by the region RMS ratio, clamped to
            ±6 dB; skipped when the original region is near-silent.

    Returns:
        ``(channels, n)`` float32 where ``n = min(len(original), len(generated))``,
        clipped to [-1, 1]. Bit-identical to ``original`` outside the region.
    """
    if original.ndim == 1:
        original = original[None, :]
    original = np.ascontiguousarray(original, dtype=np.float32)
    generated = _match_domains(original, generated, sample_rate, generated_sample_rate)

    # 1. Align lengths. Never pad — a mismatch here is a duration-rounding
    # difference (frontend crop rounds up, model truncation rounds down; at
    # most 1 sample on the timeline path), not missing content.
    n = min(original.shape[-1], generated.shape[-1])
    original = original[:, :n]
    generated = generated[:, :n]

    # 2. Region in samples.
    a = int(np.clip(int(mask_start_sec * sample_rate), 0, n))
    b = int(np.clip(int(mask_end_sec * sample_rate), a, n))
    if b <= a:
        return original.copy()

    # 3. Feather length: never more than half the region, nor more context
    # than exists on either side.
    f = min(int(feather_sec * sample_rate), (b - a) // 2, a, n - b)
    f = max(0, f)

    # 4. Optional gentle loudness match on the region.
    if match_loudness:
        orig_rms = float(np.sqrt(np.mean(np.square(original[:, a:b]))))
        gen_rms = float(np.sqrt(np.mean(np.square(generated[:, a:b]))))
        if orig_rms > _SILENCE_RMS and gen_rms > _SILENCE_RMS:
            max_ratio = 10.0 ** (_MAX_LOUDNESS_GAIN_DB / 20.0)
            ratio = float(np.clip(orig_rms / gen_rms, 1.0 / max_ratio, max_ratio))
            generated = generated * ratio

    # 5. Equal-power crossfade weights, ramping inside the region. Equal-power
    # (sin/cos), not linear, because the two sources are uncorrelated and a
    # linear fade dips ~3 dB in the middle.
    w_gen = np.zeros(n, dtype=np.float32)
    w_gen[a:b] = 1.0
    if f > 0:
        t = (np.arange(f, dtype=np.float32) + 0.5) / f
        w_gen[a : a + f] = np.sin(t * np.pi / 2.0)
        w_gen[b - f : b] = np.cos(t * np.pi / 2.0)
    # Outside the region the original must pass through EXACTLY (weight 1.0
    # multiplication, no addition of a zeroed generated term, would still be
    # exact — but keep the arithmetic away from it entirely to guarantee
    # bit-identity).
    out = original.copy()
    region = slice(a, b)
    wg = w_gen[region]
    wo = np.sqrt(np.maximum(0.0, 1.0 - np.square(wg))).astype(np.float32)
    out[:, region] = np.clip(
        original[:, region] * wo + generated[:, region] * wg, -1.0, 1.0
    )
    return out
