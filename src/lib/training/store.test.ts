// @vitest-environment node
import { Rating, State } from 'ts-fsrs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getKV, setKV } from '../db';
import { TRAINING } from './config';
import { TRAINING_KEYS } from './keys';
import { attemptIdOf, recordResult } from './session';
import type { PlannedStep, TrainingSession } from './types';

const planned: PlannedStep[] = [
  { block: 'review', item: { kind: 'best', cardId: 'best:1', note: 'n1' }, estMs: 30_000, reason: '' },
  { block: 'tactics', item: { kind: 'puzzle', item: { puzzle: { id: 'p1', source: 'lichess', fen: '', moves: [], rating: 1500, themes: [] }, mode: 'review', reason: '' } }, estMs: 35_000, reason: '' },
  { block: 'tactics', item: { kind: 'puzzle', item: { puzzle: { id: 'p2', source: 'lichess', fen: '', moves: [], rating: 1500, themes: [] }, mode: 'new', reason: '' } }, estMs: 35_000, reason: '' },
];
const compose = { daily: 0, warmup: 0 };
let release: () => void = () => undefined;
vi.mock('./sources.ts', () => ({
  loadDaily: vi.fn(async () => {
    compose.daily++;
    await new Promise<void>((r) => (release = r));
    return { steps: planned, leftover: 0, notes: [] };
  }),
  loadWarmup: vi.fn(async () => {
    compose.warmup++;
    return { steps: planned.slice(1), notes: [] };
  }),
}));

const { openTraining, readSession, reconcileSession, updateSession } = await import('./store');

const NOW = new Date(2026, 8, 11, 9, 0).getTime();
const DAY = 86_400_000;

async function opened(mode: 'daily' | 'warmup', now: number): Promise<TrainingSession> {
  const p = openTraining(mode, now);
  await vi.waitFor(() => expect(compose.daily + compose.warmup).toBeGreaterThan(0));
  release();
  return p;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  compose.daily = 0;
  compose.warmup = 0;
});

describe('the stored session', () => {
  it('is put together once, even when two screens ask at the same time', async () => {
    const a = openTraining('daily', NOW);
    const b = openTraining('daily', NOW);
    await vi.waitFor(() => expect(compose.daily).toBe(1));
    release();
    const [x, y] = await Promise.all([a, b]);
    expect(x.id).toBe(y.id);
    expect(compose.daily).toBe(1);
    expect((await getKV<TrainingSession | null>(TRAINING_KEYS.daily, null))?.id).toBe(x.id);
  });

  it('Treinar resumes the same day and starts over on the next', async () => {
    const first = await opened('daily', NOW);
    const again = await openTraining('daily', NOW + 5 * 60 * 60_000);
    expect(again.id).toBe(first.id);
    expect(compose.daily).toBe(1);
    expect(await readSession('daily', NOW + DAY)).toBeNull();
    // A session stored in an older shape is rebuilt.
    await setKV(TRAINING_KEYS.daily, { ...first, version: TRAINING.version - 1 });
    expect(await readSession('daily', NOW)).toBeNull();
  });

  it('Aquecer resumes only within half an hour, and never once finished', async () => {
    const w = await openTraining('warmup', NOW);
    expect(await readSession('warmup', NOW + 29 * 60_000)).not.toBeNull();
    expect(await readSession('warmup', NOW + 31 * 60_000)).toBeNull();
    await setKV(TRAINING_KEYS.warmup, { ...w, finishedAt: NOW + 60_000 });
    expect(await readSession('warmup', NOW + 2 * 60_000)).toBeNull();
  });

  it('applies changes one at a time on the latest version: none is lost', async () => {
    const s = await opened('daily', NOW);
    const ok = { at: NOW, ms: 1_000, outcome: 'good' as const, label: '' };
    await Promise.all([updateSession('daily', (x) => recordResult(x, s.steps[0]!.id, ok)), updateSession('daily', (x) => recordResult(x, s.steps[2]!.id, ok))]);
    const stored = (await getKV<TrainingSession | null>(TRAINING_KEYS.daily, null))!;
    expect(stored.steps.map((x) => x.status)).toEqual(['done', 'pending', 'done']);
  });
});

describe('back after a reload', () => {
  it('a step saved before the reload is done; a review puzzle with only older attempts is not', async () => {
    const s = await opened('daily', NOW);
    const bestStep = s.steps[0]!;
    await db.srsCards.put({ id: 'best:1', kind: 'best', note: 'n1', suspended: 0, last_review: NOW + 1_000 } as never);
    await db.reviewLogs.add({ attemptId: attemptIdOf(s, bestStep), cardId: 'best:1', kind: 'best', at: NOW + 1_000, rating: Rating.Again, timeMs: 8_000, after: { state: State.Relearning, due: NOW + 61_000 } } as never);
    const attempt = { source: 'lichess' as const, timeMs: 6_000, puzzleRating: 1500, ratingBefore: 1500, ratingAfter: 1500, themes: [], mode: 'review' as const };
    await db.attempts.add({ ...attempt, puzzleId: 'p1', at: NOW - DAY, solved: false });
    await db.attempts.add({ ...attempt, puzzleId: 'p2', at: NOW + 2_000, solved: true, mode: 'new' });
    const back = await reconcileSession(s);
    expect(back.steps.map((x) => x.status)).toEqual(['done', 'pending', 'done']);
    expect(back.steps[0]!.result).toMatchObject({ outcome: 'fail', grade: Rating.Again });
    // It is still learning: it comes back in this session.
    expect(back.learning['best:1']).toEqual({ kind: 'best', due: NOW + 61_000 });
  });

  it('a position taken out of your training is skipped', async () => {
    const s = await opened('daily', NOW);
    const back = await reconcileSession(s, s.steps[0]!.id);
    expect(back.steps[0]).toMatchObject({ status: 'skipped' });
    expect(back.steps[2]!.status).toBe('pending'); // only the step asked for
  });
});
