import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import example from '../../test/sequenceExample.json' with { type: 'json' };
import { lineToSan } from '../chess/replay';
import type { EngineLine } from '../types';
import type { HumanReply } from './replies';
import { pickReplies } from './replies';
import { band, buildBranches, oneMoveLesson, quietAhead, type SeqDeps, type SeqRoot } from './sequence';

// Real Stockfish 18 (depth 16) and Maia-2 answers recorded on your game
// (24...Qa5+ against necatikayser), replayed here so the test is exact.
const recorded: SeqDeps = {
  analyse: async (fen) => (example.lines as Record<string, EngineLine[]>)[fen] ?? [],
  replies: async (fen) => pickReplies((example.policy as Record<string, HumanReply[]>)[fen] ?? []),
  likeliest: async (fen) => (example.policy as Record<string, HumanReply[]>)[fen]?.[0] ?? null,
};

// A quiet engine for synthetic positions: the first legal move that is not a
// capture, scored `cp` (White's view); overrides by exact FEN.
function quiet(cp: number, overrides: Record<string, EngineLine[]> = {}): SeqDeps {
  const firstQuiet = (fen: string) => new Chess(fen).moves({ verbose: true }).find((m) => !m.captured && !m.san.includes('+'));
  return {
    analyse: async (fen) => overrides[fen] ?? (firstQuiet(fen) ? [{ depth: 16, cp, pv: [firstQuiet(fen)!.lan] }] : []),
    replies: async (fen) => new Chess(fen).moves({ verbose: true }).filter((m) => !m.captured).slice(0, 2).map((m, i) => ({ uci: m.lan, san: m.san, p: i ? 0.4 : 0.6, source: 'maia' as const })),
    likeliest: async (fen) => {
      const m = firstQuiet(fen);
      return m ? { uci: m.lan, san: m.san, p: 0.5, source: 'maia' } : null;
    },
  };
}

describe('building sequences', () => {
  it('your game: three human answers, three different endings', async () => {
    const root = example.root as SeqRoot;
    const branches = (await buildBranches(root, recorded))!;
    const summary = branches.map((b) => [b.reply.san, lineToSan(root.fen, b.moves, 20).join(' '), b.end.kind]);
    expect(summary).toEqual([
      ['Kf1', 'Qa5+ Kf1 Qb5+', 'perpetual'],
      ['b4', 'Qa5+ b4 cxb4', 'material'],
      ['Ke2', 'Qa5+ Ke2 Rd2+ Kf3 Bh4 Rf1 Nd4#', 'mate'],
    ]);
  });

  it('does not stop at the check that only starts the win (Ke2 Rd2+)', async () => {
    const branches = (await buildBranches(example.root as SeqRoot, recorded))!;
    const ke2 = branches.find((b) => b.reply.san === 'Ke2')!;
    expect(ke2.nodes.length).toBeGreaterThan(1);
    expect(ke2.end.winEnd).toBe(100);
  });

  it('keeps the advantage after 3 of your moves when nothing happens', async () => {
    const root: SeqRoot = { fen: '4k3/7p/8/8/8/8/P7/4K3 w - - 0 40', ply: 78, color: 'white', best: { uci: 'a2a3', san: 'a3', pv: ['a2a3'], score: { cp: 0 }, depth: 16 } };
    const branches = (await buildBranches(root, quiet(0)))!;
    expect(branches).toHaveLength(2);
    for (const b of branches) {
      expect(b.end.kind).toBe('kept');
      expect(b.nodes).toHaveLength(2); // root + 2 more = 3 moves of yours
    }
  });

  it('ends with advantage gained when the win chance jumps a band and nothing is pending', async () => {
    const root: SeqRoot = { fen: '4k3/7p/8/8/8/8/P7/4K3 w - - 0 40', ply: 78, color: 'white', best: { uci: 'a2a3', san: 'a3', pv: ['a2a3'], score: { cp: 0 }, depth: 16 } };
    const branches = (await buildBranches(root, quiet(300)))!;
    expect(branches[0]!.end.kind).toBe('advantage');
    expect(band(branches[0]!.end.winEnd)).toBeGreaterThan(band(branches[0]!.end.winStart));
  });

  it('a one-move lesson (a free piece taken) has no sequence', async () => {
    const root: SeqRoot = { fen: '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', ply: 40, color: 'white', best: { uci: 'd1d5', san: 'Qxd5', pv: ['d1d5', 'e8e7'], score: { cp: 400 }, depth: 16 } };
    expect(oneMoveLesson(root)).toBe(true);
    expect(await buildBranches(root, quiet(400))).toBeNull();
  });

  it('a check or capture right after your move is still pending', () => {
    // After Rd2+ the engine continues Ke1 Rb2+: a check, so not quiet.
    expect(quietAhead('3rk3/1b2b2p/p1n3pB/q1p1p3/6P1/PP2P2P/4KPB1/RQ4R1 b - - 3 25', ['d8d2', 'e2e1', 'd2b2'])).toBe(false);
    expect(quietAhead('4k3/7p/8/8/8/8/P7/4K3 w - - 0 40', ['a2a3', 'h7h6', 'a3a4'])).toBe(true);
  });
});
