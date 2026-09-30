import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { makeAnalysis, makeGame } from '../../test/positionFixtures';
import { reviewCard } from '../srs/fsrs';
import type { EngineLine } from '../types';
import { analysisSig, deriveSources, planBestCards } from './derive';
import type { BestMoveCard } from './types';

const NOW = Date.UTC(2026, 8, 10);
const best = (uci: string, cp = 60, stableFrom?: number): EngineLine => ({ depth: 16, cp, pv: [uci, 'e7e6'], ...(stableFrom ? { stableFrom } : {}) });

// White (the user) plays 7.c3 losing 8 points; the engine wanted 7.Bb5.
function gameWithError(id: string, loss = 8, extra: Parameters<typeof makeAnalysis>[1] = {}, version = 3) {
  const g = makeGame({ id, endTime: NOW - (id === 'g2' ? 1 : 2) * 86_400_000 });
  const a = makeAnalysis(g, { 7: { classification: 'inaccuracy', winBefore: 55, winAfter: 55 - loss, loss }, ...extra }, { 6: [best('c4b5', 60, 8), { depth: 16, cp: -20, pv: ['c2c3'] }] }, { version });
  return { g, a };
}

describe('deriving sources from an analysis', () => {
  it('takes only your non-theory moves that lost 5+ points and have a best line', () => {
    const g = makeGame();
    const a = makeAnalysis(
      g,
      {
        7: { loss: 8, winBefore: 55, winAfter: 47, classification: 'inaccuracy' },
        8: { loss: 30, winBefore: 45, winAfter: 15, classification: 'blunder' }, // opponent's move
        9: { loss: 4, classification: 'good' },
        3: { loss: 9, classification: 'book' },
      },
      { 6: [best('c4b5')] },
    );
    const { sources, focus } = deriveSources(g, a);
    expect(sources.map((s) => s.ply)).toEqual([7]);
    expect(focus.map((f) => f.loss)).toEqual([8]);
    const s = sources[0]!;
    expect(s.best.uci).toBe('c4b5');
    expect(s.best.san).toBe('Bb5');
    expect(s.color).toBe('white');
    expect(s.prevMove).toEqual({ from: 'f8', to: 'c5' });
    expect(s.categories).toContain('inaccuracy');
  });

  it('skips a move that still leaves you at 90% or more', () => {
    const g = makeGame();
    const cut = makeAnalysis(g, { 7: { loss: 8, winBefore: 99, winAfter: 91 } }, { 6: [best('c4b5')] });
    const kept = makeAnalysis(g, { 7: { loss: 8, winBefore: 80, winAfter: 72 } }, { 6: [best('c4b5')] });
    expect(deriveSources(g, cut).sources).toHaveLength(0);
    expect(deriveSources(g, kept).sources).toHaveLength(1);
  });

  it('signs an analysis by version, creation and depth', () => {
    const { a } = gameWithError('g1');
    expect(analysisSig({ ...a, version: undefined })).toBe('0|1000|16');
  });
});

describe('planning cards', () => {
  it('one card per position, even when two games reached it', () => {
    const one = gameWithError('g1', 8);
    const two = gameWithError('g2', 12);
    const sources = [...deriveSources(one.g, one.a).sources, ...deriveSources(two.g, two.a).sources];
    const { put, report } = planBestCards([], sources, NOW);
    expect(put).toHaveLength(1);
    expect(report.created).toBe(1);
    const card = put[0]!;
    expect(card.id).toBe(`best:${sources[0]!.epd}`);
    expect(card.note).toBe(sources[0]!.epd);
    expect(card.primaryGameId).toBe('g2'); // the bigger loss
    expect(card.totalLoss).toBe(20);
    expect(card.sources.map((s) => s.gameId)).toEqual(['g2', 'g1']); // newest first
    expect(card.state).toBe(State.New);
    expect(card.bucket).toBe('medium'); // stableFrom 8
  });

  it('is idempotent: planning again on its own output writes nothing', () => {
    const { g, a } = gameWithError('g1');
    const first = planBestCards([], deriveSources(g, a).sources, NOW);
    const again = planBestCards(first.put, deriveSources(g, a).sources, NOW + 1);
    expect(again.put).toHaveLength(0);
    expect(again.report.unchanged).toBe(1);
  });

  it('a re-scored analysis updates the card and keeps its review history', () => {
    const before = gameWithError('g1', 8, {}, 2);
    const [card] = planBestCards([], deriveSources(before.g, before.a).sources, NOW).put as [BestMoveCard];
    const reviewed: BestMoveCard = { ...card, ...reviewCard(card, Rating.Good, NOW).next, scored: { e2e4: { loss: 3, best: card.best, reply: null } } };
    const after = gameWithError('g1', 12, {}, 3);
    const { put, report } = planBestCards([reviewed], deriveSources(after.g, after.a).sources, NOW + 1);
    expect(report.updated).toBe(1);
    const next = put[0]!;
    expect(next.totalLoss).toBe(12);
    expect(next.reps).toBe(reviewed.reps);
    expect(next.state).toBe(reviewed.state);
    expect(next.due).toBe(reviewed.due);
    expect(next.scored).toBeUndefined();
  });

  it('a card that loses every source is removed if new, suspended if reviewed, and revived later', () => {
    const { g, a } = gameWithError('g1');
    const sources = deriveSources(g, a).sources;
    const [card] = planBestCards([], sources, NOW).put as [BestMoveCard];
    expect(planBestCards([card], [], NOW).remove).toEqual([card.id]);

    const reviewed: BestMoveCard = { ...card, ...reviewCard(card, Rating.Easy, NOW).next };
    const gone = planBestCards([reviewed], [], NOW);
    expect(gone.put[0]!.suspended).toBe(1);
    expect(gone.report.suspended).toBe(1);

    const back = planBestCards(gone.put, sources, NOW + 1);
    expect(back.report.revived).toBe(1);
    expect(back.put[0]!.suspended).toBe(0);
    expect(back.put[0]!.reps).toBe(reviewed.reps);
  });

  it('a best line without a settle depth counts as medium', () => {
    const g = makeGame();
    const a = makeAnalysis(g, { 7: { loss: 8, winBefore: 55, winAfter: 47 } }, { 6: [best('c4b5')] });
    expect(planBestCards([], deriveSources(g, a).sources, NOW).put[0]!.bucket).toBe('medium');
  });
});
