import { default_w, forgetting_curve, Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { retentionStats } from './retention';
import type { ReviewLogRow } from './types';

const DAY = 86_400_000;
const log = (cardId: string, at: number, state: State, rating: number, stability = 0) => ({ cardId, at, state, rating, stability }) as ReviewLogRow;

describe('retention', () => {
  it('counts only long-term reviews and compares them with the forgetting curve', () => {
    const logs = [
      log('a', 0, State.New, Rating.Good),
      log('a', 10 * 60_000, State.Learning, Rating.Good), // same-day step: ignored
      log('a', 5 * DAY, State.Review, Rating.Good, 5),
      log('b', 0, State.New, Rating.Good),
      log('b', 3 * DAY, State.Review, Rating.Again, 3),
    ];
    const s = retentionStats(logs, default_w);
    expect(s.reviews).toBe(5);
    expect(s.longTerm).toBe(2);
    expect(s.actual).toBe(0.5);
    const expected = (forgetting_curve(default_w as number[], 5 - 10 / 1440, 5) + forgetting_curve(default_w as number[], 3, 3)) / 2;
    expect(s.predicted).toBeCloseTo(expected, 5);
  });

  it('has nothing to compare before any card comes back after days', () => {
    expect(retentionStats([log('a', 0, State.New, Rating.Good)], default_w)).toMatchObject({ longTerm: 0, actual: null, predicted: null });
  });
});
