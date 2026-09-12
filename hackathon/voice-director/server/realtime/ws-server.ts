// WebSocket gateway for the realtime relay: accepts browser connections on
// `/ws/realtime`, decodes the narrow local protocol frames, and drives one
// RealtimeRelay per connection. The relay owns the runbook and the provider;
// this layer only moves bytes between the socket and the relay.
//
// Provider credentials never touch this layer: the relay's provider resolves
// the OPENAI_API_KEY inside its own connect(), and the local protocol has no
// field for a credential. A missing key surfaces as a local `error`
// (missing_provider_credential) + `closed` and a 1013 close, never as an
// invented key.
import { type Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { RealtimeClientMessage, RealtimeServerMessage } from '../../shared/realtime';
import type { DirectorConfig } from '../config';
import { createRealtimeProvider, type RealtimeProvider } from './provider';
import { RealtimeRelay, type RealtimeRelayConfig, type RealtimeRelayDeps } from './relay';
import { createDeepgramRelay } from './deepgram/relay';
import type { DeepgramProvider } from './deepgram/provider';

export const REALTIME_WS_PATH = '/ws/realtime';

/** Close codes the gateway uses on the local socket (RFC 6455 close-code space). */
export const RELAY_CLOSE = {
  /** Session/provider failure surfaced as a local `closed` frame. */
  SERVICE_UNAVAILABLE: 1013,
  /** Client sent a frame that is not a valid local protocol message. */
  BAD_MESSAGE: 1008,
} as const;

/**
 * The relay surface both providers expose. The gateway never touches the
 * provider or credential — it moves bytes between the socket and whichever
 * relay (OpenAI or Deepgram) the config selects.
 */
export interface RealtimeRelayLike {
  onLocal(listener: (message: RealtimeServerMessage) => void): () => void;
  handleClientMessage(message: RealtimeClientMessage): Promise<void>;
  close(): void;
  reportProtocolError(message: string): void;
}

export function buildRelayDeps(cfg: DirectorConfig, provider?: RealtimeProvider): RealtimeRelayDeps {
  const config: RealtimeRelayConfig = {
    model: cfg.realtime.model,
    voice: cfg.realtime.voice,
    transcriptionEnabled: cfg.realtime.transcription,
    transcriptionModel: cfg.realtime.transcriptionModel ?? undefined,
    secrets: cfg.apiKey ? [cfg.apiKey] : [],
  };
  return { provider: provider ?? createRealtimeProvider(cfg), config };
}

/**
 * Select the relay implementation from config. Default (`openai`) preserves the
 * existing OpenAI-realtime behavior byte-for-byte; `deepgram` uses the parallel
 * server-side Deepgram Agent provider. `provider` is the same injection seam
 * tests use for either provider.
 */
export function createGatewayRelay(cfg: DirectorConfig, provider?: RealtimeProvider | DeepgramProvider): RealtimeRelayLike {
  if (cfg.realtime.provider === 'deepgram') {
    return createDeepgramRelay(cfg, provider as DeepgramProvider | undefined);
  }
  return new RealtimeRelay(buildRelayDeps(cfg, provider as RealtimeProvider | undefined));
}

/**
 * Attach the realtime relay gateway to an existing HTTP server. Additive to the
 * one-shot HTTP routes: existing routes keep their exact behavior; this only
 * claims the `/ws/realtime` upgrade path.
 *
 * `provider` is an injection seam for tests; production callers omit it and the
 * configured real provider (OpenAI or Deepgram, per cfg.realtime.provider) is used.
 */
export function attachRealtimeRelayServer(
  httpServer: Server,
  cfg: DirectorConfig,
  provider?: RealtimeProvider | DeepgramProvider,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: REALTIME_WS_PATH });

  wss.on('connection', (socket: WebSocket) => {
    const relay = createGatewayRelay(cfg, provider);

    relay.onLocal((message: RealtimeServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      if (message.type === 'closed') {
        socket.close(RELAY_CLOSE.SERVICE_UNAVAILABLE, message.reason);
        relay.close();
      }
    });

    socket.on('message', (raw: WebSocket.RawData) => {
      void handleRawMessage(raw, relay);
    });

    socket.on('close', () => relay.close());
    socket.on('error', () => relay.close());
  });

  return wss;
}

async function handleRawMessage(raw: WebSocket.RawData, relay: RealtimeRelayLike): Promise<void> {
  const text = raw.toString();
  let message: RealtimeClientMessage;
  try {
    message = JSON.parse(text) as RealtimeClientMessage;
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new Error('missing type');
  } catch {
    relay.reportProtocolError('Local protocol frames must be JSON with a string "type".');
    return;
  }

  try {
    await relay.handleClientMessage(message);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    relay.reportProtocolError(detail);
  }
}