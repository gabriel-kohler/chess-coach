// Grading an attempt. The grade measures the FIRST attempt only: FSRS predicts
// whether you will find the move next time without help. Time is relative to
// your own expected time for similar positions, and it only ever upgrades an
// answer that is already right.
import { Rating, State, type Grade } from 'ts-fsrs';
import type { Bucket, CardKind, ReviewLogRow } from '../srs/types.ts';
import type { Classification } from '../types.ts';
import { POSITIONS } from './config.ts';

export function bucketOf(stableFrom: number | null | undefined): Bucket {
  if (stableFrom == null) return 'medium';
  if (stableFrom <= POSITIONS.bucketEasyMax) return 'easy';
  if (stableFrom <= POSITIONS.bucketMediumMax) return 'medium';
  return 'hard';
}

/** Classification shown on the board badge, by the chess.com thresholds. */
export function lossClass(loss: number, exact: boolean): Classification {
  if (exact || loss < 0.5) return 'best';
  if (loss <= 2) return 'excellent';
  if (loss <= 5) return 'good';
  if (loss <= 10) return 'inaccuracy';
  if (loss <= 20) return 'mistake';
  return 'blunder';
}

export interface AttemptSignals {
  loss: number | null;
  /** The engine's own best move. */
  exact: boolean;
  timeMs: number;
  gaveUp: boolean;
}

/** 'timed' uses your pace for Hard and Easy; 'untimed' grades by the loss only. The optimizer picks. */
export type GradingRule = 'timed' | 'untimed';

export function gradeAttempt(a: AttemptSignals, expectedMs: number, rule: GradingRule = 'timed'): Grade {
  if (a.gaveUp || a.loss === null) return Rating.Again;
  if (a.loss > POSITIONS.againLoss) return Rating.Again;
  if (a.loss > POSITIONS.goodLoss) return Rating.Hard;
  if (rule === 'untimed') return Rating.Good;
  if (a.timeMs > POSITIONS.slowFactor * expectedMs) return Rating.Hard;
  if (a.exact && a.timeMs < POSITIONS.fastFactor * expectedMs) return Rating.Easy;
  return Rating.Good;
}

export const GRADE_LABEL: Record<Grade, string> = {
  [Rating.Again]: 'Errei',
  [Rating.Hard]: 'Difícil',
  [Rating.Good]: 'Bom',
  [Rating.Easy]: 'Fácil',
};

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface TimingSample {
  bucket: Bucket;
  timeMs: number;
  at: number;
}

/**
 * Right first attempts, from new and review states only: same-day learning
 * repeats are answered from short-term memory and would drag the median down.
 */
export function timingSamples(logs: ReviewLogRow[], kind: CardKind): TimingSample[] {
  return logs
    .filter((l) => l.kind === kind && l.correct && !l.gaveUp && (l.state === State.New || l.state === State.Review))
    .map((l) => ({ bucket: l.bucket, timeMs: l.timeMs, at: l.at }));
}

/** Your expected time per bucket: the median of your latest right answers, or a default. */
export function expectedTimes(samples: TimingSample[]): Record<Bucket, number> {
  const out = { ...POSITIONS.defaultExpectedMs } as Record<Bucket, number>;
  const [lo, hi] = POSITIONS.expectedClampMs;
  for (const bucket of ['easy', 'medium', 'hard'] as const) {
    const latest = samples
      .filter((s) => s.bucket === bucket)
      .sort((a, b) => b.at - a.at)
      .slice(0, POSITIONS.timingWindow)
      .map((s) => s.timeMs);
    if (latest.length >= POSITIONS.minTimingSamples) out[bucket] = Math.min(hi, Math.max(lo, median(latest)));
  }
  return out;
}
