// Deterministic audio feedback — a two-note WebAudio cue derived purely from
// the feedbackSeed the server sends. No RNG: the same seed always produces the
// same cue, so the paired audio (this cue) and visual (scene highlight) feedback
// stay in lockstep across every client and run.
import { cueFromSeed } from '../../shared/scene';

let ctx: AudioContext | null = null;

export function playDeterministicCue(seed: number): void {
  const { freqA, freqB, dur, gap } = cueFromSeed(seed);
  try {
    const ac = ctx ?? (ctx = new AudioContext());
    const t0 = Math.max(ac.currentTime + 0.02, 0);
    for (const [freq, t] of [
      [freqA, t0],
      [freqB, t0 + dur + gap],
    ] as Array<[number, number]>) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  } catch {
    // The cue is cosmetic — the returned direction audio always plays.
  }
}