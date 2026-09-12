// AudioWorklet processor for mic capture. Sends raw mono float samples to the
// main thread; the recorder encodes them to WAV. Must stay dependency-free and
// plain-JS (AudioWorklet modules cannot import).
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length && input[0] && input[0].length) {
      const channel = input[0];
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);