// Wire-level test of the Deepgram relay gateway: a REAL local WebSocket client
// speaks the narrow protocol against an http server with the gateway attached,
// while the provider side is the same test-only fake. This proves the browser
// contract end to end over the Deepgram provider selection (text JSON frames
// in/out, binary audio bridged) without a paid Deepgram call.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { WebSocket as WsWebSocket } from 'ws';
import { MissingCredentialError, loadConfig } from '../../../config';
import { REALTIME_WS_PATH, attachRealtimeRelayServer } from '../../ws-server';
import type { DeepgramClientCommand, DeepgramServerEvent } from '../types';
import type { DeepgramProvider } from '../provider';
import type { RealtimeServerMessage } from '../../../../shared/realtime';
import { awaitSetImmediate, waitUntil } from './helpers';

const API_KEY = 'dg-test-wire-secret';

const POSITIONS = [
  { id: 'top-left', anchorId: 'anchor-top-left', attempts: 0, seated: false },
  { id: 'bottom-left', anchorId: 'anchor-bottom-left', attempts: 0, seated: false },
];

class WireFakeDeepgramProvider implements DeepgramProvider {
  readonly name = 'fake-deepgram';
  sentJson: DeepgramClientCommand[] = [];
  recvAudio: Uint8Array[] = [];
  private listener: ((event: DeepgramServerEvent) => void) | null = null;

  constructor(private readonly failConnect?: Error) {}

  onEvent(listener: (event: DeepgramServerEvent) => void): void {
    this.listener = listener;
  }
  async connect(): Promise<void> {
    if (this.failConnect) throw this.failConnect;
  }
  sendJson(command: DeepgramClientCommand): void {
    this.sentJson.push(command);
  }
  sendAudio(data: Uint8Array): void {
    this.recvAudio.push(data);
  }
  close(): void {}
  emitJson(event: DeepgramServerEvent): void {
    this.listener?.(event);
  }
  emitAudio(data: Uint8Array): void {
    this.listener?.({ type: 'AudioFrame', data });
  }
}

function collector(client: WsWebSocket): {
  messages: RealtimeServerMessage[];
  waitFor: (type: string, from?: number) => Promise<RealtimeServerMessage>;
} {
  const messages: RealtimeServerMessage[] = [];
  client.on('message', (data: unknown) => {
    messages.push(JSON.parse(String(data)) as RealtimeServerMessage);
  });
  const waitFor = (type: string, from = 0): Promise<RealtimeServerMessage> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const scan = setInterval(() => {
        const found = messages.findIndex((m, idx) => idx >= from && m.type === type);
        if (found >= 0) {
          clearInterval(scan);
          resolve(messages[found]);
        } else if (Date.now() - started > 5000) {
          clearInterval(scan);
          reject(new Error(`timeout waiting for ${type}; saw: ${messages.map((m) => m.type).join(',')}`));
        }
      }, 10);
    });
  return { messages, waitFor };
}

async function withDeepgramGateway(
  provider: DeepgramProvider,
  fn: (client: WsWebSocket, got: ReturnType<typeof collector>, fake: WireFakeDeepgramProvider) => Promise<void>,
  env: Record<string, string | undefined> = { DEEPGRAM_API_KEY: API_KEY, VOICE_DIRECTOR_REALTIME_PROVIDER: 'deepgram' },
): Promise<void> {
  const cfg = loadConfig(env);
  const httpServer = createServer();
  const wss = attachRealtimeRelayServer(httpServer, cfg, provider);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as { port: number }).port;

  const client = new WsWebSocket(`ws://127.0.0.1:${port}${REALTIME_WS_PATH}`);
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });

  try {
    await fn(client, collector(client), provider as WireFakeDeepgramProvider);
  } finally {
    client.close();
    wss.close();
    httpServer.close();
  }
}

test('deepgram gateway: handshake, duplex audio, transcripts, runbook advance, no credential in frames', async () => {
  const provider = new WireFakeDeepgramProvider();
  await withDeepgramGateway(provider, async (client, got) => {
    client.send(JSON.stringify({ type: 'start', job: 'Assemble the drill station.', positions: POSITIONS }));
    await waitUntil(() => provider.sentJson.some((c) => c.type === 'Settings'), 5000, 'Settings frame');
    const settings = provider.sentJson.find((c) => c.type === 'Settings');
    if (settings?.type === 'Settings') {
      assert.equal(settings.agent.listen.provider.model, 'flux-general-en');
      assert.equal(settings.agent.think.provider.model, 'gemini-3.1-flash-lite');
      assert.equal(settings.audio.output.container, 'none');
    }
    provider.emitJson({ type: 'SettingsApplied' });

    const ready = await got.waitFor('ready');
    assert.equal(ready.type, 'ready');
    if (ready.type === 'ready') {
      assert.equal(ready.model, 'flux-general-en');
      assert.equal(ready.voice, 'flux-kit-en');
      assert.equal(ready.runbook.phase, 'coaching');
      assert.equal(ready.runbook.spec.confirmed, true);
    }

    client.send(JSON.stringify({ type: 'audio_input', data: 'AQIDBA' }));
    await waitUntil(() => provider.recvAudio.length === 1, 5000, 'PCM audio frame');
    assert.deepEqual([...provider.recvAudio[0]], [1, 2, 3, 4]);

    provider.emitAudio(Uint8Array.from([250, 240]));
    const output = await got.waitFor('audio_output');
    if (output.type === 'audio_output') assert.deepEqual([...Buffer.from(output.data, 'base64')], [250, 240]);

    provider.emitJson({ type: 'ConversationText', role: 'user', content: 'put the jig on the bench' });
    const userTranscript = await got.waitFor('transcript', got.messages.length);
    if (userTranscript.type === 'transcript') assert.equal(userTranscript.youSaid, 'put the jig on the bench');

    provider.emitJson({ type: 'ConversationText', role: 'assistant', content: 'Tighten the top-left screw.' });
    provider.emitJson({ type: 'AgentAudioDone' });
    const direction = await got.waitFor('transcript', got.messages.length);
    if (direction.type === 'transcript') {
      assert.equal(direction.direction, 'Tighten the top-left screw.');
      assert.ok(typeof direction.feedbackSeed === 'number');
    }

    client.send(JSON.stringify({ type: 'confirm' }));
    const runbook = await got.waitFor('runbook', got.messages.length);
    if (runbook.type === 'runbook') assert.equal(runbook.runbook.currentScrew, 1);

    const joined = JSON.stringify(got.messages);
    for (const needle of [API_KEY, 'Authorization', 'Token ', 'apiKey']) {
      assert.ok(!joined.includes(needle), `frame text contains no ${needle}`);
    }
  });
});

test('deepgram gateway: missing credential surfaces as local error + closed and a 1013 close', async () => {
  const provider = new WireFakeDeepgramProvider(
    new MissingCredentialError('DEEPGRAM_API_KEY', 'DEEPGRAM_API_KEY is not set on the server.'),
  );
  await withDeepgramGateway(
    provider,
    async (client, got) => {
      const closeCode: number[] = [];
      client.on('close', (code: number) => closeCode.push(code));

      client.send(JSON.stringify({ type: 'start', job: 'No key needed to try.', positions: [] }));
      const error = await got.waitFor('error');
      if (error.type === 'error') {
        assert.equal(error.code, 'missing_provider_credential');
        assert.match(error.message, /DEEPGRAM_API_KEY/);
      }
      const closed = await got.waitFor('closed');
      assert.equal(closed.type, 'closed');

      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      assert.ok(closeCode.includes(1013), `gateway closed with 1013, got ${closeCode.join(',')}`);
    },
    { VOICE_DIRECTOR_REALTIME_PROVIDER: 'deepgram' },
  );
});

test('deepgram gateway: a malformed frame is reported and the socket stays usable', async () => {
  const provider = new WireFakeDeepgramProvider();
  await withDeepgramGateway(provider, async (client, got) => {
    client.send('this is not json');
    const error = await got.waitFor('error');
    if (error.type === 'error') {
      assert.equal(error.code, 'bad_message');
      assert.match(error.message, /JSON/);
    }

    client.send(JSON.stringify({ type: 'start', job: 'Still open.', positions: [] }));
    await waitUntil(() => provider.sentJson.some((c) => c.type === 'Settings'), 5000, 'Settings frame');
    provider.emitJson({ type: 'SettingsApplied' });
    const ready = await got.waitFor('ready');
    assert.equal(ready.type, 'ready');
  });
});

test('deepgram gateway: a provider handshake Error closes the session once', async () => {
  const provider = new WireFakeDeepgramProvider();
  await withDeepgramGateway(provider, async (client, got) => {
    client.send(JSON.stringify({ type: 'start', job: 'Rejected.', positions: [] }));
    await waitUntil(() => provider.sentJson.some((c) => c.type === 'Settings'), 5000, 'Settings frame');
    provider.emitJson({ type: 'Error', code: 'INVALID_SETTINGS', description: 'unusable model' });

    const error = await got.waitFor('error');
    if (error.type === 'error') assert.equal(error.code, 'INVALID_SETTINGS');
    const closed = await got.waitFor('closed');
    assert.equal(closed.type, 'closed');

    await awaitSetImmediate();
    const errors = got.messages.filter((m) => m.type === 'error');
    assert.equal(errors.length, 1, 'handshake failure emits exactly one error frame');
  });
});