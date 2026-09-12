// Determinism + versioning for the shared scene/runbook payloads. These are pure
// functions with no provider — the fake-provider-only rule is unaffected.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RUNBOOK_VERSION,
  SCENE_LAYOUT_VERSION,
  cueFromSeed,
  deriveSceneLayout,
  feedbackSeed,
  hashString,
  type RunbookState,
  type SceneLayout,
} from '../../shared/scene';

const SPEC = {
  job: 'Assemble the desk-side drill station.',
  positions: [
    { id: 'top-left', anchorId: 'anchor-top-left', attempts: 0, seated: false },
    { id: 'top-right', anchorId: 'anchor-top-right', attempts: 0, seated: false },
    { id: 'bottom-left', anchorId: 'anchor-bottom-left', attempts: 0, seated: false },
    { id: 'bottom-right', anchorId: 'anchor-bottom-right', attempts: 0, seated: false },
  ],
};

test('deriveSceneLayout is deterministic: same spec + session -> identical payload', () => {
  const a = deriveSceneLayout(SPEC, 'sess-1');
  const b = deriveSceneLayout(SPEC, 'sess-1');
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('deriveSceneLayout is versioned and carries job + session', () => {
  const layout: SceneLayout = deriveSceneLayout(SPEC, 'sess-1');
  assert.equal(layout.version, SCENE_LAYOUT_VERSION);
  assert.equal(layout.sessionId, 'sess-1');
  assert.equal(layout.job, SPEC.job);
  assert.equal(layout.targets.length, 4);
});

test('deriveSceneLayout places targets on the normalized unit grid', () => {
  const layout = deriveSceneLayout(SPEC, 'sess-1');
  const xs = layout.targets.map((t) => t.x);
  assert.deepEqual(xs, [-1, -0.333, 0.333, 1]);
  for (const t of layout.targets) {
    assert.ok(t.x >= -1 && t.x <= 1, 'x within unit range');
    assert.equal(t.y, 0);
    assert.equal(t.z, 0);
    assert.equal(t.anchorId, `anchor-${t.id}`);
  }
  const single = deriveSceneLayout({ job: SPEC.job, positions: [SPEC.positions[0]] }, 'sess-1');
  assert.equal(single.targets[0].x, 0);
});

test('deriveSceneLayout derives colors deterministically from job + id', () => {
  const a = deriveSceneLayout(SPEC, 'sess-1');
  const b = deriveSceneLayout(SPEC, 'sess-2');
  assert.deepEqual(a.targets.map((t) => t.color), b.targets.map((t) => t.color));
  for (const t of a.targets) assert.match(t.color, /^hsl\(\d+ 70% 55%\)$/);
});

test('empty spec produces an empty versioned layout', () => {
  const layout = deriveSceneLayout({ job: SPEC.job, positions: [] }, 'sess-1');
  assert.equal(layout.version, SCENE_LAYOUT_VERSION);
  assert.deepEqual(layout.targets, []);
});

test('feedbackSeed is deterministic and varies with turn inputs', () => {
  assert.equal(feedbackSeed(SPEC.job, 1, 'Tighten the top-left screw.'), feedbackSeed(SPEC.job, 1, 'Tighten the top-left screw.'));
  assert.notEqual(feedbackSeed(SPEC.job, 1, 'one'), feedbackSeed(SPEC.job, 1, 'two'));
  assert.notEqual(feedbackSeed(SPEC.job, 1, 'same'), feedbackSeed(SPEC.job, 2, 'same'));
  const seed = feedbackSeed(SPEC.job, 1, 'Tighten the top-left screw.');
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, '32-bit unsigned hash');
});

test('cueFromSeed maps a seed to a stable, bounded two-note cue', () => {
  const cueA = cueFromSeed(123456);
  const cueB = cueFromSeed(123456);
  assert.deepEqual(cueA, cueB);
  assert.ok(cueA.freqA >= 220 && cueA.freqA < 660, 'base frequency in range');
  assert.ok(cueA.freqB > cueA.freqA, 'second note is higher');
  assert.equal(cueA.dur, 0.09);
  assert.equal(cueA.gap, 0.07);
});

test('runbook payload version is exported and round-trips the documented shape', () => {
  assert.equal(RUNBOOK_VERSION, 1);
  const runbook: RunbookState = {
    version: RUNBOOK_VERSION,
    sessionId: 'sess-1',
    spec: { job: SPEC.job, positions: SPEC.positions, confirmed: true },
    phase: 'coaching',
    currentScrew: 2,
    previous: [{ youSaid: 'put the jig on the bench', direction: 'Mount the jig.' }],
  };
  assert.equal(runbook.version, RUNBOOK_VERSION);
  assert.equal(runbook.currentScrew, 2);
  assert.equal(runbook.previous[0].direction, 'Mount the jig.');
});

test('hashString is stable and 32-bit', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.equal(hashString('abc'), 440920331);
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.ok(hashString('anything') <= 0xffffffff);
});