import { describe, expect, it } from 'vitest';
import type { BestMoveCard } from '../positions/types';
import { countMotifs } from './gameMotifs';

const card = (over: Partial<BestMoveCard>): BestMoveCard =>
  ({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', color: 'white', suspended: 0, best: { uci: 'd1d8', san: 'Rd8#', pv: ['d1d8'], score: { mate: 1 }, depth: 16 }, ...over }) as BestMoveCard;

describe('motifs of the positions you got wrong', () => {
  it('counts the motif of each best move', () => {
    expect(countMotifs([card({}), card({})])).toMatchObject({ mateIn1: 2, backRankMate: 2 });
  });

  it('a mate for the other side is not a mating motif of yours, and suspended cards do not count', () => {
    const counts = countMotifs([card({ best: { uci: 'd1d8', san: 'Rd8+', pv: ['d1d8'], score: { mate: -3 }, depth: 16 } }), card({ suspended: 1 })]);
    expect(counts.mateIn1).toBeUndefined();
    expect(counts.mateIn3).toBeUndefined();
  });
});
