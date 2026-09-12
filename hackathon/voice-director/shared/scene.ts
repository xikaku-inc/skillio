// Versioned scene-layout + runbook/task-state payloads shared by every surface:
// the Vite client, a REMOTE Unity process (no local Unity dependency anywhere in
// this slice), and the MCP/CopilotKit/Slack siblings. Everything here is a pure,
// deterministic function of its input so any consumer reproduces the same layout
// and the same feedback for the same confirmed spec.
import type { CoachPhase, ScrewPosition } from '@skillio/voice-coach';

/** Version of the runbook/task-state payload. Bump when the shape changes. */
export const RUNBOOK_VERSION = 1;

/** Version of the scene-layout payload. Bump when the shape changes. */
export const SCENE_LAYOUT_VERSION = 1;

export interface RunbookTurn {
  youSaid: string;
  direction: string;
}

/** Portable task state a remote Unity process can consume without local Unity code. */
export interface RunbookState {
  version: typeof RUNBOOK_VERSION;
  sessionId: string;
  spec: { job: string; positions: ScrewPosition[]; confirmed: boolean };
  phase: CoachPhase;
  currentScrew: number;
  previous: RunbookTurn[];
}

/** One target on the (normalized) job surface. Coordinates are unit-space. */
export interface SceneTarget {
  id: string;
  anchorId: string;
  label: string;
  x: number;
  y: number;
  z: number;
  /** Deterministic derived color, e.g. "hsl(213 70% 55%)". */
  color: string;
}

export interface SceneLayout {
  version: typeof SCENE_LAYOUT_VERSION;
  sessionId: string;
  job: string;
  targets: SceneTarget[];
}

/** FNV-1a 32-bit hash — small, stable, dependency-free deterministic seed. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const GRID_COLORS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

/**
 * Derive the versioned scene layout deterministically from a confirmed spec.
 * Same spec + sessionId => byte-identical payload, so the browser and a remote
 * Unity process always agree on where each target sits and which color it is.
 */
export function deriveSceneLayout(
  spec: { job: string; positions: ScrewPosition[] },
  sessionId: string,
): SceneLayout {
  const positions = spec.positions;
  const n = positions.length;
  const targets: SceneTarget[] = positions.map((p, i) => {
    const x = n > 1 ? round3((i / (n - 1)) * 2 - 1) : 0;
    const y = 0;
    const z = 0;
    // Deterministic color: seeded hue (stable across sessions) staggered by the
    // target's index so adjacent dots in the strip always differ.
    const hue = (GRID_COLORS[hashString(`${spec.job}|${p.id}`) % GRID_COLORS.length] + i * 30) % 360;
    return {
      id: p.id,
      anchorId: p.anchorId,
      label: p.id,
      x,
      y,
      z,
      color: `hsl(${hue} 70% 55%)`,
    };
  });
  return { version: SCENE_LAYOUT_VERSION, sessionId, job: spec.job, targets };
}

/**
 * Seed shared by the PAIRED audio + visual feedback for one direction turn.
 * Just as deterministic as the layout: same job + step + direction => same seed
 * across every client and run.
 */
export function feedbackSeed(job: string, step: number, direction: string): number {
  return hashString(`${job}|${step}|${direction}`);
}

export interface FeedbackCue {
  freqA: number;
  freqB: number;
  dur: number;
  gap: number;
}

/** Deterministic two-note cue derived from a feedback seed (no RNG). */
export function cueFromSeed(seed: number): FeedbackCue {
  const base = 220 + (seed % 440);
  const major = (seed >>> 3) % 2 === 0;
  const multiplier = major ? 1.25 : 1.125;
  return { freqA: base, freqB: base * multiplier, dur: 0.09, gap: 0.07 };
}