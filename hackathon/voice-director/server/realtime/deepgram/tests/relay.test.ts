// Deepgram relay tests with a fake provider. The fake lives HERE in the test
// file and is never reachable from the server's product path
// (createDeepgramProvider only builds the Deepgram Agent adapter). These tests
// drive the relay through its two edges directly — local protocol messages in,
// Deepgram Agent events in — and assert on local frames out + provider
// commands/audio sent. No network, no paid Deepgram calls, no real key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MissingCredentialError,
  loadConfig,
  type DirectorConfig,
} from '../../../config';
import { awaitSetImmediate } from './helpers';
import {
  buildDeepgramProviderSettings,
  buildDeepgramSettings,
  createDeepgramProvider,
  deepgramEndpoint,
  parseDeepgramEvent,
  type DeepgramProvider,
} from '../provider';
import {
  DeepgramRelay,
  buildDeepgramRelayDeps,
  type DeepgramRelayConfig,
} from '../relay';
import { DEEPGRAM_ENDPOINT, type DeepgramClientCommand, type DeepgramServerEvent } from '../types';
import type { RealtimeServerMessage } from '../../../../shared/realtime';

const API_KEY = 'dg-test-secret-fake';

const DEEPGRAM_CONFIG: DeepgramRelayConfig = {
  listenModel: 'flux-general-en',
  speakModel: 'flux-kit-en',
  llmProvider: 'google',
  llmModel: 'gemini-3.1-flash-lite',
  secrets: [API_KEY],
};

const POSITIONS = [
  { id: 'top-left', anchorId: 'anchor-top-left', attempts: 0, seated: false },
  { id: 'bottom-left', anchorId: 'anchor-bottom-left', attempts: 0, seated: false },
];

class FakeDeepgramProvider implements DeepgramProvider {
  readonly name = 'fake-deepgram';
  sentJson: DeepgramClientCommand[] = [];
  sentAudio: Uint8Array[] = [];
  opened = false;
  closed = false;
  private listener: ((event: DeepgramServerEvent) => void) | null = null;

  constructor(private readonly failConnect?: Error) {}

  onEvent(listener: (event: DeepgramServerEvent) => void): void {
    this.listener = listener;
  }
  async connect(): Promise<void> {
    if (this.failConnect) throw this.failConnect;
    this.opened = true;
  }
  sendJson(command: DeepgramClientCommand): void {
    this.sentJson.push(command);
  }
  sendAudio(data: Uint8Array): void {
    this.sentAudio.push(data);
  }
  close(): void {
    this.closed = true;
  }
  /** Test-only: simulate a Deepgram Agent JSON event. */
  emitJson(event: DeepgramServerEvent): void {
    this.listener?.(event);
  }
  /** Test-only: simulate a binary output audio frame. */
  emitAudio(data: Uint8Array): void {
    this.listener?.({ type: 'AudioFrame', data });
  }
}

function harness(failConnect?: Error): {
  provider: FakeDeepgramProvider;
  relay: DeepgramRelay;
  local: RealtimeServerMessage[];
  frames: string[];
} {
  const provider = new FakeDeepgramProvider(failConnect);
  const relay = new DeepgramRelay({ provider, config: DEEPGRAM_CONFIG });
  const local: RealtimeServerMessage[] = [];
  const frames: string[] = [];
  relay.onLocal((m) => {
    local.push(m);
    frames.push(JSON.stringify(m));
  });
  return { provider, relay, local, frames };
}

/**
 * Drive start() through the handshake: connect resolves (fake), the relay sends
 * Settings, then the test applies them so `ready` can be emitted.
 */
async function startSession(
  h: ReturnType<typeof harness>,
  job = 'Assemble the desk-side drill station.',
  positions: typeof POSITIONS | [] = POSITIONS,
): Promise<void> {
  const p = h.relay.handleClientMessage({ type: 'start', job, positions });
  await awaitSetImmediate();
  h.provider.emitJson({ type: 'SettingsApplied' });
  await p;
}

test('start handshakes (Settings after connect) and emits ready with the runbook', async () => {
  const h = harness();
  await startSession(h, 'Assemble the desk-side drill station.', POSITIONS);

  assert.equal(h.provider.opened, true);
  assert.ok(h.provider.sentJson.length >= 1, 'Settings was sent to the provider');
  const settings = h.provider.sentJson[0];
  assert.equal(settings.type, 'Settings');
  if (settings.type !== 'Settings') return;
  assert.deepEqual(settings.audio.input, { encoding: 'linear16', sample_rate: 24000 });
  assert.deepEqual(settings.audio.output, { encoding: 'linear16', sample_rate: 24000, container: 'none' });
  assert.equal(settings.agent.language, 'en');
  assert.deepEqual(settings.agent.listen, { provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en' } });
  assert.deepEqual(settings.agent.speak, { provider: { type: 'deepgram', version: 'v2', model: 'flux-kit-en' } });
  assert.deepEqual(settings.agent.think.provider, { type: 'google', model: 'gemini-3.1-flash-lite' });
  assert.match(settings.agent.think.prompt, /Assemble the desk-side drill station/);
  assert.match(settings.agent.think.prompt, /one short, spoken sentence/);

  const ready = h.local[0];
  assert.equal(ready.type, 'ready');
  if (ready.type !== 'ready') return;
  assert.equal(ready.protocol, 1);
  assert.equal(ready.model, 'flux-general-en');
  assert.equal(ready.voice, 'flux-kit-en');
  assert.equal(ready.runbook.phase, 'coaching');
  assert.equal(ready.runbook.currentScrew, 0);
  assert.equal(ready.runbook.spec.confirmed, true);
});

test('audio_input frames are forwarded to the provider as raw PCM bytes', async () => {
  const h = harness();
  await startSession(h);
  h.local.length = 0;

  await h.relay.handleClientMessage({ type: 'audio_input', data: 'AQIDBA' });
  assert.equal(h.provider.sentAudio.length, 1);
  assert.deepEqual([...h.provider.sentAudio[0]], [1, 2, 3, 4], 'base64 PCM16 24k decodes to the raw bytes');
  assert.equal(h.local.length, 0, 'audio forwarding produces no local frame');
});

test('deepgram binary audio frames stream out as local audio_output base64', async () => {
  const h = harness();
  await startSession(h);

  h.provider.emitAudio(Uint8Array.from([250, 240]));
  h.provider.emitAudio(Uint8Array.from([0, 1]));
  const outputs = h.local.filter((m) => m.type === 'audio_output');
  assert.equal(outputs.length, 2);
  if (outputs[0]?.type !== 'audio_output') return;
  assert.deepEqual([...Buffer.from(outputs[0].data, 'base64')], [250, 240]);
  if (outputs[1]?.type !== 'audio_output') return;
  assert.deepEqual([...Buffer.from(outputs[1].data, 'base64')], [0, 1]);
});

test('ConversationText yields operator transcript + coach direction; guidance never advances a step', async () => {
  const h = harness();
  await startSession(h);

  h.provider.emitJson({ type: 'ConversationText', role: 'user', content: 'put the jig on the bench' });
  const userTranscript = h.local.find((m) => m.type === 'transcript');
  assert.ok(userTranscript, 'transcript emitted for the operator');
  if (userTranscript?.type === 'transcript') {
    assert.equal(userTranscript.youSaid, 'put the jig on the bench');
    assert.equal(userTranscript.direction, undefined);
    assert.equal(userTranscript.step, 1);
    assert.equal(userTranscript.targetId, 'top-left');
  }

  h.local.length = 0;
  h.provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Mount the jig on the bench.' });
  assert.equal(h.local.filter((m) => m.type === 'transcript').length, 0, 'no direction until the turn finalizes');
  h.provider.emitJson({ type: 'AgentAudioDone' });

  const direction = h.local.find((m) => m.type === 'transcript' && m.direction);
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
  assert.equal(runbookEvent.runbook.currentScrew, 0, 'agent guidance MUST NOT advance a step');
});

test('feedbackSeed is deterministic for the same job/step/direction', async () => {
  const a = harness();
  await startSession(a);
  a.provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Twist it.' });
  a.provider.emitJson({ type: 'AgentAudioDone' });

  const b = harness();
  await startSession(b);
  b.provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Twist it.' });
  b.provider.emitJson({ type: 'AgentAudioDone' });

  const seedA = a.local.find((m) => m.type === 'transcript' && m.direction) as { feedbackSeed?: number } | undefined;
  const seedB = b.local.find((m) => m.type === 'transcript' && m.direction) as { feedbackSeed?: number } | undefined;
  assert.equal(seedA?.feedbackSeed, seedB?.feedbackSeed);
});

test('interrupt sends ForceEndTurn and discards pending guidance', async () => {
  const h = harness();
  await startSession(h);
  h.provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Partial direction that will be cut off' });
  h.local.length = 0;

  await h.relay.handleClientMessage({ type: 'interrupt' });
  assert.deepEqual(h.provider.sentJson.at(-1), { type: 'ForceEndTurn' });

  h.provider.emitJson({ type: 'AgentAudioDone' });
  assert.equal(
    h.local.filter((m) => m.type === 'transcript' && m.direction).length,
    0,
    'interrupted guidance never finalizes',
  );
  assert.equal(h.relay.snapshot?.previous.length, 0);
});

test('barge-in (UserStartedSpeaking) discards partial guidance so a straggling AgentAudioDone cannot finalize it', async () => {
  const h = harness();
  await startSession(h);
  h.provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Half a direction' });
  h.provider.emitJson({ type: 'UserStartedSpeaking' });
  h.provider.emitJson({ type: 'AgentAudioDone' });
  assert.equal(
    h.local.filter((m) => m.type === 'transcript' && m.direction).length,
    0,
    'barge-in discarded the in-flight direction',
  );
});

test('confirm advances exactly one deterministic step; the agent cannot advance the runbook', async () => {
  const h = harness();
  await startSession(h);
  h.local.length = 0;

  h.provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Do the first thing.' });
  h.provider.emitJson({ type: 'AgentAudioDone' });
  assert.equal(h.relay.snapshot?.currentScrew, 0);

  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 1);
  assert.equal(h.relay.snapshot?.phase, 'coaching');

  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 2);
  assert.equal(h.relay.snapshot?.phase, 'done');

  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 2);
  assert.equal(h.relay.snapshot?.phase, 'done');

  const runbooks = h.local.filter((m) => m.type === 'runbook' && m.runbook.currentScrew === 1);
  assert.equal(runbooks.length, 1, 'one runbook update per confirmation');
});

test('free coaching (no positions) confirms without advancing a physical step', async () => {
  const h = harness();
  await startSession(h, 'Coach me.', []);
  await h.relay.handleClientMessage({ type: 'confirm' });
  assert.equal(h.relay.snapshot?.currentScrew, 0);
  assert.equal(h.relay.snapshot?.phase, 'coaching');
});

test('missing DEEPGRAM credential reaches the local protocol as error + closed, never a key', async () => {
  const h = harness(
    new MissingCredentialError('DEEPGRAM_API_KEY', 'DEEPGRAM_API_KEY is not set. Set it in hackathon/voice-director/.env.'),
  );
  await h.relay.handleClientMessage({ type: 'start', job: 'No key needed to try.', positions: POSITIONS });

  const errors = h.local.filter((m) => m.type === 'error');
  assert.equal(errors.length, 1);
  if (errors[0]?.type === 'error') {
    assert.equal(errors[0].code, 'missing_provider_credential');
    assert.match(errors[0].message, /DEEPGRAM_API_KEY/);
  }
  const closed = h.local.at(-1);
  assert.equal(closed?.type, 'closed');
  assert.equal(h.provider.sentJson.length, 0, 'no provider command before a session exists');
  assert.ok(!h.frames.join('\n').includes(API_KEY), 'credential string absent');
});

test('the real provider resolves the key lazily; a missing key throws before any socket opens', async () => {
  assert.throws(() => buildDeepgramProviderSettings(loadConfig({})), MissingCredentialError);
  await assert.rejects(() => createDeepgramProvider(loadConfig({})).connect(), MissingCredentialError);
});

test('provider errors during the handshake surface once as error + closed', async () => {
  const h = harness();
  const p = h.relay.handleClientMessage({ type: 'start', job: 'J.', positions: POSITIONS });
  await awaitSetImmediate();
  h.provider.emitJson({ type: 'Error', code: 'INVALID_SETTINGS', description: 'bad model' });
  await p;

  const errors = h.local.filter((m) => m.type === 'error');
  assert.equal(errors.length, 1, 'the handshake error is emitted exactly once');
  if (errors[0]?.type === 'error') {
    assert.equal(errors[0].code, 'INVALID_SETTINGS');
    assert.match(errors[0].message, /bad model/);
  }
  assert.equal(h.local.at(-1)?.type, 'closed');
});

test('provider errors mid-session propagate and the session closes', async () => {
  const h = harness();
  await startSession(h);
  h.local.length = 0;

  h.provider.emitJson({ type: 'Error', code: 'server_error', description: 'upstream exploded' });
  assert.equal(h.local.filter((m) => m.type === 'error').length, 1);
  if (h.local[0]?.type === 'error') {
    assert.equal(h.local[0].code, 'server_error');
    assert.match(h.local[0].message, /upstream exploded/);
  }
  assert.equal(h.local.at(-1)?.type, 'closed');
});

test('deepgram provider credentials never enter the local client protocol', async () => {
  const h = harness();
  await startSession(h);

  h.provider.emitJson({ type: 'Error', code: 'provider_unauthorized', description: `denied with key ${API_KEY} in the body` });
  const err = h.local.at(-2);
  if (err?.type === 'error') {
    assert.ok(!err.message.includes(API_KEY), 'secret redacted from local error');
    assert.ok(err.message.includes('[redacted]'), 'redaction marker visible');
  }

  h.provider.emitJson({ type: 'ConversationText', role: 'user', content: 'say more' });
  h.provider.emitAudio(Uint8Array.from([255, 0]));
  h.provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Done.' });
  h.provider.emitJson({ type: 'AgentAudioDone' });
  await h.relay.handleClientMessage({ type: 'confirm' });
  await h.relay.handleClientMessage({ type: 'audio_input', data: 'AQIDBA' });
  const joined = h.frames.join('\n');
  for (const needle of [API_KEY, 'Authorization', 'Token ', 'apiKey', 'secret']) {
    assert.ok(!joined.includes(needle), `no local frame leaks "${needle}"`);
  }
});

test('control messages before start are rejected with session_not_started', async () => {
  const h = harness();
  await h.relay.handleClientMessage({ type: 'audio_input', data: 'AQIDBA' });
  await h.relay.handleClientMessage({ type: 'interrupt' });
  await h.relay.handleClientMessage({ type: 'confirm' });
  await h.relay.handleClientMessage({ type: 'runbook_request' });

  const errors = h.local.filter((m) => m.type === 'error');
  assert.equal(errors.length, 4);
  for (const e of errors) {
    if (e.type === 'error') assert.equal(e.code, 'session_not_started');
  }
  assert.equal(h.provider.sentJson.length, 0);
});

test('runbook_request returns the current snapshot without mutating it', async () => {
  const h = harness();
  await startSession(h);
  h.local.length = 0;

  await h.relay.handleClientMessage({ type: 'runbook_request' });
  const snap = h.local.at(-1);
  assert.equal(snap?.type, 'runbook');
  if (snap?.type === 'runbook') {
    assert.equal(snap.runbook.currentScrew, 0);
    assert.equal(snap.runbook.spec.confirmed, true);
  }
});

test('parseDeepgramEvent whitelists the documented surface and drops unknowns', () => {
  assert.deepEqual(parseDeepgramEvent({ type: 'Welcome', request_id: 'r1' }), { type: 'Welcome', requestId: 'r1' });
  assert.deepEqual(parseDeepgramEvent({ type: 'SettingsApplied' }), { type: 'SettingsApplied' });
  assert.deepEqual(parseDeepgramEvent({ type: 'UserStartedSpeaking' }), { type: 'UserStartedSpeaking' });
  assert.deepEqual(parseDeepgramEvent({ type: 'AgentThinking' }), { type: 'AgentThinking' });
  assert.deepEqual(parseDeepgramEvent({ type: 'AgentAudioDone' }), { type: 'AgentAudioDone' });
  assert.deepEqual(
    parseDeepgramEvent({ type: 'ConversationText', role: 'user', content: 'hello', other: 'ignored' }),
    { type: 'ConversationText', role: 'user', content: 'hello' },
  );
  assert.deepEqual(
    parseDeepgramEvent({ type: 'Error', code: 'BAD_KEY', description: 'nope' }),
    { type: 'Error', code: 'BAD_KEY', description: 'nope' },
  );
  assert.deepEqual(
    parseDeepgramEvent({ type: 'Error', code: 'X', message: 'fallback text' }),
    { type: 'Error', code: 'X', description: 'fallback text' },
  );
  assert.equal(parseDeepgramEvent({ type: 'some.future.event' }), null);
  assert.equal(parseDeepgramEvent({ type: 'ConversationText', role: 'system', content: 'x' }), null);
  assert.equal(parseDeepgramEvent(null), null);
  assert.equal(parseDeepgramEvent({ noType: true }), null);
});

test('buildDeepgramSettings carries the captured session configuration', () => {
  const settings = buildDeepgramSettings(DEEPGRAM_CONFIG, 'Coach the operator.');
  assert.equal(settings.type, 'Settings');
  assert.deepEqual(settings.audio.input, { encoding: 'linear16', sample_rate: 24000 });
  assert.deepEqual(settings.audio.output, { encoding: 'linear16', sample_rate: 24000, container: 'none' });
  assert.equal(settings.agent.listen.provider.type, 'deepgram');
  assert.equal(settings.agent.listen.provider.version, 'v2');
  assert.equal(settings.agent.listen.provider.model, 'flux-general-en');
  assert.equal(settings.agent.think.provider.type, 'google');
  assert.equal(settings.agent.think.provider.model, 'gemini-3.1-flash-lite');
  assert.equal(settings.agent.think.prompt, 'Coach the operator.');
  assert.equal(settings.agent.speak.provider.version, 'v2');
  assert.equal(settings.agent.speak.provider.model, 'flux-kit-en');
});

test('deepgram config defaults, provider selector, and endpoint overrides', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.realtime.provider, 'openai', 'default preserves the OpenAI realtime relay');
  assert.equal(cfg.deepgram.apiKey, null);
  assert.equal(cfg.deepgram.listenModel, 'flux-general-en');
  assert.equal(cfg.deepgram.speakModel, 'flux-kit-en');
  assert.equal(cfg.deepgram.llmProvider, 'google');
  assert.equal(cfg.deepgram.llmModel, 'gemini-3.1-flash-lite');
  assert.equal(cfg.deepgram.wsUrl, DEEPGRAM_ENDPOINT);

  assert.equal(loadConfig({ VOICE_DIRECTOR_REALTIME_PROVIDER: 'deepgram' }).realtime.provider, 'deepgram');
  assert.equal(loadConfig({ VOICE_DIRECTOR_REALTIME_PROVIDER: 'bogus' }).realtime.provider, 'openai');
  assert.equal(loadConfig({ VOICE_DIRECTOR_REALTIME_PROVIDER: 'DEEPGRAM' }).realtime.provider, 'deepgram');

  const overridden = loadConfig({
    VOICE_DIRECTOR_DEEPGRAM_LISTEN_MODEL: 'nova-3',
    VOICE_DIRECTOR_DEEPGRAM_SPEAK_MODEL: 'aura-2',
    VOICE_DIRECTOR_DEEPGRAM_LLM_PROVIDER: 'anthropic',
    VOICE_DIRECTOR_DEEPGRAM_LLM_MODEL: 'claude-3.5-haiku',
    VOICE_DIRECTOR_DEEPGRAM_WS_URL: 'ws://gateway.local/agent',
  });
  assert.equal(overridden.deepgram.listenModel, 'nova-3');
  assert.equal(overridden.deepgram.speakModel, 'aura-2');
  assert.equal(overridden.deepgram.llmProvider, 'anthropic');
  assert.equal(overridden.deepgram.llmModel, 'claude-3.5-haiku');
  assert.equal(overridden.deepgram.wsUrl, 'ws://gateway.local/agent');

  const keyed: DirectorConfig = loadConfig({
    DEEPGRAM_API_KEY: API_KEY,
    VOICE_DIRECTOR_REALTIME_PROVIDER: 'deepgram',
    VOICE_DIRECTOR_DEEPGRAM_WS_URL: 'ws://gateway.local/agent',
  });
  const settings = buildDeepgramProviderSettings(keyed);
  assert.equal(settings.apiKey, API_KEY);
  assert.equal(settings.wsUrl, 'ws://gateway.local/agent');
  assert.equal(deepgramEndpoint(keyed), 'ws://gateway.local/agent');
  assert.equal(deepgramEndpoint(loadConfig({})), DEEPGRAM_ENDPOINT);
});

test('buildDeepgramRelayDeps wires server-side secrets into the relay boundary', () => {
  const cfg: DirectorConfig = loadConfig({ DEEPGRAM_API_KEY: API_KEY });
  const deps = buildDeepgramRelayDeps(cfg);
  assert.deepEqual(deps.config.secrets, [API_KEY]);
  assert.equal(deps.config.listenModel, 'flux-general-en');
  assert.ok(deps.provider.name === 'deepgram-agent');

  const noKey = buildDeepgramRelayDeps(loadConfig({}));
  assert.deepEqual(noKey.config.secrets, []);
});