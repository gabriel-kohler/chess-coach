import { describe, expect, it } from 'vitest';
import { epdOf } from '../chess/replay';
import type { OpeningTree } from '../repertoire/games';
import { humanReplies, likeliestReply, pickReplies } from './replies';

const AFTER_QA5 = '3rk3/1b2b2p/p1n3pB/q1p1p3/6P1/PP2P2P/5PB1/RQ2K1R1 w Q - 2 25';
const ALAPIN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/2P5/PP1P1PPP/RNBQKBNR b KQkq - 0 2';
const maia = (moves: Array<[string, number]>) => async () => moves.map(([uci, p]) => ({ uci, p }));

describe('human replies', () => {
  it('keeps the moves at 10% or more, at most 4', () => {
    const m = [0.4, 0.25, 0.15, 0.1, 0.06, 0.04].map((p, i) => ({ id: i, p }));
    expect(pickReplies(m).map((x) => x.id)).toEqual([0, 1, 2, 3]);
  });

  it('keeps at least 2 even when one move dominates', () => {
    expect(pickReplies([{ p: 0.92 }, { p: 0.05 }, { p: 0.03 }]).map((x) => x.p)).toEqual([0.92, 0.05]);
  });

  it('after the opening, asks Maia with the opponent to move and names the moves', async () => {
    const seen: number[] = [];
    const r = await humanReplies({
      fen: AFTER_QA5,
      ply: 48,
      oppElo: 1700,
      userElo: 1670,
      policy: async (_f, self, oppo) => (seen.push(self, oppo), [{ uci: 'e1f1', p: 0.43 }, { uci: 'b3b4', p: 0.38 }, { uci: 'e1e2', p: 0.19 }]),
    });
    expect(seen).toEqual([1700, 1670]);
    expect(r.map((x) => `${x.san} ${Math.round(x.p * 100)}`)).toEqual(['Kf1 43', 'b4 38', 'Ke2 19']);
    expect(r[0]!.source).toBe('maia');
  });

  it('in the opening, uses your games when they reached the position 5+ times', async () => {
    const tree: OpeningTree = new Map([
      [
        epdOf(ALAPIN),
        new Map([
          ['d7d5', { san: 'd5', uci: 'd7d5', n: 6, points: 3 }],
          ['b8c6', { san: 'Nc6', uci: 'b8c6', n: 3, points: 1 }],
          ['e7e6', { san: 'e6', uci: 'e7e6', n: 1, points: 0 }],
        ]),
      ],
    ]);
    const r = await humanReplies({ fen: ALAPIN, ply: 3, tree, oppElo: 1600, userElo: 1600, policy: maia([['a7a6', 1]]) });
    expect(r.map((x) => x.uci)).toEqual(['d7d5', 'b8c6', 'e7e6']);
    expect(r[0]).toMatchObject({ source: 'games', p: 0.6 });
  });

  it('falls back to Maia when your games saw the position fewer than 5 times', async () => {
    const tree: OpeningTree = new Map([[epdOf(ALAPIN), new Map([['d7d5', { san: 'd5', uci: 'd7d5', n: 2, points: 1 }]])]]);
    const r = await likeliestReply({ fen: ALAPIN, ply: 3, tree, oppElo: 1600, userElo: 1600, policy: maia([['b8c6', 0.35], ['e7e5', 0.16]]) });
    expect(r).toMatchObject({ uci: 'b8c6', san: 'Nc6', source: 'maia' });
  });
});
