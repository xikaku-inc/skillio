import { CopilotKit, useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import { CopilotPopup } from '@copilotkit/react-ui';
import { isError, sendDirect } from './api';

interface Props {
  job: string;
  sessionId?: string;
  onDirection: (direction: string) => void;
}

function DirectionCard({ text, direction, pending }: { text: string; direction: string; pending: boolean }) {
  return (
    <div className="copilot-card">
      <div className="copilot-card-head">
        <span className="tag">voice-director.direct</span>
        <span>{pending ? 'running…' : 'done'}</span>
      </div>
      <p className="you-mini">{text}</p>
      <p className="dir-mini">{pending ? 'Waiting on director…' : direction}</p>
    </div>
  );
}

function VoiceCopilotInner({ job, sessionId, onDirection }: Props) {
  useCopilotReadable({
    description: 'The assembly job the voice director is coaching',
    value: job,
  });

  useCopilotAction({
    name: 'voice-director.direct',
    description: 'Get the next concise assembly direction from a spoken-style instruction.',
    parameters: [{ name: 'text', type: 'string', required: true, description: 'The instruction, written like something you would say aloud.' }],
    render: (props) => {
      const text = String((props.args as { text?: unknown }).text ?? '');
      const direction = props.status === 'complete' ? String(props.result ?? '') : '';
      const pending = props.status === 'executing' || props.status === 'inProgress';
      return <DirectionCard text={text} direction={direction} pending={pending} />;
    },
    handler: async ({ text }) => {
      const t = String(text ?? '');
      const r = await sendDirect({ sessionId, job, text: t });
      if (isError(r)) throw new Error(`${r.error.code}: ${r.error.message}`);
      onDirection(r.direction);
      return r.direction;
    },
  });

  return null;
}

export default function VoiceCopilot(props: Props) {
  return (
    <CopilotKit runtimeUrl="/copilot">
      <VoiceCopilotInner {...props} />
      <CopilotPopup labels={{ title: 'Voice director' }} />
    </CopilotKit>
  );
}