# Realtime relay: browser ⇄ server ⇄ provider boundaries

This is the full-duplex foundation that the one-shot HTTP turn (`POST /api/voice`,
a single bounded WAV round trip on the Responses API) is NOT: a **persistent
OpenAI Realtime session** that streams audio both ways in near-real-time. It
reuses the same server-side `OPENAI_API_KEY`, the same runbook/scene vocabulary
(`shared/scene.ts`, `@skillio/voice-coach`), and the same missing-credential
contract. The one-shot HTTP routes are unchanged.

There is a **parallel server-side realtime provider**: `DEEPGRAM.md` describes
the Deepgram Agent implementation behind the same local protocol and runbook,
selected with `VOICE_DIRECTOR_REALTIME_PROVIDER=deepgram` (default `openai`,
byte-for-byte this document). Everything below describes the default OpenAI
boundaries; the Deepgram page calls out exactly what differs.

## Three boundaries

```
Browser (future client)          voice-director server            OpenAI Realtime API
┌──────────────────────┐   ┌──────────────────────────────┐   ┌─────────────────────────┐
│ narrow local protocol │   │ relay gateway (ws-server)   │   │  wss://api.openai.com/  │
│ text JSON frames on   │──▶│  /ws/realtime               │──▶│  v1/realtime?model=...  │
│ ws://localhost:8787/  │   │  RealtimeRelay (runbook)    │   │  gpt-realtime-2.1       │
│ ws/realtime           │◀──│  RealtimeProvider (ws)      │◀──│  (server-only key)      │
└──────────────────────┘   └──────────────────────────────┘   └─────────────────────────┘
   NO credential here          key lives here, never                    key used here
                               serialized to the browser
```

1. **Browser → server — the local protocol** (`shared/realtime.ts`). Ten text
   JSON message kinds total; it is the whole future-client contract:
   - client → server: `start`, `audio_input` (base64 PCM16 24kHz mono frame),
     `interrupt`, `confirm`, `runbook_request`.
   - server → client: `ready`, `audio_output` (base64 provider audio delta),
     `transcript` (operator text and/or coach direction + deterministic
     `feedbackSeed`), `runbook` (server-authoritative snapshot), `error`,
     `closed` (terminal; the socket closes with 1013 after it).
   There is **no credential field** in this protocol by construction. A
   malformed frame gets an `error`/`bad_message`; the socket stays open.
2. **Server — the relay** (`server/realtime/relay.ts`) is transport-agnostic
   and deterministic: it decodes local frames, owns the runbook state, and
   translates provider events into local frames. The gateway
   (`server/realtime/ws-server.ts`) only moves bytes between a WebSocket and
   one relay; it never touches the provider or credential.
3. **Server → provider** (`server/realtime/provider.ts`) opens the documented
   OpenAI Realtime WebSocket surface. The `OPENAI_API_KEY` is resolved lazily
   inside `connect()` and used only in the `Authorization` header of the
   outgoing provider socket. The concrete `OpenAiRealtimeProvider` is built
   only by `createRealtimeProvider`; tests inject a fake provider instead.

## How it differs from the bounded WAV HTTP turn

| | `POST /api/voice` (existing) | Realtime relay (this foundation) |
| --- | --- | --- |
| Transport | one HTTP request → one full WAV body → one JSON reply | persistent WebSocket, continuous bidirectional frames |
| Model | `gpt-4o-audio-preview` (Responses API) | `gpt-realtime-2.1` (Realtime API, `gpt-realtime` family) |
| Audio | full turn captured client-side, sent once | frames streamed as captured; provider audio streams back |
| Transcript/direction | computed server-side in one round trip | transcribed + guided incrementally by the live model |
| Interruption | n/a | `interrupt` → `response.cancel` + `input_audio_buffer.clear` |
| Runbook advance | server advances a screw after each HTTP turn | the relay NEVER advances on provider guidance; only an explicit client `confirm` does (see below) |
| Cost/dev | token-bounded per click | per-denominator streaming session; needs a keyed account |

## Runbook determinism and authority

- The runbook is **seeded server-side** on `start` (spec auto-confirmed, phase
  `coaching`, `currentScrew 0`), versioned in `shared/scene.ts`
  (`RUNBOOK_VERSION`), and transitions apply the same
  voice-coach helpers (`confirmSpec`, `advanceScrew`) the HTTP slice uses.
- The **realtime model may phrase guidance** (`response.text.delta` text in the
  `transcript`/`direction` field) and influence *what it says*, but it cannot
  change `currentScrew`, `phase`, or `previous`.
- The **only** thing that advances a physical step is the client's explicit
  `confirm` message, applied server-side with `advanceScrew`. A finished job
  (`phase: 'done'`) ignores further confirms; free coaching (no `positions`)
  confirms without advancing.
- `feedbackSeed` (`job, step, direction`) keeps the existing deterministic
  cue/highlight pairing; the same turn reproduces the same seed across clients.

## Configuration

| Env var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | **yes** | — | shared server-only credential (same as the HTTP slice) |
| `VOICE_DIRECTOR_REALTIME_PROVIDER` | no | `openai` | `deepgram` selects the parallel Deepgram Agent relay (see `DEEPGRAM.md`) |
| `VOICE_DIRECTOR_REALTIME_MODEL` | no | `gpt-realtime-2.1` | model served by the Realtime API (`gpt-realtime` family) |
| `VOICE_DIRECTOR_REALTIME_VOICE` | no | `alloy` | provider voice |
| `VOICE_DIRECTOR_REALTIME_WS_URL` | no | derived: baseUrl https→wss + `/realtime` | Realtime WebSocket endpoint (proxies/gateways) |
| `VOICE_DIRECTOR_REALTIME_TRANSCRIPTION` | no | `true` | enable `input_audio_transcription` (operator `transcript` events) |
| `VOICE_DIRECTOR_REALTIME_TRANSCRIPTION_MODEL` | no | `gpt-4o-mini-transcribe` | transcription model |

**Missing-credential behavior:** identical to the HTTP slice. The server boots
anyway; the relay mounts regardless; a `start` without a key produces a local
`error` `missing_provider_credential` ("OPENAI_API_KEY is not set…") followed
by `closed`, and the gateway closes the socket with **1013**. No credential is
ever invented, and error text is redacted against the configured key
(`secrets`) before it can reach the local protocol.

## Test surface

`server/realtime/tests/relay.test.ts` drives the relay through both edges with
a **test-only fake provider** (no network, no key):
bidirectional event forwarding, verbatim audio forwarding, transcript/direction
accumulation, `interrupt` semantics, deterministic confirm transitions,
error propagation, `session_not_started` guards, and the credential-isolation
sweep (no local frame ever contains the key, `Authorization`, `Bearer`, or
`apiKey`).

`server/realtime/tests/ws-server.test.ts` runs the same properties over a
**real local WebSocket** through the gateway with the fake provider: the
full-duplex conversation, the missing-credential `error`+`closed`+1013 path,
and malformed-frame handling. Nothing here opens a paid live provider
connection.

## Files

```
shared/realtime.ts                  local protocol types (client + server import)
server/realtime/provider.ts         RealtimeProvider boundary + OpenAI WS adapter (key lives here)
server/realtime/relay.ts            runbook ownership + local/provider codec (deterministic)
server/realtime/ws-server.ts        /ws/realtime gateway + provider selector (createGatewayRelay)
server/realtime/deepgram/           parallel Deepgram Agent provider + relay (see DEEPGRAM.md)
server/realtime/tests/              OpenAI relay tests (fake provider + wire)
server/realtime/deepgram/tests/     Deepgram relay tests (fake provider + wire)
```