import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { lineLabels, replay } from '../chess/replay';
import { classifyGame } from '../review/classify';
import type { EngineLine, PositionEval } from '../types';
import { bestLineFacts, lineFacts, nullMove, payoff, perpetual, prevented, relevanceThreshold } from './facts';
import { enPrise, motifsOf, see } from './motifs';

const themes = (fen: string, uci: string, mate?: number) => motifsOf(fen, uci, mate).map((m) => m.theme);

describe('motifs', () => {
  it('finds an absolute pin', () => {
    const fen = 'r1bqkbnr/ppp2ppp/2np4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4';
    const m = motifsOf(fen, 'f1b5');
    expect(m.map((x) => x.theme)).toContain('pin');
    expect(m.find((x) => x.theme === 'pin')!.text).toContain('cavalo em c6');
  });

  it('finds a skewer through the king', () => {
    expect(themes('8/8/8/3k3q/8/8/8/R3K3 w - - 0 1', 'a1a5')).toContain('skewer');
  });

  it('finds a discovered attack', () => {
    expect(themes('4k3/6q1/8/8/3N4/8/1B6/7K w - - 0 1', 'd4b5')).toContain('discoveredAttack');
  });

  it('finds a double check', () => {
    const t = themes('4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1', 'e4d6');
    expect(t).toContain('doubleCheck');
  });

  it('a pinned piece does not fork (chess.js attackers() ignores pins)', () => {
    // Ne5 blocks the check from e8 and is pinned there: it cannot take d7 or f7.
    expect(themes('4r2k/3q1r2/8/8/8/5N2/8/4K3 w - - 0 1', 'f3e5')).not.toContain('fork');
    // Same jump without the pinning rook: a real fork of queen and rook.
    expect(themes('7k/3q1r2/8/8/8/5N2/8/4K3 w - - 0 1', 'f3e5')).toContain('fork');
  });

  it('does not call a defended trade a free piece', () => {
    expect(themes('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5')).not.toContain('hangingPiece');
  });

  it('a pawn in front of a rook is no pin', () => {
    // ...Qa5: the a3 pawn shields a1, but that is not what the move is about.
    expect(themes('7k/8/8/3q4/8/P7/8/R6K b - - 0 1', 'd5a5')).not.toContain('pin');
  });

  it('a relative pin needs something to win behind', () => {
    // ...Qa7 lines up Na4 and Ra1: the rook is worth less than the queen, so
    // it only counts when the rook is undefended (no Bc3).
    expect(themes('6k1/3q4/8/8/N7/2B5/8/R6K b - - 0 1', 'd7a7')).not.toContain('pin');
    expect(themes('6k1/3q4/8/8/N7/8/8/R6K b - - 0 1', 'd7a7')).toContain('pin');
  });
});

describe('perpetual check', () => {
  it('recognises checks that repeat the position', () => {
    // ...Qa5+ Kf1 Qb5+ Ke1 Qa5+
    expect(perpetual('4k3/8/8/3q4/8/8/8/4K3 b - - 0 1', ['d5a5', 'e1f1', 'a5b5', 'f1e1', 'b5a5'])).toBe(true);
  });

  it('ignores the castling right lost on the way (real game, 24...Qa5+)', () => {
    const fen = '3rk3/1b2b2p/pqn3pB/2p1p3/6P1/PP2P2P/5PB1/RQ2K1R1 b Q - 1 24';
    expect(perpetual(fen, ['b6a5', 'e1f1', 'a5b5', 'f1e1', 'b5a5'])).toBe(true);
  });

  it('needs every move of the side to be a check', () => {
    expect(perpetual('4k3/8/8/3q4/8/8/8/4K3 b - - 0 1', ['d5d4', 'e1f1', 'd4d1', 'f1f2', 'd1d4', 'f2f1', 'd4d5', 'f1e1'])).toBe(false);
  });

  it('is the first thing the coach says about the best move', () => {
    const facts = lineFacts('4k3/8/8/3q4/8/8/8/4K3 b - - 0 1', { depth: 20, cp: 0, pv: ['d5a5', 'e1f1', 'a5b5', 'f1e1', 'b5a5'] });
    expect(facts.motifs.map((m) => m.theme)).toEqual(['perpetualCheck']);
  });

  it('is not claimed when the engine does not score the line as a draw', () => {
    const facts = lineFacts('4k3/8/8/3q4/8/8/8/4K3 b - - 0 1', { depth: 20, cp: -400, pv: ['d5a5', 'e1f1', 'a5b5', 'f1e1', 'b5a5'] });
    expect(facts.motifs.map((m) => m.theme)).not.toContain('perpetualCheck');
  });
});

describe('what the best move prevents', () => {
  // Real game: 24.Qb1?? allows ...Qa5+ Kf1 Qb5+ with a perpetual; 24.Qc4
  // covers b5, so after ...Qa5+ Kf1 the checks run out.
  const before = '3rk3/1b2b2p/pqn3pB/2p1p3/4Q1P1/PP2P2P/5PB1/R3K1R1 w Q - 0 24';
  const afterQb1 = '3rk3/1b2b2p/pqn3pB/2p1p3/6P1/PP2P2P/5PB1/RQ2K1R1 b Q - 1 24';
  const reply = lineFacts(afterQb1, { depth: 20, cp: 0, pv: ['b6a5', 'e1f1', 'a5b5', 'f1e1', 'b5a5'] }, before);
  const qc4: EngineLine = { depth: 20, cp: 272, pv: ['e4c4', 'b6a5', 'e1f1', 'a5d2', 'c4g8', 'e8d7'] };

  it('says the best move stops the perpetual the played move allowed', () => {
    expect(bestLineFacts(before, qc4, reply).motifs[0]!.text).toBe('evita o xeque perpétuo');
  });

  it('says nothing when the best line allows the same perpetual', () => {
    // h3 or h4: the checks from a5 and b5 work either way.
    const start = '4k3/8/8/3q4/8/8/7P/4K3 w - - 0 1';
    const checks = ['d5a5', 'e1f1', 'a5b5', 'f1e1', 'b5a5'];
    const drawn = lineFacts('4k3/8/8/3q4/8/7P/8/4K3 b - - 0 1', { depth: 20, cp: 0, pv: checks }, start);
    expect(prevented(start, { depth: 20, cp: 0, pv: ['h2h4', ...checks] }, drawn)).toBeNull();
  });

  it('names the material the best move keeps', () => {
    // Ke2 leaves the d4 knight to ...exd4; Nf5 saves it.
    const start = '4k3/8/8/4p3/3N4/8/8/4K3 w - - 0 1';
    const hung = lineFacts('4k3/8/8/4p3/3N4/8/4K3/8 b - - 1 1', { depth: 20, cp: -100, pv: ['e5d4'] }, start);
    expect(prevented(start, { depth: 20, cp: 200, pv: ['d4f5', 'e8d7'] }, hung)!.text).toBe('evita perder 3 pontos de material');
  });

  it('says nothing when the reply wins nothing', () => {
    const quiet = lineFacts(afterQb1, { depth: 20, cp: 150, pv: ['e7f6', 'b1c2'] }, before);
    expect(prevented(before, qc4, quiet)).toBeNull();
  });
});

describe('line labels', () => {
  it('numbers White moves and marks a line that Black starts', () => {
    expect(lineLabels('3rk3/1b2b2p/pqn3pB/2p1p3/6P1/PP2P2P/5PB1/RQ2K1R1 b Q - 1 24', 4)).toEqual(['24...', '25.', null, '26.']);
    expect(lineLabels('3rk3/1b2b2p/pqn3pB/2p1p3/4Q1P1/PP2P2P/5PB1/R3K1R1 w Q - 0 24', 3)).toEqual(['24.', null, '25.']);
  });
});

describe('static exchange', () => {
  it('values a defended knight as not worth a rook', () => {
    expect(see(new Chess('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1'), 'd5')).toBe(0);
    expect(see(new Chess('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1'), 'd5')).toBe(3);
  });

  it('lists pieces left en prise', () => {
    expect(enPrise('4k3/8/3p4/4N3/8/8/8/4K3 b - - 0 1', 'w')).toEqual([{ square: 'e5', type: 'n', loss: 3 }]);
  });
});

describe('payoff', () => {
  it('points at the capture that wins material', () => {
    const p = payoff('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', ['d1d5'])!;
    expect(p.kind).toBe('material');
    expect(p.swing).toBe(3);
    expect(p.text).toContain('as brancas ganham 3 pontos');
  });

  it('never credits the other side: Rxd5 exd5 is no payoff for White', () => {
    expect(payoff('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', ['d1d5', 'e6d5'])).toBeNull();
  });

  it('counts the reply from before the move it answers (Rxd5 exd5 nets 2, not 5)', () => {
    const before = '4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1';
    const after = '4k3/8/4p3/3R4/8/8/8/4K3 b - - 0 1';
    expect(payoff(after, ['e6d5'])!.swing).toBe(5);
    const p = payoff(after, ['e6d5'], 24, before)!;
    expect(p.swing).toBe(2);
    expect(p.text).toContain('as pretas ganham 2 pontos');
  });

  it('a plain exchange answered by a recapture is no payoff', () => {
    // Bxf6 gxf6: bishop for knight, nothing won.
    const before = '4k3/5ppp/5n2/8/8/8/1B6/4K3 w - - 0 1';
    const after = '4k3/5ppp/5B2/8/8/8/8/4K3 b - - 0 1';
    expect(payoff(after, ['g7f6'])!.swing).toBe(3);
    expect(payoff(after, ['g7f6'], 24, before)).toBeNull();
  });

  it('reports mate', () => {
    expect(payoff('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['d1d8'])!.kind).toBe('mate');
  });

  it('ignores being mated at the end of your own line', () => {
    expect(payoff('6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', ['a7a6', 'd1d8'])).toBeNull();
  });
});

describe('null move', () => {
  it('passes the turn and clears en passant', () => {
    expect(nullMove('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2');
  });

  it('refuses when the side to move is in check', () => {
    expect(nullMove('4k3/8/8/8/8/8/8/R3K2r w - - 0 1')).toBeNull();
  });

  it('uses a larger equivalence band for club players', () => {
    expect(relevanceThreshold(1400)).toBeGreaterThan(relevanceThreshold(2200));
  });
});

describe('teaching tags', () => {
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
  const plies = replay(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
  const line = (cp: number, pv: string[], extra: Partial<EngineLine> = {}): EngineLine => ({ depth: 16, cp, pv, ...extra });
  const evals: PositionEval[] = [
    { fen: '', lines: [line(30, ['e2e4'], { stableFrom: 8 }), line(20, ['d2d4'])] },
    { fen: '', lines: [line(30, ['e7e5']), line(35, ['c7c5'])] },
    { fen: '', lines: [line(30, ['g1f3']), line(25, ['d1h5'])] },
    { fen: '', lines: [line(-20, ['b8c6']), line(-10, ['g8f6'])] },
    { fen: '', lines: [line(10, ['f1c4']), line(0, ['b1c3'])] },
    { fen: '', lines: [line(0, ['g7g6'], { stableFrom: 3 }), line(300, ['g8f6'])] },
    { fen: '', lines: [{ depth: 16, mate: 1, pv: ['d1f7'], stableFrom: 1 }] },
    { fen: '', lines: [] },
  ];
  evals.forEach((e, i) => (e.fen = i === 0 ? plies[0]!.fenBefore : plies[i - 1]!.fenAfter));
  const reviews = classifyGame({ plies, evals });

  it('tags Nf6?? as an obvious blunder (mate in one seen at depth 1)', () => {
    expect(reviews[5]!.tags).toContain('obvious-blunder');
    expect(reviews[5]!.punishDepth).toBe(1);
  });

  it('does not tag ordinary good moves', () => {
    expect(reviews[0]!.tags).toEqual([]);
  });

  it('tags a missed perpetual in a lost position as an obvious miss (real game, 24...Bf6)', () => {
    const fen = '3rk3/1b2b2p/pqn3pB/2p1p3/6P1/PP2P2P/5PB1/RQ2K1R1 b Q - 1 24';
    const game = replay(['Bf6'], fen);
    const r = classifyGame({
      plies: game,
      evals: [
        { fen, lines: [line(0, ['b6a5', 'e1f1', 'a5b5', 'f1e1', 'b5a5'], { stableFrom: 4 }), line(250, ['e7f6'])] },
        { fen: game[0]!.fenAfter, lines: [line(250, ['b1c2'], { stableFrom: 10 })] },
      ],
    });
    expect(r[0]!.tags).toContain('obvious-miss');
  });
});

describe('payoff after an exchange', () => {
  it('reports the settled gain (rook for knight = 2), not the first capture', () => {
    // White knight takes a rook on g6, h-pawn recaptures.
    const p = payoff('4k3/7p/6r1/8/5N2/8/8/4K3 w - - 0 1', ['f4g6', 'h7g6'])!;
    expect(p.index).toBe(0);
    expect(p.swing).toBe(2);
    expect(p.text).toContain('ganham 2 pontos');
  });
});
