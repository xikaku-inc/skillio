import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HealthResponse,
  StartRequest,
  StartResponse,
  VoiceResponse,
  VoiceStatus,
} from '../shared/protocol';
import type { SceneLayout } from '../shared/scene';
import { audioFromBase64, fetchHealth, fetchScene, isError, sendVoice, startSession } from './api';
import { playDeterministicCue } from './audio/cue';
import { MicRecorder } from './audio/recorder';

export interface Turn {
  youSaid: string;
  direction: string;
}

const SILENCE_MS = 1300;
const MIN_TALK_MS = 500;
const MAX_TALK_MS = 15_000;
const VOICE_THRESHOLD = 0.02;

function micError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Microphone access denied. Allow mic access and try again.';
  if (name === 'NotFoundError') return 'No microphone found.';
  return `Could not start the mic: ${e instanceof Error ? e.message : String(e)}`;
}

export function useCoach() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [session, setSession] = useState<StartResponse | null>(null);
  const [youSaid, setYouSaid] = useState('');
  const [direction, setDirection] = useState('');
  const [energy, setEnergy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  const [scene, setScene] = useState<SceneLayout | null>(null);
  const [step, setStep] = useState(0);
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  const [feedbackSeed, setFeedbackSeed] = useState<number | null>(null);

  const recorderRef = useRef<MicRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const lastVoiceRef = useRef(0);
  const sessionRef = useRef<StartResponse | null>(null);
  sessionRef.current = session;

  const stopPlayback = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = '';
    }
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const playAudio = useCallback(
    (r: VoiceResponse) => {
      setStatus('speaking');
      const url = URL.createObjectURL(audioFromBase64(r.audioBase64, r.mime));
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      const finish = () => {
        stopPlayback();
        setStatus('idle');
      };
      audio.onended = finish;
      audio.onerror = finish;
      void audio.play().catch(() => {
        stopPlayback();
        setStatus('idle');
      });
    },
    [stopPlayback],
  );

  const endTurn = useCallback(async () => {
    if (silenceTimer.current !== null) {
      window.clearInterval(silenceTimer.current);
      silenceTimer.current = null;
    }
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return;
    if (!rec.isRecording) {
      rec.cancel();
      setStatus('idle');
      return;
    }
    const current = sessionRef.current;
    if (!current) {
      rec.cancel();
      setStatus('idle');
      return;
    }
    const wav = rec.stop();
    if (!wav) {
      setError('Nothing heard — hold the button and speak.');
      setStatus('idle');
      return;
    }
    setStatus('processing');
    setError(null);
    const r = await sendVoice(current.sessionId, wav);
    if (isError(r)) {
      setError(`${r.error.code}: ${r.error.message}`);
      setStatus('idle');
      return;
    }
    setYouSaid(r.youSaid);
    setDirection(r.direction);
    setSession((prev) => (prev ? { ...prev, phase: r.phase } : prev));
    setHistory((h) => [...h, { youSaid: r.youSaid, direction: r.direction }]);
    // Deterministic PAIRED feedback for this turn: the scene highlight and the
    // audio cue both derive from the same feedbackSeed the server computed.
    setStep(r.step);
    setTargetId(r.targetId);
    setFeedbackSeed(r.feedbackSeed);
    playDeterministicCue(r.feedbackSeed);
    playAudio(r);
  }, [playAudio]);

  const endTurnRef = useRef(endTurn);
  endTurnRef.current = endTurn;

  const beginTurn = useCallback(async () => {
    if (status === 'listening' || status === 'processing') return;
    if (status === 'speaking') {
      stopPlayback();
      setStatus('idle');
      return;
    }
    if (!sessionRef.current) return;
    setError(null);
    setEnergy(0);
    setStatus('connecting');
    const rec = new MicRecorder();
    recorderRef.current = rec;
    try {
      await rec.start({
        onLevel: (l) => {
          setEnergy(l);
          if (l > VOICE_THRESHOLD) lastVoiceRef.current = performance.now();
        },
      });
      lastVoiceRef.current = performance.now();
      const startedAt = rec.started;
      silenceTimer.current = window.setInterval(() => {
        if (!recorderRef.current?.isRecording) return;
        const now = performance.now();
        const sinceVoice = now - lastVoiceRef.current;
        const total = now - startedAt;
        if ((sinceVoice > SILENCE_MS && total > MIN_TALK_MS) || total > MAX_TALK_MS) {
          void endTurnRef.current();
        }
      }, 200);
      setStatus('listening');
    } catch (e) {
      recorderRef.current = null;
      setError(micError(e));
      setStatus('idle');
    }
  }, [status, stopPlayback]);

  const startCoaching = useCallback(async (input: StartRequest): Promise<boolean> => {
    setError(null);
    const r = await startSession(input);
    if (isError(r)) {
      setError(`${r.error.code}: ${r.error.message}`);
      return false;
    }
    setSession(r);
    setHistory([]);
    setYouSaid('');
    setDirection('');
    setStep(0);
    setTargetId(undefined);
    setFeedbackSeed(null);
    // The same versioned scene the remote Unity process polls — the browser
    // renders the layout strip from it; Unity renders the same coordinates.
    const s = await fetchScene(r.sessionId);
    setScene(isError(s) ? null : s.layout);
    setStatus('idle');
    return true;
  }, []);

  const endCoaching = useCallback(() => {
    stopPlayback();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setSession(null);
    setHistory([]);
    setYouSaid('');
    setDirection('');
    setScene(null);
    setStep(0);
    setTargetId(undefined);
    setFeedbackSeed(null);
    setStatus('idle');
    setError(null);
  }, [stopPlayback]);

  const noteDirection = useCallback((d: string) => {
    if (d) setDirection(d);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const r = await fetchHealth();
      if (cancelled || isError(r)) return;
      setHealth((prev) => (prev && prev.provider === r.provider ? prev : r));
    };
    void poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (silenceTimer.current !== null) window.clearInterval(silenceTimer.current);
      recorderRef.current?.cancel();
      stopPlayback();
    };
  }, [stopPlayback]);

  return {
    health,
    status,
    session,
    youSaid,
    direction,
    energy,
    error,
    history,
    scene,
    step,
    targetId,
    feedbackSeed,
    beginTurn,
    endTurn,
    startCoaching,
    endCoaching,
    noteDirection,
  };
}

export type Coach = ReturnType<typeof useCoach>;