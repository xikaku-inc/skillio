import type { ToolDefinition } from '@skillio/mcp-protocol';

export const tools: ToolDefinition[] = [
  { name: 'example.ping', description: 'Reference tool', inputSchema: {} },
];

// TODO: add stdio/SSE entry. Copy this folder per integration.
