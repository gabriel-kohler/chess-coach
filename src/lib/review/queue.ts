// Background analysis queue shared by every page. Each finished game also
// turns your mistakes in it into Posições cards.
//
// Two kinds of items share it. What you ask for (a game, "analyse the 20
// latest losses") always goes first, with your depth and workers. The
// automatic analysis after each sync runs behind it, with one worker at a
// fixed depth, and waits while you train; a request of yours interrupts it,
// and the interrupted game goes back to the queue.
import { useSyncExternalStore } from 'react';
import { db } from '../db.ts';
import { syncPositionCards } from '../positions/store.ts';
import { gate } from '../renewal/activity.ts';
import { RENEWAL } from '../renewal/config.ts';
import { ANALYSIS_VERSION } from '../types.ts';
import { analyzeGame, canRescore, rescoreGame } from './analyze.ts';

export interface QueueState {
  running: boolean;
  current: string | null;
  /** The game being analysed is an automatic one. */
  currentAuto: boolean;
  plyDone: number;
  plyTotal: number;
  pending: string[];
  /** Automatic games waiting, part of `pending`. */
  autoPending: number;
  /** "Parar" pauses the automatic analysis until "Retomar" or a reload. */
  autoSuspended: boolean;
  finished: number;
  error: string | null;
}

export interface JobOptions {
  depth: number;
  workers: number;
  movetime?: number;
  auto?: boolean;
}

export const AUTO_OPTIONS: JobOptions = { depth: RENEWAL.autoDepth, workers: RENEWAL.autoWorkers, movetime: RENEWAL.autoSafetyMs, auto: true };

const INITIAL: QueueState = { running: false, current: null, currentAuto: false, plyDone: 0, plyTotal: 0, pending: [], autoPending: 0, autoSuspended: false, finished: 0, error: null };
let state: QueueState = INITIAL;
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
/** Options of every waiting or running game. */
const jobs = new Map<string, JobOptions>();
/** The running automatic game was stopped to make way, not cancelled: it goes back. */
let preempted: string | null = null;
let idleWaiters: Array<() => void> = [];

const isAuto = (id: string) => jobs.get(id)?.auto === true;

/** Whether a waiting or running game is in the automatic analysis (re-read on every queue change). */
export const isAutoJob = isAuto;

function set(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  if (patch.pending) state.autoPending = state.pending.filter(isAuto).length;
  for (const l of listeners) l();
}

export function getQueueState(): QueueState {
  return state;
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAnalysisQueue(): QueueState {
  return useSyncExternalStore(subscribeQueue, getQueueState);
}

/** Puts manual games after the other manual ones and before every automatic one. */
function withManual(pending: string[], ids: string[], front: boolean): string[] {
  const rest = pending.filter((id) => !ids.includes(id));
  if (front) return [...ids, ...rest];
  const firstAuto = rest.findIndex(isAuto);
  const at = firstAuto < 0 ? rest.length : firstAuto;
  return [...rest.slice(0, at), ...ids, ...rest.slice(at)];
}

/** Stops the running automatic game so a request of yours starts now; it goes back to the queue. */
function preemptAuto() {
  if (state.current && state.currentAuto && controller) {
    preempted = state.current;
    controller.abort();
  }
}

export function enqueueAnalysis(ids: string[], opts: { depth: number; workers: number }, front = false) {
  const wanted = [...new Set(ids)].filter((id) => !(id === state.current && !state.currentAuto));
  // A game waiting in the automatic queue becomes yours, with your options.
  for (const id of wanted) jobs.set(id, { depth: opts.depth, workers: opts.workers });
  set({ pending: withManual(state.pending, wanted, front), error: null });
  if (wanted.length) preemptAuto();
  void run();
}

/**
 * The automatic games, in the order to analyse them. Replaces the automatic
 * part of the queue; your own requests stay ahead of it.
 */
export function setAutoQueue(ids: string[], opts: JobOptions = AUTO_OPTIONS) {
  const manual = state.pending.filter((id) => !isAuto(id));
  const auto = [...new Set(ids)].filter((id) => id !== state.current && !manual.includes(id));
  for (const id of state.pending) if (isAuto(id) && !auto.includes(id)) jobs.delete(id);
  for (const id of auto) jobs.set(id, { ...opts, auto: true });
  set({ pending: [...manual, ...auto] });
  void run();
}

/** "Parar": stops everything now; the automatic games wait until "Retomar". */
export function cancelQueue() {
  for (const id of state.pending) if (!isAuto(id)) jobs.delete(id);
  set({ pending: state.pending.filter(isAuto), autoSuspended: true });
  if (state.current) {
    if (state.currentAuto) preempted = state.current;
    controller?.abort();
  }
}

export function resumeAuto() {
  set({ autoSuspended: false });
  void run();
}

/** Every automatic game dropped (an account switch). */
export function clearQueue() {
  jobs.clear();
  preempted = null;
  set({ pending: [] });
  controller?.abort();
}

/** Resolves when nothing is running. */
export function whenIdle(): Promise<void> {
  if (!state.running) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function nextId(): string | undefined {
  return state.pending.find((id) => !state.autoSuspended || !isAuto(id));
}

async function run() {
  if (state.running) return;
  set({ running: true });
  for (let id = nextId(); id; id = nextId()) {
    const opts = jobs.get(id) ?? { depth: RENEWAL.autoDepth, workers: 2 };
    set({ current: id, currentAuto: !!opts.auto, pending: state.pending.filter((p) => p !== id), plyDone: 0, plyTotal: 0 });
    controller = new AbortController();
    try {
      const game = await db.games.get(id);
      if (game) {
        const existing = await db.analyses.get(id);
        const deepEnough = !!existing && existing.depth >= opts.depth;
        let analysis = deepEnough && existing.version === ANALYSIS_VERSION ? existing : null;
        if (!analysis && deepEnough && canRescore(existing)) analysis = await rescoreGame(game, existing);
        analysis ??= await analyzeGame(game, {
          depth: opts.depth,
          workers: opts.workers,
          movetime: opts.movetime,
          signal: controller.signal,
          wait: opts.auto ? gate : undefined,
          onProgress: (done, total) => set({ plyDone: done, plyTotal: total }),
        });
        // A failed sync must not mark the analysis as failed; the next one catches up.
        await syncPositionCards().catch(() => undefined);
      }
      // Asked for while it was finishing: the abort came too late, so the game
      // runs again with your options, which must survive this one.
      if (preempted === id) preempted = null;
      if (!state.pending.includes(id)) jobs.delete(id);
      set({ finished: state.finished + 1 });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        if (preempted === id) {
          // Interrupted to make way (or paused by "Parar"): back to the head of the automatic part.
          preempted = null;
          if (!state.pending.includes(id) && jobs.has(id)) {
            const firstAuto = state.pending.findIndex(isAuto);
            const at = firstAuto < 0 ? state.pending.length : firstAuto;
            set({ pending: [...state.pending.slice(0, at), id, ...state.pending.slice(at)] });
          }
        } else jobs.delete(id);
        continue;
      }
      jobs.delete(id);
      set({ error: (e as Error).message });
    }
  }
  controller = null;
  set({ running: false, current: null, currentAuto: false, plyDone: 0, plyTotal: 0 });
  const w = idleWaiters;
  idleWaiters = [];
  for (const f of w) f();
}

/** For tests: back to an empty queue. */
export function resetQueueForTests() {
  jobs.clear();
  preempted = null;
  idleWaiters = [];
  controller = null;
  state = INITIAL;
}
