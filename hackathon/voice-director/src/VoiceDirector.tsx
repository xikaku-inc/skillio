import { useState } from 'react';
import type { CoachPhase } from '@skillio/voice-coach';
import type { SceneTarget } from '../shared/scene';
import type { Coach } from './useCoach';

const PHASE_LABEL: Record<CoachPhase, string> = {
  setup: 'setup',
  'confirm-back': 'confirm-back',
  coaching: 'coaching',
  escalated: 'escalated',
  done: 'done',
};

function PhaseBadge({ phase }: { phase: CoachPhase }) {
  return <span className={`phase phase-${phase}`}>{PHASE_LABEL[phase]}</span>;
}

function StatusPill({ status }: { status: Coach['status'] }) {
  const labels: Record<string, string> = {
    idle: 'Idle',
    connecting: 'Connecting…',
    listening: 'Listening — release to send',
    processing: 'Directing…',
    speaking: 'Speaking…',
  };
  return <span className={`state state-${status}`}>{labels[status]}</span>;
}

function SceneStrip({ targets, activeIndex }: { targets: SceneTarget[]; activeIndex: number }) {
  return (
    <div className="scene-strip" role="list" aria-label="scene layout">
      {targets.map((t, i) => (
        <div
          key={t.id}
          className={`scene-dot${i === activeIndex ? ' scene-dot-active' : ''}`}
          role="listitem"
          title={`${t.label} · ${t.anchorId} · (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`}
        >
          <span className="scene-dot-head" style={{ background: t.color }} />
          <span className="scene-dot-label">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

function Setup({ coach }: { coach: Coach }) {
  const [job, setJob] = useState('Assemble the desk-side drill station.');
  const [positions, setPositions] = useState('top-left, top-right, bottom-left, bottom-right');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!job.trim()) return;
    setBusy(true);
    const ids = positions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await coach.startCoaching({
      job: job.trim(),
      positions: ids.map((id, i) => ({ id, anchorId: `anchor-${id}`, attempts: 0, seated: false })),
    });
    setBusy(false);
  };

  return (
    <section className="panel">
      <h2>Define the job</h2>
      <p className="hint">Set the task, then the voice director coaches you through it one concise direction at a time.</p>
      <label className="field">
        <span>Job</span>
        <textarea
          rows={2}
          value={job}
          onChange={(e) => setJob(e.target.value)}
          placeholder="e.g. Assemble the desk-side drill station."
        />
      </label>
      <label className="field">
        <span>Screw positions (comma-separated ids, optional)</span>
        <input value={positions} onChange={(e) => setPositions(e.target.value)} />
      </label>
      <button className="btn primary" onClick={() => void submit()} disabled={busy || !job.trim()}>
        {busy ? 'Opening session…' : 'Confirm task'}
      </button>
      <p className="hint">
        Confirm-back gate from <code>@skillio/voice-coach</code>: nothing is coached until the task spec is confirmed.
      </p>
    </section>
  );
}

function Coaching({ coach }: { coach: Coach }) {
  const session = coach.session!;
  const held = coach.status === 'listening' || coach.status === 'connecting';
  const meter = Math.min(100, Math.round(coach.energy * 250));

  return (
    <section className="panel coaching">
      <header className="coach-head">
        <div>
          <p className="kicker">session</p>
          <h2>{session.spec.job}</h2>
          <p className="hint">
            {session.spec.positions.length
              ? `${session.spec.positions.length} defined positions · confirmed intact (${session.spec.positions.map((p) => p.id).join(', ')})`
              : 'no fixed positions — open coaching'}
          </p>
        </div>
        <div className="badges">
          <PhaseBadge phase={session.phase} />
          <StatusPill status={coach.status} />
        </div>
      </header>

      {coach.scene && coach.scene.targets.length > 0 && (
        <div className="scene-wrap">
          <SceneStrip
            targets={coach.scene.targets}
            activeIndex={coach.step > 0 ? coach.step - 1 : -1}
          />
          <p className="hint">
            scene layout v{coach.scene.version} · target {coach.step > 0 ? coach.targetId ?? '—' : '—'}{' '}
            {coach.feedbackSeed !== null ? `· feedback seed ${coach.feedbackSeed}` : ''}
          </p>
        </div>
      )}

      <div
        className={`talk ${held ? 'talk-held' : ''}`}
        onPointerDown={() => void coach.beginTurn()}
        onPointerUp={() => void coach.endTurn()}
        onPointerLeave={() => {
          if (held) void coach.endTurn();
        }}
        onPointerCancel={() => void coach.endTurn()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (coach.status === 'listening' || coach.status === 'connecting') void coach.endTurn();
            else void coach.beginTurn();
          }
        }}
      >
        <span className="talk-icon">{coach.status === 'speaking' ? '♪' : '🎤'}</span>
        <span className="talk-label">
          {coach.status === 'listening'
            ? 'Listening… speak now'
            : coach.status === 'connecting'
              ? 'Starting mic…'
              : coach.status === 'processing'
                ? 'On it…'
                : coach.status === 'speaking'
                  ? 'Playing direction'
                  : 'Hold to talk'}
        </span>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${meter}%` }} />
        </div>
      </div>

      {coach.error && <p className="error">{coach.error}</p>}

      <div className="turn">
        {coach.youSaid && (
          <p className="you">
            <span className="tag">transcript</span>
            {coach.youSaid}
          </p>
        )}
        {coach.direction && (
          <p className="direct">
            <span className="tag">current direction</span>
            {coach.direction}
          </p>
        )}
        {!coach.youSaid && !coach.direction && (
          <p className="hint">Hold the button and give the coach a spoken instruction.</p>
        )}
      </div>

      {coach.history.length > 1 && (
        <ol className="log">
          {coach.history.slice(0, -1).reverse().slice(0, 3).map((t, i) => (
            <li key={`${i}-${t.direction}`}>
              <span className="you-mini">{t.youSaid}</span> → <span className="dir-mini">{t.direction}</span>
            </li>
          ))}
        </ol>
      )}

      <button className="btn ghost" onClick={coach.endCoaching}>
        End job · start another
      </button>
    </section>
  );
}

export default function VoiceDirector({ coach }: { coach: Coach }) {
  if (!coach.health) {
    return (
      <section className="panel">
        <p className="state state-connecting">Connecting to the voice-director server…</p>
        <p className="hint">Want it up? In a terminal: <code>pnpm --filter @skillio/hackathon-voice-director dev</code></p>
      </section>
    );
  }

  if (coach.health.provider === 'missing-credential') {
    return (
      <section className="panel warn">
        <h2>Coach not configured</h2>
        <p>
          The server is up but the provider credential is missing. Set{' '}
          <code>OPENAI_API_KEY</code> in <code>hackathon/voice-director/.env</code>{' '}
          (server-side only) and restart <code>pnpm dev:server</code>.
        </p>
        <p className="hint">Missing credentials are reported explicitly — the slice never invents one.</p>
      </section>
    );
  }

  return coach.session ? <Coaching coach={coach} /> : <Setup coach={coach} />;
}