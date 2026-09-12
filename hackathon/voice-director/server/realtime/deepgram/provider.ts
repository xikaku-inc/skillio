// Provider boundary for the Deepgram Agent realtime relay.
//
// The Deepgram provider is the parallel server-side option behind the same
// local protocol (shared/realtime.ts) and the same runbook authority. It opens
// a WebSocket to the documented Deepgram Agent surface
// (wss://agent.deepgram.com/v1/agent/converse) using the **server-side**
// DEEPGRAM_API_KEY in the upgrade `Authorization` header — the credential is
// resolved lazily inside connect(), never appears in a local relay frame, and
// the browser protocol has no field for it.
//
// Protocol: open -> server sends `Welcome` -> client sends `Settings` ->
// server sends `SettingsApplied` -> binary PCM frames flow both ways. Audio is
// linear16 24 kHz mono in/out, which matches the local protocol's base64
// PCM16 24 kHz frames without resampling.
import WebSocket from 'ws';
import { ProviderError, requireDeepgramApiKey, type DirectorConfig } from '../../config';
import {
  DEEPGRAM_ENDPOINT,
  type DeepgramClientCommand,
  type DeepgramModelSpec,
  type DeepgramServerEvent,
  type DeepgramSettingsMessage,
} from './types';

/** Credential-carrying settings, created ONLY inside the server boundary. */
export interface DeepgramProviderSettings {
  apiKey: string;
  wsUrl: string;
  listenModel: string;
  speakModel: string;
  llmProvider: string;
  llmModel: string;
}

/** The provider surface the Deepgram relay drives. Tests implement this with a fake. */
export interface DeepgramProvider {
  readonly name: string;
  connect(): Promise<void>;
  sendJson(command: DeepgramClientCommand): Promise<void> | void;
  sendAudio(data: Uint8Array): Promise<void> | void;
  close(): void;
  onEvent(listener: (event: DeepgramServerEvent) => void): void;
}

/** Agent WebSocket endpoint. `VOICE_DIRECTOR_DEEPGRAM_WS_URL` wins when set. */
export function deepgramEndpoint(cfg: DirectorConfig): string {
  return cfg.deepgram.wsUrl || DEEPGRAM_ENDPOINT;
}

/** Resolve the server-side credential into settings, or throw MissingCredentialError. */
export function buildDeepgramProviderSettings(cfg: DirectorConfig): DeepgramProviderSettings {
  return {
    apiKey: requireDeepgramApiKey(cfg),
    wsUrl: deepgramEndpoint(cfg),
    listenModel: cfg.deepgram.listenModel,
    speakModel: cfg.deepgram.speakModel,
    llmProvider: cfg.deepgram.llmProvider,
    llmModel: cfg.deepgram.llmModel,
  };
}

/**
 * Build the `Settings` message sent after `Welcome`. Pure and credential-free:
 * the runbook instruction prompt is injected by the relay, and the model knobs
 * come from the resolved spec. `linear16` 24 kHz matches the local protocol's
 * PCM16 24 kHz frames exactly (no resampling).
 */
export function buildDeepgramSettings(spec: DeepgramModelSpec, prompt: string): DeepgramSettingsMessage {
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'linear16', sample_rate: 24000 },
      output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
    },
    agent: {
      language: 'en',
      // version v2 is required for the flux-* listen family (ForceEndTurn, etc.).
      listen: { provider: { type: 'deepgram', version: 'v2', model: spec.listenModel } },
      think: { provider: { type: spec.llmProvider, model: spec.llmModel }, prompt },
      speak: { provider: { type: 'deepgram', version: 'v2', model: spec.speakModel } },
    },
  };
}

/**
 * Whitelist a raw Deepgram JSON frame into a typed DeepgramServerEvent.
 * Unknown/unsupported event types return null and are ignored by the relay;
 * `Error`/`Warning` fall back to `message` when `description` is absent.
 */
export function parseDeepgramEvent(raw: unknown): DeepgramServerEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (typeof type !== 'string') return null;
  switch (type) {
    case 'Welcome':
      return { type, requestId: typeof r.request_id === 'string' ? r.request_id : undefined };
    case 'SettingsApplied':
    case 'UserStartedSpeaking':
    case 'AgentThinking':
    case 'AgentAudioDone':
      return { type } as DeepgramServerEvent;
    case 'ConversationText': {
      if (r.role !== 'user' && r.role !== 'assistant') return null;
      return {
        type,
        role: r.role,
        content: typeof r.content === 'string' ? r.content : '',
      };
    }
    case 'Error':
      return {
        type,
        code: typeof r.code === 'string' ? r.code : 'provider_error',
        description:
          typeof r.description === 'string'
            ? r.description
            : typeof r.message === 'string'
              ? r.message
              : 'Deepgram Agent reported an error.',
      };
    case 'Warning':
      return {
        type,
        code: typeof r.code === 'string' ? r.code : 'provider_warning',
        description: typeof r.description === 'string' ? r.description : '',
      };
    default:
      return null;
  }
}

/**
 * The real provider: a WebSocket to the Deepgram Agent API. The key is resolved
 * lazily inside connect(), so the module (and the server) can boot with no
 * credential and report it cleanly. Binary frames from the Agent (output audio)
 * are surfaced as `AudioFrame` events; text frames go through parseDeepgramEvent.
 */
export class DeepgramAgentProvider implements DeepgramProvider {
  readonly name = 'deepgram-agent';
  private ws: WebSocket | null = null;
  private listener: ((event: DeepgramServerEvent) => void) | null = null;

  constructor(private readonly cfg: DirectorConfig) {}

  onEvent(listener: (event: DeepgramServerEvent) => void): void {
    this.listener = listener;
  }

  async connect(): Promise<void> {
    const settings = buildDeepgramProviderSettings(this.cfg);
    const ws = new WebSocket(settings.wsUrl, {
      headers: { Authorization: `Token ${settings.apiKey}` },
    });
    this.ws = ws;

    ws.addEventListener('message', (e) => {
      const data = e.data as unknown;
      if (typeof data === 'string') {
        try {
          const parsed = parseDeepgramEvent(JSON.parse(data) as unknown);
          if (parsed) this.listener?.(parsed);
        } catch {
          // A malformed text frame is ignored; the socket stays up for the next one.
        }
        return;
      }
      const frame = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
      this.listener?.({ type: 'AudioFrame', data: new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength) });
    });

    await new Promise<void>((resolve, reject) => {
      const onMessage = (e: WebSocket.MessageEvent): void => {
        const data = e.data as unknown;
        if (typeof data !== 'string') return;
        try {
          if (parseDeepgramEvent(JSON.parse(data) as unknown)?.type === 'Welcome') {
            cleanup();
            resolve();
          }
        } catch {
          // Not the Welcome frame yet; keep waiting.
        }
      };
      const onError = (): void => {
        cleanup();
        reject(
          new ProviderError(
            'provider_connect_failed',
            `The Deepgram Agent WebSocket (${settings.wsUrl}) could not be opened. Check DEEPGRAM_API_KEY and VOICE_DIRECTOR_DEEPGRAM_WS_URL.`,
          ),
        );
      };
      const onClose = (e: WebSocket.CloseEvent): void => {
        cleanup();
        if (e.code === 1006) {
          reject(
            new ProviderError(
              'provider_connect_failed',
              'The Deepgram Agent WebSocket closed before the Welcome frame (HTTP handshake failed; check DEEPGRAM_API_KEY).',
            ),
          );
        }
      };
      const cleanup = (): void => {
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });
  }

  sendJson(command: DeepgramClientCommand): Promise<void> | void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ProviderError('provider_not_open', 'The Deepgram Agent socket is not open.');
    }
    this.ws.send(JSON.stringify(command));
  }

  sendAudio(data: Uint8Array): Promise<void> | void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ProviderError('provider_not_open', 'The Deepgram Agent socket is not open.');
    }
    this.ws.send(data);
  }

  close(code = 1000, reason = 'relay closed'): void {
    this.ws?.close(code, reason);
    this.ws = null;
  }
}

/** Builds the real Deepgram provider. Tests never construct this. */
export function createDeepgramProvider(cfg: DirectorConfig): DeepgramProvider {
  return new DeepgramAgentProvider(cfg);
}