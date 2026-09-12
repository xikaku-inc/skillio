# Deepgram Agent relay (parallel server-side realtime provider)

The voice-director realtime relay has two interchangeable **server-side**
providers behind the SAME narrow local protocol (`shared/realtime.ts`, the ONLY
browser contract) and the SAME deterministic runbook authority:

| | Default (`openai`) | `deepgram` |
| --- | --- | --- |
| Provider WS | OpenAI Realtime (`/v1/realtime`) | Deepgram **Agent** (`wss://agent.deepgram.com/v1/agent/converse`) |
| Credential (server-only) | `OPENAI_API_KEY` | `DEEPGRAM_API_KEY` |
| Handshake | `session.update` after socket open | `Welcome` → `Settings` → `SettingsApplied` |
| Audio codec | base64 PCM16 24 kHz (OpenAI flavor) | linear16 24 kHz mono in/out (Deepgram flavor) — same bytes as the local protocol, no resampling |
| Input frame | `input_audio_buffer.append` | raw binary PCM over the Agent socket |
| Interrupt | `response.cancel` + `input_audio_buffer.clear` | `ForceEndTurn` (requires Agent listen `v2`) |
| Turn end | `response.done` | `AgentAudioDone` |

Select it with `VOICE_DIRECTOR_REALTIME_PROVIDER=deepgram`. The default
(`openai`) is byte-for-byte the existing behavior; the Deepgram path is a pure
addition.

## Captured session configuration

These are the Agent knobs the relay pins (hackathon demo), all overridable via
env:

| Setting | Value | Env override |
| --- | --- | --- |
| `audio.input` | `linear16`, 24000 Hz | — (matches local base64 PCM16 24 kHz) |
| `audio.output` | `linear16`, 24000 Hz, `container: none` | — |
| `agent.language` | `en` | — |
| `agent.listen` | Deepgram, **`version: v2`**, `flux-general-en` | `VOICE_DIRECTOR_DEEPGRAM_LISTEN_MODEL` |
| `agent.think` | Google, `gemini-3.1-flash-lite` | `VOICE_DIRECTOR_DEEPGRAM_LLM_PROVIDER` / `_LLM_MODEL` |
| `agent.speak` | Deepgram, **`version: v2`**, `flux-kit-en` | `VOICE_DIRECTOR_DEEPGRAM_SPEAK_MODEL` |
| endpoint | `wss://agent.deepgram.com/v1/agent/converse` | `VOICE_DIRECTOR_DEEPGRAM_WS_URL` |

`version: v2` on `listen` is **required** for the `flux-*` listen family and for
`ForceEndTurn` to work; the relay always stamps it.

## Wire flow (server-boundary only)

```
browser                            voice-director server              Deepgram Agent
┌──────────────────────┐   ┌──────────────────────────────┐   ┌──────────────────────────┐
│ narrow local protocol │   │ gateway /ws/realtime        │──▶│ wss://agent.deepgram.com │
│ (shared/realtime.ts)  │──▶│ DeepgramRelay (runbook)     │   │ /v1/agent/converse       │
│ NO credential here    │◀──│ DeepgramAgentProvider (ws)  │◀──│ Authorization: Token <key>│
└──────────────────────┘   └──────────────────────────────┘   └──────────────────────────┘
```

1. `start` → relay seeds the runbook (spec auto-confirmed, phase `coaching`),
   opens the Agent socket, and waits for `Welcome` (the credential is resolved
   lazily here, in the upgrade `Authorization` header — never in a local frame).
2. Relay sends `Settings` (model knobs + `buildRealtimeInstructions(runbook)` as
   the agent prompt) and waits for `SettingsApplied` before emitting `ready`.
   A provider `Error` during this handshake closes the session cleanly.
3. `audio_input` (base64 PCM16 24 kHz) is decoded and forwarded as raw binary
   PCM — identical codec, no resampling. Agent output comes back as binary
   frames bridged to `audio_output` base64.
4. `ConversationText` user → operator `transcript` (`youSaid`); assistant →
   pending direction, finalized on `AgentAudioDone` into `transcript` +
   runbook `previous`. `UserStartedSpeaking` (server-side barge-in) discards any
   in-flight partial direction.
5. `interrupt` → `ForceEndTurn` (natural cancel; valid because listen is v2).
6. `confirm` → the **only** runbook advance (`advanceScrew`), exactly as the
   OpenAI relay. The Deepgram agent may phrase guidance; it can never change
   `currentScrew`, `phase`, or `previous`.

## Missing-credential behavior

Identical to the OpenAI path: the server boots, health reports
`deepgram: "missing-credential"`, and a `start` with no `DEEPGRAM_API_KEY`
produces a local `error` `missing_provider_credential` ("DEEPGRAM_API_KEY is not
set…") + `closed`, then the gateway closes the socket with **1013**. Error text
is redacted against the server-side key (`secrets`) before it can reach the
local protocol. No credential is ever invented or serialized.

## Env vars

| Env var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `VOICE_DIRECTOR_REALTIME_PROVIDER` | no | `openai` | `deepgram` selects the Deepgram Agent relay |
| `DEEPGRAM_API_KEY` | when `deepgram` | — | server-only Agent credential (upgrade header) |
| `VOICE_DIRECTOR_DEEPGRAM_LISTEN_MODEL` | no | `flux-general-en` | `agent.listen` model (`flux-*` family) |
| `VOICE_DIRECTOR_DEEPGRAM_SPEAK_MODEL` | no | `flux-kit-en` | `agent.speak` model |
| `VOICE_DIRECTOR_DEEPGRAM_LLM_PROVIDER` | no | `google` | `agent.think.provider.type` |
| `VOICE_DIRECTOR_DEEPGRAM_LLM_MODEL` | no | `gemini-3.1-flash-lite` | `agent.think` model |
| `VOICE_DIRECTOR_DEEPGRAM_WS_URL` | no | `wss://agent.deepgram.com/v1/agent/converse` | Agent endpoint (proxies/gateways) |

## Tests

`server/realtime/deepgram/tests/relay.test.ts` drives `DeepgramRelay` through
both edges with a test-only fake provider (no network, no paid calls, no real
key): the `Settings` handshake shape, base64 PCM round-trip, Agent audio
bridging, transcript/direction accumulation, `ForceEndTurn` interrupt +
barge-in, deterministic confirms, missing-credential reporting, handshake vs
mid-session error handling, the credential-isolation sweep, and the
`parseDeepgramEvent`/`buildDeepgramSettings` codecs.

`server/realtime/deepgram/tests/ws-server.test.ts` runs the same properties over
a **real local WebSocket** through the gateway with the fake provider and
`VOICE_DIRECTOR_REALTIME_PROVIDER=deepgram`: full-duplex duplex, the
missing-credential `error`+`closed`+1013 path, and malformed-frame handling.

## Manual smoke test (needs your own key in `.env`, no source changes)

```bash
cd hackathon/voice-director
cp .env.example .env            # set: VOICE_DIRECTOR_REALTIME_PROVIDER=deepgram, DEEPGRAM_API_KEY=...
pnpm dev:server                 # boots the voice-director API + realtime gateway
curl -s localhost:8787/api/health   # expect realtime:"deepgram", deepgram:"ready"
```

Drive the local relay with a small Node client:

```js
// smoke.mjs  (throwaway; connects to the LOCAL /ws/realtime, not Deepgram directly)
import { WebSocket } from 'ws';
const ws = new WebSocket('ws://localhost:8787/ws/realtime');
ws.on('open', () => ws.send(JSON.stringify({ type: 'start', job: 'Assemble the drill station.', positions: [] })));
ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type !== 'audio_output') console.log(m.type, JSON.stringify(m)); });
```

Expected: `ready` (model `flux-general-en`, voice `flux-kit-en`, runbook
`coaching`). Live audio in/out then behaves like any browser client — but the
Deepgram session only runs if your key is valid; an invalid key surfaces as a
`missing_provider_credential`-style (or `provider_connect_failed`) `error` +
`closed` + 1013, never as a crashed server.

## Files

```
server/realtime/deepgram/types.ts           Deepgram Agent protocol types + endpoint + model spec
server/realtime/deepgram/provider.ts        DeepgramProvider boundary + WS adapter (key lives here)
server/realtime/deepgram/relay.ts           DeepgramRelay: same local protocol + runbook authority
server/realtime/deepgram/tests/relay.test.ts      fake-provider relay tests
server/realtime/deepgram/tests/ws-server.test.ts  deepgram gateway wire tests
server/realtime/deepgram/tests/helpers.ts         shared test helpers (not a test)
server/realtime/ws-server.ts                provider selector (createGatewayRelay)
```