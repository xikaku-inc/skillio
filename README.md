# skillio

pnpm monorepo. UI layer + MCP integrations live here; hackathon tinkerer space included.

## Layout

- `apps/web/` — main UI app (React)
- `packages/ui/` — design system (no business logic, no MCP imports)
- `packages/mcp-protocol/` — shared MCP types/schemas (anti-drift layer)
- `packages/mcp-client/` — browser-safe MCP client (HTTP/SSE, never stdio)
- `integrations/mcp-servers/<service>/` — one runnable per integration
- `hackathon/` — AI Tinkerers "Agents Everywhere" build space
  - `EVENT.md` (challenge, schedule, submission, prizes)
  - `STACK.md` (recommended build + playbook)
  - `SPONSORS.md` (sponsor abilities; CopilotKit + Ambiguous.ai primary)
  - `starter-minimal/` (copy-paste starting point), `examples/hello-tool/`

## Quickstart

```bash
pnpm install
pnpm --filter @skillio/web dev
# tinkerers:
cp -r hackathon/starter-minimal hackathon/my-team && cd hackathon/my-team
```

## Conventions

- UI renders state; `apps/web → packages/ui` one direction.
- Browser calls MCP over HTTP/SSE via `mcp-client`; types from `mcp-protocol`.
- One tool = one file. New integration = new folder under `mcp-servers/`.
- Tinkerers stay inside `hackathon/<their-folder>/`.

See `CONTRIBUTORS.md`, `hackathon/README.md`.
