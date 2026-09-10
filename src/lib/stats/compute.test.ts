import { describe, expect, it } from 'vitest';
import type { StoredGame } from '../types';
import { sittings } from './compute';
import { gameAccuracy } from '../review/scoring';

const g = (id: string, startMin: number, endMin: number): StoredGame => ({
  id, url: '', archive: '', timeClass: 'rapid', timeControl: '1800', rated: true,
  endTime: endMin * 60000, startTime: startMin * 60000, userColor: 'white', userRating: 1400, oppRating: 1400,
  oppName: 'x', outcome: 'loss', userResult: 'resigned', oppResult: 'win', moves: [], clocks: [], pgn: '',
});

describe('sittings', () => {
  it('keeps back-to-back long games together (measured end to next start)', () => {
    // Two 50-minute games with a 5-minute break: one sitting.
    expect(sittings([g('a', 0, 50), g('b', 55, 105)])).toHaveLength(1);
  });
  it('splits on a real break', () => {
    expect(sittings([g('a', 0, 50), g('b', 120, 170)])).toHaveLength(2);
  });
});

describe('game accuracy colors', () => {
  it('credits each move to its real mover when Black starts', () => {
    // Black moves first and blunders; White then plays perfectly.
    const acc = gameAccuracy([{ color: 'black', accuracy: 10 }, { color: 'white', accuracy: 100 }, { color: 'black', accuracy: 100 }]);
    expect(acc.black).toBeLessThan(acc.white);
  });
});
