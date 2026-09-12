# Agents Everywhere — AI Tinkerers Global Hackathon (LA)

Source: clipboard 2026-09-12 → `/tmp/hackathon-reqs.txt`
Event page: https://la.aitinkerers.org/p/agents-everywhere-bots-channels-more-global-hackathon

## Challenge

> Most agents still wait inside a separate chat window. Build a working agent that belongs somewhere new.

Pick ONE context where people already work. Examples (not tracks — single global pool):

- **At work:** Slack, Teams, email, docs, calendars, tickets, support, live collab
- **In your pocket:** messaging, mobile, notifications, short async moments
- **On the web:** browser agent that researches, navigates, transacts, takes action
- **In the room:** voice, vision, wearables, robotics, physical-world

## Schedule (build day)

| Time | What |
|------|------|
| 10:00–10:30 | Doors, food, check-in, meet teammates |
| 10:30–11:00 | Global opening + starter-kit walkthrough |
| 11:00–11:15 | Team formation |
| **11:15–15:30** | **Build (~4h15)** |
| 15:30–16:00 | Submit in portal (hard deadline) |
| 16:00–16:45 | Local show-and-tell (no formal local judging) |
| 16:45–17:00 | Wrap + photo |

## Submission (all 5 required)

1. **Title** — clear name
2. **Description** — what you built, who it's for, **why the context matters**
3. **Public GitHub repo** — working code, reviewable
4. **2-min video** — concise demo in action
5. **Social post** — public, tags event sponsors

Rule: sharp working demo > broad concept.

## Stack (use what helps, not everything)

- **OpenAI** — frontier models + credits
- **CopilotKit** — in-app actions, generative UI, AG-UI / MCP / A2A (→ Best Use prize)
- **OpenRouter** — multi-model gateway, anti-lock-in
- **Exa** — search infra for agents
- **Trigger.dev** — background jobs, retries, long-running AI workloads
- **Auth0** — auth for web/mobile/AI apps
- **Mozilla.ai** — open-source trustworthy-AI tooling
- **Ambiguous AI** — 17-app workspace (Docs/Mail/Chat/Sheets/CRM/Calendar), CLI/MCP in <1min (→ Best Use prize)
- Local: **Timepoint** (Sean), **Oxen** (Greg)

## Prizes (global, all cities + virtual)

- **1st:** $10k OpenAI credits + Mac mini/member + $1k Exa + swag
- **2nd:** $5k OpenAI credits + Ray-Ban Metas/member + $500 Exa + swag
- **3rd:** $2.5k OpenAI credits + LOOI Robot/member + $250 Exa + swag
- **Best Use Ambiguous AI:** NVIDIA DGX Spark
- **Best Use CopilotKit:** purple AirPods Max/member

## Strategy for skillio (UI + MCP side)

- Win on **context + demo**: agent living in Slack/browser/voice with a 90-sec
  working trace beats a chat window with 10 tools.
- Our edge: `packages/mcp-client` (typed tool calls) + `packages/ui`
  (generative UI) + one reference `integrations/mcp-servers/*`.
- Tinkerers: copy `hackathon/starter-minimal/`, ship ONE tool in ONE context.
