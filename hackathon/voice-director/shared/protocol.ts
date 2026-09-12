// Wire contract between the Vite client and the voice-director server.
// Both sides import this file — keep serializable shapes only (no classes).
// Coach domain types are reused from @skillio/voice-coach to keep the slice
// on the repo's existing vocabulary instead of inventing a parallel one.
import type { CoachPhase, ScrewPosition } from '@skillio/voice-coach';
import type { RunbookState, SceneLayout } from './scene';

export type ProviderStatus = 'ready' | 'missing-credential';

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking';

export interface HealthResponse {
  ok: boolean;
  provider: ProviderStatus;
  model: string;
  voice: string;
  copilot: boolean;
  slack: boolean;
}

export interface StartRequest {
  job: string;
  positions?: ScrewPosition[];
}

export interface StartResponse {
  ok: true;
  sessionId: string;
  phase: CoachPhase;
  spec: { job: string; positions: ScrewPosition[]; confirmed: boolean };
}

/** Body of POST /api/voice is raw WAV/PCM bytes; session id travels in a header. */
export interface VoiceResponse {
  ok: true;
  sessionId: string;
  phase: CoachPhase;
  youSaid: string;
  direction: string;
  audioBase64: string;
  mime: string;
  /** 1-based index of the screw this direction addresses (0 = free coaching). */
  step: number;
  /** Position id this direction addresses, when the spec defines positions. */
  targetId?: string;
  /** Deterministic seed shared by audio cue + scene highlight for this turn. */
  feedbackSeed: number;
}

export interface DirectRequest {
  sessionId?: string;
  job?: string;
  text: string;
}

export interface DirectResponse {
  ok: true;
  phase: CoachPhase;
  direction: string;
}

/** GET /api/scene/:sessionId — portable runbook + layout for a remote Unity process. */
export interface SceneResponse {
  ok: true;
  sessionId: string;
  runbook: RunbookState;
  layout: SceneLayout;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string };
}

export type ApiResponse<T> = T | ApiError;