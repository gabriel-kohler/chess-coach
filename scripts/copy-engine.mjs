// Copies the single-threaded lite Stockfish build into public/ so the browser can
// load it as a Web Worker. Single-threaded means no COOP/COEP headers are needed.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'stockfish');

if (!existsSync(src)) {
  console.warn('[copy-engine] stockfish package not installed yet, skipping');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const file of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log('[copy-engine] Stockfish 18 lite (single-threaded) copied to public/stockfish');
