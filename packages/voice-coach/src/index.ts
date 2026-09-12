// Trillium side of HACKATHON_BUILD_PLAN: voice pipeline + coach state machine.
// Audio passage: headset mic → transcribe → coach → speak → headset speakers.
// API-first (keys server-side only); local STT/TTS stays as fallback.

export interface ScrewPosition {
  id: string;
  /** Anchor id from Klause's spatial-anchor side; opaque here. */
  anchorId: string;
  attempts: number;
  seated: boolean;
}

export interface TaskSpec {
  job: string;
  positions: ScrewPosition[];
  /** Confirm-back gate: nothing renders in VR until the user confirms. */
  confirmed: boolean;
}

export type CoachPhase =
  | 'setup'
  | 'confirm-back'
  | 'coaching'
  | 'escalated'
  | 'done';

export interface CoachState {
  phase: CoachPhase;
  spec: TaskSpec;
  currentScrew: number;
}

export function createCoach(job: string): CoachState {
  return { phase: 'setup', spec: { job, positions: [], confirmed: false }, currentScrew: 0 };
}

export function confirmSpec(state: CoachState, positions: ScrewPosition[]): CoachState {
  return {
    ...state,
    phase: 'confirm-back',
    spec: { ...state.spec, positions, confirmed: true },
  };
}

export function advanceScrew(state: CoachState): CoachState {
  const next = state.currentScrew + 1;
  const done = next >= state.spec.positions.length;
  return { ...state, currentScrew: next, phase: done ? 'done' : 'coaching' };
}

// --- Voice pipeline (stubs; wire keys + transport on build day) ---

export async function transcribe(_audio: ArrayBuffer): Promise<string> {
  // TODO: headset mic → API transcription (local STT fallback).
  throw new Error('transcribe: not wired');
}

export async function coachReply(state: CoachState, utterance: string): Promise<string> {
  // TODO: fast model in VR, slow-smart in planning room. Keep prompts short.
  void state;
  void utterance;
  throw new Error('coachReply: not wired');
}

export async function speak(_text: string): Promise<ArrayBuffer> {
  // TODO: API speech → headset speakers (local TTS fallback).
  throw new Error('speak: not wired');
}

export async function voiceRoundTrip(state: CoachState, audio: ArrayBuffer): Promise<ArrayBuffer> {
  const text = await transcribe(audio);
  const reply = await coachReply(state, text);
  return speak(reply);
}
