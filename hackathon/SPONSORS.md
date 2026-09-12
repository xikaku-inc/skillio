# Sponsors — abilities + where they plug into skillio

> URLs/claims marked UNVERIFIED (researchers had no web tools; model knowledge
> cutoff 2026-01-04). Verify docs + pricing on build day.
> Primary bets first: **CopilotKit** + **Ambiguous.ai**.

## Primary (our integrations)

### 1. CopilotKit — in-app agent UI ⭐ primary
**Abilities:** React copilot components (`<CopilotSidebar>` / Chat / Popup);
agent sees app state (`useCopilotReadable`); agent mutates app
(`useCopilotAction` + `render:` generative-UI cards); streams any backend via
AG-UI protocol; `CopilotRuntime` backend exposes MCP-server tools to chat.
**Use it for:** the visible agent inside `apps/web` — "watch the app, not me"
demo (reads tickets, calls action, renders card, list updates).
**Plugs into:** `apps/web` (provider + 1 component), `packages/ui` (cards),
`packages/mcp-client` (actions call MCP tools), `hackathon/<team>/server.ts`
(Express runtime, `OPENAI_API_KEY` server-side only).
**Prize:** Best Use of CopilotKit → purple AirPods Max/member.
**Docs (verify):** https://docs.copilotkit.ai, /ag-ui, /mcp.
**Cautions:** pin react-core/react-ui/runtime to same version; flat ≤4-param
schemas; handlers return strings; don't claim A2A (unverified).

### 2. Ambiguous AI — agent workspace identity ⭐ primary
**Abilities:** 17-app workspace (Docs, Mail, Chat, Sheets, CRM, Calendar, …);
each AI coworker has its own identity on shared data; interact via email, chat
message, task assignment, @mention; agents onboard via CLI or MCP in <1 min;
free for teams ≤5.
**Use it for:** the "belongs somewhere new" story — one loop, e.g. triage
incoming mail → draft doc → log CRM row → post chat summary. Show the real
trace in the 2-min video, not a chat window.
**Plugs into:** `integrations/mcp-servers/ambiguous/` (new server shim),
`packages/mcp-client` (typed calls), `packages/ui` (trace view),
`hackathon/starter-minimal/` (start here, ship ONE tool in ONE context).
**Prize:** Best Use of Ambiguous AI → NVIDIA DGX Spark.
**Docs (UNVERIFIED):** https://www.ambiguous.ai/ — exact CLI/MCP quickstart
unknown; timebox first 20 min at doors-open, fallback to Exa/OpenRouter loop.
**Cautions:** auth/scopes/rate limits unknown until onboarding runs.

## Supporting (use what helps)

### 3. OpenAI — models + agent APIs
Realtime/Responses APIs, function calling, hosted tools, MCP-as-tool-source,
voice/vision. Default: Responses API + `gpt-4o-mini` (fast/cheap/reliable tool
calls); `gpt-4o` for vision/voice quality. Realtime only with typed-chat
fallback. Prizes: $10k / $5k / $2.5k credits + hardware by place.

### 4. OpenRouter — multi-model gateway
One OpenAI-compatible endpoint, swap models by string; `:free` variants for
zero-cost testing (rate-limited — fallback only). Pin PRIMARY + FALLBACK,
server-side keys only. Verify IDs on openrouter.ai/models day-of.

### 5. Exa — agent search
`/search` (find URLs) + `/contents` (clean text extracts), `exa-js` SDK.
Wrap as MCP tools `exa_search` / `exa_contents`; search-first, ≤3 contents,
cache results. Credits + swag for top teams; check exa.ai/pricing free tier.

### 6. Trigger.dev — background jobs
v3 `task()` + `tasks.trigger()` with retries for long AI work (LLM calls, MCP
fanout); thin routes return `runId`, poll UI. One root `trigger/` dir, cloud +
`dev` tunnel (don't self-host). Generous free tier (verify).

### 7. Auth0 — login + agent tokens
Universal Login + `@auth0/nextjs-auth0`, Google social (~15 min). Gate `/demo`,
pass `user.sub` as sessionId. Token Vault can hold user OAuth (Google/GitHub/
Slack) for agent-as-user calls; MCP-OAuth/FGA = skip in 4h15. Free plan
historically 25k MAUs (verify).

### 8. Mozilla.ai — trustworthy-AI tooling
Open-source tools for transparent/controllable AI. Supporting layer only
(visible trace/log in video), not the demo centerpiece. Library pick UNVERIFIED.

### Local hosts
**Timepoint** (Sean, timepointai.com) + **Oxen** (Greg, oxen.ai) — venue,
mentors, day-of help. No formal local judging; global pool only.

## Cheat table

| Sponsor | Gives the demo | Monorepo home | Prize lane |
|---------|---------------|---------------|------------|
| CopilotKit ⭐ | in-app sidebar + actions | `apps/web`, `packages/ui` | Best Use |
| Ambiguous ⭐ | workspace identity/loop | `integrations/mcp-servers/ambiguous/` | Best Use |
| OpenAI | reasoning + tools + voice | server-side only | 1st/2nd/3rd |
| OpenRouter | cheap model swap | server routes | — |
| Exa | grounded search | `exa_search` MCP tools | credits/swag |
| Trigger.dev | retries + long runs | root `trigger/` | — |
| Auth0 | login in 15 min | `apps/web` gate | — |
| Mozilla.ai | trust/trace layer | supporting | — |
