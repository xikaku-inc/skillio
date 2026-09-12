# skillio hackathon — AI tinkerers start here

Build a mini MCP integration + UI in < 30 min. No monorepo knowledge needed.

## Layout

```
hackathon/
  README.md              # this file
  starter-minimal/       # copy-paste MCP server + UI widget
  examples/
    hello-tool/          # smallest working tool
  SUBMISSIONS.md         # where to list your team + demo link
```

## 5-min quickstart

1. Copy the starter:
   ```bash
   cp -r hackathon/starter-minimal hackathon/my-team-name
   cd hackathon/my-team-name
   ```
2. Define your tool in `src/tools.ts` (see `examples/hello-tool`).
3. Test it: `pnpm dev` — hits the local mock transport, no creds needed.
4. Add your row to `SUBMISSIONS.md`.

## Rules of the road

- Only touch files inside `hackathon/<your-folder>/`. Everything else is off-limits.
- Import types from `@skillio/mcp-protocol`, call via `@skillio/mcp-client`.
  Never import from `apps/` or other servers.
- One tool = one file in `src/tools/`. Keep schemas small (zod).
- UI widget goes in `widget.tsx` using `@skillio/ui` components only.

## Judging

Working `callTool` round-trip > clever idea. Show the trace in your demo.
