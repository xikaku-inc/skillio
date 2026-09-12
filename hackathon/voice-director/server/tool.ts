// The shared MCP capability for this slice, in the repo's starter-minimal shape:
// a ToolDefinition (typed via @skillio/mcp-protocol) + a handleTool dispatch.
//
// `voice-director.direct` is the one tool: turn a text instruction into the next
// concise assembly direction. The express API (POST /api/direct) and the Slack
// bot route through the same handler so every surface shares one behavior.
import type { CallToolResult, ToolDefinition } from '@skillio/mcp-protocol';
import { MissingCredentialError, ProviderError } from './config';
import { buildCoachPrompt, type DialogueLine, type DirectorProvider } from './director';

export const directorTools: ToolDefinition[] = [
  {
    name: 'voice-director.direct',
    description:
      'Get the next concise, spoken-style assembly direction from a text instruction. Returns { direction: string }.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What the operator just said or asked.' },
        job: {
          type: 'string',
          description: 'Assembly job being coached. Defaults to the active session job.',
        },
      },
      required: ['text'],
    },
  },
];

export interface ToolContext {
  provider: DirectorProvider;
  getJob: () => string;
  getPhase: () => string;
  getPrevious: () => DialogueLine[];
}

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<CallToolResult> {
  if (name === 'voice-director.direct') {
    const text = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : null;
    if (!text) {
      return { ok: false, error: { code: 'invalid_args', message: 'direct requires a non-empty "text" string.' } };
    }
    const job = typeof args.job === 'string' && args.job.trim() ? args.job.trim() : ctx.getJob();
    const prompt = buildCoachPrompt({ job, phase: ctx.getPhase(), previous: ctx.getPrevious() });
    try {
      const { direction } = await ctx.provider.directText({ text, job, phase: ctx.getPhase(), previous: ctx.getPrevious() });
      return { ok: true, data: { direction, prompt } };
    } catch (err) {
      if (err instanceof MissingCredentialError) {
        return { ok: false, error: { code: 'missing_provider_credential', message: err.message } };
      }
      if (err instanceof ProviderError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      return {
        ok: false,
        error: { code: 'provider_error', message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
  return { ok: false, error: { code: 'unknown_tool', message: `unknown tool: ${name}` } };
}