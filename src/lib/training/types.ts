import type { Grade } from 'ts-fsrs';
import type { SessionItem } from '../tactics/trainer.ts';
import type { Color } from '../types.ts';

export type TrainingMode = 'daily' | 'warmup';

/** The parts of a session, in the order they come. */
export type Block = 'review' | 'mine' | 'tactics' | 'openings' | 'endgame' | 'reminder';

/**
 * review: toward your due positions. deviation: a real game up to where you
 * left the repertoire, then the book move. chapter: a line in a chapter where
 * you score low. warmup: only positions you already know.
 */
export type RepLineKind = 'review' | 'deviation' | 'chapter' | 'warmup';

export type StepItem =
  | { kind: 'best'; cardId: string; note: string }
  | { kind: 'seq'; cardId: string; note: string }
  | { kind: 'puzzle'; item: SessionItem }
  /** deckId: the line stays in that opening deck (lib/decks); without one, the whole color as before. */
  | { kind: 'rep'; side: Color; line: RepLineKind; key: string; replay?: string[]; chapterId?: string; deckId?: string }
  | { kind: 'endgame'; drillId: string };

export type StepOutcome = 'good' | 'hard' | 'fail';

export interface StepResult {
  at: number;
  ms: number;
  outcome: StepOutcome;
  /** FSRS grade, when the step has one (the worst one, for a line). */
  grade?: Grade;
  label: string;
  /** Repertoire: the line played, SAN from the start, so a redo plays the same one. */
  line?: string[];
  /** Done in another screen after the session was put together. */
  outside?: boolean;
}

export interface TrainingStep {
  /** Unique in the session, never reused: the attempt ids are built from it. */
  id: string;
  addedAt: number;
  block: Block;
  item: StepItem;
  estMs: number;
  reason: string;
  /** Planned as free practice: nothing is saved (the warm-up reminder when not due). */
  practice?: boolean;
  /** A position of this session coming back in its learning step. */
  reshow?: boolean;
  status: 'pending' | 'done' | 'skipped';
  result?: StepResult;
  /** Why it was skipped without you, when it was. */
  note?: string;
}

/** A step before the session numbers it. */
export type PlannedStep = Omit<TrainingStep, 'id' | 'addedAt' | 'status'>;

export interface LearningEntry {
  kind: 'best' | 'seq';
  due: number;
}

export interface TrainingSession {
  id: string;
  version: number;
  mode: TrainingMode;
  /** Local midnight of the day it was put together. */
  day: number;
  startedAt: number;
  budgetMs: number;
  steps: TrainingStep[];
  /** Index on screen; steps.length is the summary. */
  at: number;
  nextId: number;
  /** Cards of this session in a learning step, by id: they come back. */
  learning: Record<string, LearningEntry>;
  /** Reviews that did not fit: they wait for tomorrow. */
  leftover: number;
  /** What could not be put together (no puzzle bank, no repertoire...). */
  notes: string[];
  finishedAt?: number;
}

/** A position card of the session as the composition sees it. */
export interface PositionRef {
  id: string;
  kind: 'best' | 'seq';
  note: string;
  primaryGameId: string | null;
  bucket: 'easy' | 'medium' | 'hard';
  /** Moves of yours in it: 1 for a best-move card. */
  steps: number;
  priority: number;
  reason: string;
}
