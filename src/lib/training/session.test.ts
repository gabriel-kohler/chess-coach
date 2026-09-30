// @vitest-environment node
import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { appendSteps, attemptIdOf, frontier, goTo, newSession, nextStep, reconcile, recordResult, sessionExclude, skipStep, summarize, unskipStep, type StepFacts } from './session';
import type { PlannedStep, StepResult, TrainingSession } from './types';

const NOW = new Date(2026, 8, 11, 9, 0).getTime();
const MIN = 60_000;
const AHEAD = 20 * MIN;

const best = (id: string, block: PlannedStep['block'] = 'review'): PlannedStep => ({ block, item: { kind: 'best', cardId: id, note: `n-${id}` }, estMs: 30_000, reason: id });
const puzzleStep: PlannedStep = { block: 'tactics', item: { kind: 'puzzle', item: { puzzle: { id: 'p1', source: 'lichess', fen: '', moves: [], rating: 1500, themes: [] }, mode: 'new', reason: '' } }, estMs: 35_000, reason: '' };
const ok = (at = NOW, ms = 20_000): StepResult => ({ at, ms, outcome: 'good', grade: Rating.Good, label: 'Bom, 20 s' });
const fail = (at = NOW): StepResult => ({ at, ms: 20_000, outcome: 'fail', grade: Rating.Again, label: 'Errei, 20 s' });
const learningNext = (due: number) => ({ state: State.Learning, due });
const reviewNext = (due: number) => ({ state: State.Review, due });

const session = (planned: PlannedStep[], mode: 'daily' | 'warmup' = 'daily'): TrainingSession => newSession(mode, NOW, NOW - 9 * 60 * MIN, 30 * MIN, planned, 0, []);
const cardAt = (s: TrainingSession, i: number) => (s.steps[i]!.item as { cardId: string }).cardId;

describe('a session', () => {
  it('numbers its steps once, and a step has its own attempt id', () => {
    const s = session([best('a'), best('b')]);
    expect(s.steps.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(attemptIdOf(s, s.steps[1]!)).toBe(`daily-${NOW}|s2`);
  });

  it('keeps the first result of a step: a second save changes nothing', () => {
    let s = session([best('a')]);
    s = recordResult(s, 's1', fail(), learningNext(NOW + MIN));
    s = recordResult(s, 's1', ok(), reviewNext(NOW + 3 * 86_400_000));
    expect(s.steps[0]!.result!.outcome).toBe('fail');
    expect(s.learning.a).toEqual({ kind: 'best', due: NOW + MIN });
  });

  it('goes back one by one through done steps, then on from where you stopped', () => {
    let s = session([best('a'), best('b'), best('c')]);
    s = recordResult(s, 's1', ok(), reviewNext(NOW + 86_400_000));
    s = recordResult(s, 's2', ok(), reviewNext(NOW + 86_400_000));
    expect(frontier(s)).toBe(2);
    s = goTo(s, 0);
    s = nextStep(s, NOW, AHEAD);
    expect(s.at).toBe(1);
    s = nextStep(s, NOW, AHEAD);
    expect(s.at).toBe(2);
  });

  it('moves on while the grade of the step is still saving; the grade lands on its own step', () => {
    let s = session([best('a'), best('b')]);
    s = nextStep(s, NOW, AHEAD);
    expect(s.at).toBe(1);
    s = recordResult(s, 's1', ok(), reviewNext(NOW + 86_400_000));
    expect(s.steps[0]!.status).toBe('done');
    expect(s.at).toBe(1);
  });

  it('skipping leaves a step to do later, and it can be undone', () => {
    let s = session([best('a'), best('b')]);
    s = skipStep(s, 's1');
    expect(frontier(s)).toBe(1);
    expect(s.steps[0]!.status).toBe('skipped');
    expect(frontier(unskipStep(s, 's1'))).toBe(0);
    // A step with a result is never skipped.
    const done = recordResult(session([best('a')]), 's1', ok());
    expect(skipStep(done, 's1').steps[0]!.status).toBe('done');
  });
});

describe('a position left in a learning step comes back, as in Posições', () => {
  it('after the next step, not right away, in the Treinar', () => {
    let s = session([best('a'), best('b'), best('c')]);
    s = recordResult(s, 's1', fail(), learningNext(NOW + MIN));
    s = nextStep(s, NOW + 2 * MIN, AHEAD); // due, but it was just shown: b comes first
    expect(cardAt(s, s.at)).toBe('b');
    s = recordResult(s, 's2', ok(), reviewNext(NOW + 86_400_000));
    s = nextStep(s, NOW + 3 * MIN, AHEAD);
    expect(s.at).toBe(2);
    expect(s.steps[2]!).toMatchObject({ reshow: true, item: { cardId: 'a' } });
    expect(s.steps[3]!.item).toMatchObject({ cardId: 'c' });
    expect(s.steps.map((x) => x.id)).toEqual(['s1', 's2', 's4', 's3']);
  });

  it('a card still learning after its return keeps coming back; graduated, it stops', () => {
    let s = session([best('a')]);
    s = recordResult(s, 's1', fail(), learningNext(NOW + MIN));
    // Nothing else left: the one just shown comes back once due, or early within the look-ahead.
    s = nextStep(s, NOW + 30_000, AHEAD);
    expect(s.steps).toHaveLength(2);
    expect(s.at).toBe(1);
    s = recordResult(s, s.steps[1]!.id, ok(), reviewNext(NOW + 86_400_000));
    s = nextStep(s, NOW + 2 * MIN, AHEAD);
    expect(s.at).toBe(s.steps.length);
    expect(s.finishedAt).toBe(NOW + 2 * MIN);
  });

  it('beyond the look-ahead it waits for another day', () => {
    let s = session([best('a')]);
    s = recordResult(s, 's1', ok(), learningNext(NOW + 30 * MIN));
    s = nextStep(s, NOW, AHEAD);
    expect(s.at).toBe(1);
    expect(s.steps).toHaveLength(1);
  });

  it('never in the warm-up', () => {
    let s = session([best('a'), best('b')], 'warmup');
    s = recordResult(s, 's1', fail(), learningNext(NOW + MIN));
    expect(s.learning).toEqual({});
  });
});

describe('a step already done somewhere', () => {
  const s = session([best('a'), { ...best('r'), reshow: true }, puzzleStep]);
  const [a, r, p] = s.steps as [TrainingSession['steps'][number], TrainingSession['steps'][number], TrainingSession['steps'][number]];

  it('its own review (a reload after the save) makes it done', () => {
    expect(reconcile(a, { ownLog: { rating: Rating.Hard, timeMs: 9_000, at: NOW } })).toMatchObject({ status: 'done', result: { outcome: 'hard', label: 'Difícil, 9 s' } });
  });

  it('a review in another screen counts, except on a return of this session', () => {
    const later: StepFacts = { laterLog: { rating: Rating.Good, timeMs: 5_000, at: NOW + MIN } };
    expect(reconcile(a, later)).toMatchObject({ status: 'done', result: { outside: true } });
    expect(reconcile(r, later)).toBeNull();
  });

  it('a card gone from your training is skipped with a note', () => {
    expect(reconcile(a, { cardGone: true })).toMatchObject({ status: 'skipped' });
  });

  it('a puzzle counts only an attempt since the step was added', () => {
    expect(reconcile(p, {})).toBeNull();
    expect(reconcile(p, { puzzleAttempt: { solved: false, timeMs: 7_000, at: NOW + MIN } })).toMatchObject({ status: 'done', result: { outcome: 'fail' } });
  });

  it('nothing changes on a step already done', () => {
    const done = recordResult(s, a.id, ok()).steps[0]!;
    expect(reconcile(done, { cardGone: true })).toBeNull();
  });
});

describe('more minutes and the summary', () => {
  it('"Mais 10 minutos" adds steps after the others and opens the first of them', () => {
    let s = session([best('a')]);
    s = recordResult(s, 's1', ok(), reviewNext(NOW + 86_400_000));
    s = nextStep(s, NOW, AHEAD);
    expect(s.finishedAt).toBe(NOW);
    s = appendSteps(s, [best('b'), puzzleStep], NOW + MIN, 10);
    expect(s.steps.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
    expect(s.at).toBe(1);
    expect(s.finishedAt).toBeUndefined();
    expect(s.budgetMs).toBe(40 * MIN);
    expect([...sessionExclude(s)]).toEqual(expect.arrayContaining(['card:a', 'note:n-a', 'puzzle:p1']));
  });

  it('counts each part; a reminder seen as free practice is done, not graded', () => {
    let s = session([best('a'), best('b'), puzzleStep, { ...best('r', 'reminder'), practice: true }]);
    s = recordResult(s, 's1', ok());
    s = recordResult(s, 's2', fail());
    s = skipStep(s, 's3');
    s = recordResult(s, 's4', { at: NOW, ms: 1_000, outcome: 'good', label: 'Visto em treino livre' });
    expect(summarize(s)).toEqual([
      { block: 'review', done: 2, skipped: 0, pending: 0, good: 1, hard: 0, fail: 1 },
      { block: 'tactics', done: 0, skipped: 1, pending: 0, good: 0, hard: 0, fail: 0 },
      { block: 'reminder', done: 1, skipped: 0, pending: 0, good: 0, hard: 0, fail: 0 },
    ]);
  });
});
