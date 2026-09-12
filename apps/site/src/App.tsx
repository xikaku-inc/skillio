const REPO_URL = 'https://github.com/xikaku-inc/skillio';

function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="section">
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function App() {
  return (
    <div className="page">
      <header className="hero">
        <p className="kicker">skillio · pnpm monorepo</p>
        <h1>Agents belong somewhere new.</h1>
        <p className="lede">
          skillio is the UI layer + MCP integrations for agents that show up inside
          the tools, channels, and rooms where people already work — not in a
          separate chat window.
        </p>
        <div className="cta-row">
          <a className="btn primary" href={REPO_URL}>GitHub repo</a>
          <a className="btn" href="#drill-coach">Hackathon build</a>
        </div>
      </header>

      <Section id="architecture" kicker="Architecture" title="UI renders state. MCP supplies tools.">
        <ol className="flow">
          <li>
            <strong>apps/web</strong> — the deployable UI. Routing, pages, data-fetching.
            Imports the design system and the MCP client; never touches MCP stdio.
          </li>
          <li>
            <strong>packages/ui</strong> — dumb design system. Components and tokens only:
            no business logic, no fetch, no MCP imports.
          </li>
          <li>
            <strong>packages/mcp-client</strong> — browser-safe client. Typed{' '}
            <code>callTool()</code> over HTTP/SSE, connection + reconnect handling.
          </li>
          <li>
            <strong>packages/mcp-protocol</strong> — the shared contract. Tool schemas
            both client and servers import, so neither side drifts.
          </li>
          <li>
            <strong>integrations/mcp-servers/*</strong> — one runnable per integration.
            New integration = new folder, no changes to UI or client.
          </li>
          <li>
            <strong>packages/voice-coach</strong> — voice pipeline
            (mic → transcribe → coach → speak) + coach state machine with a
            confirm-back gate before anything renders.
          </li>
        </ol>
      </Section>

      <Section id="drill-coach" kicker="AI Tinkerers · Agents Everywhere" title="Voice-guided drill coach.">
        <p>
          Our hackathon build: wear a Vision Pro, say what to build, and the coach
          projects crosshairs onto the real wood — then talks through every screw,
          correcting grip until each one seats.
        </p>
        <ul className="cols">
          <li><strong>Planning room</strong> — desktop, voice + keyboard, slow-smart model.</li>
          <li><strong>Handoff</strong> — agreed task spec + anchored positions transfer in.</li>
          <li><strong>Working room</strong> — headset, voice only, fast model. Hands are busy.</li>
        </ul>
      </Section>

      <Section id="sponsors" kicker="Integrations" title="Primary bets.">
        <div className="cards">
          <article className="card star">
            <h3>CopilotKit ⭐ primary</h3>
            <p>
              In-app agent UI: sidebar, app-state reading, mutating actions with
              generative-UI cards, AG-UI streaming, MCP tools via CopilotRuntime.
            </p>
          </article>
          <article className="card star">
            <h3>Ambiguous.ai ⭐ primary</h3>
            <p>
              Agent workspace identity across Docs, Mail, Chat, Sheets, CRM, Calendar —
              onboarded via CLI or MCP, living where work happens.
            </p>
          </article>
          <article className="card">
            <h3>Supporting</h3>
            <p>OpenAI · OpenRouter · Exa · Trigger.dev · Auth0 · Mozilla.ai</p>
          </article>
        </div>
      </Section>

      <Section id="team" kicker="Team" title="Built by Trillium + Klaus.">
        <p>
          <strong>Trillium</strong> — UI layer, MCP integrations, voice + vibe.{' '}
          <strong>Klaus</strong> — hardware path (Vision Pro, SteamVR bridge, anchors).
        </p>
        <div className="cta-row">
          <a className="btn primary" href={REPO_URL}>Follow along on GitHub</a>
        </div>
      </Section>

      <footer className="footer">
        <span>skillio · AI Tinkerers Agents Everywhere</span>
        <a href={REPO_URL}>xikaku-inc/skillio</a>
      </footer>
    </div>
  );
}
