// Shared test helpers for the Deepgram relay/gateway tests. Not a test file
// (does not match the *.test.ts runner glob).
import { setImmediate as nodeSetImmediate } from 'node:timers';

/** Yields to the macrotask queue so an awaited continuation (e.g. connect→Settings) runs. */
export function awaitSetImmediate(): Promise<void> {
  return new Promise((resolve) => nodeSetImmediate(resolve));
}

/** Poll until a predicate holds (drive an async handshake in wire tests). */
export function waitUntil(predicate: () => boolean, timeoutMs = 5000, label = 'condition'): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (predicate()) {
        clearInterval(tick);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        reject(new Error(`timeout waiting for ${label}`));
      }
    }, 5);
  });
}