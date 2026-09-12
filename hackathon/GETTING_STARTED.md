# Getting started — hackathon in 15 minutes

You are in `hackathon/`, the AI Tinkerers "Agents Everywhere" build space.
Read top to bottom; stop when you're building.

## 1. What are we building? (3 min)

Read `EVENT.md`: the challenge (agents that belong somewhere new, not a chat
window), the schedule (build 11:15–15:30, submit by 16:00), the 5 submission
items, and the prizes.

Our answer: a **voice-guided drill coach** — Vision Pro projects crosshairs
onto real wood and talks you through each screw. Klause owns hardware/anchors,
Trillium owns voice/UI/vibe. Full plan lives outside this repo (hackathonmate
home, `HACKATHON_BUILD_PLAN.md`); our lane details are in `STACK.md`.

## 2. What do we get for free? (4 min)

Read `SPONSORS.md`. Primary bets: **CopilotKit** (in-app agent UI) +
**Ambiguous.ai** (workspace identity). Supporting: OpenAI, OpenRouter, Exa,
Trigger.dev, Auth0, Mozilla.ai.

Then know the kit: `sources/agents-everywhere-starter-kit/` (vendored
official starter). Our lane is its **web template** (OpenAI + CopilotKit React
+ Ambiguous AI, voice page included). Rules note: starter code is inherited —
the core interaction must be built during the event.

## 3. Where is our code? (3 min)

Read `starting-point/README.md` — the index of everything in progress, each
with exists/stubbed/start/done. Short version:

| You want to… | Go to… |
|---|---|
| Add an MCP tool fast | `starter-minimal/` (copy → `hackathon/<team>/`) |
| See the smallest example | `examples/hello-tool/` |
| Work the voice loop | `packages/voice-coach/` (repo root) |
| Add an MCP server | `integrations/mcp-servers/example/` (repo root) |
| Build planning-room UI | `apps/web/` (repo root; CopilotKit decision open) |
| Install Slack agent | `copilotkit-slack-install.md` (this folder) |

## 4. Run something (5 min)

```bash
# repo setup (from repo root)
pnpm install
pnpm --filter @skillio/web dev

# tinkerer path: copy the starter, add one tool
cp -r hackathon/starter-minimal hackathon/my-team

# kit path: official templates (npm, Node 22+, separate checkout semantics)
cd sources/agents-everywhere-starter-kit
npm ci && cp .env.example .env
npm run dev:web        # web template
npm run dev:slack      # Slack template (after copilotkit-slack-install.md)
```

## 5. Submit (day-of)

Track rows in `SUBMISSIONS.md`. The kit's `SUBMISSION.md` is the fill-in
checklist (inherited-vs-created log, clean-clone quickstart, live checks,
no credentials in repo/video). Global pool, one working demo beats breadth.
