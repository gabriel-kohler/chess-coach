// @vitest-environment node
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { gainOf, punishWhy, WHY } from './why';

const fenAfter = (m: string[]) => {
  const c = new Chess();
  for (const x of m) c.move(x);
  return c.fen();
};

describe('why a punishment punishes', () => {
  it('follows the engine to the mate, and stops there', () => {
    // 4.Nxe5?? Qg5 (Blackburne Shilling): 5.Nxf7 Qxg2 6.Rf1 Qxe4+ 7.Be2 Nf3#.
    const puzzle = { fen: fenAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']), moves: ['f3e5', 'd8g5'] };
    const why = punishWhy(puzzle, { depth: 18, mate: -3, pv: ['e5f7', 'g5g2', 'h1f1', 'g2e4', 'c4e2', 'd4f3', 'e1d1'] });
    expect(why.solved).toBe(2);
    expect(why.moves).toHaveLength(8);
    expect(why.payoff).toMatchObject({ kind: 'mate', what: 'dá mate', ply: 8, label: '7...', san: 'Nf3#' });
    expect(why.score).toEqual({ mate: -3 });
  });

  it('says what the material is and lets the recaptures land', () => {
    // ...Ke8?? walks into the fork: Nc7+ and Nxa8.
    const puzzle = { fen: 'r7/4k3/8/1N6/8/8/8/4K3 b - - 0 1', moves: ['e7e8', 'b5c7'] };
    const why = punishWhy(puzzle, { depth: 18, cp: 900, pv: ['e8d7', 'c7a8', 'd7c8', 'e1d2', 'c8b8'] });
    expect(why.payoff).toMatchObject({ kind: 'material', what: 'ganha uma torre', ply: 4, label: '3.', san: 'Nxa8' });
    expect(why.moves).toHaveLength(4 + WHY.settle);
    expect(why.idea?.san).toBe('Nc7+');
    expect(why.idea?.motifs[0]).toContain('garfo');
  });

  it('a recapture wins nothing: its idea is the skewer, not the material', () => {
    // Alapin: 7...Bxf3 8.Bxf3 takes back the bishop and hits the queen with the knight behind it.
    const fen = fenAfter(['e4', 'c5', 'c3', 'd5', 'exd5', 'Qxd5', 'd4', 'Nc6', 'Nf3', 'Bg4', 'Be2', 'cxd4', 'cxd4']);
    const why = punishWhy({ fen, moves: ['g4f3', 'e2f3'] }, { depth: 18, cp: 130, pv: ['d5c4', 'b1a3', 'c4a6'] });
    expect(why.payoff).toBeNull();
    expect(why.idea?.motifs.join(' ')).not.toContain('ganha material');
    expect(why.idea?.motifs.join(' ')).toContain('espeto');
  });

  it('a capture that wins more than the mistake took keeps its motif', () => {
    // 4...Nxe4?? takes a pawn defended by d3: 5.dxe4 wins the knight for it.
    const fen = fenAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3']);
    const why = punishWhy({ fen, moves: ['f6e4', 'd3e4'] }, { depth: 18, cp: 250, pv: [] });
    expect(why.idea?.motifs.join(' ')).toContain('cavalo em e4');
  });

  it('wins nothing: a few moves of the plan, no payoff', () => {
    // 1.f3 e5 and a quiet line: the advantage is the position.
    const puzzle = { fen: fenAfter([]), moves: ['f2f3', 'e7e5'] };
    const pv = ['g1h3', 'd7d5', 'e2e3', 'g8f6', 'f1e2', 'b8c6', 'e1g1', 'f8d6', 'c2c3', 'e8g8'];
    const why = punishWhy(puzzle, { depth: 18, cp: -60, pv });
    expect(why.payoff).toBeNull();
    expect(why.moves).toEqual([...puzzle.moves, ...pv.slice(0, WHY.quiet)]);
  });

  it('keeps the whole exercise even when it pays off inside it', () => {
    // A Lichess puzzle's solution goes on past Nxa8 and its two settling plies.
    const puzzle = { fen: 'r7/4k3/8/1N6/8/8/8/4K3 b - - 0 1', moves: ['e7e8', 'b5c7', 'e8d7', 'c7a8', 'd7c8', 'e1d2', 'c8b8', 'd2e3'] };
    const why = punishWhy(puzzle, { depth: 18, cp: 900, pv: ['b8a8'] });
    expect(why.moves).toEqual(puzzle.moves);
    expect(why.payoff?.ply).toBe(4);
  });

  it('stops at an illegal engine move', () => {
    const puzzle = { fen: fenAfter([]), moves: ['f2f3', 'e7e5'] };
    expect(punishWhy(puzzle, { depth: 18, cp: -60, pv: ['g1h3', 'e1e5'] }).moves).toEqual(['f2f3', 'e7e5', 'g1h3']);
  });
});

describe('what changed hands', () => {
  it('names the pieces, net of the trades', () => {
    expect(gainOf('4k3/4b3/8/8/8/8/4P3/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w')).toBe('um bispo por um peão');
    expect(gainOf('4k3/2ppb3/8/8/8/8/4B3/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w')).toBe('dois peões');
    expect(gainOf('r3k3/8/8/8/8/8/8/2B1K3 w - - 0 1', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w')).toBe('a qualidade');
    expect(gainOf('rn2k3/8/8/8/8/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w')).toBe('uma torre e um cavalo');
  });

  it('is nothing when the trade is even, the side lost, or a pawn promoted', () => {
    expect(gainOf('4k3/4b3/8/8/8/8/4N3/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w')).toBeNull();
    expect(gainOf('4k3/4b3/8/8/8/8/8/4K3 w - - 0 1', '4k3/4b3/8/8/8/8/8/4K3 w - - 0 1', 'b')).toBeNull();
    expect(gainOf('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'Q3k3/8/8/8/8/8/8/4K3 b - - 0 1', 'w')).toBeNull();
  });
});
