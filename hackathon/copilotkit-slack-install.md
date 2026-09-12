# Install Guide — CopilotKit agent into Slack

Source: `sources/agents-everywhere-starter-kit` (vendored).
Template used: `apps/channel` — OpenAI + CopilotKit Channels + Exa.
Managed path needs **no public tunnel and no Slack app token**.

## 0. Prerequisites

- Node.js 22+
- A Slack workspace where you can install apps
- Keys: OpenAI (`OPENAI_API_KEY`), CopilotKit Intelligence project key
  (`INTELLIGENCE_API_KEY`), Exa (`EXA_API_KEY`)
- Work from the kit root: `cd sources/agents-everywhere-starter-kit`

## 1. Install + env

```bash
npm ci
cp .env.example .env
```

Fill in root `.env`:

```dotenv
MODEL_PROVIDER=openai
OPENAI_API_KEY=your-key
MODEL=gpt-5.6-sol
CHANNEL_CODE=your-channel-code
INTELLIGENCE_API_KEY=your-project-key
EXA_API_KEY=your-key
EXA_SEARCH_TYPE=fast
```

Pick a model available to your account. (OpenRouter works instead of OpenAI —
see kit `using-sponsor-tools.md#openrouter`.) Restart processes after env changes.

## 2. Create the Channel (pick ONE path)

### A. Guided path (recommended, ~10 min)

```bash
npm run channel:setup -- --no-clipboard
```

This installs the maintained `channels-setup` skill and prints a prompt. Give
that prompt to your coding agent **in this checkout**, specify **Slack** and the
existing `apps/channel` app, and let the agent walk the skill through sign-in,
project/Channel configuration, Slack installation, and a real reply.
The command alone does **not** create the Channel — the agent run does.
Keep existing `.env` values; the listener reads `CHANNEL_CODE` + `INTELLIGENCE_API_KEY`.

Reference: kit `dev-docs/channels-sdk-walkthrough/README.md` (screenshots).

### B. Manual path

Create the Channel **before** the Slack app so the wizard generates the right manifest:

```bash
npx copilotkit@latest channels add --name my-agent \
  --display-name "My Agent" --adapter slack --json
```

1. Complete platform setup + Slack installation in the wizard.
2. Copy the Channel **Code** → `CHANNEL_CODE` in root `.env`.
3. Create a project-scoped Intelligence API key → `INTELLIGENCE_API_KEY`.
4. Check status: `npm run channel:status`

## 3. Run the listener

```bash
npm run dev:slack
```

CopilotKit Intelligence holds the Slack connection and delivers over an
outbound socket — the listener just stays running. Use a **separate
Intelligence project for local vs deployed**; two listeners on one Channel
compete for deliveries.

## 4. Verify in Slack

1. `/invite @yourbot` to a channel.
2. Add 2–3 facts to a thread, then mention the bot **inside the thread**.
3. Ask it to catch up using the thread + render a card — confirm facts came
   from earlier messages, not your last prompt.
4. Ask a research question — `search_web` posts native **Search sources** cards;
   open links, separate published evidence from thread facts.
5. Ask a follow-up relying on the discussion; confirm answer stays in-thread.

Exact inputs: kit `dev-docs/demo-prompts.md#slack-context-sources-card-follow-up`.
Offline checks only: `npm run verify` (typechecks + unit tests, no live calls).

## 5. Make it ours (drill-coach mapping)

| Kit piece | File | Our adaptation |
|---|---|---|
| Agent + model | `packages/agent-core/src/agent.ts` | keep, swap model string |
| Channel lifecycle | `apps/channel/src/channel.tsx` | keep mention/subscribe flow |
| Thread context + research | `apps/channel/src/tools.tsx`, `src/search.tsx` | keep `read_thread` + Exa; add drill status tool if Slack mirrors the coach |
| Native cards | `apps/channel/src/components.tsx` | replace incident card with drill/progress card |
| Prompt | `packages/agent-core/src/prompt.ts` | replace incident wording with our workflow |

Before changing Slack code, read kit `.agents/skills/build-channels-agent/SKILL.md`
— it holds the verified API vocabulary. Keep the pinned Channels/runtime pair
and the `@ag-ui/client` override. If you add an external write, enforce
approval in code first (proposal card pattern, no silent production actions).

## Troubleshooting pointers

- `npm run channel:status` — Channel health.
- Deliveries missing? Check for a second listener on the same Channel.
- Env changed? Restart `dev:slack`.
- More: kit `dev-docs/troubleshooting.md`, `dev-docs/surfaces.md`.
