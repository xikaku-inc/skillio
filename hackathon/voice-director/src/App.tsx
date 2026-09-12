import { useState } from 'react';
import VoiceDirector from './VoiceDirector';
import VoiceCopilot from './VoiceCopilot';
import { useCoach } from './useCoach';

export default function App() {
  const coach = useCoach();
  const [copilot, setCopilot] = useState(false);

  const healthReady = coach.health?.provider === 'ready' && coach.health?.copilot;

  return (
    <div className="page">
      <header className="hero">
        <p className="kicker">skillio · {new Date().getFullYear()} hackathon — voice slice</p>
        <h1>Voice director</h1>
        <p className="lede">
          microphone → Vite client → localhost server → conversational voice API → returned audio → playback.
        </p>
        <p className="footnote">API-only path. Provider credentials stay on the server; a missing key is reported, never invented.</p>
      </header>

      <VoiceDirector coach={coach} />

      <footer className="sidecars">
        <div className="sidecar-toggle">
          <button
            className="btn ghost"
            disabled={!healthReady}
            onClick={() => setCopilot((v) => !v)}
          >
            {copilot ? 'Hide' : 'Open'} Copilot sidecar
          </button>
          {!healthReady && coach.health?.provider === 'ready' && (
            <span className="hint">Copilot sidecar needs the provider credential configured.</span>
          )}
        </div>
        {copilot && healthReady && (
          <VoiceCopilot
            job={coach.session?.spec.job ?? 'Assemble the desk-side drill station.'}
            sessionId={coach.session?.sessionId}
            onDirection={coach.noteDirection}
          />
        )}
        {copilot && !healthReady && <p className="hint">Copilot is off until OPENAI_API_KEY is configured on the server.</p>}
      </footer>
    </div>
  );
}