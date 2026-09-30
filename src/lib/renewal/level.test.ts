import { describe, expect, it } from 'vitest';
import { focusPopulation, focusWeights, type FocusMove, type PopulationGame } from '../positions/focus';
import { bandOf, bandStartOf, compareFocus, levelStep, type LevelState, type RatedGame } from './level';

const rapid = (endTime: number, userRating: number, over: Partial<RatedGame> = {}): RatedGame => ({ endTime, userRating, timeClass: 'rapid', rated: true, ...over });

describe('rating bands', () => {
  it('a band is the hundred below the rating', () => {
    expect([bandOf(1499), bandOf(1500), bandOf(1612)]).toEqual([1400, 1500, 1600]);
  });

  it('the band starts at the first game at or above it, and a small dip does not restart it', () => {
    const games = [rapid(1, 1470), rapid(2, 1490), rapid(3, 1510), rapid(4, 1495), rapid(5, 1505)];
    expect(bandStartOf(games, 1500)).toBe(3);
  });

  it('a real fall below the band restarts it, and blitz or unrated games never count', () => {
    const games = [rapid(1, 1520), rapid(2, 1430), rapid(3, 1480), rapid(4, 1502), rapid(5, 1600, { timeClass: 'blitz' }), rapid(6, 1650, { rated: false })];
    expect(bandStartOf(games, 1500)).toBe(4);
    expect(bandStartOf(games, 1600)).toBeNull();
  });
});

describe('what a sync means for the level review', () => {
  const state: LevelState = { highestBand: 1400, pending: null, reports: [] };
  const games = [rapid(1, 1450), rapid(2, 1490), rapid(3, 1510)];

  it('the first time only records where you are', () => {
    expect(levelStep(null, 1370, games)).toEqual({ kind: 'init', state: { highestBand: 1300, pending: null, reports: [] } });
  });

  it('crossing from 1490 to 1510 gives the band and its start', () => {
    expect(levelStep(state, 1510, games)).toEqual({ kind: 'crossed', band: 1500, bandStart: 3 });
  });

  it('stats ahead of the archive wait as pending, once', () => {
    const early = levelStep(state, 1510, games.slice(0, 2));
    expect(early).toEqual({ kind: 'pending', state: { ...state, pending: 1500 } });
    expect(levelStep({ ...state, pending: 1500 }, 1510, games.slice(0, 2))).toEqual({ kind: 'none' });
  });

  it('going back under the highest band never repeats the report', () => {
    expect(levelStep({ ...state, highestBand: 1500 }, 1495, games)).toEqual({ kind: 'none' });
    expect(levelStep({ ...state, highestBand: 1500 }, 1530, games)).toEqual({ kind: 'none' });
  });
});

describe('before and after', () => {
  const NOW = Date.UTC(2026, 8, 10);
  const DAY = 86_400_000;
  const gamesOf = (prefix: string, n: number, age: number): PopulationGame[] =>
    Array.from({ length: n }, (_, i) => ({ gameId: `${prefix}${String(i).padStart(2, '0')}`, endTime: NOW - (age + i / 100) * DAY, timeClass: 'rapid', rated: true, analysed: true }));
  const moves = (games: PopulationGame[], middlegame: number): FocusMove[] =>
    games.map((g, i) => ({ gameId: g.gameId, endTime: g.endTime, loss: 10, categories: [i < middlegame ? 'middlegame' : 'endgame'] }));

  it('a clear shift between the two bands is marked, the same games twice give the same report', () => {
    const before = gamesOf('b', 40, 40);
    const after = gamesOf('a', 40, 5);
    const all = [...before, ...after];
    const mv = [...moves(before, 30), ...moves(after, 10)];
    const bandStart = NOW - 20 * DAY;
    const w = (now: number, since?: number) => focusWeights(mv, focusPopulation(all, now, since), now);
    const a = compareFocus(w(bandStart), w(NOW, bandStart + 1));
    const b = compareFocus(w(bandStart), w(NOW, bandStart + 1));
    expect(b).toEqual(a);
    const mg = a.find((c) => c.category === 'middlegame')!;
    expect(mg).toMatchObject({ before: 0.75, after: 0.25, changed: true });
    expect(a.find((c) => c.category === 'opening')!.changed).toBe(false);
  });

  it('with few games in the new band nothing is marked, and no game from before leaks in', () => {
    const before = gamesOf('b', 40, 40);
    const after = gamesOf('a', 10, 5);
    const bandStart = NOW - 20 * DAY;
    const pop = focusPopulation([...before, ...after], NOW, bandStart + 1);
    expect(pop.provisional).toBe(true);
    expect(pop.ids.every((id) => id.startsWith('a'))).toBe(true);
    const mv = [...moves(before, 30), ...moves(after, 0)];
    const cmp = compareFocus(focusWeights(mv, focusPopulation([...before, ...after], bandStart), bandStart), focusWeights(mv, pop, NOW));
    expect(cmp.some((c) => c.changed)).toBe(false);
  });
});
