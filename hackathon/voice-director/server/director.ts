// The "conversational voice API" provider boundary.
//
// One adapter turns client audio into (a) what the operator said, (b) the
// next concise direction, and (c) provider audio of that direction, through a
// SINGLE round trip to the provider's conversational voice endpoint. There is
// deliberately no local STT/TTS stage and no offline fallback — the slice is
// API-only by contract.
//
// The default provider is the OpenAI Responses API with input_audio +
// output_audio. The wire codec (renderResponsesRequest / parseResponsesResponse)
// is factored out as pure functions so provider-adjacent behavior is testable
// without a network call or a real credential.
import { MissingCredentialError, ProviderError, requireApiKey, type DirectorConfig } from './config';

export interface DialogueLine {
  youSaid: string;
  direction: string;
}

export interface DirectorRoundTrip {
  youSaid: string;
  direction: string;
  audio: Uint8Array;
}

export interface DirectorContext {
  job: string;
  phase: string;
  previous: DialogueLine[];
}

/** Capability used by every surface — the express API, the MCP tool, Slack, CopilotKit. */
export interface DirectorProvider {
  name: string;
  directAudio(ctx: DirectorContext & { audio: Uint8Array; mime: string }): Promise<DirectorRoundTrip>;
  directText(ctx: DirectorContext & { text: string }): Promise<{ direction: string }>;
}

export interface ProviderSettings {
  apiKey: string;
  model: string;
  voice: string;
  baseUrl: string;
}

const DEFAULT_SYSTEM_VOICE = 'alloy';

export function buildCoachPrompt(ctx: Omit<DirectorContext, 'phase'> & { phase: string }): string {
  const history = ctx.previous
    .map((l, i) => `${i + 1}. you: "${l.youSaid}" -> directed: "${l.direction}"`)
    .join('\n');
  return [
    'You are the voice director for a hands-on assembly job:',
    `"${ctx.job}"`,
    '',
    'Coach the operator in one short, spoken sentence per turn — one clear direction at a time.',
    'Be concise: directions only, no filler, no disclaimers, no markdown.',
    `Current coaching phase: ${ctx.phase}.`,
    history ? `So far (most recent last):\n${history}` : 'No turns yet.',
    'Give the next concise direction now.',
  ].join('\n');
}

function formatFromMime(mime: string): 'wav' | 'mp3' {
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  return 'wav';
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export interface ResponsesRequestOpts {
  mode: 'audio' | 'text';
  /** mode === 'audio' */
  audio?: Uint8Array;
  mime?: string;
  /** mode === 'text' */
  text?: string;
  prompt: string;
}

export interface RenderedResponseRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function renderResponsesRequest(
  settings: ProviderSettings,
  opts: ResponsesRequestOpts,
): RenderedResponseRequest {
  const inputContent =
    opts.mode === 'audio'
      ? [
          {
            type: 'input_audio',
            input_audio: {
              data: toBase64(opts.audio ?? new Uint8Array()),
              format: formatFromMime(opts.mime ?? 'audio/wav'),
            },
          },
        ]
      : [{ type: 'input_text', text: opts.text ?? '' }];
  const body = {
    model: settings.model,
    instructions: opts.prompt,
    store: false,
    include: ['*.transcript'],
    input: [{ role: 'user', content: inputContent }],
    text: { format: { type: 'text' } },
    output_audio: { voice: settings.voice || DEFAULT_SYSTEM_VOICE, format: 'wav' },
  };
  return {
    url: `${settings.baseUrl}/responses`,
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function scanForTranscript(records: unknown): string {
  if (!Array.isArray(records)) return '';
  for (const item of records) {
    if (item && typeof item === 'object' && Array.isArray((item as { content?: unknown }).content)) {
      for (const c of (item as { content: Array<Record<string, unknown>> }).content) {
        if (!c || typeof c !== 'object') continue;
        if (typeof c.transcript === 'string' && c.transcript) return c.transcript;
        const nested = c.input_audio as { transcript?: unknown } | undefined;
        if (nested && typeof nested.transcript === 'string' && nested.transcript) {
          return nested.transcript;
        }
      }
    }
  }
  return '';
}

export interface ParsedResponses {
  youSaid: string;
  direction: string;
  audio: Uint8Array | null;
}

/** Parse an OpenAI Responses API payload into the three things the UI needs. */
export function parseResponsesResponse(json: {
  output_text?: unknown;
  input?: unknown;
  output?: unknown;
}): ParsedResponses {
  const direction = typeof json.output_text === 'string' ? json.output_text : '';
  const youSaid = scanForTranscript(json.input) || scanForTranscript(json.output);
  let audio: Uint8Array | null = null;
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (!item || typeof item !== 'object' || item.type !== 'message') continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c && typeof c === 'object' && (c as { type?: unknown }).type === 'output_audio') {
          const data = (c as { data?: unknown }).data;
          if (typeof data === 'string' && data) audio = Buffer.from(data, 'base64');
          break;
        }
      }
      if (audio) break;
    }
  }
  return { youSaid, direction, audio };
}

export class OpenAiResponsesProvider implements DirectorProvider {
  readonly name = 'openai-responses';
  constructor(private readonly cfg: DirectorConfig) {}

  private settings(): ProviderSettings {
    return {
      apiKey: requireApiKey(this.cfg),
      model: this.cfg.model,
      voice: this.cfg.voice,
      baseUrl: this.cfg.baseUrl,
    };
  }

  async directAudio(
    ctx: DirectorContext & { audio: Uint8Array; mime: string },
  ): Promise<DirectorRoundTrip> {
    const request = renderResponsesRequest(this.settings(), {
      mode: 'audio',
      audio: ctx.audio,
      mime: ctx.mime,
      prompt: buildCoachPrompt(ctx),
    });
    const parsed = await this.post(request);
    if (!parsed.audio || parsed.audio.byteLength === 0) {
      throw new ProviderError(
        'provider_no_audio',
        `The conversational voice provider returned no audio for model "${this.cfg.model}". ` +
          'Pick an audio-capable model via VOICE_DIRECTOR_MODEL (see hackathon/voice-director/README.md).',
      );
    }
    return { youSaid: parsed.youSaid, direction: parsed.direction, audio: parsed.audio };
  }

  async directText(ctx: DirectorContext & { text: string }): Promise<{ direction: string }> {
    const request = renderResponsesRequest(this.settings(), {
      mode: 'text',
      text: ctx.text,
      prompt: buildCoachPrompt(ctx),
    });
    const parsed = await this.post(request);
    return { direction: parsed.direction };
  }

  private async post(req: RenderedResponseRequest): Promise<ParsedResponses> {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
    if (!res.ok) {
      const detail = await safeBodyText(res);
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(
          'provider_unauthorized',
          `The configured provider credential (OPENAI_API_KEY) was rejected (HTTP ${res.status}). ${detail}`,
        );
      }
      throw new ProviderError(
        `provider_http_${res.status}`,
        `Conversational voice API call failed (HTTP ${res.status}). ${detail}`,
      );
    }
    const json = (await res.json()) as Parameters<typeof parseResponsesResponse>[0];
    const parsed = parseResponsesResponse(json);
    if (!parsed.direction) {
      throw new ProviderError(
        'provider_no_direction',
        'The conversational voice API returned no direction text. Check VOICE_DIRECTOR_MODEL.',
      );
    }
    return parsed;
  }
}

async function safeBodyText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text ? text.slice(0, 300) : '(empty response body)';
  } catch {
    return '(unreadable response body)';
  }
}

/**
 * Builds the real provider. Resolves the credential lazily at call time so the
 * server can boot and report `missing-credential` health / 503 errors instead
 * of inventing or guessing a credential. test-only fake providers are defined
 * in tests and never flow through this factory.
 */
export function createProvider(cfg: DirectorConfig): DirectorProvider {
  return new OpenAiResponsesProvider(cfg);
}

export { MissingCredentialError };