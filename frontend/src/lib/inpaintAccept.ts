/**
 * inpaintAccept — pure resolution logic for accepting a repaint result.
 *
 * Two independent defects lived in the accept path, and both bit exactly the
 * cut-then-repaint workflow this fork exists for:
 *
 * 1. STALE SOURCE GEOMETRY. submitInpaint deliberately crops the audio to the
 *    visible clip region before sending, so the returned blob starts at zero
 *    and is exactly the clip's duration long — but accept used to write only
 *    `{audioBlob, mimeType, peaks}`, leaving `offsetIntoSource` and
 *    `sourceDuration` pointing into the old, longer source. Every consumer
 *    then read the stale offset into the new short blob; the playback clamps
 *    (`Math.min(offset, buf.duration - 0.01)`) meant nothing crashed — it
 *    silently played the WRONG audio, collapsing to the final 10 ms for a
 *    clip trimmed near its source end. Untrimmed clips worked by accident
 *    (offset 0), which is why it survived.
 *
 * 2. MID-GENERATION EDITS. The job polls while the user is free to keep
 *    editing; the returned blob was cropped against pre-submit geometry. An
 *    accept after a re-trim would overwrite the edited clip with audio cut
 *    for the OLD geometry. The snapshot/refusal below makes accept refuse
 *    instead of overwriting.
 *
 * Kept free of imports so it runs under plain `node --test`
 * (src/lib/inpaintAccept.test.ts) — the component supplies the decoded blob
 * duration; this module decides.
 */

/** The clip geometry the submitted crop was cut against. */
export interface InpaintGeometrySnapshot {
  clipId: string;
  offsetIntoSource: number;
  durationSec: number;
}

export interface ClipGeometryLike {
  id: string;
  offsetIntoSource: number;
  durationSec: number;
}

/** Geometry drift below this is float wobble, not a user edit. */
const GEOMETRY_EPSILON_SEC = 1e-3;

export const snapshotInpaintGeometry = (
  clip: ClipGeometryLike,
): InpaintGeometrySnapshot => ({
  clipId: clip.id,
  offsetIntoSource: clip.offsetIntoSource,
  durationSec: clip.durationSec,
});

export type InpaintAcceptResolution =
  | {
      ok: true;
      /** Partial<AudioClip> patch: the blob starts at 0 and IS the whole
       *  source now, so offset resets and both durations come from the
       *  decoded blob (duration rounding in the model path can shift it —
       *  a stale sourceDuration is what caused defect 1 above). */
      patch: {
        offsetIntoSource: 0;
        sourceDuration: number;
        durationSec: number;
        peaks: undefined;
      };
    }
  | { ok: false; reason: string };

export function resolveInpaintAccept(
  clipNow: ClipGeometryLike | undefined,
  snapshot: InpaintGeometrySnapshot,
  decodedDurationSec: number,
): InpaintAcceptResolution {
  if (!clipNow || clipNow.id !== snapshot.clipId) {
    return { ok: false, reason: 'the clip no longer exists' };
  }
  if (
    Math.abs(clipNow.offsetIntoSource - snapshot.offsetIntoSource) >
      GEOMETRY_EPSILON_SEC ||
    Math.abs(clipNow.durationSec - snapshot.durationSec) > GEOMETRY_EPSILON_SEC
  ) {
    return {
      ok: false,
      reason:
        'the clip was edited while the repaint was generating — the result was ' +
        'cut for the old geometry. Re-select the region and repaint.',
    };
  }
  if (!(decodedDurationSec > 0)) {
    return { ok: false, reason: 'the repaint result decoded to empty audio' };
  }
  return {
    ok: true,
    patch: {
      offsetIntoSource: 0,
      sourceDuration: decodedDurationSec,
      durationSec: decodedDurationSec,
      peaks: undefined,
    },
  };
}
