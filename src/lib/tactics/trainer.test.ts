import { Rating } from 'ts-fsrs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { Puzzle, TacticsState } from '../types';
import { calcOf, countsAsDailyTactics, detectMotifs, duePuzzles, isCalcPuzzle, isMastered, levelProgress, puzzleBucket, recordAttempt, themeRating, themeWeights, type SessionItem } from './trainer';
import { importance } from './themes';

const state = (over: Partial<TacticsState> = {}): TacticsState => ({
  rating: { rating: 1500, rd: 80, vol: 0.06 },
  themes: {},
  placementDone: true,
  recent: [],
  stretch: 0,
  history: [],
  updatedAt: Date.now(),
  ...over,
});

describe('countsAsDailyTactics', () => {
  it('only the daily session modes count, not warm-up, punish, Cálculo or Posições', () => {
    const counted = (['new', 'review', 'placement', 'mine', 'warmup', 'punish', 'calc'] as const).filter((mode) => countsAsDailyTactics({ mode }));
    expect(counted).toEqual(['new', 'review', 'placement']);
  });
});

describe('detectMotifs', () => {
  it('sees a knight fork of king and rook', () => {
    // White Nf3 forks via Nd4-c6? Use a clean position: Ne5 to f7 forks Rh8 and Qd8.
    const fen = 'r2qk2r/ppp2ppp/8/4N3/8/8/PPP2PPP/R3K2R w KQkq - 0 1';
    expect(detectMotifs(fen, ['e5f7'])).toContain('fork');
  });

  it('sees a free piece', () => {
    const fen = '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1';
    expect(detectMotifs(fen, ['d1d5'])).toContain('hangingPiece');
  });

  it('labels short mates and back-rank mates', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const m = detectMotifs(fen, ['d1d8'], { mate: 1 });
    expect(m).toContain('mateIn1');
    expect(m).toContain('backRankMate');
  });
});

describe('curriculum', () => {
  it('weights forks and hanging pieces above quiet moves for club players', () => {
    expect(importance('hangingPiece', 1300)).toBeGreaterThan(importance('quietMove', 1300));
    expect(importance('quietMove', 2200)).toBeGreaterThan(importance('quietMove', 1300));
  });

  it('shrinks a theme rating toward the global one while data is thin', () => {
    const s = state({ themes: { fork: { rating: 1200, rd: 200, vol: 0.06, attempts: 2, solved: 0, lastAt: Date.now() } } });
    const r = themeRating(s, 'fork');
    expect(r).toBeGreaterThan(1200);
    expect(r).toBeLessThan(1500);
  });

  it('gives a weak theme more weight than a strong one', () => {
    const now = Date.now();
    const s = state({
      themes: {
        pin: { rating: 1200, rd: 80, vol: 0.06, attempts: 40, solved: 10, lastAt: now },
        skewer: { rating: 1800, rd: 80, vol: 0.06, attempts: 40, solved: 30, lastAt: now },
      },
    });
    const w = themeWeights(s);
    expect(w.pin! / importance('pin', 1500)).toBeGreaterThan(w.skewer! / importance('skewer', 1500));
  });

  it('level progress points at the next hundred', () => {
    const p = levelProgress(state({ rating: { rating: 1537, rd: 70, vol: 0.06 } }));
    expect(p.current).toBe(1500);
    expect(p.next).toBe(1600);
    expect(p.ready).toBe(false);
  });
});

describe('failed puzzles on FSRS', () => {
  const puzzle = (id: string): Puzzle => ({ id, source: 'lichess', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', moves: ['g8f8', 'd1d8'], rating: 1500, themes: ['backRankMate'] });
  const item = (id: string, mode: SessionItem['mode'] = 'new'): SessionItem => ({ puzzle: puzzle(id), mode, reason: '' });

  beforeEach(async () => {
    await Promise.all([db.srsCards.clear(), db.reviewLogs.clear(), db.attempts.clear(), db.kv.clear()]);
  });

  it('a miss joins the review queue and comes back the next day', async () => {
    const before = Date.now();
    const out = await recordAttempt(item('p1'), { solved: false, timeMs: 12_000 });
    expect(out.review?.rating).toBe(Rating.Again);
    const card = (await db.srsCards.get('puzzle:p1'))!;
    expect(card.kind).toBe('puzzle');
    expect(card.due - before).toBeGreaterThanOrEqual(86_400_000);
    expect(card.due - before).toBeLessThan(86_400_000 + 5_000);
    expect(await duePuzzles(before + 86_400_000 + 5_000)).toHaveLength(1);
  });

  it('a new puzzle solved first try needs no review', async () => {
    const out = await recordAttempt(item('p2'), { solved: true, timeMs: 5_000 });
    expect(out.review).toBeNull();
    expect(await db.srsCards.count()).toBe(0);
  });

  it('a review solved fast is Easy and goes out further than a slow one', async () => {
    await recordAttempt(item('fast'), { solved: false, timeMs: 9_000 });
    await recordAttempt(item('slow'), { solved: false, timeMs: 9_000 });
    const fast = await recordAttempt(item('fast', 'review'), { solved: true, timeMs: 2_000 }); // one move to find: 10 s expected
    const slow = await recordAttempt(item('slow', 'review'), { solved: true, timeMs: 30_000 });
    expect([fast.review?.rating, slow.review?.rating]).toEqual([Rating.Easy, Rating.Hard]);
    expect(fast.review!.due).toBeGreaterThan(slow.review!.due);
    // Reviews never move the rating.
    expect(fast.after).toBe(fast.before);
  });

  it('a warm-up puzzle never moves the rating nor the difficulty; a miss still joins the reviews', async () => {
    const out = await recordAttempt(item('w1', 'warmup'), { solved: false, timeMs: 5_000 });
    expect(out.after).toBe(out.before);
    expect(out.state.recent).toEqual([]);
    expect(out.state.themes).toEqual({});
    expect(out.review?.rating).toBe(Rating.Again);
    expect((await db.attempts.toArray()).map((a) => a.mode)).toEqual(['warmup']);
  });

  it('punishing an opening mistake: a card even when solved, and nothing of the tactics moves', async () => {
    const punish: SessionItem = { puzzle: { ...puzzle('punish:e1'), source: 'punish', themes: ['opening'] }, mode: 'punish', reason: '' };
    const out = await recordAttempt(punish, { solved: true, timeMs: 3_000 });
    expect(out.after).toBe(out.before);
    expect(out.state.recent).toEqual([]);
    expect(out.state.themes).toEqual({});
    expect(out.review).not.toBeNull();
    expect(await db.srsCards.get('puzzle:punish:e1')).toMatchObject({ kind: 'puzzle', reps: 1 });
    // A Lichess opening puzzle in the same session: unrated, and solved it needs no card.
    const lichess = await recordAttempt({ puzzle: puzzle('L1'), mode: 'punish', reason: '' }, { solved: true, timeMs: 3_000 });
    expect(lichess.after).toBe(lichess.before);
    expect(lichess.review).toBeNull();
    // Its fast solves stay out of the puzzles' expected time.
    const { loadExpectedTimes } = await import('../positions/store');
    const { POSITIONS } = await import('../positions/config');
    // More than the 20 samples the median needs.
    for (let k = 0; k < 25; k++) await recordAttempt({ ...punish, puzzle: { ...punish.puzzle, id: `punish:q${k}` } }, { solved: true, timeMs: 1_000 });
    expect((await loadExpectedTimes('puzzle')).easy).toBe(POSITIONS.defaultExpectedMs.easy);
  });

  it('Cálculo moves its own rating, not the tactics one, and a miss still joins the reviews', async () => {
    const long: SessionItem = { puzzle: { ...puzzle('c1'), moves: ['g8f8', 'd1d8', 'f8e7', 'd8e8', 'e7d6', 'e8e6'], themes: ['master', 'deflection'] }, mode: 'calc', reason: '' };
    const out = await recordAttempt(long, { solved: true, timeMs: 40_000 });
    expect(out.after).toBeGreaterThan(out.before);
    expect(out.state.rating.rating).toBe(1500);
    expect(out.state.themes).toEqual({});
    expect(out.state.recent).toEqual([]);
    expect(calcOf(out.state).rating.rating).toBe(out.after);
    expect(calcOf(out.state).recent).toEqual([true]);
    expect(calcOf(out.state).history).toHaveLength(1);
    expect(out.review).toBeNull();
    const miss = await recordAttempt({ ...long, puzzle: { ...long.puzzle, id: 'c2' } }, { solved: false, timeMs: 60_000 });
    expect(miss.after).toBeLessThan(miss.before);
    expect(miss.review?.rating).toBe(Rating.Again);
    const rows = await db.attempts.toArray();
    expect(rows.map((a) => a.mode)).toEqual(['calc', 'calc']);
    expect(rows[0]!.ratingAfter).toBe(out.after);
  });

  it('a Cálculo puzzle comes from a titled player\'s game with three moves or more to find', () => {
    const short = puzzle('s');
    expect(isCalcPuzzle({ ...short, themes: ['master'] })).toBe(false);
    const long = { ...short, moves: ['a', 'b', 'c', 'd', 'e', 'f'] };
    expect(isCalcPuzzle(long)).toBe(false);
    expect(isCalcPuzzle({ ...long, themes: ['superGM', 'fork'] })).toBe(true);
  });

  it('a state saved before Cálculo gets one at the tactics rating, unsure', () => {
    const c = calcOf(state({ rating: { rating: 1800, rd: 60, vol: 0.06 } }));
    expect(c.rating).toEqual({ rating: 1800, rd: 200, vol: 0.06 });
    expect(c.history).toEqual([]);
  });

  it('a training step saved twice (a reload) schedules one review', async () => {
    await recordAttempt(item('x', 'review'), { solved: false, timeMs: 5_000 }, { attemptId: 'daily-1|s3' });
    await recordAttempt(item('x', 'review'), { solved: false, timeMs: 5_000 }, { attemptId: 'daily-1|s3' });
    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('mastered means FSRS gives the puzzle over a month', () => {
    expect(isMastered({ stability: 35 } as never)).toBe(true);
    expect(isMastered({ stability: 16 } as never)).toBe(false);
  });

  it('the solution length sets the expected-time bucket', () => {
    expect(puzzleBucket(puzzle('a'))).toBe('easy');
    expect(puzzleBucket({ ...puzzle('b'), moves: ['a', 'b', 'c', 'd'] })).toBe('medium');
    expect(puzzleBucket({ ...puzzle('c'), moves: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe('hard');
  });
});
