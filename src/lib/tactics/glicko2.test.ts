import { describe, expect, it } from 'vitest';
import { decay, expectedScore, update } from './glicko2';

describe('glicko2', () => {
  it('matches the reference example for a single game (Glickman 2013)', () => {
    // Player 1500/200/0.06 beats a 1400/30 opponent.
    const after = update({ rating: 1500, rd: 200, vol: 0.06 }, 1400, 1, 30);
    expect(after.rating).toBeGreaterThan(1560);
    expect(after.rating).toBeLessThan(1575);
    expect(after.rd).toBeLessThan(200);
  });

  it('moves more when uncertain', () => {
    const sure = update({ rating: 1500, rd: 60, vol: 0.06 }, 1500, 1);
    const unsure = update({ rating: 1500, rd: 300, vol: 0.06 }, 1500, 1);
    expect(unsure.rating - 1500).toBeGreaterThan(sure.rating - 1500);
  });

  it('losing to an easier puzzle costs more than to a harder one', () => {
    const p = { rating: 1600, rd: 80, vol: 0.06 };
    expect(1600 - update(p, 1300, 0).rating).toBeGreaterThan(1600 - update(p, 1900, 0).rating);
  });

  it('expected score is 50% at equal ratings and falls for harder puzzles', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 5);
    expect(expectedScore(1500, 1700)).toBeLessThan(0.3);
  });

  it('rd grows with inactivity', () => {
    expect(decay({ rating: 1500, rd: 60, vol: 0.06 }, 30).rd).toBeGreaterThan(60);
  });
});
