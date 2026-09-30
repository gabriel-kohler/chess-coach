import { describe, expect, it } from 'vitest';
import { backlogCut, selectAutoGames, type AutoCandidate } from './select';

const g = (id: string, endTime: number, outcome: AutoCandidate['outcome'], over: Partial<AutoCandidate> = {}): AutoCandidate => ({ id, endTime, outcome, timeClass: 'rapid', rated: true, ...over });

describe('automatic analysis selection', () => {
  const games = [
    g('w-new', 100, 'win'),
    g('l-old', 40, 'loss'),
    g('d-mid', 70, 'draw'),
    g('l-new', 90, 'loss'),
    g('bullet', 95, 'loss', { timeClass: 'bullet' }),
    g('casual', 96, 'loss', { rated: false }),
    g('blitz', 80, 'win', { timeClass: 'blitz' }),
    g('ancient', 10, 'loss'),
  ];

  it('losses first, then draws, then wins; newest first in each; only rated rapid and blitz', () => {
    expect(selectAutoGames(games, new Set(), 30)).toEqual(['l-new', 'l-old', 'd-mid', 'w-new', 'blitz']);
  });

  it('skips what is analysed and what is older than the cut', () => {
    expect(selectAutoGames(games, new Set(['l-new']), 50)).toEqual(['d-mid', 'w-new', 'blitz']);
  });

  it('the cut is the Nth most recent game that counts, or the oldest one', () => {
    expect(backlogCut(games, 3)).toBe(80); // w-new 100, l-new 90, blitz 80
    expect(backlogCut(games, 60)).toBe(10);
    expect(backlogCut([g('b', 1, 'win', { timeClass: 'bullet' })], 60)).toBeNull();
  });
});
