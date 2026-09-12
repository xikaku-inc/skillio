// Narrow local WebSocket protocol between a future browser voice client and the
// voice-director realtime relay server. This is the ONLY contract a browser
// client needs for full-duplex voice: text JSON frames in, text JSON frames out.
//
// Provider credentials NEVER travel on this protocol. The OPENAI_API_KEY lives
// in the server process and the relay replaces it with an outgoing WebSocket to
// the OpenAI Realtime API; the browser only ever sees the messages below. See
// server/realtime/REALTIME.md for the browser/server/provider boundaries and
// how this relay differs from the one-shot WAV HTTP turn.
//
// Keep serializable shapes only (no classes) — both the Vite client and the
// server import this file.
import type { ScrewPosition } from '@skillio/voice-coach';
import type { RunbookState } from './scene';

/** Bump when the local protocol shape changes. Clients may gate on `ready`. */
export const REALTIME_PROTOCOL_VERSION = 1;

/**
 * Client -> server on the local relay socket.
 *
 * | type | Payload | Meaning |
 * | --- | --- | --- |
 * | `start` | `job`, `positions?` | Create the server-authoritative runbook and open the provider session. Server replies `ready`. |
 * | `audio_input` | `data` (base64 PCM16 24kHz mono) | One microphone audio frame. |
 * | `interrupt` | — | Operator cancel: stop the in-flight provider response and clear the input buffers. |
 * | `confirm` | — | Explicit Skillio-side confirmation: advance exactly one runbook step. |
 * | `runbook_request` | — | Ask for the current runbook snapshot (reconnect/resync). |
 */
export type RealtimeClientMessage =
  | { type: 'start'; job: string; positions?: ScrewPosition[] }
  | { type: 'audio_input'; data: string }
  | { type: 'interrupt' }
  | { type: 'confirm' }
  | { type: 'runbook_request' };

/**
 * Server -> client on the local relay socket.
 *
 * | type | Payload | Meaning |
 * | --- | --- | --- |
 * | `ready` | `protocol`, `model`, `voice`, `runbook` | Provider session established; initial snapshot. |
 * | `audio_output` | `data` (base64 PCM16 audio delta) | Provider audio for playback. |
 * | `transcript` | `youSaid?`, `direction?`, `step`, `targetId?`, `feedbackSeed?` | Operator transcript and/or the coach guidance for the in-progress step. |
 * | `runbook` | `runbook` | Server-authoritative runbook update (a transition happened). |
 * | `error` | `code`, `message` | Relay/provider failure (same `code` vocabulary as the HTTP API errors). |
 * | `closed` | `reason` | Session ended; the socket closes after this. |
 */
export type RealtimeServerMessage =
  | { type: 'ready'; protocol: number; model: string; voice: string; runbook: RunbookState }
  | { type: 'audio_output'; data: string }
  | {
      type: 'transcript';
      youSaid?: string;
      direction?: string;
      step: number;
      targetId?: string;
      feedbackSeed?: number;
    }
  | { type: 'runbook'; runbook: RunbookState }
  | { type: 'error'; code: string; message: string }
  | { type: 'closed'; reason: string };

/** Relay error codes, kept in the same family as the ApiError codes. */
export const REALTIME_ERROR_CODES = {
  MISSING_CREDENTIAL: 'missing_provider_credential',
  SESSION_NOT_STARTED: 'session_not_started',
  PROVIDER_CONNECT_FAILED: 'provider_connect_failed',
  PROVIDER_SEND_FAILED: 'provider_send_failed',
  BAD_MESSAGE: 'bad_message',
} as const;