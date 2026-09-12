// Wire-level test of the relay gateway: a REAL local WebSocket client speaks the
// narrow protocol against an http server with the gateway attached, while the
// provider side is the same test-only fake. This proves the future browser
// contract end to end (text JSON frames in/out) without a paid provider call.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { WebSocket as WsWebSocket } from 'ws';
import { MissingCredentialError, loadConfig } from '../../config';
import type { ProviderClientEvent, ProviderEvent, RealtimeProvider } from '../provider';
import { REALTIME_WS_PATH, attachRealtimeRelayServer } from '../ws-server';
import type { RealtimeServerMessage } from '../../../shared/realtime';

const API_KEY = 'sk-test-wire-secret';

class WireFakeProvider implements RealtimeProvider {
  readonly name = 'fake-realtime';
  sent: ProviderClientEvent[] = [];
  private listener: ((event: ProviderEvent) => void) | null = null;
  constructor(private readonly failConnect?: Error) {}
  onEvent(listener: (event: ProviderEvent) => void): void {
    this.listener = listener;
  }
  async connect(): Promise<void> {
    if (this.failConnect) throw this.failConnect;
  }
  send(event: ProviderClientEvent): void {
    this.sent.push(event);
  }
  close(): void {}
  emit(event: ProviderEvent): void {
    this.listener?.(event);
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

async function withGateway(
  provider: RealtimeProvider,
  fn: (client: WsWebSocket, got: ReturnType<typeof collector>, onMessage: (ev: ProviderEvent) => void) => Promise<void>,
): Promise<void> {
  const cfg = loadConfig({ OPENAI_API_KEY: API_KEY });
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
    await fn(client, collector(client), (ev) => (provider as WireFakeProvider).emit(ev));
  } finally {
    client.close();
    wss.close();
    httpServer.close();
  }
}

test('gateway: full-duplex forwarding over a real local WebSocket, no credential in frames', async () => {
  const provider = new WireFakeProvider();
  await withGateway(provider, async (client, got, onMessage) => {
    client.send(JSON.stringify({ type: 'start', job: 'Assemble the drill station.', positions: [] }));
    const ready = await got.waitFor('ready');
    assert.equal(ready.type, 'ready');
    if (ready.type === 'ready') {
      assert.equal(ready.runbook.phase, 'coaching');
      assert.equal(ready.runbook.spec.confirmed, true);
    }

    client.send(JSON.stringify({ type: 'audio_input', data: 'AAECAwQ' }));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(provider.sent.at(-1), { type: 'input_audio_buffer.append', audio: 'AAECAwQ' });

    onMessage({ type: 'response.output_audio.delta', delta: 'FF0000' });
    await got.waitFor('audio_output');
    assert.equal(got.messages.at(-1)?.type, 'audio_output');

    onMessage({ type: 'response.text.delta', delta: 'Tighten the top screw.' });
    onMessage({ type: 'response.done' });
    const transcript = await got.waitFor('transcript', got.messages.length);
    if (transcript.type === 'transcript') assert.equal(transcript.direction, 'Tighten the top screw.');

    client.send(JSON.stringify({ type: 'confirm' }));
    const runbook = await got.waitFor('runbook', got.messages.length);
    if (runbook.type === 'runbook') assert.equal(runbook.runbook.currentScrew, 0); // free coaching: no advance

    // The wire never carries a credential, anywhere (frames are canonical JSON of the parsed messages).
    const joined = JSON.stringify(got.messages);
    for (const needle of [API_KEY, 'Authorization', 'Bearer ', 'apiKey']) {
      assert.ok(!joined.includes(needle), `frame text contains no ${needle}`);
    }
  });
});

test('gateway: missing credential surfaces as local error + closed and a 1013 close', async () => {
  const provider = new WireFakeProvider(
    new MissingCredentialError('OPENAI_API_KEY', 'OPENAI_API_KEY is not set on the server.'),
  );
  await withGateway(provider, async (client, got) => {
    const closeCode: number[] = [];
    client.on('close', (code: number) => closeCode.push(code));

    client.send(JSON.stringify({ type: 'start', job: 'No key needed to try.' }));
    const error = await got.waitFor('error');
    if (error.type === 'error') {
      assert.equal(error.code, 'missing_provider_credential');
      assert.match(error.message, /OPENAI_API_KEY/);
    }
    const closed = await got.waitFor('closed');
    assert.equal(closed.type, 'closed');

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.ok(closeCode.includes(1013), `gateway closed with 1013, got ${closeCode.join(',')}`);
  });
});

test('gateway: a malformed frame is reported and the socket stays usable', async () => {
  const provider = new WireFakeProvider();
  await withGateway(provider, async (client, got) => {
    client.send('this is not json');
    const error = await got.waitFor('error');
    if (error.type === 'error') {
      assert.equal(error.code, 'bad_message');
      assert.match(error.message, /JSON/);
    }

    client.send(JSON.stringify({ type: 'start', job: 'Still open.' }));
    const ready = await got.waitFor('ready');
    assert.equal(ready.type, 'ready');
  });
});