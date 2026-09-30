// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionItem } from '../tactics/trainer';
import { composeDaily, composeWarmup, positionMs, puzzleMs, repLineMs, tacticsSlots, warmupSlots, type DailyInput, type Times } from './compose';
import { TRAINING } from './config';
import type { OpeningTarget } from './openings';
import type { PlannedStep, PositionRef } from './types';

const NOW = new Date(2026, 8, 11, 9, 0).getTime();
const B = 30 * 60_000;
const times: Times = { best: { easy: 10_000, medium: 20_000, hard: 30_000 }, seq: { easy: 10_000, medium: 20_000, hard: 30_000 }, puzzleMs: 25_000, repMoveMs: 8_000 };

const pos = (id: string, over: Partial<PositionRef> = {}): PositionRef => ({ id, kind: 'best', note: `n-${id}`, primaryGameId: `g-${id}`, bucket: 'easy', steps: 1, priority: 1, reason: id, ...over });
const puzzle = (id: string, mode: SessionItem['mode'] = 'new'): SessionItem => ({ puzzle: { id, source: 'lichess', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2', 'a2a3'], rating: 1500, themes: [] }, mode, reason: id });
const target = (key: string, side: 'white' | 'black' = 'white'): OpeningTarget => ({ side, line: 'deviation', key, weight: 1, replay: ['e4'], reason: key });
const many = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

const input = (over: Partial<DailyInput> = {}): DailyInput => ({
  now: NOW,
  budgetMs: B,
  learning: [],
  bestReviews: [],
  seqReviews: [],
  puzzleReviews: [],
  repDue: [],
  news: [],
  openings: [],
  endgame: null,
  tacticsAvailable: true,
  placement: null,
  tactics: [],
  times,
  maxNewPerGame: 2,
  ...over,
});

/** Composes with the puzzle pool the loader would fetch: exactly the slots asked for. */
function daily(over: Partial<DailyInput> = {}) {
  const i = input(over);
  const slots = tacticsSlots(i);
  return composeDaily({ ...i, tactics: many(slots, (k) => puzzle(`t${k}`)) });
}

const sum = (steps: PlannedStep[]) => steps.reduce((s, x) => s + x.estMs, 0);
const blockOf = (steps: PlannedStep[], b: PlannedStep['block']) => steps.filter((s) => s.block === b);
const ids = (steps: PlannedStep[]) => steps.map((s) => (s.item.kind === 'best' || s.item.kind === 'seq' ? s.item.cardId : s.item.kind === 'puzzle' ? s.item.item.puzzle.id : s.item.kind === 'rep' ? `${s.item.side}:${s.item.line}` : s.item.drillId));

describe('Treinar: the reviews', () => {
  it('come first, up to half the time: the learning steps, then each kind in turn', () => {
    const { steps, leftover } = daily({
      learning: [pos('L1')],
      bestReviews: many(40, (k) => pos(`b${k}`)),
      puzzleReviews: many(40, (k) => puzzle(`p${k}`, 'review')),
      seqReviews: many(10, (k) => pos(`s${k}`, { kind: 'seq', steps: 2 })),
      repDue: [{ side: 'white', due: 6 }],
    });
    const review = blockOf(steps, 'review');
    expect(ids(review).slice(0, 6)).toEqual(['L1', 'b0', 'p0', 's0', 'white:review', 'b1']);
    expect(sum(review)).toBeLessThanOrEqual(TRAINING.reviewShare * B);
    // Everything that did not fit waits for tomorrow, counted (a repertoire line by its positions).
    const taken = review.reduce((n, s) => n + (s.item.kind === 'rep' ? TRAINING.repPerLine : 1), 0);
    expect(leftover).toBe(1 + 40 + 40 + 10 + 6 - taken);
    expect(leftover).toBeGreaterThan(0);
    expect(steps[0]!.block).toBe('review');
  });

  it('repertoire lines by opening deck, the decks in turn, each naming its deck', () => {
    const { steps } = daily({ repDue: [{ side: 'black', due: 4, deckId: 'b-sicilian', name: 'Siciliana' }, { side: 'white', due: 2, deckId: 'w-italian', name: 'Italiana' }, { side: 'white', due: 1 }] });
    const reps = blockOf(steps, 'review').map((s) => s.item as { deckId?: string; key: string });
    expect(reps.map((r) => r.deckId)).toEqual(['b-sicilian', 'w-italian', undefined, 'b-sicilian']);
    expect(new Set(reps.map((r) => r.key)).size).toBe(4);
    expect(blockOf(steps, 'review')[0]!.reason).toBe('Siciliana: 4 posições venceram hoje, e a linha passa por elas.');
    expect(blockOf(steps, 'review')[2]!.reason).toBe('Repertório de brancas: a linha passa pelas posições que venceram hoje.');
  });

  it('show one card per position: a sequence of a position already there stays out', () => {
    const { steps } = daily({ bestReviews: [pos('A', { note: 'n1' })], seqReviews: [pos('S', { kind: 'seq', note: 'n1', steps: 2 }), pos('T', { kind: 'seq', note: 'n2', steps: 2 })] });
    expect(ids(blockOf(steps, 'review'))).toEqual(['A', 'T']);
  });
});

describe('Treinar: your new mistakes', () => {
  it('come in the order of your focuses, at most two from the same game across both kinds', () => {
    const news = [pos('x1', { primaryGameId: 'g1' }), pos('x2', { primaryGameId: 'g1', kind: 'seq', steps: 2 }), pos('x3', { primaryGameId: 'g1' }), pos('y1', { primaryGameId: 'g2' })];
    const { steps } = daily({ news });
    expect(ids(blockOf(steps, 'mine'))).toEqual(['x1', 'x2', 'y1']);
    // A new position counts its return within the session.
    expect(blockOf(steps, 'mine')[0]!.estMs).toBe(positionMs(news[0]!, times) * TRAINING.newRepeatFactor);
  });

  it('never take the time reserved for tactics, openings and the endgame', () => {
    const news = many(100, (k) => pos(`m${k}`));
    const { steps } = daily({ news, openings: many(5, (k) => target(`e${k}`)), endgame: { drillId: 'kqk', reason: '' } });
    expect(sum(blockOf(steps, 'tactics'))).toBeGreaterThanOrEqual(TRAINING.tacticsMinShare * B - puzzleMs(times));
    expect(blockOf(steps, 'openings')).toHaveLength(Math.floor((TRAINING.openingsShare * B) / repLineMs(times)));
    expect(ids(blockOf(steps, 'endgame'))).toEqual(['kqk']);
    expect(sum(steps)).toBeLessThanOrEqual(B);
  });
});

describe('Treinar: the whole session', () => {
  it('comes in the order of value and closes the time with tactics, within one step of it', () => {
    const { steps } = daily({ bestReviews: many(5, (k) => pos(`b${k}`)), news: many(3, (k) => pos(`m${k}`)), openings: [target('e1')], endgame: { drillId: 'kqk', reason: '' } });
    const order = [...new Set(steps.map((s) => s.block))];
    expect(order).toEqual(['review', 'mine', 'tactics', 'openings', 'endgame']);
    expect(sum(steps)).toBeLessThanOrEqual(B);
    expect(B - sum(steps)).toBeLessThan(puzzleMs(times));
  });

  it('a block without material passes its time on: no puzzle bank, more of your mistakes', () => {
    const news = many(100, (k) => pos(`m${k}`));
    const withBank = daily({ news });
    const without = daily({ news, tacticsAvailable: false });
    expect(blockOf(without.steps, 'tactics')).toHaveLength(0);
    expect(blockOf(without.steps, 'mine').length).toBeGreaterThan(blockOf(withBank.steps, 'mine').length);
  });

  it('the calibration, while pending, is the tactics block whatever the time', () => {
    const placement = many(12, (k) => puzzle(`c${k}`, 'placement'));
    const i = input({ placement, budgetMs: 20 * 60_000 });
    expect(tacticsSlots(i)).toBe(0);
    expect(ids(blockOf(composeDaily(i).steps, 'tactics'))).toEqual(placement.map((p) => p.puzzle.id));
  });

  it('"Mais 10 minutos" leaves out what the session already has', () => {
    const exclude = new Set(['card:A', 'note:n-B', 'puzzle:p0', 'rep:white:deviation:e1', 'endgame:kqk']);
    const { steps } = daily({ budgetMs: 10 * 60_000, bestReviews: [pos('A'), pos('C')], seqReviews: [pos('B2', { kind: 'seq', note: 'n-B' })], puzzleReviews: [puzzle('p0', 'review'), puzzle('p1', 'review')], openings: [target('e1'), target('e2')], endgame: { drillId: 'kqk', reason: '' }, exclude });
    expect(ids(steps)).not.toContain('A');
    expect(ids(steps)).not.toContain('B2');
    expect(ids(steps)).not.toContain('p0');
    expect(ids(steps)).toContain('C');
    expect(steps.filter((s) => s.item.kind === 'rep').map((s) => (s.item as { key: string }).key)).toEqual(['e2']);
    expect(blockOf(steps, 'endgame')).toHaveLength(0);
  });

  it('mistakes to punish get their own time: the openings\' lines stay, the tactics give way', () => {
    const lines = many(5, (k) => target(`e${k}`));
    const punish = many(3, (k) => ({ ...puzzle(`punish:p${k}`, 'punish'), puzzle: { ...puzzle(`punish:p${k}`).puzzle, source: 'punish' as const } }));
    const without = daily({ openings: lines });
    const withPunish = daily({ openings: lines, punish });
    const reps = (s: PlannedStep[]) => s.filter((x) => x.item.kind === 'rep').length;
    expect(reps(withPunish.steps)).toBe(reps(without.steps));
    const opening = blockOf(withPunish.steps, 'openings');
    expect(opening.filter((x) => x.item.kind === 'puzzle').map((x) => (x.item as { item: SessionItem }).item.puzzle.id)).toEqual(['punish:p0', 'punish:p1', 'punish:p2']);
    expect(blockOf(withPunish.steps, 'tactics').length).toBeLessThan(blockOf(without.steps, 'tactics').length);
    expect(sum(withPunish.steps)).toBeLessThanOrEqual(B);
    // One already in the session stays out ("Mais 10 minutos").
    const more = daily({ punish, exclude: new Set(['puzzle:punish:p0']) });
    expect(more.steps.filter((x) => x.item.kind === 'puzzle' && x.block === 'openings')).toHaveLength(2);
  });

  it('two weak decks with the same root are two lines, and "Mais 10 minutos" tells them apart', () => {
    const deck = (deckId: string): OpeningTarget => ({ side: 'black', line: 'chapter', key: 'start', weight: 1, deckId, reason: deckId });
    const first = daily({ openings: [deck('b-reti-english'), deck('b-rare')] });
    expect(blockOf(first.steps, 'openings').map((s) => (s.item as { deckId?: string }).deckId)).toEqual(['b-reti-english', 'b-rare']);
    const more = daily({ budgetMs: 10 * 60_000, openings: [deck('b-reti-english'), deck('b-rare')], exclude: new Set(['rep:black:chapter:start:b-reti-english']) });
    expect(blockOf(more.steps, 'openings').map((s) => (s.item as { deckId?: string }).deckId)).toEqual(['b-rare']);
  });
});

describe('Aquecer', () => {
  const base = { budgetMs: TRAINING.warmupMinutes * 60_000, sides: ['white', 'black'] as Array<'white' | 'black'>, times };

  it('a reminder, quick puzzles, then one line of each color, and no new mistake', () => {
    const steps = composeWarmup({ ...base, reminder: { p: pos('R'), due: true }, puzzles: many(6, (k) => puzzle(`w${k}`, 'warmup')) });
    expect(steps.map((s) => s.block)).toEqual(['reminder', 'tactics', 'tactics', 'tactics', 'tactics', 'openings', 'openings']);
    expect(steps[0]!.practice).toBeUndefined();
    expect(steps.slice(-2).map((s) => s.item)).toEqual([
      { kind: 'rep', side: 'white', line: 'warmup', key: 'white' },
      { kind: 'rep', side: 'black', line: 'warmup', key: 'black' },
    ]);
    expect(steps.some((s) => s.block === 'mine')).toBe(false);
  });

  it('the line of a color stays in the deck you meet most, when there is one', () => {
    const steps = composeWarmup({ ...base, reminder: null, puzzles: [], decks: { black: { id: 'b-sicilian', name: 'Siciliana' } } });
    expect(steps.map((s) => s.item)).toEqual([
      { kind: 'rep', side: 'white', line: 'warmup', key: 'white' },
      { kind: 'rep', side: 'black', line: 'warmup', key: 'black', deckId: 'b-sicilian' },
    ]);
    expect(steps[1]!.reason).toMatch(/^Siciliana, a abertura de pretas que você mais enfrenta/);
  });

  it('the reminder is free practice when it is not due', () => {
    const steps = composeWarmup({ ...base, reminder: { p: pos('R'), due: false }, puzzles: [] });
    expect(steps[0]!.practice).toBe(true);
  });

  it('as many puzzles as fit the five minutes, between 3 and 6', () => {
    const reminder = { p: pos('R'), due: true };
    expect(warmupSlots({ ...base, reminder })).toBe(4);
    expect(warmupSlots({ ...base, reminder, times: { ...times, puzzleMs: 5_000 } })).toBe(6);
    expect(warmupSlots({ ...base, reminder, times: { ...times, puzzleMs: 120_000 } })).toBe(3);
  });
});
