// The realtime relay: a server-owned session that bridges one browser
// WebSocket (the narrow local protocol in shared/realtime.ts) and one provider
// Realtime session (RealtimeProvider in provider.ts).
//
// The relay is transport-agnostic and deterministic:
// - Local protocol frames are decoded here; provider-bound events we emit are
//   returned to the caller (the ws-server layer) to forward on the socket.
// - Provider events are translated here into local frames emitted through the
//   onLocal sink.
// - Runbook state is server-authoritative: the provider may phrase guidance,
//   but the ONLY thing that advances a step is an explicit `confirm` from the
//   client, applied through the voice-coach domain helpers (advanceScrew).
import { randomUUID } from 'node:crypto';
import { advanceScrew, confirmSpec, createCoach, type CoachPhase, type ScrewPosition } from '@skillio/voice-coach';
import { feedbackSeed, RUNBOOK_VERSION, type RunbookState } from '../../shared/scene';
import { REALTIME_ERROR_CODES, REALTIME_PROTOCOL_VERSION, type RealtimeClientMessage, type RealtimeServerMessage } from '../../shared/realtime';
import { MissingCredentialError, ProviderError } from '../config';
import type { ProviderClientEvent, ProviderEvent, RealtimeProvider, RealtimeSessionConfig } from './provider';

export interface RealtimeRelayConfig {
  model: string;
  voice: string;
  transcriptionEnabled: boolean;
  transcriptionModel?: string;
  /**
   * Server-owned values that must never appear in a local frame (e.g. the API
   * key). Error messages are redacted against these before emission.
   */
  secrets?: readonly string[];
}

export interface RealtimeRelayDeps {
  provider: RealtimeProvider;
  config: RealtimeRelayConfig;
}

/**
 * Deterministic, server-authoritative runbook seed: the spec is confirmed the
 * moment the operator starts a session (matching POST /api/start), and phase
 * starts at 'coaching' so the first provider turn coaches immediately.
 */
export function seedRunbook(job: string, positions: ScrewPosition[]): RunbookState {
  const confirmed = confirmSpec(createCoach(job), positions);
  return {
    version: RUNBOOK_VERSION,
    sessionId: randomUUID(),
    spec: { job, positions, confirmed: true },
    phase: 'coaching',
    currentScrew: 0,
    previous: [],
  };
}

/** Realtime system instructions built from the runbook (mirrors buildCoachPrompt). */
export function buildRealtimeInstructions(runbook: RunbookState): string {
  const history = runbook.previous
    .map((l, i) => `${i + 1}. you: "${l.youSaid}" -> directed: "${l.direction}"`)
    .join('\n');
  return [
    'You are the voice director for a hands-on assembly job:',
    `"${runbook.spec.job}"`,
    '',
    'Coach the operator in one short, spoken sentence per turn — one clear direction at a time.',
    'Be concise: directions only, no filler, no disclaimers, no markdown.',
    `Current coaching phase: ${runbook.phase}.`,
    history ? `So far (most recent last):\n${history}` : 'No turns yet.',
    'Give the next concise direction when the operator speaks.',
  ].join('\n');
}

export class RealtimeRelay {
  private runbook: RunbookState | null = null;
  private pendingDirection = '';
  private lastUserTranscript = '';
  private started = false;
  private ended = false;
  private listeners = new Set<(message: RealtimeServerMessage) => void>();

  constructor(private readonly deps: RealtimeRelayDeps) {
    // Provider inbound events flow into the relay's translation pipeline.
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
   * Open the provider session for a runbook seeded from the operator's job.
   * Resolves once `ready` has been emitted; on credential/connect failure emits
   * `error` + `closed` instead of throwing (the ws layer closes the socket).
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
      this.deps.provider.send({ type: 'session.update', session: this.sessionConfig() });
    } catch (err) {
      const error = this.toRelayError(err);
      this.emit(error);
      this.emit({ type: 'closed', reason: 'provider_connect_failed' });
      return;
    }

    this.emit({
      type: 'ready',
      protocol: REALTIME_PROTOCOL_VERSION,
      model: this.deps.config.model,
      voice: this.deps.config.voice,
      runbook: this.runbook,
    });
  }

  /**
   * Decode one local client message: opens the session on `start`, forwards
   * audio/interrupt frames to the provider, and applies confirm/runbook
   * requests server-side. Any local frames produced (ready, runbook snapshots,
   * errors) are emitted through the sink; provider client events are sent by
   * the relay itself so the ws layer never touches the provider.
   */
  async handleClientMessage(msg: RealtimeClientMessage): Promise<void> {
    switch (msg.type) {
      case 'start':
        await this.start(msg);
        return;
      case 'audio_input':
        this.requireReady(() => this.sendToProvider({ type: 'input_audio_buffer.append', audio: msg.data }));
        return;
      case 'interrupt':
        this.pendingDirection = '';
        this.requireReady(() => {
          this.sendToProvider({ type: 'response.cancel' });
          this.sendToProvider({ type: 'input_audio_buffer.clear' });
        });
        return;
      case 'confirm':
        if (this.requireRunbook()) this.confirmStep();
        return;
      case 'runbook_request':
        if (this.requireRunbook()) this.emit({ type: 'runbook', runbook: this.runbook as RunbookState });
        return;
    }
  }

  private sendToProvider(event: ProviderClientEvent): void {
    try {
      this.deps.provider.send(event);
    } catch (err) {
      this.emit(this.toRelayError(err));
      this.emit({ type: 'closed', reason: 'provider_send_failed' });
    }
  }

  /** Translate a provider event into local frames (emitted via the sink). */
  feedProviderEvent(ev: ProviderEvent): RealtimeServerMessage[] {
    const out: RealtimeServerMessage[] = [];
    switch (ev.type) {
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (ev.transcript ?? '').trim();
        if (text) {
          this.lastUserTranscript = text;
          out.push(this.transcriptEvent({ youSaid: text }));
        }
        break;
      }
      case 'response.text.delta': {
        this.pendingDirection += ev.delta ?? '';
        break;
      }
      case 'response.output_audio.delta': {
        if (ev.delta) out.push({ type: 'audio_output', data: ev.delta });
        break;
      }
      case 'response.done': {
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
      case 'error': {
        const error = this.toRelayError(new ProviderError(ev.code ?? 'provider_error', ev.message ?? 'Provider reported an error.'));
        out.push(error);
        out.push({ type: 'closed', reason: 'provider_error' });
        break;
      }
      case 'response.cancelled':
      case 'session.created':
      case 'session.updated':
      case 'conversation.item.created':
      case 'input_audio_buffer.speech_started':
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
      case 'input_audio_buffer.cleared':
      case 'response.created':
      case 'response.output_audio.done':
      case 'response.text.done':
      case 'conversation.item.input_audio_transcription.failed':
      default:
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

  /** Map the client's first `confirm`/turn post-start safety around snapshots. */
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

  private sessionConfig(): RealtimeSessionConfig {
    const session: RealtimeSessionConfig = {
      instructions: buildRealtimeInstructions(this.runbook as RunbookState),
      voice: this.deps.config.voice,
      modalities: ['text', 'audio'],
    };
    if (this.deps.config.transcriptionEnabled) {
      session.input_audio_transcription = {
        enabled: true,
        model: this.deps.config.transcriptionModel ?? 'gpt-4o-mini-transcribe',
      };
    }
    return session;
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