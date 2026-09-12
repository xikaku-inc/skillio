# Starting points — code we've begun, where to jump in

> KIT LANDED (task-qpeek ✅): `sources/agents-everywhere-starter-kit/` is vendored.
> Our lane is its **web template** (`apps/web` — OpenAI + CopilotKit React +
> Ambiguous AI, incl. a voice page) with our packages (`voice-coach`,
> `mcp-client/protocol`) supplying the drill-coach specifics. Below stays valid
> as the map of OUR code; treat kit code as inherited starter per its
> `hackathon-rules.md` (new build required — launching a demo as-is doesn't count).

All paths relative to repo root. Nothing below is finished; each entry says
what exists, what's stubbed, and the first command to run.

## 1. Tinkerer MCP tool (`hackathon/starter-minimal/`) — START HERE for new tools
- **Exists:** `package.json`, `src/tools.ts` (one demo tool `my-team.ping` +
  `handleTool`), `widget.tsx` (empty render stub).
- **Stubbed:** everything past the ping round-trip.
- **Start:** `cp -r hackathon/starter-minimal hackathon/<team>`, add your tool
  to `src/tools.ts`, render it in `widget.tsx`.
- **Done when:** `callTool` round-trip works against the mock transport.

## 2. Smallest working example (`hackathon/examples/hello-tool/`)
- **Exists:** `index.ts` with `hello.greet` tool + handler. Read-only reference.
- **Start:** read it, then copy the pattern into your folder. Don't edit in place.

## 3. Voice pipeline + coach (`packages/voice-coach/`) — Trillium's slice
- **Exists:** `TaskSpec` + confirm-back gate, `CoachState` phases
  (setup → confirm-back → coaching → escalated → done), `advanceScrew`,
  pipeline stubs (`transcribe` / `coachReply` / `speak` / `voiceRoundTrip`).
- **Stubbed:** all three pipeline functions throw `not wired` (keys + transport
  land on build day); Klause's anchor side is an opaque `anchorId`.
- **Start:** `pnpm --filter @skillio/voice-coach ...` once wired; until then
  import the types/state machine into your logic.
- **Done when:** full voice loop coaches one real screw (per HACKATHON_BUILD_PLAN).

## 4. MCP contract + client (`packages/mcp-protocol/`, `packages/mcp-client/`)
- **Exists:** `ToolDefinition`, `CallToolRequest/Result` types; `callTool`
  stub returning `{ ok: true }`.
- **Stubbed:** transport (HTTP/SSE), discovery, reconnect.
- **Start:** import types from `@skillio/mcp-protocol`; call via
  `@skillio/mcp-client`. Never import server code into the browser.
- **Done when:** real `callTool` hits `integrations/mcp-servers/*` over HTTP/SSE.

## 5. Reference MCP server (`integrations/mcp-servers/example/`)
- **Exists:** package shell + `tools` array with `example.ping`.
- **Start:** copy the folder per integration (`.../mcp-servers/<service>/`),
  add one file per tool group in `src/tools/`.
- **Done when:** one real tool serves through the client.

## 6. UI shells (`apps/web/`, `packages/ui/`, `apps/site/`)
- **Exists:** `apps/web` empty `App.tsx`; `packages/ui` Button stub;
  `apps/site` full static Vite page (hero, architecture, drill-coach, sponsors)
  deployed to GitHub Pages — use as the static-site reference.
- **Start:** build planning-room UI in `apps/web` (+ CopilotKit decision open);
  keep `packages/ui` dumb (components/tokens only).
- **Done when:** planning room defines a job + confirm-back before anything
  renders in VR.

## Map to the plan
HACKATHON_BUILD_PLAN lives outside this repo (hackathonmate home). Rough map:
Klause → Unity/XR/anchors (nothing in-repo yet); Trillium → items 3+6 here;
shared → items 1/2/4/5.
