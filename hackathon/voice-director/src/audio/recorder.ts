import { encodeWav } from './wav';

export interface RecorderEvents {
  onSamples?: (samples: Float32Array) => void;
  onLevel?: (rms: number) => void;
}

function rms(samples: Float32Array): number {
  const step = Math.max(1, Math.floor(samples.length / 256));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i];
    sum += s * s;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/**
 * Mic capture that produces a WAV Blob. Uses getUserMedia + AudioWorklet so the
 * client hands the server raw PCM/WAV — the server, not the browser, does all
 * speech work (this slice is API-only by contract: no local STT/TTS).
 */
export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 48000;
  private startedAt = 0;
  private recording = false;

  get isRecording(): boolean {
    return this.recording;
  }

  get started(): number {
    return this.startedAt;
  }

  async start(events: RecorderEvents = {}): Promise<void> {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    this.sampleRate = this.ctx.sampleRate;
    this.chunks = [];
    await this.ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const data = e.data;
      events.onSamples?.(data);
      events.onLevel?.(rms(data));
      this.chunks.push(data);
    };
    this.source.connect(this.node);
    await this.ctx.resume();
    this.recording = true;
    this.startedAt = performance.now();
  }

  /** Finalize capture: WAV Blob, or null when nothing usable was captured. */
  stop(): Blob | null {
    if (!this.recording || !this.ctx) return null;
    const sampleRate = this.sampleRate;
    const merged = this.mergeChunks();
    this.teardown();
    if (merged.length < sampleRate * 0.05) return null;
    return encodeWav(merged, sampleRate);
  }

  /** Abort without producing a blob. */
  cancel(): void {
    if (this.recording) this.teardown();
  }

  private mergeChunks(): Float32Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of this.chunks) {
      merged.set(c, off);
      off += c.length;
    }
    return merged;
  }

  private teardown(): void {
    this.recording = false;
    this.node?.disconnect();
    this.node = null;
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const ctx = this.ctx;
    this.ctx = null;
    void ctx?.close().catch(() => {});
    this.chunks = [];
  }
}