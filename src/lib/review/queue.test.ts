// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../test/positionFixtures';
import { db } from '../db';
import { ANALYSIS_VERSION } from '../types';
import type { AnalyzeOptions } from './analyze';

// The engine is replaced by a fake whose games finish when the test says so.
const calls: Array<{ id: string; opts: AnalyzeOptions }> = [];
const finish = new Map<string, () => void>();
vi.mock('./analyze.ts', () => ({
  canRescore: () => false,
  rescoreGame: vi.fn(),
  analyzeGame: vi.fn(
    (game: { id: string }, opts: AnalyzeOptions) =>
      new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        // Like the engine pool, a signal already aborted stops before any position.
        if (opts.signal?.aborted) return abort();
        calls.push({ id: game.id, opts });
        finish.set(game.id, () => resolve({ gameId: game.id }));
        opts.signal?.addEventListener('abort', abort);
      }),
  ),
}));
vi.mock('../positions/store.ts', () => ({ syncPositionCards: vi.fn(async () => undefined) }));

const { cancelQueue, clearQueue, enqueueAnalysis, getQueueState, resetQueueForTests, resumeAuto, setAutoQueue, whenIdle } = await import('./queue');

const mine = { depth: 18, workers: 3 };
const running = () => calls[calls.length - 1]!;
const settle = () => vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
async function done(id: string) {
  const before = calls.length;
  finish.get(id)!();
  await vi.waitFor(() => expect(calls.length > before || !getQueueState().running).toBe(true));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.games.bulkPut(['a1', 'a2', 'a3', 'm1', 'm2'].map((id) => makeGame({ id })));
  calls.length = 0;
  finish.clear();
  resetQueueForTests();
});

afterEach(async () => {
  clearQueue();
  await whenIdle();
});

describe('analysis queue', () => {
  it('automatic games run with one worker at the fixed depth and no 4 s cut', async () => {
    setAutoQueue(['a1', 'a2']);
    await settle();
    expect(running()).toMatchObject({ id: 'a1', opts: { depth: 16, workers: 1, movetime: 30_000 } });
    expect(running().opts.wait).toBeTypeOf('function');
    expect(getQueueState()).toMatchObject({ currentAuto: true, autoPending: 1 });
  });

  it('a request of yours interrupts the automatic game, which goes back first in line', async () => {
    setAutoQueue(['a1', 'a2']);
    await settle();
    enqueueAnalysis(['m1'], mine);
    await vi.waitFor(() => expect(running().id).toBe('m1'));
    expect(running().opts).toMatchObject({ depth: 18, workers: 3 });
    expect(running().opts.wait).toBeUndefined();
    expect(getQueueState().pending).toEqual(['a1', 'a2']);
    await done('m1');
    await vi.waitFor(() => expect(running().id).toBe('a1'));
  });

  it('your requests go after each other and before every automatic game', async () => {
    setAutoQueue(['a1', 'a2', 'a3']);
    await settle();
    enqueueAnalysis(['m1'], mine);
    enqueueAnalysis(['m2'], mine);
    await vi.waitFor(() => expect(running().id).toBe('m1'));
    expect(getQueueState().pending).toEqual(['m2', 'a1', 'a2', 'a3']);
  });

  it('asking now for a game waiting in the automatic queue makes it yours', async () => {
    setAutoQueue(['a1', 'a2']);
    await settle();
    enqueueAnalysis(['a2'], mine, true);
    await vi.waitFor(() => expect(running().id).toBe('a2'));
    expect(running().opts).toMatchObject({ depth: 18, workers: 3 });
    expect(getQueueState().pending).toEqual(['a1']);
  });

  it('"Parar" pauses the automatic analysis until "Retomar"', async () => {
    setAutoQueue(['a1', 'a2']);
    await settle();
    cancelQueue();
    await whenIdle();
    expect(getQueueState()).toMatchObject({ running: false, autoSuspended: true, pending: ['a1', 'a2'], autoPending: 2 });
    // A request of yours still runs while the automatic ones wait.
    enqueueAnalysis(['m1'], mine);
    await vi.waitFor(() => expect(running().id).toBe('m1'));
    await done('m1');
    await whenIdle();
    expect(getQueueState().pending).toEqual(['a1', 'a2']);
    resumeAuto();
    await vi.waitFor(() => expect(running().id).toBe('a1'));
  });

  it('a new automatic order replaces the old one and keeps your requests ahead', async () => {
    setAutoQueue(['a1', 'a2', 'a3']);
    await settle();
    enqueueAnalysis(['m1'], mine);
    await vi.waitFor(() => expect(running().id).toBe('m1'));
    setAutoQueue(['a3', 'a2']);
    expect(getQueueState().pending).toEqual(['a3', 'a2']);
  });

  it('asking for the automatic game while it finishes runs it again with your options', async () => {
    const { syncPositionCards } = await import('../positions/store.ts');
    let release!: () => void;
    vi.mocked(syncPositionCards).mockImplementationOnce(() => new Promise((r) => (release = () => r(undefined as never))));
    setAutoQueue(['a1']);
    await settle();
    finish.get('a1')!();
    // The engine is done and the cards are syncing: the abort no longer lands.
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    enqueueAnalysis(['a1'], mine, true);
    release();
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(running()).toMatchObject({ id: 'a1', opts: { depth: 18, workers: 3 } });
    expect(running().opts.wait).toBeUndefined();
  });

  it('a game already analysed at that depth is not analysed again', async () => {
    await db.analyses.put({ gameId: 'a1', version: ANALYSIS_VERSION, depth: 16, createdAt: 0, evals: [], moves: [], accuracy: { white: 0, black: 0 } });
    setAutoQueue(['a1', 'a2']);
    await vi.waitFor(() => expect(running().id).toBe('a2'));
    expect(calls.map((c) => c.id)).toEqual(['a2']);
    expect(getQueueState().finished).toBe(1);
  });
});
