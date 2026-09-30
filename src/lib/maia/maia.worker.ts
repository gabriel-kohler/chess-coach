/// <reference lib="webworker" />
// Runs Maia-2 with ONNX Runtime's WASM backend on one thread (the app sends
// no COOP/COEP headers, so there is no SharedArrayBuffer). Model and runtime
// are served from public/maia and public/ort (npm run setup:maia).
import * as ort from 'onnxruntime-web/wasm';
import { BOARD_SIZE, encodePosition, eloToCategory, NUM_CHANNELS, policyFromLogits, type HumanMove } from './encode.ts';

ort.env.wasm.numThreads = 1;
// Only the .wasm binary comes from public/; the JS glue is bundled with the
// package import (Vite refuses to import JS from public/ as a module).
ort.env.wasm.wasmPaths = { wasm: '/ort/ort-wasm-simd-threaded.wasm' };

export type MaiaRequest =
  | { id: number; type: 'load' }
  | { id: number; type: 'predict'; items: Array<{ fen: string; eloSelf: number; eloOppo: number }> };
export type MaiaResponse = { id: number; ok: true; results?: HumanMove[][] } | { id: number; ok: false; error: string };

let session: Promise<ort.InferenceSession> | null = null;
const load = () => (session ??= ort.InferenceSession.create('/maia/maia2_rapid.onnx', { executionProviders: ['wasm'] }));

const PLANE = NUM_CHANNELS * BOARD_SIZE * BOARD_SIZE;

self.onmessage = async (e: MessageEvent<MaiaRequest>) => {
  const req = e.data;
  const reply = (r: MaiaResponse) => (self as unknown as Worker).postMessage(r);
  try {
    const s = await load();
    if (req.type === 'load') return reply({ id: req.id, ok: true });
    const encoded = req.items.map((it) => encodePosition(it.fen));
    const n = encoded.length;
    const boards = new Float32Array(n * PLANE);
    encoded.forEach((x, i) => boards.set(x.tensor, i * PLANE));
    const out = await s.run({
      boards: new ort.Tensor('float32', boards, [n, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE]),
      elos_self: new ort.Tensor('int64', BigInt64Array.from(req.items.map((it) => BigInt(eloToCategory(it.eloSelf)))), [n]),
      elos_oppo: new ort.Tensor('int64', BigInt64Array.from(req.items.map((it) => BigInt(eloToCategory(it.eloOppo)))), [n]),
    });
    const logits = out.logits_maia!.data as Float32Array;
    const per = logits.length / n;
    reply({ id: req.id, ok: true, results: encoded.map((x, i) => policyFromLogits(logits.subarray(i * per, (i + 1) * per), x.legal)) });
  } catch (err) {
    session = null;
    reply({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
