// Moving through a session: pure transitions on the stored session. A step's
// attempt id is fixed by the session and the step, so saving it twice (a
// reload, React's double mount) counts once; a step you already did opens as
// free practice; a position left in a learning step comes back, as in Posições.
import { Rating, State, type Grade } from 'ts-fsrs';
import { GRADE_LABEL } from '../positions/grade.ts';
import { TRAINING } from './config.ts';
import { refOf } from './compose.ts';
import type { Block, PlannedStep, StepOutcome, StepResult, TrainingMode, TrainingSession, TrainingStep } from './types.ts';

export const attemptIdOf = (s: Pick<TrainingSession, 'id'>, step: Pick<TrainingStep, 'id'>) => `${s.id}|${step.id}`;
export const repAttemptIdOf = (s: Pick<TrainingSession, 'id'>, step: Pick<TrainingStep, 'id'>, epd: string) => `${s.id}|${step.id}|${epd}`;

export const BLOCK_LABEL: Record<Block, string> = {
  review: 'Revisões',
  mine: 'Seus erros',
  tactics: 'Tática',
  openings: 'Aberturas',
  endgame: 'Final',
  reminder: 'Lembrete',
};

export function outcomeOf(grade: Grade): StepOutcome {
  return grade === Rating.Again ? 'fail' : grade === Rating.Hard ? 'hard' : 'good';
}

export const secs = (ms: number) => `${Math.max(1, Math.round(ms / 1000))} s`;

export function gradedResult(grade: Grade, timeMs: number, at: number, ms: number): StepResult {
  return { at, ms, outcome: outcomeOf(grade), grade, label: `${GRADE_LABEL[grade]}, ${secs(timeMs)}` };
}

function numbered(s: TrainingSession, planned: PlannedStep[], now: number): { steps: TrainingStep[]; nextId: number } {
  let n = s.nextId;
  return { steps: planned.map((p) => ({ ...p, id: `s${n++}`, addedAt: now, status: 'pending' })), nextId: n };
}

export function newSession(mode: TrainingMode, now: number, day: number, budgetMs: number, planned: PlannedStep[], leftover: number, notes: string[]): TrainingSession {
  const base: TrainingSession = { id: `${mode}-${now}`, version: TRAINING.version, mode, day, startedAt: now, budgetMs, steps: [], at: 0, nextId: 1, learning: {}, leftover, notes };
  const { steps, nextId } = numbered(base, planned, now);
  return { ...base, steps, nextId };
}

/** "Mais 10 minutos": more steps after the ones there, never a repeat. */
export function appendSteps(s: TrainingSession, planned: PlannedStep[], now: number, minutes: number): TrainingSession {
  const { steps, nextId } = numbered(s, planned, now);
  if (!steps.length) return s;
  const open: TrainingSession = { ...s, steps: [...s.steps, ...steps], nextId, at: s.steps.length, budgetMs: s.budgetMs + minutes * 60_000 };
  delete open.finishedAt;
  return open;
}

/** What the session already shows: refs, and the notes of its positions. */
export function sessionExclude(s: TrainingSession): Set<string> {
  const out = new Set<string>();
  for (const st of s.steps) {
    out.add(refOf(st.item));
    if (st.item.kind === 'best' || st.item.kind === 'seq') out.add(`note:${st.item.note}`);
  }
  return out;
}

/** The first step still to do: where you stopped. steps.length when none is left. */
export function frontier(s: TrainingSession): number {
  const i = s.steps.findIndex((st) => st.status === 'pending');
  return i < 0 ? s.steps.length : i;
}

export function goTo(s: TrainingSession, index: number): TrainingSession {
  return { ...s, at: Math.max(0, Math.min(s.steps.length, index)) };
}

const patchStep = (s: TrainingSession, stepId: string, f: (st: TrainingStep) => TrainingStep): TrainingSession => ({ ...s, steps: s.steps.map((st) => (st.id === stepId ? f(st) : st)) });

/**
 * A step's first result. Later ones (a retry, a second save) change nothing.
 * A position left in a learning step joins the ones that come back.
 */
export function recordResult(s: TrainingSession, stepId: string, result: StepResult, next?: { state: State; due: number } | null): TrainingSession {
  const step = s.steps.find((st) => st.id === stepId);
  if (!step || step.status === 'done') return s;
  let out = patchStep(s, stepId, (st) => ({ ...st, status: 'done', result }));
  if (next && s.mode === 'daily' && (step.item.kind === 'best' || step.item.kind === 'seq')) {
    const learning = { ...out.learning };
    if (next.state === State.Learning || next.state === State.Relearning) learning[step.item.cardId] = { kind: step.item.kind, due: next.due };
    else delete learning[step.item.cardId];
    out = { ...out, learning };
  }
  return out;
}

export function skipStep(s: TrainingSession, stepId: string, note?: string): TrainingSession {
  return patchStep(s, stepId, (st) => (st.status === 'pending' ? { ...st, status: 'skipped', ...(note ? { note } : {}) } : st));
}

/** Back to pending: a step skipped by mistake. */
export function unskipStep(s: TrainingSession, stepId: string): TrainingSession {
  return patchStep(s, stepId, (st) => (st.status === 'skipped' ? { ...st, status: 'pending' } : st));
}

function reshowStep(s: TrainingSession, cardId: string, now: number): TrainingStep {
  const origin = [...s.steps].reverse().find((st) => (st.item.kind === 'best' || st.item.kind === 'seq') && st.item.cardId === cardId)!;
  const relearning = origin.result?.outcome === 'fail';
  return {
    id: `s${s.nextId}`,
    addedAt: now,
    block: origin.block,
    item: origin.item,
    estMs: origin.estMs,
    reason: relearning ? 'Você errou esta posição há pouco: ela volta para fixar.' : 'Posição nova: ela volta uma vez para fixar.',
    reshow: true,
    status: 'pending',
  };
}

/**
 * "Próxima". Walking through steps already done goes one by one. At the edge
 * (the step you just did), a position of this session due in its learning
 * step comes first, as in Posições (never the one just shown, unless it is
 * the only thing left); then the next step to do; at the end, what comes due
 * within the look-ahead; then the summary.
 */
export function nextStep(s: TrainingSession, now: number, learnAheadMs: number): TrainingSession {
  // The step on screen may still be saving its grade (it lands on its own step later): "Próxima" moves on anyway.
  const found = s.steps.findIndex((st, i) => st.status === 'pending' && i !== s.at);
  const f = found < 0 ? s.steps.length : found;
  if (s.at + 1 < f) return { ...s, at: s.at + 1 };
  const current = s.steps[s.at];
  const lastCard = current && (current.item.kind === 'best' || current.item.kind === 'seq') ? current.item.cardId : null;
  const waiting = new Set(s.steps.filter((st) => st.status === 'pending' && (st.item.kind === 'best' || st.item.kind === 'seq')).map((st) => (st.item as { cardId: string }).cardId));
  const learning = Object.entries(s.learning)
    .filter(([id]) => !waiting.has(id))
    .sort((a, b) => a[1].due - b[1].due);
  const due = learning.filter(([, e]) => e.due <= now);
  const insert = (cardId: string, at: number): TrainingSession => {
    const step = reshowStep(s, cardId, now);
    const steps = [...s.steps.slice(0, at), step, ...s.steps.slice(at)];
    return { ...s, steps, nextId: s.nextId + 1, at };
  };
  const fresh = due.find(([id]) => id !== lastCard);
  if (fresh) return insert(fresh[0], f);
  if (f < s.steps.length) return { ...s, at: f };
  if (due[0]) return insert(due[0][0], f);
  const soon = learning.find(([, e]) => e.due <= now + learnAheadMs);
  if (soon) return insert(soon[0], f);
  return { ...s, at: s.steps.length, finishedAt: s.finishedAt ?? now };
}

/** Active time: what the done steps took. */
export function activeMs(s: TrainingSession): number {
  return s.steps.reduce((sum, st) => sum + (st.result ? Math.min(st.result.ms, TRAINING.maxStepMs) : 0), 0);
}

export interface BlockSummary {
  block: Block;
  done: number;
  skipped: number;
  pending: number;
  good: number;
  hard: number;
  fail: number;
}

export function summarize(s: TrainingSession): BlockSummary[] {
  const by = new Map<Block, BlockSummary>();
  for (const st of s.steps) {
    const b = by.get(st.block) ?? { block: st.block, done: 0, skipped: 0, pending: 0, good: 0, hard: 0, fail: 0 };
    if (st.status === 'done') {
      b.done++;
      // A step planned as free practice was seen, not graded.
      if (st.result && !st.practice) b[st.result.outcome]++;
    } else if (st.status === 'skipped') b.skipped++;
    else b.pending++;
    by.set(st.block, b);
  }
  return [...by.values()];
}

/** What the database says about a pending step, to see whether it was already done. */
export interface StepFacts {
  /** The card is gone or suspended (a re-analysis took it out of your training). */
  cardGone?: boolean;
  /** The review saved with this step's attempt id, and where it left the card. */
  ownLog?: { rating: Grade; timeMs: number; at: number; next?: { state: State; due: number } };
  /** The card's last review, and its log, when it came after the step was added. */
  laterLog?: { rating: Grade; timeMs: number; at: number };
  /** A puzzle attempt since the step was added. */
  puzzleAttempt?: { solved: boolean; timeMs: number; at: number };
  /** The repertoire position, the chapter or the drill is no longer there. */
  targetGone?: boolean;
}

export type Reconciled = { status: 'done'; result: StepResult } | { status: 'skipped'; note: string } | null;

/**
 * Whether a pending step turns out to be done or impossible. A position done
 * in another screen counts as done (never on a re-show: its own first showing
 * reviewed it). A review puzzle has older attempts: only newer ones count.
 */
export function reconcile(step: TrainingStep, facts: StepFacts): Reconciled {
  if (step.status !== 'pending') return null;
  const k = step.item.kind;
  if (k === 'best' || k === 'seq') {
    if (facts.ownLog) return { status: 'done', result: gradedResult(facts.ownLog.rating, facts.ownLog.timeMs, facts.ownLog.at, facts.ownLog.timeMs) };
    if (facts.cardGone) return { status: 'skipped', note: 'Esta posição saiu do seu treino depois de uma nova análise.' };
    if (!step.reshow && !step.practice && facts.laterLog) {
      return { status: 'done', result: { ...gradedResult(facts.laterLog.rating, facts.laterLog.timeMs, facts.laterLog.at, facts.laterLog.timeMs), outside: true } };
    }
    return null;
  }
  if (k === 'puzzle' && facts.puzzleAttempt) {
    const a = facts.puzzleAttempt;
    return { status: 'done', result: { at: a.at, ms: a.timeMs, outcome: a.solved ? 'good' : 'fail', label: a.solved ? `Resolvido, ${secs(a.timeMs)}` : 'Não resolvido' } };
  }
  if (facts.targetGone) return { status: 'skipped', note: 'Isto saiu do seu repertório ou do treino desde que a sessão foi montada.' };
  return null;
}
