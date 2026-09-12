# skillio · voice-director (hackathon slice)

API-only voice direction: the operator talks, the director listens, replies with
**one concise direction**, and speaks it back. There is no local STT/TTS and no
offline fallback — this slice is provider-API by contract.

```
microphone ──> Vite client ──> localhost server (POST /api/voice) ──> conversational
voice API (input_audio -> output_audio) ──> returned audio ──> client playback
```

The stack packages are reused, not forked: `@skillio/voice-coach` drives the
session state (confirm-back gate, phases), `@skillio/mcp-protocol` types the tool
surface, and the Vite + React conventions match `apps/site`. Everything
hackathon-specific stays inside this folder — `apps/web` is untouched.

## Run it

```bash
cd hackathon/voice-director
cp .env.example .env          # then set OPENAI_API_KEY (server-side only)
pnpm install                  # once, from repo root
pnpm dev                      # server :8787 + Vite web :5173 (proxies /api + /copilot)
```

Open http://localhost:5173, confirm a job, hold the talk button, speak, and the
director's reply plays back. Mic capture on plain `localhost` is allowed; if you
open via an IP instead, serve over HTTPS or flip Chrome's
`unsafely-treat-insecure-origin-as-secure` flag.

### Commands

| Command | What |
| --- | --- |
| `pnpm dev` | server + Vite, together |
| `pnpm dev:server` | API server only (`tsx watch`, loads `.env` if present) |
| `pnpm dev:web` | Vite only |
| `pnpm test` | provider/contract unit tests (fake provider, `tsx --test`) |
| `pnpm typecheck` | client + server tsc |
| `pnpm build` | static client build |

## Provider configuration contract

The only credential is `OPENAI_API_KEY`; it is read in the **server process**
and is never serialized to the browser. The adapter is a single conversational
round trip on the OpenAI **Responses API** (`input_audio` + `output_audio`)
that returns transcript + direction text + direction audio in one call.

| Env var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | **yes** | — | conversational voice provider credential |
| `VOICE_DIRECTOR_MODEL` | no | `gpt-4o-audio-preview` | model supporting audio-in/audio-out |
| `VOICE_DIRECTOR_VOICE` | no | `alloy` | voice for returned audio |
| `VOICE_DIRECTOR_PORT` | no | `8787` | API server port |
| `VOICE_DIRECTOR_ALLOWED_ORIGIN` | no | `http://localhost:5173` | CORS origin |
| `VOICE_DIRECTOR_BASE_URL` | no | `https://api.openai.com/v1` | provider base (proxies/gateways) |
| `VOICE_DIRECTOR_JOB` | no | `Assemble the desk-side drill station.` | fallback job pre-session |
| `SLACK_APP_TOKEN` + `SLACK_BOT_TOKEN` | no | — | enable the Slack bot (both required) |

**Missing credential behavior:** the server boots anyway, `GET /api/health`
reports `provider: "missing-credential"`, and `/api/voice|direct|copilot` return
`503 { error.code: "missing_provider_credential" }` with a message that says
exactly which env var to set. The UI surfaces that as "Coach not configured".
The slice never invents a credential and never treats a CLI/session token as an
application key.

## Realtime relay (full-duplex WebSocket, server-owned session)

Beyond the one-shot HTTP turn there is a **persistent realtime relay** at
`/ws/realtime`, driven by a narrow local protocol (`shared/realtime.ts`) with a
**server-side provider** — either the default OpenAI Realtime session
(`server/realtime/REALTIME.md`) or the parallel **Deepgram Agent** provider
(`server/realtime/DEEPGRAM.md`), selected with
`VOICE_DIRECTOR_REALTIME_PROVIDER=deepgram`. Both share the same runbook
authority (only an explicit `confirm` advances a step) and the same
missing-credential contract. Provider credentials live on the server and never
appear in a local frame; `GET /api/health` reports `realtime` (the selected
provider) and `deepgram` readiness.

## Endpoints

| Route | Body | Returns |
| --- | --- | --- |
| `POST /api/start` | `{ job, positions?[] }` | `{ sessionId, phase, spec }` — runs the voice-coach confirm-back gate |
| `POST /api/voice` | raw WAV bytes + `x-session` header | `{ youSaid, direction, audioBase64, phase, step, targetId?, feedbackSeed }` |
| `POST /api/direct` | `{ sessionId?, job?, text }` | `{ phase, direction }` — text surface (CopilotKit sidecar) |
| `GET /api/scene/:sessionId` | — | `{ runbook, layout }` — versioned task-state + scene payload for a remote Unity process |
| `GET /api/health` | — | provider readiness, no secrets |
| `POST /copilot` | CopilotKit runtime | Copilot sidecar chat (mounted only when credentialed) |
| `WS /ws/realtime` | JSON frames (`shared/realtime.ts`) | full-duplex realtime relay — provider-selected (OpenAI or Deepgram), model/`confirm` runbook |

## Scene / task-state boundary (remote Unity, no local Unity dependency)

The Unity side of the demo runs on another machine and never imports this repo.
The entire contract is `GET /api/scene/:sessionId` — versioned, pure-JSON, and
deterministic:

- **Runbook** (`runbook`, `RunbookState`, `RUNBOOK_VERSION`) — the portable task
  state: confirmed spec, phase, `currentScrew`, and the concise previous turns.
  Adding a step never changes the payload shape; bump `RUNBOOK_VERSION`.
- **Layout** (`layout`, `SceneLayout`, `SCENE_LAYOUT_VERSION`) — the same
  confirmed `ScrewPosition[]` mapped onto a normalized unit grid (`x,y,z` in
  `[-1,1]`) plus a deterministic derived color per target. The browser renders
  it as the scene strip; Unity renders the same coordinates. Same spec +
  `sessionId` → byte-identical payload (`deriveSceneLayout` is pure).
- **Deterministic paired feedback** — every direction turn carries a
  `feedbackSeed` (`feedbackSeed(job, step, direction)`, FNV-1a). One seed drives
  BOTH the audio cue (`cueFromSeed` → the two-note WebAudio blip before the
  spoken direction) and the visual highlight (the active target in the strip, and
  the same highlight Unity applies). No RNG anywhere: same turn → same cue +
  same highlight on every client and run.

## Surfaces (siblings, not nested)

The one capability — *next concise direction* — is served by four flat siblings,
all calling the same `DirectorProvider`:

1. **Voice slice** (`/api/voice`) — the primary path above.
2. **MCP tool** `voice-director.direct` (`server/tool.ts`, typed via
   `@skillio/mcp-protocol`) — the repo's starter-minimal tool shape.
3. **CopilotKit sidecar** — `CopilotPopup` + `useCopilotAction` in `src/VoiceCopilot.tsx`
   calling `/api/direct`; generative-UI card shows the direction. The sidecar runs on the
   **v2 CopilotKit runtime** (`@copilotkit/runtime/v2`): `BuiltInAgent` (`openai/gpt-4o-mini`,
   text chat, same `OPENAI_API_KEY`) behind `createCopilotEndpointExpress`, mounted at
   `/copilot` only when credentialed. The client action uses the 1.71.1 `handler`/`render` API.
4. **Slack bot** — Bolt Socket Mode, `app_mention` → same provider → in-thread reply.
   Starts only when both `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` are set.

Tools live server-side only; the browser never imports server code or holds a
credential.

## Tests

`pnpm test` uses Node's built-in test runner. A **fake provider is defined inside
the test file** and passed straight to the callers — it is unreachable from the
normal product configuration (`createProvider` only ever builds the real OpenAI
adapter). Contract coverage: missing-credential reporting, config defaults, the
round-trip shape, the Responses payload codec, defensive response parsing, and
scene/runbook determinism (identical spec → identical layout, 32-bit stable
hashes, bounded deterministic cues, versioned payloads).

## Inventory — what was reused / deliberately left out

Reused:
- `@skillio/voice-coach` — `createCoach`/`confirmSpec`/`CoachState` (confirm-back gate, phases), `ScrewPosition`.
- `@skillio/mcp-protocol` — `ToolDefinition`/`CallToolResult` typing for the tool surface.
- `hackathon/starter-minimal` shapes — `src/tools.ts` tool-definition + `handleTool` dispatch.
- `hackathon/STACK.md` edit patterns — Slack Socket Mode + pinned CopilotKit trio (the sidecar
  uses the v2 runtime with a `BuiltInAgent` instead of the deprecated `servicesAdapter` API).

Deliberately excluded (see PR summary):
- `apps/web`, `packages/ui` — production surface / shared design system; hackathon rules keep work inside
  `hackathon/<team-folder>/`, and the CopilotKit popup supplies its own UI.
- `packages/mcp-client#callTool` — its shared transport is still a stub
  (`{ ok: true }`), so external consumers call the typed tool route `/api/direct`
  instead of shipping a half-wired client; the tool contract itself is served by `server/tool.ts`.
- `packages/voice-coach` three-stage stubs (`transcribe`/`coachReply`/`speak`) —
  this slice uses one conversational round trip rather than a discrete STT/LLM/TTS pipeline,
  so the stubs are left as the package ships them.

## Demo script (90s)

1. `pnpm dev`, confirm "Assemble the desk-side drill station." (confirm-back gate shown, scene strip renders).
2. Hold to talk: *"put the jig on the bench"* → transcript + direction card render, two-note cue, audio plays,
   the active target pulses in the strip (same `feedbackSeed` drives both).
3. Bay-two: same session, *"torque the top-left screw"* → next direction, state advanced (poll
   `/api/scene/<id>` to watch the runbook + layout advance).
4. Open the Copilot sidecar, type the same ask → the `voice-director.direct` card appears in chat.
5. Optional: drop the two Slack tokens → @mention the bot in any channel, get an in-thread direction.