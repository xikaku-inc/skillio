import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Project page for xikaku-inc/skillio, served at
// https://xikaku-inc.github.io/skillio/ — keep base in sync with repo slug.
export default defineConfig({
  base: '/skillio/',
  plugins: [react()],
});
