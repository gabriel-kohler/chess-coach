// Downloads the Maia-2 rapid model (MIT, CSSLab; ONNX export used by maia2-js)
// into public/maia and copies the single-threaded ONNX Runtime files into
// public/ort. Both folders stay out of git. Safe to run again: a model with
// the right checksum is kept.
//
//   npm run setup:maia
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL = 'https://huggingface.co/cemoss17/maia2-onnx/resolve/main/maia2_rapid.onnx';
const MODEL_SHA256 = 'f2ded336c9574510468382345ae66e9c4b6de80d6b5c72efbf9610fa612475e8';
const MODEL_BYTES = 84_945_775;
const modelDir = join(root, 'public', 'maia');
const modelPath = join(modelDir, 'maia2_rapid.onnx');

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// ONNX Runtime: the WASM build, run with one thread (no COOP/COEP headers).
const ortSrc = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortDest = join(root, 'public', 'ort');
mkdirSync(ortDest, { recursive: true });
for (const file of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(join(ortSrc, file), join(ortDest, file));
console.log('[setup-maia] ONNX Runtime copied to public/ort');

mkdirSync(modelDir, { recursive: true });
if (existsSync(modelPath) && statSync(modelPath).size === MODEL_BYTES && (await sha256(modelPath)) === MODEL_SHA256) {
  console.log('[setup-maia] model already in public/maia, checksum ok');
  process.exit(0);
}

console.log(`[setup-maia] downloading Maia-2 rapid (${(MODEL_BYTES / 1e6).toFixed(0)} MB)...`);
const res = await fetch(MODEL_URL);
if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
const tmp = `${modelPath}.part`;
let got = 0;
let shown = 0;
const body = Readable.fromWeb(res.body);
body.on('data', (chunk) => {
  got += chunk.length;
  const pct = Math.floor((got / MODEL_BYTES) * 100);
  if (pct >= shown + 10) {
    shown = pct - (pct % 10);
    process.stdout.write(`  ${shown}%\n`);
  }
});
await pipeline(body, createWriteStream(tmp));
const digest = await sha256(tmp);
if (digest !== MODEL_SHA256) {
  rmSync(tmp);
  throw new Error(`checksum mismatch: got ${digest}`);
}
renameSync(tmp, modelPath);
console.log('[setup-maia] model saved to public/maia, checksum ok');
