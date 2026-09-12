import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VOICE_DIRECTOR_API_TARGET ?? 'http://localhost:8787';

// Voice direct slice: the Vite client talks to the localhost voice-director
// server through these same-origin proxies. Provider credentials live in the
// server process only — nothing below is bundled into the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/copilot': { target: API_TARGET, changeOrigin: true },
    },
  },
});