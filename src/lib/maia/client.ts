// Main-thread side of Maia-2: one worker, loaded on first use, requests
// matched by id. Everything degrades to "unavailable" when the model is not
// installed (npm run setup:maia).
import type { HumanMove } from './encode.ts';
import type { MaiaRequest, MaiaResponse } from './maia.worker.ts';

export type { HumanMove };

const MODEL_URL = '/maia/maia2_rapid.onnx';
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: MaiaResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./maia.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<MaiaResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    p.resolve(e.data);
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Maia worker failed'));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

type RequestBody = MaiaRequest extends infer R ? (R extends MaiaRequest ? Omit<R, 'id'> : never) : never;

function call(msg: RequestBody): Promise<MaiaResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id } as MaiaRequest);
  });
}

let available: Promise<boolean> | null = null;

/**
 * Whether the model file is installed. `no-store` avoids a conditional request
 * (a 304 carries no headers to check); a missing file comes back as the app's
 * own HTML page (the dev server's fallback), not as a 404. Only a yes is
 * remembered, so installing the model needs no reload of this check.
 */
export function maiaAvailable(): Promise<boolean> {
  available ??= fetch(MODEL_URL, { method: 'HEAD', cache: 'no-store' })
    .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
    .catch(() => false)
    .then((ok) => {
      if (!ok) available = null;
      return ok;
    });
  return available;
}

let loaded: Promise<void> | null = null;

/** Loads the model in the worker (about 85 MB, once per page load). */
export function loadMaia(): Promise<void> {
  loaded ??= call({ type: 'load' }).then((r) => {
    if (!r.ok) {
      loaded = null;
      throw new Error(r.error);
    }
  });
  return loaded;
}

export interface MaiaQuery {
  fen: string;
  /** Rating of the player to move, on Maia's (Lichess) scale. */
  eloSelf: number;
  eloOppo: number;
}

/** Human move probabilities for several positions in one model run. */
export async function maiaPolicies(items: MaiaQuery[]): Promise<HumanMove[][]> {
  if (!items.length) return [];
  await loadMaia();
  const r = await call({ type: 'predict', items });
  if (!r.ok) throw new Error(r.error);
  return r.results ?? [];
}

export async function maiaPolicy(fen: string, eloSelf: number, eloOppo = eloSelf): Promise<HumanMove[]> {
  return (await maiaPolicies([{ fen, eloSelf, eloOppo }]))[0] ?? [];
}
