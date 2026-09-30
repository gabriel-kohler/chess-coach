import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { makeAnalysis, makeGame } from '../../test/positionFixtures';
import { reviewCard } from '../srs/fsrs';
import { deriveSources, planBestCards } from './derive';
import { planSequenceCards, seqCardsFor } from './seqPlan';
import type { SeqBranch } from './sequence';
import type { BestMoveCard } from './types';

const NOW = Date.UTC(2026, 8, 10);
const root = (): BestMoveCard => {
  const g = makeGame();
  const a = makeAnalysis(g, { 7: { loss: 8, winBefore: 55, winAfter: 47 } }, { 6: [{ depth: 16, cp: 60, pv: ['c4b5', 'a7a6'] }] });
  return planBestCards([], deriveSources(g, a).sources, NOW).put[0]!;
};
const branch = (uci: string): SeqBranch => ({ reply: { uci, san: uci, p: 0.4, source: 'maia' }, nodes: [], replies: [], end: { kind: 'kept', winStart: 55, winEnd: 55 }, moves: ['c4b5', uci] });

describe('sequence cards', () => {
  it('one card per branch, siblings of the position card', () => {
    const r = root();
    const cards = seqCardsFor(r, [branch('a7a6'), branch('c6d4')], 300, NOW);
    expect(cards.map((c) => c.id)).toEqual([`seq:${r.epd}:a7a6`, `seq:${r.epd}:c6d4`]);
    expect(cards.every((c) => c.note === r.note && c.rootId === r.id && c.built.offset === 300)).toBe(true);
  });

  it('removes new sequences when the position goes away, suspends reviewed ones', () => {
    const r = root();
    const [fresh, reviewed] = seqCardsFor(r, [branch('a7a6'), branch('c6d4')], 300, NOW);
    const done = { ...reviewed!, ...reviewCard(reviewed!, Rating.Good, NOW).next };
    const plan = planSequenceCards([fresh!, done], []);
    expect(plan.remove).toEqual([fresh!.id]);
    expect(plan.put.map((c) => [c.id, c.suspended])).toEqual([[done.id, 1]]);
  });

  it('retires sequences when a new analysis changes the best move', () => {
    const r = root();
    const [s] = seqCardsFor(r, [branch('a7a6')], 300, NOW);
    const moved = { ...r, best: { ...r.best, uci: 'd2d4', san: 'd4' } };
    expect(planSequenceCards([s!], [moved]).remove).toEqual([s!.id]);
  });

  it('revives a suspended sequence when its position is back, and follows its priority data', () => {
    const r = root();
    const [s] = seqCardsFor(r, [branch('a7a6')], 300, NOW);
    const plan = planSequenceCards([{ ...s!, suspended: 1 }], [{ ...r, totalLoss: 20 }]);
    expect(plan.put[0]).toMatchObject({ suspended: 0, totalLoss: 20 });
    expect(planSequenceCards([s!], [r]).put).toHaveLength(0);
  });
});
