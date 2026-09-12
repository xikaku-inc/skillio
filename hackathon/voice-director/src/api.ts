// Thin client for the voice-director server. Same-origin in dev via the Vite
// proxy (/api -> localhost server); provider credentials never appear here.
import type {
  ApiResponse,
  ApiError,
  DirectRequest,
  DirectResponse,
  HealthResponse,
  SceneResponse,
  StartRequest,
  StartResponse,
  VoiceResponse,
} from '../shared/protocol';

async function parse<T>(res: Response): Promise<ApiResponse<T>> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const j = (await res.json()) as Partial<ApiError>;
      message = j?.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, error: { code: `http_${res.status}`, message } };
  }
  return (await res.json()) as T;
}

async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'network_error', message: err instanceof Error ? err.message : String(err) },
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

export function isError<T extends { ok: boolean }>(r: ApiResponse<T>): r is ApiError {
  return r.ok === false;
}

export async function fetchHealth(): Promise<ApiResponse<HealthResponse>> {
  return parse<HealthResponse>(await safeFetch('/api/health'));
}

export async function startSession(req: StartRequest): Promise<ApiResponse<StartResponse>> {
  return parse<StartResponse>(
    await safeFetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
}

export async function sendVoice(sessionId: string, wav: Blob): Promise<ApiResponse<VoiceResponse>> {
  return parse<VoiceResponse>(
    await safeFetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'x-session': sessionId },
      body: wav,
    }),
  );
}

export async function sendDirect(req: DirectRequest): Promise<ApiResponse<DirectResponse>> {
  return parse<DirectResponse>(
    await safeFetch('/api/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
}

export async function fetchScene(sessionId: string): Promise<ApiResponse<SceneResponse>> {
  return parse<SceneResponse>(await safeFetch(`/api/scene/${encodeURIComponent(sessionId)}`));
}

export function audioFromBase64(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}