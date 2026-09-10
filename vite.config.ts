import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { narratePlugin } from './server/narrate';

export default defineConfig(({ mode }) => {
  // Loads .env.local too. Only VITE_* reach the browser; ANTHROPIC_API_KEY
  // stays in this Node process for the narration proxy.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), narratePlugin(env)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5180 },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
