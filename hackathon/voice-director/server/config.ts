// Voice-director server configuration contract.
//
// Credentials (OPENAI_API_KEY, and optionally DEEPGRAM_API_KEY for the parallel
// realtime provider) live on the server. Nothing here is ever serialized to the
// browser bundle. If a key is missing the server comes up anyway, marks itself
// `missing-credential`, and every provider call returns a safe, explicit error —
// we never invent a credential and never fall back to pretending a session is a key.
import type { RealtimeProviderName } from '../shared/protocol';

export class MissingCredentialError extends Error {
  readonly key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = 'MissingCredentialError';
    this.key = key;
  }
}

export class ProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export interface SlackConfig {
  appToken: string | null;
  botToken: string | null;
}

/** Realtime relay configuration — same credential (OPENAI_API_KEY), separate endpoint. */
export interface RealtimeConfig {
  /** Which provider the relay gateway wires to. `openai` keeps legacy behavior. */
  provider: RealtimeProviderName;
  /** Model family is `gpt-realtime-*`; only the model prefix strings are docs-safe. */
  model: string;
  voice: string;
  /** Explicit Realtime WebSocket URL override; else derived from baseUrl (https -> wss + /realtime). */
  wsUrl: string | null;
  /** Enable input_audio_transcription so the relay can emit operator transcripts. */
  transcription: boolean;
  transcriptionModel: string | null;
}

/**
 * Deepgram Agent (parallel server-side realtime provider). Selected with
 * `VOICE_DIRECTOR_REALTIME_PROVIDER=deepgram`; `apiKey` is server-side only and
 * the browser protocol has no field for it. A missing key is reported the same
 * way OPENAI_API_KEY is — health + a 503-shaped local `error`, never invented.
 */
export interface DeepgramConfig {
  apiKey: string | null;
  /** Flux-family listen model. Must be `flux-*` with the Agent `version: v2`. */
  listenModel: string;
  /** Flux-family speak/TTS model. */
  speakModel: string;
  /** agent.think provider type (e.g. `google`). */
  llmProvider: string;
  /** agent.think model (e.g. `gemini-3.1-flash-lite`). */
  llmModel: string;
  /** Agent WebSocket endpoint (proxies/gateways). */
  wsUrl: string | null;
}

export interface DirectorConfig {
  /** null = not configured. Presence is required (and verified) before any provider call. */
  apiKey: string | null;
  model: string;
  voice: string;
  port: number;
  allowedOrigin: string;
  baseUrl: string;
  defaultJob: string;
  slack: SlackConfig;
  realtime: RealtimeConfig;
  deepgram: DeepgramConfig;
}

const DEFAULT_MODEL = 'gpt-4o-audio-preview';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_DEEPGRAM_LISTEN_MODEL = 'flux-general-en';
const DEFAULT_DEEPGRAM_SPEAK_MODEL = 'flux-kit-en';
const DEFAULT_DEEPGRAM_LLM_PROVIDER = 'google';
const DEFAULT_DEEPGRAM_LLM_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_DEEPGRAM_WS_URL = 'wss://agent.deepgram.com/v1/agent/converse';

function envValue(env: Record<string, string | undefined>, key: string): string | null {
  const v = env[key];
  return v && v.trim().length > 0 ? v.trim() : null;
}

function envBoolean(env: Record<string, string | undefined>, key: string, fallback: boolean): boolean {
  const v = envValue(env, key);
  if (v === null) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): DirectorConfig {
  return {
    apiKey: envValue(env, 'OPENAI_API_KEY'),
    model: envValue(env, 'VOICE_DIRECTOR_MODEL') ?? DEFAULT_MODEL,
    voice: envValue(env, 'VOICE_DIRECTOR_VOICE') ?? DEFAULT_VOICE,
    port: Number(envValue(env, 'VOICE_DIRECTOR_PORT') ?? '8787'),
    allowedOrigin: envValue(env, 'VOICE_DIRECTOR_ALLOWED_ORIGIN') ?? 'http://localhost:5173',
    baseUrl: envValue(env, 'VOICE_DIRECTOR_BASE_URL') ?? 'https://api.openai.com/v1',
    defaultJob: envValue(env, 'VOICE_DIRECTOR_JOB') ?? 'Assemble the desk-side drill station.',
    slack: {
      appToken: envValue(env, 'SLACK_APP_TOKEN'),
      botToken: envValue(env, 'SLACK_BOT_TOKEN'),
    },
    realtime: {
      provider: envValue(env, 'VOICE_DIRECTOR_REALTIME_PROVIDER')?.toLowerCase() === 'deepgram' ? 'deepgram' : 'openai',
      model: envValue(env, 'VOICE_DIRECTOR_REALTIME_MODEL') ?? DEFAULT_REALTIME_MODEL,
      voice: envValue(env, 'VOICE_DIRECTOR_REALTIME_VOICE') ?? DEFAULT_VOICE,
      wsUrl: envValue(env, 'VOICE_DIRECTOR_REALTIME_WS_URL'),
      transcription: envBoolean(env, 'VOICE_DIRECTOR_REALTIME_TRANSCRIPTION', true),
      transcriptionModel: envValue(env, 'VOICE_DIRECTOR_REALTIME_TRANSCRIPTION_MODEL') ?? DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
    },
    deepgram: {
      apiKey: envValue(env, 'DEEPGRAM_API_KEY'),
      listenModel: envValue(env, 'VOICE_DIRECTOR_DEEPGRAM_LISTEN_MODEL') ?? DEFAULT_DEEPGRAM_LISTEN_MODEL,
      speakModel: envValue(env, 'VOICE_DIRECTOR_DEEPGRAM_SPEAK_MODEL') ?? DEFAULT_DEEPGRAM_SPEAK_MODEL,
      llmProvider: envValue(env, 'VOICE_DIRECTOR_DEEPGRAM_LLM_PROVIDER') ?? DEFAULT_DEEPGRAM_LLM_PROVIDER,
      llmModel: envValue(env, 'VOICE_DIRECTOR_DEEPGRAM_LLM_MODEL') ?? DEFAULT_DEEPGRAM_LLM_MODEL,
      wsUrl: envValue(env, 'VOICE_DIRECTOR_DEEPGRAM_WS_URL') ?? DEFAULT_DEEPGRAM_WS_URL,
    },
  };
}

/**
 * Resolve the configured credential or fail loudly.
 * Throws MissingCredentialError — callers map it to a 503 + a human-readable
 * message. We never synthesize a key from session/auth state.
 */
export function requireApiKey(cfg: DirectorConfig): string {
  if (!cfg.apiKey) {
    throw new MissingCredentialError(
      'OPENAI_API_KEY',
      'OPENAI_API_KEY is not set. Set it in hackathon/voice-director/.env (server-side only). ' +
        'Missing provider credentials are reported, never invented.',
    );
  }
  return cfg.apiKey;
}

/**
 * Resolve the Deepgram Agent credential or fail loudly, mirroring the OpenAI
 * contract. Selected only when `VOICE_DIRECTOR_REALTIME_PROVIDER=deepgram`;
 * a missing DEEPGRAM_API_KEY surfaces as a safe local `error`
 * (missing_provider_credential) + `closed`, exactly like the OpenAI path.
 */
export function requireDeepgramApiKey(cfg: DirectorConfig): string {
  if (!cfg.deepgram.apiKey) {
    throw new MissingCredentialError(
      'DEEPGRAM_API_KEY',
      'DEEPGRAM_API_KEY is not set. Set it in hackathon/voice-director/.env (server-side only). ' +
        'Missing provider credentials are reported, never invented.',
    );
  }
  return cfg.deepgram.apiKey;
}