import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { gradeAttempt } from '../positions/grade';
import { fitModel, historiesFor, ratingUnder, untimedGrade } from './optimizer';
import type { ReviewLogRow } from './types';

const log = (over: Partial<ReviewLogRow>): ReviewLogRow =>
  ({ attemptId: 'a', cardId: 'c1', kind: 'best', note: 'n', gameId: null, at: 0, gradingVersion: 1, uci: 'e2e4', loss: 0, lossSource: 'best', exact: true, correct: true, timeMs: 5000, hiddenMs: 0, expectedMs: 20000, bucket: 'medium', showing: 1, gaveUp: false, hintUsed: false, tries: 1, solved: true, rating: 4, state: State.New, due: 0, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, after: {} as ReviewLogRow['after'], ...over }) as ReviewLogRow;

describe('grading rules', () => {
  it('untimed grades by the loss only: never Easy, never Hard for being slow', () => {
    expect(untimedGrade({ loss: 6, gaveUp: false })).toBe(Rating.Again);
    expect(untimedGrade({ loss: 3, gaveUp: false })).toBe(Rating.Hard);
    expect(untimedGrade({ loss: 0, gaveUp: false })).toBe(Rating.Good);
    expect(untimedGrade({ loss: 0, gaveUp: true })).toBe(Rating.Again);
    expect(gradeAttempt({ loss: 1, exact: true, timeMs: 100_000, gaveUp: false }, 20_000, 'untimed')).toBe(Rating.Good);
  });

  it('both rules agree on every Again, so recall labels are the same', () => {
    for (const loss of [0, 1, 2.5, 5, 5.1, 30, null]) {
      for (const timeMs of [1000, 90_000]) {
        const l = log({ loss, exact: loss === 0, timeMs, gaveUp: loss === null });
        expect(ratingUnder(l, 'timed') === Rating.Again).toBe(ratingUnder(l, 'untimed') === Rating.Again);
      }
    }
  });

  it('replays the timed rule from raw signals, and a sequence takes its worst move', () => {
    expect(ratingUnder(log({ loss: 0, exact: true, timeMs: 5000 }), 'timed')).toBe(Rating.Easy);
    expect(ratingUnder(log({ loss: 0, exact: true, timeMs: 5000 }), 'untimed')).toBe(Rating.Good);
    const seq = log({ kind: 'seq', steps: [{ uci: 'a', loss: 0, exact: true, timeMs: 1, rating: 4 }, { uci: 'b', loss: 3, exact: false, timeMs: 1, rating: 2 }] });
    expect(ratingUnder(seq, 'timed')).toBe(Rating.Hard);
    const gaveUp = log({ kind: 'seq', steps: [{ uci: null, loss: null, exact: false, timeMs: 1, rating: 1 }] });
    expect(ratingUnder(gaveUp, 'untimed')).toBe(Rating.Again);
  });

  it('builds one history per card, in time order', () => {
    const h = historiesFor([log({ cardId: 'b', at: 5, loss: 9 }), log({ cardId: 'a', at: 3 }), log({ cardId: 'b', at: 1 })], 'untimed');
    expect(h).toEqual([
      [{ rating: 3, at: 1 }, { rating: 1, at: 5 }],
      [{ rating: 3, at: 3 }],
    ]);
  });
});

describe('fitting a model', () => {
  const logs = [log({ at: 1 }), log({ at: 2, loss: 3 }), log({ at: 3 })];
  const fake = (losses: Record<string, number>, seen: string[] = []) => async (path: string, body: unknown) => {
    const b = body as { histories: Array<Array<{ rating: number }>>; params?: number[] };
    seen.push(path);
    if (path === 'optimize') return { params: [9, 9, 9] };
    if (path === 'evaluate') return { logLoss: b.params?.[0] === 9 ? losses.fitted : losses.current, rmseBins: 0.1 };
    // evaluate-splits: tell the rules apart by whether any Easy (4) appears.
    const timed = b.histories.some((h) => h.some((r) => r.rating === 4));
    return { logLoss: timed ? losses.timed : losses.untimed, rmseBins: 0.1 };
  };

  it('keeps the rule that predicts your reviews better', async () => {
    const m = await fitModel('best', logs, null, fake({ timed: 0.5, untimed: 0.4, fitted: 0.3, current: 0.35 }), 7);
    expect(m.rule).toBe('untimed');
    expect(m).toMatchObject({ kind: 'best', reviews: 3, at: 7, w: [9, 9, 9] });
  });

  it('keeps the weights in use when the new ones are not better', async () => {
    const m = await fitModel('best', logs, { kind: 'best', rule: 'timed', w: [1, 2], reviews: 1, at: 0, metrics: {} }, fake({ timed: 0.3, untimed: 0.4, fitted: 0.5, current: 0.45 }));
    expect(m.rule).toBe('timed');
    expect(m.w).toEqual([1, 2]);
  });
});
