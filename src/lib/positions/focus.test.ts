import { describe, expect, it } from 'vitest';
import type { MoveReview } from '../types';
import { categoriesOf, focusPopulation, focusShifts, focusWeights, priorityOf, type FocusMove, type GameContext, type PopulationGame } from './focus';

// A middlegame position (full material, past the opening plies).
const MIDDLE = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const move = (over: Partial<MoveReview>): MoveReview =>
  ({ ply: 31, color: 'white', san: 'Nf3', uci: 'g1f3', fenBefore: MIDDLE, fenAfter: MIDDLE, classification: 'mistake', winBefore: 50, winAfter: 38, loss: 12, timeSpent: 10, clock: 300, ...over }) as MoveReview;
const ctx: GameContext = { base: 600, medianSpent: 10, fromPosition: false };
const cats = (over: Partial<MoveReview>, c: GameContext = ctx) => categoriesOf(move(over), c);

describe('focus categories', () => {
  it('splits situation at 70 and 30', () => {
    expect(cats({ winBefore: 70 })).toContain('convert');
    expect(cats({ winBefore: 69.9 })).toContain('balanced');
    expect(cats({ winBefore: 30 })).toContain('defend');
  });

  it('low clock is under 10% of the base, and wins over fast', () => {
    expect(cats({ clock: 59 })).toContain('lowClock');
    expect(cats({ clock: 60 })).not.toContain('lowClock');
    expect(cats({ clock: 30, timeSpent: 1 })).not.toContain('fast');
  });

  it('fast is under half your median think time in that game', () => {
    expect(cats({ timeSpent: 4.9 })).toContain('fast');
    expect(cats({ timeSpent: 5 })).not.toContain('fast');
  });

  it('daily games get no clock focus', () => {
    expect(cats({ timeSpent: 1, clock: 1 }, { base: null, medianSpent: 10, fromPosition: false })).not.toEqual(expect.arrayContaining(['fast']));
  });

  it('severity follows the loss, and a miss is its own focus', () => {
    expect(cats({ loss: 20 })).toContain('blunder');
    expect(cats({ loss: 19.9 })).toContain('mistake');
    expect(cats({ loss: 10 })).toContain('mistake');
    expect(cats({ loss: 5 })).toContain('inaccuracy');
    expect(cats({ classification: 'miss' })).toContain('miss');
  });

  it('phase comes from the ply and the material', () => {
    expect(cats({ ply: 12 })).toContain('opening');
    expect(cats({ ply: 31 })).toContain('middlegame');
    expect(cats({ ply: 12 }, { ...ctx, fromPosition: true })).toContain('middlegame');
  });
});

describe('focus weights', () => {
  const NOW = Date.UTC(2026, 8, 10);
  const DAY = 86_400_000;
  type G = PopulationGame;
  const games = (n: number, ageDays: number, prefix: string, over: Partial<G> = {}): G[] =>
    Array.from({ length: n }, (_, i) => ({ gameId: `${prefix}${i}`, endTime: NOW - ageDays * DAY - i, timeClass: 'rapid', rated: true, analysed: true, ...over }));
  const mv = (gameId: string, loss: number, categories: FocusMove['categories']): FocusMove => ({ gameId, endTime: 0, loss, categories });
  const weightsOf = (moves: FocusMove[], g: G[]) => focusWeights(moves, focusPopulation(g, NOW), NOW);

  it('uses your recent run of 30 analysed games, and says provisional below that', () => {
    const recent = games(30, 10, 'r');
    const old = games(10, 200, 'o');
    const moves = [mv('r0', 10, ['middlegame']), mv('o0', 10, ['endgame'])];
    const w = weightsOf(moves, [...recent, ...old]);
    expect([w.windowDays, w.block, w.provisional]).toEqual([90, 30, false]);
    expect(w.shares.endgame.share).toBe(0);
    const short = weightsOf(moves, [...recent.slice(0, 29), ...old]);
    expect([short.windowDays, short.block, short.provisional]).toEqual([null, 29, true]);
    expect(short.shares.endgame.share).toBeCloseTo(0.5);
  });

  it('the run skips games still waiting at the top and stops at the first gap', () => {
    const waiting = games(3, 1, 'w', { analysed: false });
    const run = games(31, 5, 'a');
    run[20]!.analysed = false; // a win the backlog has not reached yet
    const p = focusPopulation([...waiting, ...run], NOW);
    expect(p.block).toBe(20);
    expect(p.provisional).toBe(true);
    // Losses analysed first would otherwise tilt the numbers: the gap keeps them out of a firm run.
    expect(p.ids).not.toContain('w0');
  });

  it('bullet, daily and unrated games never count', () => {
    const p = focusPopulation([...games(30, 1, 'b', { timeClass: 'bullet' }), ...games(5, 1, 'u', { rated: false }), ...games(2, 1, 'd', { timeClass: 'daily' })], NOW);
    expect(p.ids).toEqual([]);
  });

  it('phase shares add up to 1 and small losses stay out', () => {
    const g = games(3, 1, 'g');
    const moves = [mv('g0', 30, ['middlegame']), mv('g1', 10, ['endgame']), mv('g2', 10, ['opening']), mv('g2', 4, ['opening'])];
    const w = weightsOf(moves, g);
    expect(w.shares.opening.share + w.shares.middlegame.share + w.shares.endgame.share).toBeCloseTo(1);
    expect(w.shares.middlegame.share).toBeCloseTo(0.6);
    expect(w.shares.opening.count).toBe(1);
  });

  it('an extra focus raises the priority instead of diluting it', () => {
    const g = games(1, 1, 'g');
    const w = weightsOf([mv('g0', 10, ['middlegame', 'balanced', 'fast', 'mistake']), mv('g0', 10, ['middlegame', 'balanced', 'mistake'])], g);
    const withFast = priorityOf({ totalLoss: 10, categories: ['middlegame', 'balanced', 'fast', 'mistake'] }, w);
    const without = priorityOf({ totalLoss: 10, categories: ['middlegame', 'balanced', 'mistake'] }, w);
    expect(withFast).toBeGreaterThan(without);
  });
});

describe('focus margins', () => {
  const NOW = Date.UTC(2026, 8, 10);
  const DAY = 86_400_000;
  const game = (id: string, ageDays = 1): PopulationGame => ({ gameId: id, endTime: NOW - ageDays * DAY, timeClass: 'blitz', rated: true, analysed: true });
  const mv = (gameId: string, loss: number, categories: FocusMove['categories']): FocusMove => ({ gameId, endTime: 0, loss, categories });
  // n games: `mg` of them lost 10 points in the middlegame, the rest 10 in the endgame.
  const split = (prefix: string, n: number, mg: number) => ({
    games: Array.from({ length: n }, (_, i) => game(`${prefix}${String(i).padStart(2, '0')}`)),
    moves: Array.from({ length: n }, (_, i) => mv(`${prefix}${String(i).padStart(2, '0')}`, 10, [i < mg ? 'middlegame' : 'endgame'])),
  });

  it('the margin surrounds the share and shrinks with more games', () => {
    const small = split('s', 30, 15);
    const big = split('b', 120, 60);
    const ws = focusWeights(small.moves, focusPopulation(small.games, NOW), NOW);
    const wb = focusWeights(big.moves, focusPopulation(big.games, NOW), NOW);
    expect(ws.shares.middlegame.share).toBe(0.5);
    expect(ws.shares.middlegame.lo).toBeLessThan(0.5);
    expect(ws.shares.middlegame.hi).toBeGreaterThan(0.5);
    expect(wb.shares.middlegame.hi - wb.shares.middlegame.lo).toBeLessThan(ws.shares.middlegame.hi - ws.shares.middlegame.lo);
  });

  it('identical games leave no margin', () => {
    const same = { games: Array.from({ length: 30 }, (_, i) => game(`g${i}`)), moves: Array.from({ length: 30 }, (_, i) => mv(`g${i}`, 10, ['middlegame'])) };
    const w = focusWeights(same.moves, focusPopulation(same.games, NOW), NOW);
    expect([w.shares.middlegame.lo, w.shares.middlegame.hi]).toEqual([1, 1]);
  });

  it('the same games in any order give exactly the same numbers', () => {
    const d = split('g', 40, 13);
    const a = focusWeights(d.moves, focusPopulation(d.games, NOW), NOW);
    const b = focusWeights([...d.moves].reverse(), focusPopulation([...d.games].reverse(), NOW), NOW);
    expect(b).toEqual(a);
  });

  it('a shift of 25 points is announced, one of 3 is not', () => {
    const before = split('a', 40, 20);
    const up25 = split('b', 40, 30);
    const up3 = split('c', 40, 21);
    const pop = (g: PopulationGame[]) => focusPopulation(g, NOW);
    const big = focusShifts([...before.moves, ...up25.moves], pop(before.games), pop(up25.games));
    expect(big.middlegame).toMatchObject({ from: 0.5, to: 0.75 });
    expect(big.middlegame!.lo).toBeGreaterThan(0);
    expect(big.endgame!.hi).toBeLessThan(0);
    expect(focusShifts([...before.moves, ...up3.moves], pop(before.games), pop(up3.games))).toEqual({});
  });

  it('nothing is announced while either side is provisional', () => {
    const before = split('a', 20, 0);
    const after = split('b', 40, 40);
    expect(focusShifts([...before.moves, ...after.moves], focusPopulation(before.games, NOW), focusPopulation(after.games, NOW))).toEqual({});
  });
});
