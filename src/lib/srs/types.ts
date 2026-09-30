// Spaced-repetition types shared by every card kind. FSRS state is stored
// flat on the card, with dates as epoch milliseconds: IndexedDB sorts Date
// objects after numbers, so a Date in the `due` index breaks range queries.
import type { State } from 'ts-fsrs';

/** Card kinds: best move, sequence, Lichess puzzle, repertoire position. */
export type CardKind = 'best' | 'seq' | 'puzzle' | 'rep';

export const CARD_KINDS: readonly CardKind[] = ['best', 'seq', 'puzzle', 'rep'];

/** Engine difficulty of the position, from the depth where the best move settled. */
export type Bucket = 'easy' | 'medium' | 'hard';

export interface FsrsFields {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review: number | null;
}

export interface SrsCardBase extends FsrsFields {
  id: string;
  kind: CardKind;
  /** Sibling group: cards with the same note are shown at most once a day. */
  note: string;
  /** Game the card counts against for the "new per game" cap. */
  primaryGameId: string | null;
  createdAt: number;
  /** 1 when the card lost every source but has review history. */
  suspended: 0 | 1;
}

/**
 * One attempt, with the raw signals kept apart from the derived rating so the
 * grading rule can be re-derived and compared later (phase 3 optimizer).
 */
export interface ReviewLogRow {
  id?: number;
  attemptId: string;
  cardId: string;
  kind: CardKind;
  note: string;
  gameId: string | null;
  at: number;
  gradingVersion: number;
  // Raw signals of the first attempt.
  uci: string | null;
  loss: number | null;
  lossSource: 'best' | 'mate' | 'stored' | 'game' | 'engine' | null;
  exact: boolean;
  correct: boolean;
  timeMs: number;
  hiddenMs: number;
  expectedMs: number;
  bucket: Bucket;
  /** How many times the card had been shown before, plus one. */
  showing: number;
  gaveUp: boolean;
  // Filled in at the verdict.
  hintUsed: boolean;
  tries: number;
  solved: boolean;
  /** FSRS grade, 1 (Again) to 4 (Easy). */
  rating: number;
  // FSRS state before the review.
  state: State;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  after: FsrsFields;
  /** Sequences: the first attempt at each of your moves, in order. */
  steps?: Array<{ uci: string | null; loss: number | null; exact: boolean; timeMs: number; rating: number }>;
}
