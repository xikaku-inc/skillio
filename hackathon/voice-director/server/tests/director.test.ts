// Test-only surface. The fake provider lives HERE — in the test file — and is
// never reachable from the server's normal product configuration (createProvider
// only ever builds the real OpenAI-backed conversational voice adapter).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCoachPrompt,
  createProvider,
  parseResponsesResponse,
  renderResponsesRequest,
  type DirectorContext,
  type DirectorProvider,
  type ParsedResponses,
} from '../director';
import { loadConfig, requireApiKey, MissingCredentialError } from '../config';

function fakeContext(): DirectorContext {
  return {
    job: 'Assemble the drill station.',
    phase: 'coaching',
    previous: [{ youSaid: 'put the jig on the bench', direction: 'Mount the jig.' }],
  };
}

class FakeProvider implements DirectorProvider {
  readonly name = 'fake';
  async directAudio(ctx: DirectorContext & { audio: Uint8Array; mime: string }) {
    assert.ok(ctx.audio.byteLength > 0, 'audio bytes are forwarded');
    assert.equal(ctx.mime, 'audio/wav');
    return {
      youSaid: 'put the jig on the bench',
      direction: 'Mount the jig on the bench.',
      audio: Buffer.from('RIFF....fake-wav'),
    };
  }
  async directText(ctx: DirectorContext & { text: string }) {
    assert.ok(ctx.text.length > 0);
    return { direction: 'Torque the top-left screw to 12 in·lb.' };
  }
}

test('missing provider credential is reported, never invented', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.apiKey, null);
  assert.throws(() => requireApiKey(cfg), (err) => {
    assert.ok(err instanceof MissingCredentialError);
    assert.ok(/OPENAI_API_KEY/.test(err.message));
    return true;
  });

  const provider = createProvider(cfg);
  assert.equal(provider.name, 'openai-responses');
  return assert.rejects(
    provider.directText({ ...fakeContext(), text: 'start' }),
    MissingCredentialError,
  );
});

test('config defaults are documented and audible', () => {
  const cfg = loadConfig({ OPENAI_API_KEY: 'sk-test' });
  assert.equal(cfg.apiKey, 'sk-test');
  assert.equal(cfg.model, 'gpt-4o-audio-preview');
  assert.equal(cfg.voice, 'alloy');
  assert.equal(cfg.port, 8787);
  assert.equal(cfg.allowedOrigin, 'http://localhost:5173');
});

test('fake provider satisfies the DirectorProvider contract end-to-end', async () => {
  const provider: DirectorProvider = new FakeProvider();
  const round = await provider.directAudio({ ...fakeContext(), audio: new Uint8Array([1, 2, 3]), mime: 'audio/wav' });
  assert.equal(round.youSaid, 'put the jig on the bench');
  assert.equal(round.direction, 'Mount the jig on the bench.');
  assert.match(Buffer.from(round.audio).toString('latin1'), /fake-wav/);

  const text = await provider.directText({ ...fakeContext(), text: 'what next?' });
  assert.match(text.direction, /Torque/);
});

test('renderResponsesRequest produces the conversational voice call shape', () => {
  const { url, headers, body } = renderResponsesRequest(
    { apiKey: 'sk-test', model: 'm', voice: 'nova', baseUrl: 'https://api.openai.com/v1' },
    { mode: 'audio', audio: Buffer.from([1, 2, 3]), mime: 'audio/wav', prompt: 'Coach now.' },
  );
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(headers.Authorization, 'Bearer sk-test');
  const payload = JSON.parse(body) as Record<string, unknown>;
  assert.equal(payload.model, 'm');
  assert.equal((payload.output_audio as { voice: string }).voice, 'nova');
  const input = payload.input as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  const audio = input[0].content[0].input_audio as { data: string; format: string };
  assert.equal(audio.format, 'wav');
  assert.equal(atob(audio.data), '\x01\x02\x03');
});

test('parseResponsesResponse extracts transcript, direction and audio defensively', () => {
  const json = {
    output_text: 'Flip the bracket over.',
    input: [
      {
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: 'AQID', format: 'wav' }, transcript: 'flip the bracket' }],
      },
    ],
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_audio', id: 'a1', data: 'BAUG', transcript: 'Flip the bracket over.' }],
      },
    ],
  };
  const parsed: ParsedResponses = parseResponsesResponse(json);
  assert.equal(parsed.youSaid, 'flip the bracket');
  assert.equal(parsed.direction, 'Flip the bracket over.');
  assert.ok(parsed.audio);
  assert.deepEqual(Array.from(parsed.audio!), [4, 5, 6]);
});

test('parseResponsesResponse falls back cleanly when provider omits transcript audio', () => {
  const parsed = parseResponsesResponse({ output_text: 'Only text.' });
  assert.equal(parsed.direction, 'Only text.');
  assert.equal(parsed.youSaid, '');
  assert.equal(parsed.audio, null);
});

test('buildCoachPrompt stays concise and carries job, phase, history', () => {
  const prompt = buildCoachPrompt(fakeContext());
  assert.match(prompt, /Assemble the drill station/);
  assert.match(prompt, /Current coaching phase: coaching/);
  assert.match(prompt, /put the jig on the bench/);
  assert.match(prompt, /directions only/);
});