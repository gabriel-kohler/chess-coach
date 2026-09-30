// FSRS adapter: desired retention, fuzz and a maximum interval, with
// short-term learning steps on, so a position you miss comes back in the
// same session instead of tomorrow.
import { createEmptyCard, fsrs, type Card, type CardInput, type FSRS, type FSRSParameters, type Grade } from 'ts-fsrs';
import type { GradingRule } from '../positions/grade.ts';
import type { CardKind, FsrsFields } from './types.ts';

export const FSRS_PARAMS: Partial<FSRSParameters> = {
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
};

/**
 * Per-kind changes. A tactics session is put together before it starts, so a
 * failed puzzle cannot come back ten minutes later in it: puzzles skip the
 * short-term steps and a miss comes back tomorrow, as it did before FSRS.
 */
const KIND_PARAMS: Partial<Record<CardKind, Partial<FSRSParameters>>> = {
  puzzle: { enable_short_term: false },
};

export function shortTermFor(kind: CardKind): boolean {
  return KIND_PARAMS[kind]?.enable_short_term ?? FSRS_PARAMS.enable_short_term ?? true;
}

const schedulers = new Map<string, FSRS>();

// Fitted weights and grading rule per kind (see optimizer.ts), loaded at start.
const models = new Map<CardKind, { w: readonly number[] | null; rule: GradingRule }>();

export function setKindModel(kind: CardKind, w: readonly number[] | null, rule: GradingRule) {
  models.set(kind, { w, rule });
}

export function ruleFor(kind: CardKind): GradingRule {
  return models.get(kind)?.rule ?? 'timed';
}

/** Scheduler for a card kind, with that kind's fitted weights when given. */
export function schedulerFor(kind: CardKind, w?: readonly number[], overrides: Partial<FSRSParameters> = {}): FSRS {
  const key = `${kind}|${w?.join(',') ?? ''}|${JSON.stringify(overrides)}`;
  let s = schedulers.get(key);
  if (!s) {
    s = fsrs({ ...FSRS_PARAMS, ...KIND_PARAMS[kind], ...(w ? { w } : {}), ...overrides });
    schedulers.set(key, s);
  }
  return s;
}

export function fromCard(c: Card): FsrsFields {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

export function newFsrsFields(now: number): FsrsFields {
  return fromCard(createEmptyCard(new Date(now)));
}

/** Only the FSRS keys: `next` copies the whole object it is given. */
export function pickFsrs(c: FsrsFields): CardInput {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ?? undefined,
  } as CardInput;
}

export interface ReviewResult {
  next: FsrsFields;
  /** State before the review, as FSRS logs it. */
  log: { state: FsrsFields['state']; due: number; stability: number; difficulty: number; elapsedDays: number; scheduledDays: number; learningSteps: number };
}

export function reviewCard(fields: FsrsFields, grade: Grade, now: number, kind: CardKind = 'best', options: { fuzz?: boolean } = {}): ReviewResult {
  const scheduler = schedulerFor(kind, models.get(kind)?.w ?? undefined, options.fuzz === false ? { enable_fuzz: false } : {});
  const { card, log } = scheduler.next(pickFsrs(fields), new Date(now), grade);
  return {
    next: fromCard(card),
    log: {
      state: log.state,
      due: log.due.getTime(),
      stability: log.stability,
      difficulty: log.difficulty,
      elapsedDays: log.elapsed_days,
      scheduledDays: log.scheduled_days,
      learningSteps: log.learning_steps,
    },
  };
}
