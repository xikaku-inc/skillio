// Voice-director server configuration contract.
//
// The ONE required credential is OPENAI_API_KEY and it must live on the server.
// Nothing here is ever serialized to the browser bundle. If the key is missing
// the server comes up anyway, marks itself `missing-credential`, and every
// provider call returns a safe, explicit error — we never invent a credential
// and never fall back to pretending a session is a key.

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
  /** Model family is `gpt-realtime-*`; only the model prefix strings are docs-safe. */
  model: string;
  voice: string;
  /** Explicit Realtime WebSocket URL override; else derived from baseUrl (https -> wss + /realtime). */
  wsUrl: string | null;
  /** Enable input_audio_transcription so the relay can emit operator transcripts. */
  transcription: boolean;
  transcriptionModel: string | null;
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
}

const DEFAULT_MODEL = 'gpt-4o-audio-preview';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

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
      model: envValue(env, 'VOICE_DIRECTOR_REALTIME_MODEL') ?? DEFAULT_REALTIME_MODEL,
      voice: envValue(env, 'VOICE_DIRECTOR_REALTIME_VOICE') ?? DEFAULT_VOICE,
      wsUrl: envValue(env, 'VOICE_DIRECTOR_REALTIME_WS_URL'),
      transcription: envBoolean(env, 'VOICE_DIRECTOR_REALTIME_TRANSCRIPTION', true),
      transcriptionModel: envValue(env, 'VOICE_DIRECTOR_REALTIME_TRANSCRIPTION_MODEL') ?? DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
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