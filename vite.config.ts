import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { explorerPlugin } from './server/explorer';
import { fsrsPlugin } from './server/fsrs';
import { narratePlugin } from './server/narrate';

export default defineConfig(({ mode }) => {
  // Loads .env.local too. Only VITE_* reach the browser; ANTHROPIC_API_KEY and
  // LICHESS_TOKEN stay in this Node process for the narration and explorer proxies.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), narratePlugin(env), explorerPlugin(env), fsrsPlugin()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5180 },
    // The Maia worker imports ONNX Runtime, which loads its WASM at runtime:
    // ES-module workers, and no dependency pre-bundling for it.
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
