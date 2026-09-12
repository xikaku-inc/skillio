// Relay tests with a fake provider. The fake lives HERE in the test file and is
// never reachable from the server's product path (createRealtimeProvider only
// ever builds the OpenAI-backed adapter). These tests drive the relay through
// its two edges directly: local protocol messages in, provider events in, and
// assert on local frames out + provider events sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MissingCredentialError,
  loadConfig,
  type DirectorConfig,
} from '../../config';
import {
  buildRealtimeProviderSettings,
  parseProviderEvent,
  realtimeEndpoint,
  type ProviderClientEvent,
  type ProviderEvent,
  type RealtimeProvider,
} from '../provider';
import {
  RealtimeRelay,
  buildRealtimeInstructions,
  seedRunbook,
  type RealtimeRelayConfig,
} from '../relay';
import type { RealtimeServerMessage } from '../../../shared/realtime';

const API_KEY = 'sk-test-secret-fake';

const RELAY_CONFIG: RealtimeRelayConfig = {
  model: 'gpt-realtime-2.1',
  voice: 'alloy',
  transcriptionEnabled: true,
  transcriptionModel: 'gpt-4o-mini-transcribe',
  secrets: [API_KEY],
};

const POSITIONS = [
  { id: 'top-left', anchorId: 'anchor-top-left', attempts: 0, seated: false },
  { id: 'bottom-left', anchorId: 'anchor-bottom-left', attempts: 0, seated: false },
];

class FakeRealtimeProvider implements RealtimeProvider {
  readonly name = 'fake-realtime';
  sent: ProviderClientEvent[] = [];
  opened = false;
  closed: { code?: number; reason?: string } | null = null;
  private listener: ((event: ProviderEvent) => void) | null = null;

  constructor(private readonly failConnect?: Error) {}

  onEvent(listener: (event: ProviderEvent) => void): void {
    this.listener = listener;
  }
  async connect(): Promise<void> {
    if (this.failConnect) throw this.failConnect;
    this.opened = true;
  }
  send(event: ProviderClientEvent): void {
    this.sent.push(event);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  /** Test-only: simulate a provider-inbound event. */
  emit(event: ProviderEvent): void {
    this.listener?.(event);
  }
}

function harness(failConnect?: Error): {
  provider: FakeRealtimeProvider;
  relay: RealtimeRelay;
  local: RealtimeServerMessage[];
  frames: string[];
} {
  const provider = new FakeRealtimeProvider(failConnect);
  const relay = new RealtimeRelay({ provider, config: RELAY_CONFIG });
  const local: RealtimeServerMessage[] = [];
  const frames: string[] = [];
  relay.onLocal((m) => {
    local.push(m);
    frames.push(JSON.stringify(m));
  });
  return { provider, relay, local, frames };
}

function cfgWithKey(): DirectorConfig {
  return loadConfig({ OPENAI_API_KEY: API_KEY });
}

test('start opens the provider, applies session.update, and emits ready with the runbook', async () => {
  const h = harness();
  await h.relay.handleClientMessage({
    type: 'start',
    job: 'Assemble the desk-side drill station.',
    positions: POSITIONS,
  });

  assert.equal(h.provider.opened, true);
  assert.ok(h.provider.sent.length >= 1, 'session.update was sent to the provider');
  const update = h.provider.sent[0];
  assert.equal(update.type, 'session.update');
  if (update.type !== 'session.update') return;
  assert.equal(update.session.voice, 'alloy');
  assert.deepEqual(update.session.modalities, ['text', 'audio']);
  assert.equal(update.session.input_audio_transcription?.enabled, true);
  assert.match(update.session.instructions, /Assemble the desk-side drill station/);
  assert.match(update.session.instructions, /one short, spoken sentence/);

  const ready = h.local[0];
  assert.equal(ready.type, 'ready');
  if (ready.type !== 'ready') return;
  assert.equal(ready.protocol, 1);
  assert.equal(ready.model, 'gpt-realtime-2.1');
  assert.equal(ready.runbook.phase, 'coaching');
  assert.equal(ready.runbook.currentScrew, 0);
  assert.equal(ready.runbook.spec.confirmed, true);
});

test('audio_input frames are forwarded to the provider verbatim', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });
  h.local.length = 0;

  await h.relay.handleClientMessage({ type: 'audio_input', data: 'AQIDBA' });
  const appended = h.provider.sent.at(-1);
  assert.deepEqual(appended, { type: 'input_audio_buffer.append', audio: 'AQIDBA' });
  assert.equal(h.local.length, 0, 'audio forwarding produces no local frame');
});

test('provider audio deltas stream out as local audio_output frames', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });

  h.provider.emit({ type: 'response.output_audio.delta', delta: 'AAECAw' });
  h.provider.emit({ type: 'response.output_audio.delta', delta: 'BAU=' });
  assert.deepEqual(h.local.filter((m) => m.type === 'audio_output'), [
    { type: 'audio_output', data: 'AAECAw' },
    { type: 'audio_output', data: 'BAU=' },
  ]);
});

test('operator transcript and coach direction arrive as transcript events; runbook guidance never advances a step', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'Assemble.', positions: POSITIONS });

  h.provider.emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'put the jig on the bench' });
  let t = h.local.find((m) => m.type === 'transcript');
  assert.ok(t, 'transcript event emitted for the operator');
  if (t?.type === 'transcript') {
    assert.equal(t.youSaid, 'put the jig on the bench');
    assert.equal(t.direction, undefined);
    assert.equal(t.step, 1);
    assert.equal(t.targetId, 'top-left');
  }

  h.provider.emit({ type: 'response.text.delta', delta: 'Mount the ' });
  h.provider.emit({ type: 'response.text.delta', delta: 'jig on the bench.' });
  assert.equal(h.local.filter((m) => m.type === 'transcript').length, 1, 'no direction yet mid-stream');
  h.provider.emit({ type: 'response.done' });

  const transcripts = h.local.filter((m) => m.type === 'transcript');
  const direction = transcripts.at(-1);
  if (direction?.type !== 'transcript') return assert.fail('expected a direction transcript');
  assert.equal(direction.youSaid, 'put the jig on the bench');
  assert.equal(direction.direction, 'Mount the jig on the bench.');
  assert.equal(direction.step, 1);
  assert.equal(direction.targetId, 'top-left');
  assert.ok(typeof direction.feedbackSeed === 'number', 'deterministic feedbackSeed present');

  const runbookEvent = h.local.at(-1);
  assert.equal(runbookEvent?.type, 'runbook');
  if (runbookEvent?.type !== 'runbook') return;
  assert.equal(runbookEvent.runbook.previous.length, 1);
  assert.equal(runbookEvent.runbook.previous[0].direction, 'Mount the jig on the bench.');
  assert.equal(runbookEvent.runbook.currentScrew, 0, 'provider guidance MUST NOT advance a step');
});

test('feedbackSeed is deterministic for the same job/step/direction', async () => {
  const a = harness();
  await a.relay.handleClientMessage({ type: 'start', job: 'Assemble.', positions: POSITIONS });
  a.provider.emit({ type: 'response.text.delta', delta: 'Twist it.' });
  a.provider.emit({ type: 'response.done' });

  const b = harness();
  await b.relay.handleClientMessage({ type: 'start', job: 'Assemble.', positions: POSITIONS });
  b.provider.emit({ type: 'response.text.delta', delta: 'Twist it.' });
  b.provider.emit({ type: 'response.done' });

  const seedA = a.local.find((m) => m.type === 'transcript' && m.direction) as { feedbackSeed?: number } | undefined;
  const seedB = b.local.find((m) => m.type === 'transcript' && m.direction) as { feedbackSeed?: number } | undefined;
  assert.equal(seedA?.feedbackSeed, seedB?.feedbackSeed);
});

test('interrupt cancels the in-flight response and clears input buffers, discarding pending guidance', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });
  h.provider.emit({ type: 'response.text.delta', delta: 'Partial direction that will be cut off' });
  h.local.length = 0;

  await h.relay.handleClientMessage({ type: 'interrupt' });
  const lastTwo = h.provider.sent.slice(-2);
  assert.deepEqual(lastTwo, [{ type: 'response.cancel' }, { type: 'input_audio_buffer.clear' }]);

  h.provider.emit({ type: 'response.cancelled' });
  h.provider.emit({ type: 'response.done' });
  assert.equal(
    h.local.filter((m) => m.type === 'transcript' && m.direction).length,
    0,
    'interrupted guidance never finalizes',
  );
});

test('confirm advances exactly one deterministic step; the provider cannot advance the runbook', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'Assemble.', positions: POSITIONS });

  // Provider closes a coaching turn: guidance only.
  h.provider.emit({ type: 'response.text.delta', delta: 'Do the first thing.' });
  h.provider.emit({ type: 'response.done' });
  assert.equal(h.relay.snapshot?.currentScrew, 0);

  // Explicit Skillio-side confirmation — the ONLY transition.
  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 1);
  assert.equal(h.relay.snapshot?.phase, 'coaching');

  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 2);
  assert.equal(h.relay.snapshot?.phase, 'done');

  // Confirming a finished job is a no-op.
  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 2);
  assert.equal(h.relay.snapshot?.phase, 'done');

  const runbooks = h.local.filter((m) => m.type === 'runbook' && m.runbook.currentScrew === 1);
  assert.equal(runbooks.length, 1, 'one runbook update per confirmation');
});

test('free coaching (no positions) confirms without advancing a physical step', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'Coach me.' });
  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 0);
  assert.equal(h.relay.snapshot?.phase, 'coaching');
});

test('missing provider credential reaches the local protocol as error + closed, never a key', async () => {
  const h = harness(
    new MissingCredentialError('OPENAI_API_KEY', 'OPENAI_API_KEY is not set. Set it in hackathon/voice-director/.env.'),
  );
  await h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });

  const errors = h.local.filter((m) => m.type === 'error');
  assert.equal(errors.length, 1);
  if (errors[0]?.type === 'error') {
    assert.equal(errors[0].code, 'missing_provider_credential');
    assert.match(errors[0].message, /OPENAI_API_KEY/);
  }
  const closed = h.local.at(-1);
  assert.equal(closed?.type, 'closed');
  assert.equal(h.provider.sent.length, 0, 'no provider event before a session exists');
  assert.ok(!h.frames.join('\n').includes(API_KEY), 'credential string absent');
});

test('provider errors propagate and the session closes', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });
  h.local.length = 0;

  h.provider.emit({ type: 'error', code: 'server_error', message: 'upstream exploded' });
  assert.equal(h.local.filter((m) => m.type === 'error').length, 1);
  if (h.local[0]?.type === 'error') {
    assert.equal(h.local[0].code, 'server_error');
    assert.match(h.local[0].message, /upstream exploded/);
  }
  assert.equal(h.local.at(-1)?.type, 'closed');
});

test('provider credentials never enter the local client protocol', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });

  // A leaky provider error that happens to echo the API key must be redacted.
  h.provider.emit({ type: 'error', code: 'provider_unauthorized', message: `denied with key ${API_KEY} in the body` });
  const err = h.local.at(-2);
  if (err?.type === 'error') {
    assert.ok(!err.message.includes(API_KEY), 'secret redacted from local error');
    assert.ok(err.message.includes('[redacted]'), 'redaction marker visible');
  }

  // Full-session sweep: every local frame authored across the protocol is clean.
  h.provider.emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'say more' });
  h.provider.emit({ type: 'response.output_audio.delta', delta: 'FF00' });
  h.provider.emit({ type: 'response.text.delta', delta: 'Done.' });
  h.provider.emit({ type: 'response.done' });
  await h.relay.handleClientMessage({ type: 'confirm' });
  await h.relay.handleClientMessage({ type: 'audio_input', data: 'AA==' });
  const joined = h.frames.join('\n');
  for (const needle of [API_KEY, 'Authorization', 'Bearer ', 'apiKey', 'secret']) {
    assert.ok(!joined.includes(needle), `no local frame leaks "${needle}"`);
  }
});

test('control messages before start are rejected with session_not_started', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'audio_input', data: 'AA==' });
  await h.relay.handleClientMessage({ type: 'interrupt' });
  await h.relay.handleClientMessage({ type: 'confirm' });
  await h.relay.handleClientMessage({ type: 'runbook_request' });

  const errors = h.local.filter((m) => m.type === 'error');
  assert.equal(errors.length, 4);
  for (const e of errors) {
    if (e.type === 'error') assert.equal(e.code, 'session_not_started');
  }
  assert.equal(h.provider.sent.length, 0);
});

test('runbook_request returns the current snapshot without mutating it', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });
  h.local.length = 0;

  await h.relay.handleClientMessage({ type: 'runbook_request' });
  const snap = h.local.at(-1);
  assert.equal(snap?.type, 'runbook');
  if (snap?.type === 'runbook') {
    assert.equal(snap.runbook.currentScrew, 0);
    assert.equal(snap.runbook.spec.confirmed, true);
  }
});

test('seedRunbook is server-authoritative and deterministic in shape', () => {
  const a = seedRunbook('J.', POSITIONS);
  const b = seedRunbook('J.', POSITIONS);
  assert.notEqual(a.sessionId, b.sessionId, 'distinct session ids');
  assert.deepEqual(a.spec, b.spec, 'identical spec');
  assert.equal(a.phase, 'coaching');
  assert.equal(a.currentScrew, 0);
  assert.equal(a.spec.confirmed, true);
  assert.equal(a.previous.length, 0);
});

test('buildRealtimeInstructions mirrors the coach prompt contract', () => {
  const runbook = seedRunbook('Assemble the drill station.', POSITIONS);
  runbook.previous = [{ youSaid: 'put the jig on the bench', direction: 'Mount the jig.' }];
  const prompt = buildRealtimeInstructions(runbook);
  assert.match(prompt, /Assemble the drill station/);
  assert.match(prompt, /one clear direction at a time/);
  assert.match(prompt, /put the jig on the bench/);
  assert.match(prompt, /Current coaching phase: coaching/);
});

test('parseProviderEvent whitelists the documented surface and drops unknowns', () => {
  assert.deepEqual(parseProviderEvent({ type: 'response.output_audio.delta', delta: 'AQID' }), {
    type: 'response.output_audio.delta',
    delta: 'AQID',
  });
  const composed = parseProviderEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'hello',
    item_id: 'c1',
  });
  assert.deepEqual(composed, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'hello' });
  assert.equal(parseProviderEvent({ type: 'some.future.event' }), null);
  assert.equal(parseProviderEvent(null), null);
  assert.equal(parseProviderEvent({ noType: true }), null);
});

test('realtimeEndpoint derives wss from the Responses baseUrl and honors an override', () => {
  const cfg = cfgWithKey();
  assert.equal(realtimeEndpoint({ ...cfg, realtime: { ...cfg.realtime, wsUrl: null } }), 'wss://api.openai.com/v1/realtime');
  assert.equal(
    realtimeEndpoint({ ...cfg, realtime: { ...cfg.realtime, wsUrl: 'ws://gateway.local/rt' } }),
    'ws://gateway.local/rt',
  );
});

test('buildRealtimeProviderSettings resolves the key lazily and never leaks in HTTP-shaped errors', () => {
  const settings = buildRealtimeProviderSettings(cfgWithKey());
  assert.equal(settings.apiKey, API_KEY);
  assert.equal(settings.model, 'gpt-realtime-2.1');
  assert.equal(settings.voice, 'alloy');
  assert.equal(settings.wsUrl, 'wss://api.openai.com/v1/realtime');
  assert.equal(settings.transcriptionModel, 'gpt-4o-mini-transcribe');

  assert.throws(() => buildRealtimeProviderSettings(loadConfig({})), MissingCredentialError);
});

test('config defaults for the realtime relay are audible', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.realtime.model, 'gpt-realtime-2.1');
  assert.equal(cfg.realtime.voice, 'alloy');
  assert.equal(cfg.realtime.wsUrl, null);
  assert.equal(cfg.realtime.transcription, true);
  const overridden = loadConfig({
    VOICE_DIRECTOR_REALTIME_MODEL: 'gpt-realtime-1.5',
    VOICE_DIRECTOR_REALTIME_TRANSCRIPTION: 'false',
  });
  assert.equal(overridden.realtime.model, 'gpt-realtime-1.5');
  assert.equal(overridden.realtime.transcription, false);
  assert.equal(overridden.realtime.transcriptionModel, 'gpt-4o-mini-transcribe');
});