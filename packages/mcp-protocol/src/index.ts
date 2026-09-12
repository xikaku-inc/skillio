// Shared MCP contract — both client and servers import this.
// Add zod schemas here to prevent drift.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CallToolRequest {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface CallToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}
