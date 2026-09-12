// voice-director server: the localhost API boundary for the voice slice.
//
//   POST /api/start   { job, positions? }        -> { sessionId, phase, spec }
//   POST /api/voice   raw WAV body + x-session   -> { youSaid, direction, audioBase64 }
//   POST /api/direct  { sessionId?, job?, text } -> { phase, direction }
//   GET  /api/scene/:sessionId                   -> { runbook, layout } (remote Unity gate)
//   GET  /api/health                             -> provider readiness (no secrets)
//   POST /copilot                                -> CopilotKit runtime (chat sidecar)
//
// Provider credentials (OPENAI_API_KEY et al.) are read into this process only;
// they are never computed into client responses or bundled into the browser.
// A missing credential is reported via health + explicit 503 codes — never invented.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { BuiltInAgent, CopilotRuntime, createCopilotEndpointExpress } from '@copilotkit/runtime/v2';
import { confirmSpec, createCoach, type CoachPhase, type CoachState, type ScrewPosition } from '@skillio/voice-coach';
import { MissingCredentialError, ProviderError, loadConfig, type DirectorConfig } from './config';
import { createProvider, type DialogueLine, type DirectorProvider } from './director';
import { startSlack } from './slack';
import { deriveSceneLayout, feedbackSeed, RUNBOOK_VERSION, type RunbookState } from '../shared/scene';
import { attachRealtimeRelayServer, REALTIME_WS_PATH } from './realtime/ws-server';

import type {
  ApiError,
  StartRequest,
  StartResponse,
  VoiceResponse,
  DirectResponse,
  DirectRequest,
  HealthResponse,
  SceneResponse,
} from '../shared/protocol';

interface Session {
  state: CoachState;
  previous: DialogueLine[];
}

const MAX_AUDIO_BYTES = '25mb';

function copilotPrompt(job: string): string {
  return [
    'You are the voice-director sidecar for a Skillio hackathon demo.',
    `Current job: "${job}".`,
    'Answer concisely in plain text. When the operator asks for the next step,',
    'name the current screw target and suggest they ask the voice director for',
    'a spoken direction.',
  ].join('\n');
}

function startExpress(cfg: DirectorConfig): {
  app: express.Express;
  provider: DirectorProvider;
  getJob: () => string;
  getPhase: () => CoachPhase;
  getPrevious: () => DialogueLine[];
} {
  const app = express();
  const provider = createProvider(cfg);
  const sessions = new Map<string, Session>();
  let latestId: string | undefined;

  const latest = (): Session | undefined => (latestId ? sessions.get(latestId) : undefined);
  const getJob = () => latest()?.state.spec.job ?? cfg.defaultJob;
  const getPhase = () => latest()?.state.phase ?? 'setup';
  const getPrevious = () => latest()?.previous ?? [];

  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', cfg.allowedOrigin);
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-session, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const fail = (err: unknown, res: express.Response): void => {
    if (err instanceof MissingCredentialError) {
      res.status(503).json({ ok: false, error: { code: 'missing_provider_credential', message: err.message } } satisfies ApiError);
    } else if (err instanceof ProviderError) {
      res.status(502).json({ ok: false, error: { code: err.code, message: err.message } } satisfies ApiError);
    } else {
      res.status(500).json({
        ok: false,
        error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
      } satisfies ApiError);
    }
  };

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = {
      ok: true,
      provider: cfg.apiKey ? 'ready' : 'missing-credential',
      model: cfg.model,
      voice: cfg.voice,
      copilot: Boolean(cfg.apiKey),
      slack: Boolean(cfg.slack.appToken && cfg.slack.botToken),
    };
    res.json(body);
  });

  app.post('/api/start', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<StartRequest>;
      const job = typeof body.job === 'string' && body.job.trim() ? body.job.trim() : null;
      if (!job) {
        return res.status(400).json({ ok: false, error: { code: 'invalid_args', message: 'job is required.' } } satisfies ApiError);
      }
      const positions: ScrewPosition[] = Array.isArray(body.positions)
        ? body.positions.filter((p): p is ScrewPosition => Boolean(p && typeof p === 'object' && typeof (p as ScrewPosition).id === 'string'))
        : [];
      const sessionId = randomUUID();
      if (sessions.size > 40) {
        const oldest = sessions.keys().next().value as string;
        sessions.delete(oldest);
      }
      // The repo's voice-coach confirm-back gate: nothing is coached until the
      // task spec is confirmed. Reusing confirmSpec keeps the slice on existing
      // domain vocabulary instead of inventing a parallel state machine.
      const state = confirmSpec(createCoach(job), positions);
      sessions.set(sessionId, { state, previous: [] });
      latestId = sessionId;
      const result: StartResponse = {
        ok: true,
        sessionId,
        phase: state.phase,
        spec: { job: state.spec.job, positions: state.spec.positions, confirmed: state.spec.confirmed },
      };
      res.json(result);
    } catch (err) {
      fail(err, res);
    }
  });

  app.post(
    '/api/voice',
    express.raw({ type: ['audio/wav', 'audio/x-wav'], limit: MAX_AUDIO_BYTES }),
    async (req, res) => {
      try {
        const sessionId = String(req.headers['x-session'] ?? '');
        const session = sessions.get(sessionId);
        if (!session) {
          return res.status(404).json({ ok: false, error: { code: 'session_not_found', message: 'Unknown session id. POST /api/start first.' } } satisfies ApiError);
        }
        const audio = req.body as Buffer | undefined;
        if (!audio || audio.byteLength === 0) {
          return res.status(400).json({ ok: false, error: { code: 'empty_audio', message: 'Request body must be WAV audio bytes.' } } satisfies ApiError);
        }
        const ctx = { job: session.state.spec.job, phase: session.state.phase, previous: session.previous };
        const round = await provider.directAudio({ ...ctx, audio, mime: 'audio/wav' });

        session.previous = [...session.previous, { youSaid: round.youSaid, direction: round.direction }];
        if (session.state.spec.positions.length > 0) {
          // One direction addresses one defined position; when the positions are
          // exhausted the coach reaches the voice-coach 'done' phase.
          const nextScrew = session.state.currentScrew + 1;
          const done = nextScrew >= session.state.spec.positions.length;
          session.state = { ...session.state, currentScrew: nextScrew, phase: done ? 'done' : 'coaching' };
        } else {
          session.state = { ...session.state, phase: 'coaching' };
        }

        const positions = session.state.spec.positions;
        const step = positions.length ? session.state.currentScrew : 0;
        const current = step > 0 ? positions[step - 1] : undefined;
        const seed = feedbackSeed(session.state.spec.job, step || 0, round.direction);

        const result: VoiceResponse = {
          ok: true,
          sessionId,
          phase: session.state.phase,
          youSaid: round.youSaid,
          direction: round.direction,
          audioBase64: Buffer.from(round.audio).toString('base64'),
          mime: 'audio/wav',
          step: step || 0,
          targetId: current?.id,
          feedbackSeed: seed,
        };
        res.json(result);
      } catch (err) {
        fail(err, res);
      }
    },
  );

  app.post('/api/direct', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<DirectRequest>;
      const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim() : null;
      if (!text) {
        return res.status(400).json({ ok: false, error: { code: 'invalid_args', message: 'text is required.' } } satisfies ApiError);
      }
      const running = body.sessionId ? sessions.get(body.sessionId) : undefined;
      const job = running
        ? running.state.spec.job
        : typeof body.job === 'string' && body.job.trim()
          ? body.job.trim()
          : cfg.defaultJob;
      const phase = running ? running.state.phase : 'setup';
      const previous = running?.previous ?? [];
      const { direction } = await provider.directText({ text, job, phase, previous });
      const result: DirectResponse = { ok: true, phase, direction };
      res.json(result);
    } catch (err) {
      fail(err, res);
    }
  });

  // Portable runbook/task-state + scene-layout gate for a REMOTE Unity process.
  // Everything here is pure JSON and versioned — no local Unity dependency.
  app.get('/api/scene/:sessionId', (req, res) => {
    const sessionId = String(req.params.sessionId ?? '');
    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        ok: false,
        error: { code: 'session_not_found', message: 'Unknown session id. POST /api/start first.' },
      } satisfies ApiError);
    }
    const runbook: RunbookState = {
      version: RUNBOOK_VERSION,
      sessionId,
      spec: {
        job: session.state.spec.job,
        positions: session.state.spec.positions,
        confirmed: session.state.spec.confirmed,
      },
      phase: session.state.phase,
      currentScrew: session.state.currentScrew,
      previous: session.previous,
    };
    const layout = deriveSceneLayout(session.state.spec, sessionId);
    res.json({ ok: true, sessionId, runbook, layout } satisfies SceneResponse);
  });

  const apiKey = cfg.apiKey;
  if (apiKey) {
    const runtime = new CopilotRuntime({
      // Per-request agent factory: bakes the CURRENT job into the sidecar's
      // prompt. Same OpenAI credential as the voice path; the sidecar is a text
      // chat sibling, so it uses a plain text model rather than the audio model.
      agents: () => ({
        primary: new BuiltInAgent({
          model: 'openai/gpt-4o-mini',
          apiKey,
          prompt: copilotPrompt(getJob()),
        }),
      }),
    });
    // CopilotKit ships its own Express-4 Router; our app is Express 5, so type
    // it as a plain handler. The router routes its own basePath (/copilot), so
    // it mounts pathless — a second mount prefix would double the path.
    const copilot = createCopilotEndpointExpress({ runtime, basePath: '/copilot', cors: false }) as unknown as express.RequestHandler;
    app.use(copilot);
  } else {
    app.use('/copilot', (_req, res) => {
      res.status(503).json({ ok: false, error: { code: 'missing_provider_credential', message: 'OPENAI_API_KEY is not set; Copilot sidecar disabled.' } } satisfies ApiError);
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'not_found', message: 'No such route on the voice-director server.' } } satisfies ApiError);
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    fail(err, res);
  });

  return { app, provider, getJob, getPhase, getPrevious };
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const cfg = loadConfig(env);
  const { app, provider, getJob, getPhase, getPrevious } = startExpress(cfg);

  if (cfg.slack.appToken && cfg.slack.botToken) {
    try {
      await startSlack(cfg.slack, { provider, getJob, getPhase, getPrevious });
      console.log('slack: bot listening (Socket Mode)');
    } catch (err) {
      console.error(`slack: failed to start — ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log('slack: bot skipped (set SLACK_APP_TOKEN + SLACK_BOT_TOKEN to enable)');
  }

  const httpServer = createServer(app);
  // Realtime relay gateway: claims ONLY the /ws/realtime upgrade path. The
  // one-shot HTTP routes above are unchanged; this is additive by design.
  attachRealtimeRelayServer(httpServer, cfg);

  httpServer.listen(cfg.port, () => {
    console.log(`voice-director server: http://localhost:${cfg.port}`);
    console.log(`  provider: ${cfg.apiKey ? 'ready' : 'missing-credential (set OPENAI_API_KEY to enable provider calls)'}`);
    console.log(`  model: ${cfg.model} | voice: ${cfg.voice}`);
    console.log(`  realtime relay: ws://localhost:${cfg.port}${REALTIME_WS_PATH} (model ${cfg.realtime.model}, ${cfg.apiKey ? 'ready' : 'missing-credential'})`);
    console.log(`  copilot sidecar: ${cfg.apiKey ? 'mounted at /copilot' : 'disabled'}`);
    console.log(`  CORS allowed origin: ${cfg.allowedOrigin}`);
  });
}

// Boot when run directly (e.g. `tsx server/index.ts`), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}