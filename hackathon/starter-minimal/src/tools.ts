import type { ToolDefinition } from '@skillio/mcp-protocol';

// 1. Define your tool here. One tool = one entry. Keep it tiny.
export const tools: ToolDefinition[] = [
  { name: 'my-team.ping', description: 'Replace me with your tool', inputSchema: {} },
];

// 2. Implement it here. Must return JSON-serializable data.
export async function handleTool(name: string, args: Record<string, unknown>) {
  void args;
  if (name === 'my-team.ping') return { pong: true };
  throw new Error(`unknown tool: ${name}`);
}
