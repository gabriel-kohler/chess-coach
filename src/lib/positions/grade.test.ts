import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { ReviewLogRow } from '../srs/types';
import { bucketOf, expectedTimes, gradeAttempt, lossClass, median, timingSamples, type TimingSample } from './grade';

const E = 20_000;
const grade = (loss: number | null, timeMs: number, exact = false, gaveUp = false) => gradeAttempt({ loss, timeMs, exact, gaveUp }, E);

describe('grading the first attempt', () => {
  it('buckets by the depth where the best move settled', () => {
    expect([6, 7, 12, 13].map(bucketOf)).toEqual(['easy', 'medium', 'medium', 'hard']);
    expect(bucketOf(undefined)).toBe('medium');
    expect(bucketOf(null)).toBe('medium');
  });

  it('more than 5 points lost is Again, giving up too', () => {
    expect(grade(5.01, 1000)).toBe(Rating.Again);
    expect(grade(null, 1000)).toBe(Rating.Again);
    expect(grade(0, 1000, true, true)).toBe(Rating.Again);
  });

  it('a move losing 2 to 5 points is Hard, even when fast', () => {
    expect(grade(5, 1000)).toBe(Rating.Hard);
    expect(grade(2.01, 1000)).toBe(Rating.Hard);
    expect(grade(3, 0.1 * E)).toBe(Rating.Hard);
  });

  it('right but slower than twice the expected time is Hard', () => {
    expect(grade(1, 2.01 * E)).toBe(Rating.Hard);
    expect(grade(1, 2 * E)).toBe(Rating.Good);
  });

  it('Easy needs the exact best move, faster than half the expected time', () => {
    expect(grade(0, 0.49 * E, true)).toBe(Rating.Easy);
    expect(grade(0, 0.5 * E, true)).toBe(Rating.Good);
    // A lucky equal move in a quiet position is never Easy.
    expect(grade(1, 0.1 * E, false)).toBe(Rating.Good);
  });

  it('labels the board badge like chess.com', () => {
    expect(lossClass(0, true)).toBe('best');
    expect(lossClass(1.5, false)).toBe('excellent');
    expect(lossClass(4, false)).toBe('good');
    expect(lossClass(25, false)).toBe('blunder');
  });
});

describe('expected time', () => {
  const samples = (n: number, bucket: TimingSample['bucket'], timeMs: (i: number) => number): TimingSample[] =>
    Array.from({ length: n }, (_, i) => ({ bucket, timeMs: timeMs(i), at: i }));

  it('uses the defaults below 20 samples and your median from 20 on', () => {
    expect(expectedTimes(samples(19, 'medium', () => 8000)).medium).toBe(20_000);
    expect(expectedTimes(samples(20, 'medium', () => 8000)).medium).toBe(8000);
  });

  it('keeps only the latest 100 answers and clamps to 5-120 s', () => {
    const old = samples(100, 'hard', () => 90_000).map((s) => ({ ...s, at: s.at }));
    const recent = samples(100, 'hard', () => 30_000).map((s) => ({ ...s, at: s.at + 1000 }));
    expect(expectedTimes([...old, ...recent]).hard).toBe(30_000);
    expect(expectedTimes(samples(20, 'easy', () => 1000)).easy).toBe(5000);
  });

  it('medians an even count by averaging the middle pair', () => {
    expect(median([1, 3, 5, 7])).toBe(4);
  });

  it('ignores same-day learning repeats and wrong answers', () => {
    const base = { kind: 'best', correct: true, gaveUp: false, bucket: 'easy', timeMs: 3000, at: 1 } as ReviewLogRow;
    const logs = [
      { ...base, state: State.New },
      { ...base, state: State.Review },
      { ...base, state: State.Learning },
      { ...base, state: State.Relearning },
      { ...base, state: State.Review, correct: false },
    ];
    expect(timingSamples(logs, 'best')).toHaveLength(2);
  });
});
