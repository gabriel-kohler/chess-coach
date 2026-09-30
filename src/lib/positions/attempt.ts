// One attempt at a position, as a pure reducer:
// loading -> playing -> checking -> (wrong -> playing)* -> verdict.
// The grade comes from the first move only; retries are for learning.
import { Rating, type Grade } from 'ts-fsrs';
import { POSITIONS } from './config.ts';
import { gradeAttempt, type GradingRule } from './grade.ts';
import type { MoveScore } from './types.ts';

export type AttemptPhase = 'loading' | 'playing' | 'checking' | 'wrong' | 'verdict';

export interface FirstAttempt {
  uci: string | null;
  san: string | null;
  loss: number | null;
  exact: boolean;
  timeMs: number;
  gaveUp: boolean;
  score: MoveScore | null;
}

export interface PendingMove {
  uci: string;
  san: string;
  fenAfter: string;
  timeMs: number;
}

export interface AttemptState {
  phase: AttemptPhase;
  expectedMs: number;
  rule: GradingRule;
  startedAt: number | null;
  tries: number;
  pending: PendingMove | null;
  first: FirstAttempt | null;
  rating: Grade | null;
  /** The latest move tried, with its score: drives the "why not" block. */
  last: (PendingMove & { score: MoveScore }) | null;
  hint: boolean;
  solved: boolean;
  message: string | null;
}

export type AttemptEvent =
  | { type: 'ready'; at: number }
  | ({ type: 'move' } & PendingMove)
  | { type: 'scored'; uci: string; score: MoveScore }
  | { type: 'scoreFailed'; uci: string }
  | { type: 'revert' }
  | { type: 'hint' }
  | { type: 'giveUp'; timeMs: number };

export function initAttempt(expectedMs: number, rule: GradingRule = 'timed'): AttemptState {
  return { phase: 'loading', expectedMs, rule, startedAt: null, tries: 0, pending: null, first: null, rating: null, last: null, hint: false, solved: false, message: null };
}

export function attemptReducer(s: AttemptState, e: AttemptEvent): AttemptState {
  switch (e.type) {
    case 'ready':
      return s.phase === 'loading' ? { ...s, phase: 'playing', startedAt: e.at } : s;

    case 'move':
      if (s.phase !== 'playing') return s;
      return { ...s, phase: 'checking', tries: s.tries + 1, pending: { uci: e.uci, san: e.san, fenAfter: e.fenAfter, timeMs: e.timeMs }, message: null };

    case 'scored': {
      if (s.phase !== 'checking' || !s.pending || s.pending.uci !== e.uci) return s;
      const isFirst = !s.first;
      const first: FirstAttempt = s.first ?? {
        uci: e.uci,
        san: s.pending.san,
        loss: e.score.loss,
        exact: e.score.exact,
        timeMs: s.pending.timeMs,
        gaveUp: false,
        score: e.score,
      };
      const rating = s.rating ?? gradeAttempt({ loss: first.loss, exact: first.exact, timeMs: first.timeMs, gaveUp: false }, s.expectedMs, s.rule);
      const last = { ...s.pending, score: e.score };
      const right = e.score.loss <= POSITIONS.goodLoss;
      // A first move losing 2 to 5 points is acceptable (Hard) and ends the attempt.
      const acceptable = isFirst && e.score.loss <= POSITIONS.againLoss;
      if (right || acceptable) return { ...s, phase: 'verdict', first, rating, last, solved: true, pending: null };
      return {
        ...s,
        phase: 'wrong',
        first,
        rating,
        last,
        message: e.score.loss <= POSITIONS.againLoss ? 'Esse lance serve, mas não é o melhor. Tente de novo.' : null,
      };
    }

    case 'scoreFailed':
      if (s.phase !== 'checking' || s.pending?.uci !== e.uci) return s;
      return { ...s, phase: 'playing', tries: s.tries - 1, pending: null, message: 'Não consegui conferir esse lance. Jogue de novo.' };

    case 'revert':
      return s.phase === 'wrong' ? { ...s, phase: 'playing', pending: null } : s;

    case 'hint':
      // Only after a mistake: a hint is a learning aid, never a way to a better grade.
      return (s.phase === 'playing' || s.phase === 'wrong') && s.first ? { ...s, hint: true } : s;

    case 'giveUp': {
      if (s.phase !== 'playing' && s.phase !== 'wrong') return s;
      const first = s.first ?? { uci: null, san: null, loss: null, exact: false, timeMs: e.timeMs, gaveUp: true, score: null };
      return { ...s, phase: 'verdict', first, rating: s.rating ?? Rating.Again, solved: false, pending: null };
    }
  }
}
