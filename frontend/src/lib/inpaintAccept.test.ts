/**
 * Regression tests for the repaint accept path (lib/inpaintAccept).
 *
 * Runs under plain `node --test src/lib/inpaintAccept.test.ts` — the module
 * under test has no imports, so no bundler is needed.
 *
 * Scenario 1 (the stale-source-geometry defect): split a clip and repaint the
 * second half — the accepted clip must come back with offsetIntoSource 0 and
 * sourceDuration equal to the decoded blob, because the submitted audio was
 * cropped to the visible region and the returned blob IS the whole source now.
 *
 * Scenario 2 (the mid-generation edit race): trim the clip while the job is
 * generating — the accept must be REFUSED, never overwrite the edited clip
 * with audio cut for the old geometry.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveInpaintAccept,
  snapshotInpaintGeometry,
  type ClipGeometryLike,
} from './inpaintAccept.ts';

// A 20 s source split at 12 s: the second half starts 12 s into the source
// and is 8 s long — exactly the shape that used to silently play wrong audio.
const splitSecondHalf: ClipGeometryLike = {
  id: 'clip-2',
  offsetIntoSource: 12.0,
  durationSec: 8.0,
};

test('split-then-repaint: accept resets offset and takes the decoded duration', () => {
  const snapshot = snapshotInpaintGeometry(splitSecondHalf);
  // The model path's duration rounding can shift the result by a sample.
  const decoded = 8.0 - 1 / 44100;
  const res = resolveInpaintAccept(splitSecondHalf, snapshot, decoded);
  assert.equal(res.ok, true);
  assert.ok(res.ok);
  assert.equal(res.patch.offsetIntoSource, 0);
  assert.equal(res.patch.sourceDuration, decoded);
  assert.equal(res.patch.durationSec, decoded);
  assert.equal(res.patch.peaks, undefined);
});

test('trim mid-generation: accept is refused, not applied', () => {
  const snapshot = snapshotInpaintGeometry(splitSecondHalf);
  // The user trims the clip while the job polls: duration changes.
  const trimmed: ClipGeometryLike = { ...splitSecondHalf, durationSec: 5.5 };
  const res = resolveInpaintAccept(trimmed, snapshot, 8.0);
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.match(res.reason, /edited while the repaint was generating/);
});

test('re-trim of the left edge (offset change) is also refused', () => {
  const snapshot = snapshotInpaintGeometry(splitSecondHalf);
  const nudged: ClipGeometryLike = {
    ...splitSecondHalf,
    offsetIntoSource: 12.5,
    durationSec: 7.5,
  };
  const res = resolveInpaintAccept(nudged, snapshot, 8.0);
  assert.equal(res.ok, false);
});

test('deleted clip is refused', () => {
  const snapshot = snapshotInpaintGeometry(splitSecondHalf);
  const res = resolveInpaintAccept(undefined, snapshot, 8.0);
  assert.equal(res.ok, false);
});

test('sub-millisecond float wobble does not refuse', () => {
  const snapshot = snapshotInpaintGeometry(splitSecondHalf);
  const wobbled: ClipGeometryLike = {
    ...splitSecondHalf,
    offsetIntoSource: 12.0 + 1e-6,
    durationSec: 8.0 - 1e-6,
  };
  const res = resolveInpaintAccept(wobbled, snapshot, 8.0);
  assert.equal(res.ok, true);
});

test('empty decode is refused', () => {
  const snapshot = snapshotInpaintGeometry(splitSecondHalf);
  const res = resolveInpaintAccept(splitSecondHalf, snapshot, 0);
  assert.equal(res.ok, false);
});
