// Deepgram Agent relay: the parallel server-side implementation of the same
// gateway contract as RealtimeRelay (relay.ts). It is byte-for-byte the same
// on the LOCAL edge — shared/realtime.ts, runbook-only-confirms, transcript/
// error/closed frames — and different only on the provider edge, where it
// speaks the Deepgram Agent protocol instead of the OpenAI Realtime protocol.
//
// Determinism and authority are intentionally identical to the OpenAI relay:
// - The runbook is seeded server-side on `start` and transitions only on an
//   explicit client `confirm` (advanceScrew). The Deepgram agent may phrase
//   guidance (assistant `ConversationText`), never a physical advancement.
// - `AgentAudioDone` finalizes a turn (paired user/assistant transcript +
//   runbook `previous` entry), mirroring the OpenAI relay's `response.done`.
// - The Deepgram `Settings` carries the same runbook-derived prompt that the
//   OpenAI session.update carries (buildRealtimeInstructions), so both
//   providers coach identically.
import { advanceScrew, type CoachPhase, type ScrewPosition } from '@skillio/voice-coach';
import { feedbackSeed, RUNBOOK_VERSION, type RunbookState } from '../../../shared/scene';
import { REALTIME_ERROR_CODES, REALTIME_PROTOCOL_VERSION, type RealtimeClientMessage, type RealtimeServerMessage } from '../../../shared/realtime';
import { MissingCredentialError, ProviderError, type DirectorConfig } from '../../config';
import { buildRealtimeInstructions, seedRunbook } from '../relay';
import { buildDeepgramSettings, createDeepgramProvider, type DeepgramProvider } from './provider';
import type { DeepgramClientCommand, DeepgramModelSpec, DeepgramServerEvent } from './types';

export interface DeepgramRelayConfig extends DeepgramModelSpec {
  /**
   * Server-owned values that must never appear in a local frame (e.g. the
   * DEEPGRAM_API_KEY). Error messages are redacted against these before emission.
   */
  secrets?: readonly string[];
}

export interface DeepgramRelayDeps {
  provider: DeepgramProvider;
  config: DeepgramRelayConfig;
}

export class DeepgramRelay {
  private runbook: RunbookState | null = null;
  private pendingDirection = '';
  private lastUserTranscript = '';
  private started = false;
  private ended = false;
  private listeners = new Set<(message: RealtimeServerMessage) => void>();
  /** Settled when the Agent confirms our `Settings` (handshake gate for `ready`). */
  private appliedWaiter: { resolve: () => void; reject: (err: unknown) => void } | null = null;

  constructor(private readonly deps: DeepgramRelayDeps) {
    deps.provider.onEvent((event) => {
      this.feedProviderEvent(event);
    });
  }

  /** Subscribe to local frames produced by the relay (ready/transcript/error/...). */
  onLocal(listener: (message: RealtimeServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The current server-authoritative runbook, or null before `start`. */
  get snapshot(): RunbookState | null {
    return this.runbook;
  }

  /**
   * Handshake: connect (resolves on `Welcome`) -> send `Settings` -> wait for
   * `SettingsApplied`, then emit `ready`. On credential/connect/handshake
   * failure emits `error` + `closed` instead of throwing.
   */
  async start(opts: { job: string; positions?: ScrewPosition[] }): Promise<void> {
    if (this.started || this.runbook) {
      this.emit({ type: 'error', code: 'session_already_started', message: 'This relay session has already been started.' });
      return;
    }
    this.runbook = seedRunbook(opts.job, opts.positions ?? []);
    this.started = true;

    try {
      await this.deps.provider.connect();
      this.sendJson(buildDeepgramSettings(this.deps.config, buildRealtimeInstructions(this.runbook)));
      await this.waitForApplied();
    } catch (err) {
      const error = this.toRelayError(err);
      this.emit(error);
      this.emit({ type: 'closed', reason: 'provider_connect_failed' });
      return;
    }

    this.emit({
      type: 'ready',
      protocol: REALTIME_PROTOCOL_VERSION,
      model: this.deps.config.listenModel,
      voice: this.deps.config.speakModel,
      runbook: this.runbook,
    });
  }

  /**
   * Decode one local client message, mirroring RealtimeRelay's surface.
   * `audio_input` PCM frames are forwarded as raw bytes (linear16 24 kHz);
   * `interrupt` sends Deepgram `ForceEndTurn` (valid with the v2 flux listen
   * config) and discards any pending guidance, exactly like the OpenAI path.
   */
  async handleClientMessage(msg: RealtimeClientMessage): Promise<void> {
    switch (msg.type) {
      case 'start':
        await this.start(msg);
        return;
      case 'audio_input':
        this.requireReady(() => this.sendAudio(Buffer.from(msg.data, 'base64')));
        return;
      case 'interrupt':
        this.pendingDirection = '';
        this.requireReady(() => this.sendJson({ type: 'ForceEndTurn' }));
        return;
      case 'confirm':
        if (this.requireRunbook()) this.confirmStep();
        return;
      case 'runbook_request':
        if (this.requireRunbook()) this.emit({ type: 'runbook', runbook: this.runbook as RunbookState });
        return;
    }
  }

  /**
   * Translate a Deepgram Agent event into local frames (emitted via the sink).
   * `ConversationText` user content -> operator transcript; assistant content ->
   * pending direction; `AudioFrame` -> audio_output; `AgentAudioDone` ->
   * finalized turn (transcript + runbook); `Error` during the handshake rejects
   * the waiter (start's catch emits error+closed), otherwise closes the session.
   */
  feedProviderEvent(ev: DeepgramServerEvent): RealtimeServerMessage[] {
    const out: RealtimeServerMessage[] = [];
    switch (ev.type) {
      case 'ConversationText': {
        const text = ev.content.trim();
        if (!text) break;
        if (ev.role === 'user') {
          this.lastUserTranscript = text;
          out.push(this.transcriptEvent({ youSaid: text }));
        } else {
          this.pendingDirection = text;
        }
        break;
      }
      case 'AudioFrame': {
        if (ev.data.byteLength > 0) out.push({ type: 'audio_output', data: Buffer.from(ev.data).toString('base64') });
        break;
      }
      case 'AgentAudioDone': {
        const direction = this.pendingDirection.trim();
        this.pendingDirection = '';
        const runbook = this.runbook;
        if (!direction || !runbook) break;
        const turn = { youSaid: this.lastUserTranscript, direction };
        this.lastUserTranscript = '';
        this.runbook = { ...runbook, previous: [...runbook.previous, turn] };
        out.push(this.transcriptEvent({ youSaid: turn.youSaid, direction }));
        out.push({ type: 'runbook', runbook: this.runbook });
        break;
      }
      case 'Error': {
        const err = new ProviderError(ev.code || 'provider_error', ev.description || 'Deepgram Agent reported an error.');
        if (this.appliedWaiter) {
          // Handshake failure: start()'s catch emits error + closed once.
          this.rejectApplied(err);
          break;
        }
        out.push(this.toRelayError(err));
        out.push({ type: 'closed', reason: 'provider_error' });
        break;
      }
      case 'SettingsApplied':
        this.resolveApplied();
        break;
      case 'UserStartedSpeaking':
        // Server-side barge-in: any in-flight partial guidance is discarded so a
        // straggling AgentAudioDone can't finalize a stale direction.
        this.pendingDirection = '';
        break;
      case 'Warning':
      case 'AgentThinking':
      case 'Welcome':
        break;
    }
    for (const message of out) this.emit(message);
    return out;
  }

  /** Operator confirmed the in-progress step: the ONLY runbook advance. */
  private confirmStep(): void {
    const runbook = this.runbook as RunbookState;
    const positions = runbook.spec.positions;
    if (positions.length === 0 || runbook.phase === 'done') {
      // Free coaching or already finished: nothing physical to advance.
      this.emit({ type: 'runbook', runbook });
      return;
    }
    const next = advanceScrew({
      phase: runbook.phase as CoachPhase,
      spec: runbook.spec,
      currentScrew: runbook.currentScrew,
    });
    this.runbook = { ...runbook, phase: next.phase, currentScrew: next.currentScrew };
    this.emit({ type: 'runbook', runbook: this.runbook });
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.deps.provider.close();
  }

  /** Emit a local `error` for a malformed client frame (the socket stays open). */
  reportProtocolError(message: string): void {
    this.emit({ type: 'error', code: REALTIME_ERROR_CODES.BAD_MESSAGE, message });
  }

  private requireRunbook(): boolean {
    if (this.runbook) return true;
    this.emit({
      type: 'error',
      code: REALTIME_ERROR_CODES.SESSION_NOT_STARTED,
      message: 'No runbook session. Send { type: "start", job } first.',
    });
    return false;
  }

  private requireReady(build: () => void): void {
    if (this.runbook && this.started && !this.ended) {
      build();
      return;
    }
    this.requireRunbook();
  }

  private sendJson(command: DeepgramClientCommand): void {
    try {
      this.deps.provider.sendJson(command);
    } catch (err) {
      if (this.appliedWaiter) {
        this.rejectApplied(err);
        return;
      }
      this.emit(this.toRelayError(err));
      this.emit({ type: 'closed', reason: 'provider_send_failed' });
    }
  }

  private sendAudio(data: Uint8Array): void {
    try {
      this.deps.provider.sendAudio(data);
    } catch (err) {
      this.emit(this.toRelayError(err));
      this.emit({ type: 'closed', reason: 'provider_send_failed' });
    }
  }

  private waitForApplied(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.appliedWaiter = { resolve, reject };
    });
  }

  private resolveApplied(): void {
    if (this.appliedWaiter) {
      const resolve = this.appliedWaiter.resolve;
      this.appliedWaiter = null;
      resolve();
    }
  }

  private rejectApplied(err: unknown): void {
    if (this.appliedWaiter) {
      const reject = this.appliedWaiter.reject;
      this.appliedWaiter = null;
      reject(err);
    }
  }

  private transcriptEvent(p: { youSaid?: string; direction?: string }): RealtimeServerMessage {
    const runbook = this.runbook as RunbookState;
    const positions = runbook.spec.positions;
    const step = positions.length ? runbook.currentScrew + 1 : 0;
    const targetId = step > 0 ? positions[step - 1]?.id : undefined;
    const message: RealtimeServerMessage = { type: 'transcript', step, ...(targetId ? { targetId } : {}) };
    if (p.youSaid) message.youSaid = p.youSaid;
    if (p.direction) {
      message.direction = p.direction;
      message.feedbackSeed = feedbackSeed(runbook.spec.job, step, p.direction);
    }
    return message;
  }

  private toRelayError(err: unknown): RealtimeServerMessage {
    let code: string = REALTIME_ERROR_CODES.PROVIDER_CONNECT_FAILED;
    let message = err instanceof Error ? err.message : String(err);
    if (err instanceof MissingCredentialError) {
      code = REALTIME_ERROR_CODES.MISSING_CREDENTIAL;
    } else if (err instanceof ProviderError) {
      code = err.code;
    }
    for (const secret of this.deps.config.secrets ?? []) {
      if (secret && message.includes(secret)) message = message.split(secret).join('[redacted]');
    }
    return { type: 'error', code, message };
  }

  private emit(message: RealtimeServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}

/** Build the deps the same way ws-server builds the OpenAI ones. */
export function buildDeepgramRelayDeps(cfg: DirectorConfig, provider?: DeepgramProvider): DeepgramRelayDeps {
  const config: DeepgramRelayConfig = {
    listenModel: cfg.deepgram.listenModel,
    speakModel: cfg.deepgram.speakModel,
    llmProvider: cfg.deepgram.llmProvider,
    llmModel: cfg.deepgram.llmModel,
    secrets: cfg.deepgram.apiKey ? [cfg.deepgram.apiKey] : [],
  };
  return { provider: provider ?? createDeepgramProvider(cfg), config };
}

/** Builds the configured (or injected) Deepgram relay. */
export function createDeepgramRelay(cfg: DirectorConfig, provider?: DeepgramProvider): DeepgramRelay {
  return new DeepgramRelay(buildDeepgramRelayDeps(cfg, provider));
}