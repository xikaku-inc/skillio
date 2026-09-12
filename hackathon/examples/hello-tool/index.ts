import type { ToolDefinition } from '@skillio/mcp-protocol';

export const tools: ToolDefinition[] = [
  { name: 'hello.greet', description: 'Smallest working tool', inputSchema: {} },
];

export async function handleTool(name: string) {
  if (name === 'hello.greet') return { message: 'hello, tinkerer!' };
  throw new Error(`unknown tool: ${name}`);
}
