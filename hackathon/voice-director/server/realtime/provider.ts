// Provider boundary for the OpenAI Realtime relay.
//
// The relay is transport-agnostic: it drives a `RealtimeProvider`, and the
// only concrete implementation here opens a WebSocket to the documented OpenAI
// Realtime surface (`wss://api.openai.com/v1/realtime?model=...`) using the
// **server-side** OPENAI_API_KEY. The credential is resolved lazily inside
// `connect()` and never leaves this boundary — it cannot appear in a local
// relay frame because the local protocol has no field for it.
//
// The fake provider used by tests lives in the test file and never flows
// through `createRealtimeProvider`.
import { MissingCredentialError, ProviderError, requireApiKey, type DirectorConfig } from '../config';

/** Realtime session options sent with `session.update` (subset of the documented surface). */
export interface RealtimeSessionConfig {
  instructions: string;
  voice: string;
  modalities: ('text' | 'audio')[];
  input_audio_transcription?: { enabled: boolean; model?: string };
}

/** Client -> provider events this relay sends (documented OpenAI Realtime surface). */
export type ProviderClientEvent =
  | { type: 'session.update'; session: RealtimeSessionConfig }
  | { type: 'input_audio_buffer.append'; audio: string }
  | { type: 'input_audio_buffer.commit' }
  | { type: 'input_audio_buffer.clear' }
  | { type: 'response.cancel' }
  | {
      type: 'response.create';
      response?: { modalities?: ('text' | 'audio')[]; instructions?: string };
    };

/** Provider -> relay events this relay consumes (documented OpenAI Realtime surface). */
export type ProviderEvent =
  | { type: 'session.created' }
  | { type: 'session.updated' }
  | { type: 'conversation.item.created' }
  | { type: 'input_audio_buffer.speech_started' }
  | { type: 'input_audio_buffer.speech_stopped' }
  | { type: 'input_audio_buffer.committed' }
  | { type: 'input_audio_buffer.cleared' }
  | { type: 'conversation.item.input_audio_transcription.completed'; transcript?: string }
  | { type: 'conversation.item.input_audio_transcription.failed'; error?: { code?: string; message?: string } }
  | { type: 'response.created' }
  | { type: 'response.output_audio.delta'; delta?: string }
  | { type: 'response.output_audio.done' }
  | { type: 'response.text.delta'; delta?: string }
  | { type: 'response.text.done'; text?: string }
  | { type: 'response.done' }
  | { type: 'response.cancelled' }
  | { type: 'error'; code?: string; message?: string };

/**
 * Credential-carrying settings, created ONLY inside the server boundary from a
 * configured `OPENAI_API_KEY`. Never serialized into a local relay message.
 */
export interface RealtimeProviderSettings {
  apiKey: string;
  model: string;
  voice: string;
  wsUrl: string;
  transcriptionEnabled: boolean;
  transcriptionModel?: string;
}

/** The provider surface the relay drives. Tests implement this with a fake. */
export interface RealtimeProvider {
  readonly name: string;
  connect(): Promise<void>;
  send(event: ProviderClientEvent): Promise<void> | void;
  close(code?: number, reason?: string): void;
  onEvent(listener: (event: ProviderEvent) => void): void;
}

const OPENAI_BETA_HEADER = 'realtime=v1';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

/**
 * Build the Realtime WebSocket URL. `VOICE_DIRECTOR_REALTIME_WS_URL` wins when
 * set; otherwise derive from the Responses base URL (https -> wss + /realtime).
 */
export function realtimeEndpoint(cfg: DirectorConfig): string {
  if (cfg.realtime.wsUrl) return cfg.realtime.wsUrl;
  const wsHost = cfg.baseUrl.replace(/^https?/, (scheme) => (scheme === 'https' ? 'wss' : 'ws'));
  return `${wsHost}/realtime`;
}

/**
 * Resolve the server-side credential into provider settings, or throw
 * MissingCredentialError with the same clear "which env var" message the HTTP
 * slice uses. This is the ONLY place the API key becomes concrete.
 */
export function buildRealtimeProviderSettings(cfg: DirectorConfig): RealtimeProviderSettings {
  return {
    apiKey: requireApiKey(cfg),
    model: cfg.realtime.model,
    voice: cfg.realtime.voice,
    wsUrl: realtimeEndpoint(cfg),
    transcriptionEnabled: cfg.realtime.transcription,
    transcriptionModel: cfg.realtime.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL,
  };
}

/**
 * Whitelist a raw provider WebSocket payload into a typed ProviderEvent.
 * Unknown/unsupported event types return null and are ignored by the relay.
 */
export function parseProviderEvent(raw: unknown): ProviderEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  switch (type) {
    case 'session.created':
    case 'session.updated':
    case 'conversation.item.created':
    case 'input_audio_buffer.speech_started':
    case 'input_audio_buffer.speech_stopped':
    case 'input_audio_buffer.committed':
    case 'input_audio_buffer.cleared':
    case 'response.created':
    case 'response.output_audio.done':
    case 'response.done':
    case 'response.cancelled':
      return { type } as ProviderEvent;
    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = (raw as { transcript?: unknown }).transcript;
      return { type, transcript: typeof transcript === 'string' ? transcript : undefined };
    }
    case 'conversation.item.input_audio_transcription.failed': {
      const error = (raw as { error?: { code?: string; message?: string } }).error;
      return { type, error };
    }
    case 'response.output_audio.delta': {
      const delta = (raw as { delta?: unknown }).delta;
      return { type, delta: typeof delta === 'string' ? delta : undefined };
    }
    case 'response.text.delta': {
      const delta = (raw as { delta?: unknown }).delta;
      return { type, delta: typeof delta === 'string' ? delta : undefined };
    }
    case 'response.text.done': {
      const text = (raw as { text?: unknown }).text;
      return { type, text: typeof text === 'string' ? text : undefined };
    }
    case 'error':
      return { type, code: (raw as { code?: unknown }).code as string | undefined, message: (raw as { message?: unknown }).message as string | undefined };
    default:
      return null;
  }
}

/**
 * The real provider: a WebSocket to the OpenAI Realtime API, authenticated with
 * the server-side key. The key is resolved lazily inside connect(), so the
 * module (and the server) can boot with no credential and report it cleanly.
 */
export class OpenAiRealtimeProvider implements RealtimeProvider {
  readonly name = 'openai-realtime';
  private ws: WebSocket | null = null;
  private listener: ((event: ProviderEvent) => void) | null = null;

  constructor(private readonly cfg: DirectorConfig) {}

  onEvent(listener: (event: ProviderEvent) => void): void {
    this.listener = listener;
  }

  async connect(): Promise<void> {
    const settings = buildRealtimeProviderSettings(this.cfg);
    const url = `${settings.wsUrl}?model=${encodeURIComponent(settings.model)}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'OpenAI-Beta': OPENAI_BETA_HEADER,
      },
    });
    this.ws = ws;

    ws.addEventListener('message', (e) => {
      const text = typeof e.data === 'string' ? e.data : String(e.data);
      try {
        const parsed = parseProviderEvent(JSON.parse(text) as unknown);
        if (parsed) this.listener?.(parsed);
      } catch {
        // A malformed provider frame is ignored; the relay stays up for the next one.
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(
          new ProviderError(
            'provider_connect_failed',
            `The OpenAI Realtime WebSocket (${url}) could not be opened. Check VOICE_DIRECTOR_BASE_URL and the credential.`,
          ),
        );
      };
      const onClose = (e: Event & { code?: number }): void => {
        cleanup();
        if (e.code === 1006) {
          reject(
            new ProviderError(
              'provider_connect_failed',
              `The OpenAI Realtime WebSocket closed before it opened (HTTP handshake failed; check the API key and model "${settings.model}").`,
            ),
          );
        }
      };
      const cleanup = (): void => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });
  }

  send(event: ProviderClientEvent): Promise<void> | void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ProviderError('provider_not_open', 'The Realtime provider socket is not open.');
    }
    this.ws.send(JSON.stringify(event));
  }

  close(code = 1000, reason = 'relay closed'): void {
    this.ws?.close(code, reason);
    this.ws = null;
  }
}

/**
 * Builds the real provider. Never constructs the test fake; missing credentials
 * surface lazily through connect() rather than at build time.
 */
export function createRealtimeProvider(cfg: DirectorConfig): RealtimeProvider {
  return new OpenAiRealtimeProvider(cfg);
}