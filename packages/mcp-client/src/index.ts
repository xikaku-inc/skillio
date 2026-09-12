import type { CallToolRequest, CallToolResult } from '@skillio/mcp-protocol';

// Browser-safe client. Talks HTTP/SSE to servers, never stdio.
export async function callTool<T>(req: CallToolRequest): Promise<CallToolResult<T>> {
  // TODO: wire transport
  void req;
  return { ok: true, data: undefined };
}
