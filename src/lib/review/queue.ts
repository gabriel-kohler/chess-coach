// Background analysis queue shared by every page. Each finished game also
// feeds your own mistakes into the tactics trainer.
import { useSyncExternalStore } from 'react';
import { db } from '../db.ts';
import { addMistakePuzzles, refreshGameMotifs } from '../tactics/trainer.ts';
import { ANALYSIS_VERSION } from '../types.ts';
import { analyzeGame } from './analyze.ts';

export interface QueueState {
  running: boolean;
  current: string | null;
  plyDone: number;
  plyTotal: number;
  pending: string[];
  finished: number;
  error: string | null;
}

let state: QueueState = { running: false, current: null, plyDone: 0, plyTotal: 0, pending: [], finished: 0, error: null };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let options = { depth: 16, workers: 2 };

function set(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useAnalysisQueue(): QueueState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function enqueueAnalysis(ids: string[], opts: { depth: number; workers: number }, front = false) {
  options = opts;
  const fresh = ids.filter((id) => id !== state.current && !state.pending.includes(id));
  set({ pending: front ? [...fresh, ...state.pending] : [...state.pending, ...fresh], error: null });
  void run();
}

export function cancelQueue() {
  controller?.abort();
  set({ pending: [] });
}

async function run() {
  if (state.running) return;
  set({ running: true });
  while (state.pending.length) {
    const [id, ...rest] = state.pending;
    set({ current: id!, pending: rest, plyDone: 0, plyTotal: 0 });
    const game = await db.games.get(id!);
    if (!game) continue;
    const existing = await db.analyses.get(id!);
    let analysis = existing && existing.depth >= options.depth && existing.version === ANALYSIS_VERSION ? existing : null;
    controller = new AbortController();
    try {
      analysis ??= await analyzeGame(game, {
        ...options,
        signal: controller.signal,
        onProgress: (done, total) => set({ plyDone: done, plyTotal: total }),
      });
      await addMistakePuzzles(game, analysis);
      await refreshGameMotifs();
      set({ finished: state.finished + 1 });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // "Parar" cleared the queue; anything queued since then still runs.
        if (!state.pending.length) break;
        continue;
      }
      set({ error: (e as Error).message });
    }
  }
  set({ running: false, current: null, plyDone: 0, plyTotal: 0 });
}
