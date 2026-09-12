# Stack playbook — Agents Everywhere (4h15 build)

> Method note: all 5 briefs were compiled from model knowledge (cutoff 2026-01-04)
> — researchers had NO web tools in this run. Every URL/claim below is
> UNVERIFIED. Verify docs + versions + pricing on build day before committing.
> Full briefs: subagent-artifacts/outputs/2af1d0c8…/ (`copilotkit.md`,
> `models-search.md`, `jobs-auth.md`, `ambiguous-mozilla.md`, `openai-strategy.md`).

## Recommended build (UI + MCP side)

**Slack triage agent + in-app Copilot sidebar.** Slack is fastest to demo
(Socket Mode, no ngrok); CopilotKit sidebar is the Best-Use prize lane.
One context, one loop, one trace in the 2-min video.

```
Slack channel (Bolt, Socket Mode)
  → OpenAI Responses API + gpt-4o-mini (function calling, 2–3 tools)
    → our MCP servers (integrations/mcp-servers/*) via packages/mcp-client
      → Exa search (exa_search / exa_contents) for grounding
  → CopilotKit sidebar in apps/web (useCopilotAction + 1 generative-UI card)
  → long jobs on Trigger.dev (retry), login via Auth0 Universal Login
  → Ambiguous AI workspace identity as stretch (Best Use → DGX Spark)
```

## Per-sponsor fast path

1. **OpenAI** — Responses API + function calling on `gpt-4o-mini`. Skip Agents SDK
   unless you need handoffs. Realtime voice only with typed-chat fallback
   (venue wifi is the #1 demo killer). Docs: platform.openai.com/docs,
   /api-reference/responses, /guides/function-calling, /guides/mcp, /guides/realtime.
2. **CopilotKit** (Best Use → AirPods Max) — `@copilotkit/react-core` +
   `@copilotkit/react-ui` + Express `CopilotRuntime`. 1 `useCopilotReadable` +
   1–2 `useCopilotAction` with `render:` card wired to `packages/mcp-client`.
   Pin all three pkgs to same version. Judges want to SEE the app mutate.
   Docs: docs.copilotkit.ai, /ag-ui, /mcp. Don't claim A2A (unverified).
3. **OpenRouter** — OpenAI-compatible gateway; pin `PRIMARY=openai/gpt-4o-mini`,
   `FALLBACK=google/gemini-flash-1.5`-class; `:free` models fallback-only
   (rate-limited, vanish mid-event). Server-side only, never in React bundle.
   Verify IDs on openrouter.ai/models day-of.
4. **Exa** — `exa-js`: `search({numResults:5, text:true})` then `getContents`
   top ≤3. Wrap as MCP tools `exa_search` / `exa_contents`. Cap agent at 3–4
   tool steps; cache results. Check exa.ai/pricing free tier day-of.
5. **Trigger.dev** — v3 `task()` + `tasks.trigger()` with retry 3–5 for all long
   AI work; thin Next.js routes return `runId`, poll 1.5s. One `trigger/` dir at
   root, `npx trigger.dev@latest dev` alongside web dev. Don't self-host.
6. **Auth0** — Universal Login + `@auth0/nextjs-auth0`, Google social with dev
   keys (~15 min). Gate `/demo`, pass `user.sub` as sessionId. Skip custom login
   UI, MCP OAuth, FGA. Token Vault only if agent calls Google/GitHub as the user.
7. **Ambiguous AI** (Best Use → DGX Spark) — agent identity inside the 17-app
   workspace (mail → doc → CRM → chat summary). UNVERIFIED quickstart: budget
   first 20 min at doors-open to run their <1-min CLI/MCP onboarding; fallback
   to Exa/OpenRouter loop if auth stalls. One workspace-native loop > 5 tools.
8. **Mozilla.ai** — supporting trust/transparency layer only (visible trace/log
   in video). Not the demo centerpiece in 4h15. Library pick UNVERIFIED.

## Monorepo mapping

| Need | Where |
|------|-------|
| Copilot provider/sidebar | `apps/web` (+1 component file) |
| Runtime endpoint | `hackathon/<team>/server.ts` (don't touch prod) |
| MCP tools | `integrations/mcp-servers/*` (copy `example/`) |
| Typed calls | `packages/mcp-client` via `packages/mcp-protocol` |
| UI cards | `packages/ui` |
| Long jobs | root `trigger/` (single project) |
| Tinkerer start | `hackathon/starter-minimal/` (tools.ts + widget.tsx) |

## Scope freeze (by 13:00)

- 1 readable + 2 actions + 1 generative-UI card. ≤4 flat params per action.
- Handlers return strings. `styles.css` imported. CORS on for Vite:5173→:4000.
- One golden-path query pre-scripted. Canned GIF + stub-handler fallback ready.

## Hour 0–1 checklist

- [ ] Pin model IDs (`/models`), Exa params, CopilotKit versions; freeze
- [ ] `OPENROUTER_API_KEY`, `EXA_API_KEY`, `OPENAI_API_KEY` server-side only
- [ ] Trigger `dev` running, one task with retry, `runId` poll UI
- [ ] Auth0 tenant + Google social + `/demo` gated
- [ ] Ambiguous <1-min onboarding attempted (timebox 20 min)
- [ ] Backup video filming plan + social-post draft with sponsor tags

## 2-min video shape

0:00–0:15 hook (who + where the agent lives) → 0:15–1:30 one live end-to-end
task with a visible retry → 1:30–2:00 why embedded context mattered + repo URL.
Cold-open in Slack/app, no slides >10s, captions on.
