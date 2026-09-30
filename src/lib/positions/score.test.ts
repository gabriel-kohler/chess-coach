import { describe, expect, it } from 'vitest';
import { makeAnalysis, makeGame } from '../../test/positionFixtures';
import type { SearchLimits } from '../engine/stockfish';
import type { EngineLine } from '../types';
import { deriveSources, planBestCards } from './derive';
import { engineScore, storedScore } from './score';
import type { BestMoveCard } from './types';

const NOW = Date.UTC(2026, 8, 10);

function whiteCard(): BestMoveCard {
  const g = makeGame();
  const a = makeAnalysis(
    g,
    { 7: { loss: 8, winBefore: 55, winAfter: 47, classification: 'inaccuracy' } },
    {
      6: [
        { depth: 16, cp: 60, pv: ['c4b5', 'a7a6'], stableFrom: 8 },
        { depth: 16, cp: 20, pv: ['d2d3', 'd7d6'] },
      ],
      7: [{ depth: 16, cp: -30, pv: ['g8f6', 'd2d3'] }],
    },
  );
  return planBestCards([], deriveSources(g, a).sources, NOW).put[0]!;
}

function fakeEngine(lines: EngineLine[], seen: SearchLimits[] = []) {
  return { analyse: async (_fen: string, limits: SearchLimits) => (seen.push(limits), lines) };
}

describe('stored move scores', () => {
  const card = whiteCard();
  it('the best move is exact and free', () => {
    expect(storedScore(card, 'c4b5', false)).toMatchObject({ loss: 0, exact: true, source: 'best' });
  });
  it('mate is always right', () => {
    expect(storedScore(card, 'a2a3', true)).toMatchObject({ loss: 0, source: 'mate' });
  });
  it('the second line comes from the same search', () => {
    const s = storedScore(card, 'd2d3', false)!;
    expect(s.source).toBe('stored');
    expect(s.loss).toBeGreaterThan(2);
    expect(s.reply?.pv[0]).toBe('d7d6');
  });
  it('the move you played in the game keeps the loss the review showed', () => {
    expect(storedScore(card, 'c2c3', false)).toMatchObject({ loss: 8, source: 'game' });
  });
  it('a cached engine verdict is reused, anything else needs the engine', () => {
    const cached: BestMoveCard = { ...card, scored: { h2h3: { loss: 4, best: card.best, reply: null } } };
    expect(storedScore(cached, 'h2h3', false)).toMatchObject({ loss: 4, source: 'engine' });
    expect(storedScore(card, 'h2h3', false)).toBeNull();
  });
});

describe('engine move scores', () => {
  it('scores both moves in one search, same depth', async () => {
    const card = whiteCard();
    const seen: SearchLimits[] = [];
    const s = await engineScore(
      card,
      'h2h3',
      fakeEngine(
        [
          { depth: 16, cp: 60, pv: ['c4b5', 'a7a6'] },
          { depth: 16, cp: -60, pv: ['h2h3', 'd7d5', 'e4d5'] },
        ],
        seen,
      ),
    );
    expect(seen).toEqual([{ depth: 16, multipv: 2, searchmoves: ['c4b5', 'h2h3'] }]);
    expect(s.loss).toBeGreaterThan(10);
    expect(s.reply?.pv).toEqual(['d7d5', 'e4d5']);
  });

  it('gets the sign right when Black is to move (scores are from White)', async () => {
    const card: BestMoveCard = { ...whiteCard(), color: 'black', best: { uci: 'e7e5', san: 'e5', pv: ['e7e5'], score: { cp: 20 }, depth: 16 } };
    const s = await engineScore(
      card,
      'f7f6',
      fakeEngine([
        { depth: 16, cp: 20, pv: ['e7e5'] },
        { depth: 16, cp: 120, pv: ['f7f6'] },
      ]),
    );
    expect(s.loss).toBeGreaterThan(5);
  });

  it('a move the engine now prefers loses nothing', async () => {
    const s = await engineScore(
      whiteCard(),
      'd2d4',
      fakeEngine([
        { depth: 16, cp: 80, pv: ['d2d4'] },
        { depth: 16, cp: 60, pv: ['c4b5'] },
      ]),
    );
    expect(s.loss).toBe(0);
  });

  it('fails loudly when the engine gives no line for the move', async () => {
    await expect(engineScore(whiteCard(), 'h2h3', fakeEngine([{ depth: 16, cp: 60, pv: ['c4b5'] }]))).rejects.toThrow();
  });
});
