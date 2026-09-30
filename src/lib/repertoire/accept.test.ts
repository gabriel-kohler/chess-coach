import { describe, expect, it } from 'vitest';
import { suggestionFrom } from '../renewal/suggest';
import { acceptable, moverScore, moverScoreFromWhite, winDrop, winPct } from './accept';

describe('the repertoire move rule', () => {
  it('matches the build: Lichess curve, clamped at 1000 centipawns', () => {
    expect(winPct(0)).toBe(50);
    expect(winPct(5000)).toBe(winPct(1000));
    expect(winPct(100)).toBeCloseTo(59.1, 1);
  });

  it('a move 5 points below the best is out; just under 5 is in', () => {
    // Find a centipawn gap that drops exactly 5.0 win% from 0.
    let cp = 0;
    while (winDrop(0, -cp) < 5) cp += 1;
    expect(acceptable(0, -(cp - 1))).toBe(true);
    expect(acceptable(0, -cp)).toBe(false);
    expect(acceptable(0, 0)).toBe(true);
  });

  it('mates count from the side to move, and from White for the app engine', () => {
    expect(moverScore({ mate: 3 })).toBe(9997);
    expect(moverScore({ mate: -3 })).toBe(-9997);
    // Black to move, White-side mate in 2 against Black: bad for the mover.
    expect(moverScoreFromWhite({ mate: 2 }, false)).toBe(-9998);
    expect(moverScoreFromWhite({ cp: -80 }, false)).toBe(80);
  });
});

describe('gap suggestions', () => {
  // After 1.e4 c5 2.Nf3 a6: White to move.
  const fen = 'rnbqkbnr/1p1ppppp/p7/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';

  it('keeps only answers within 5 points of the best, and says why', () => {
    const lines = [
      { depth: 18, pv: ['c2c3', 'e7e6', 'd2d4'], cp: 40 },
      { depth: 18, pv: ['d2d4', 'c5d4'], cp: 30 },
      { depth: 18, pv: ['b2b4', 'c5b4'], cp: -120 },
    ];
    const s = suggestionFrom(fen, lines, 18, 0, 'x');
    expect(s.moves.map((m) => [m.san, m.acceptable])).toEqual([['c3', true], ['d4', true], ['b4', false]]);
    expect(s.moves[0]!.line).toEqual(['e6', 'd4']);
    expect(s.moves[2]!.drop).toBeGreaterThan(5);
  });

  it('for Black the scores are turned to the side to move', () => {
    // After 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O Nxe4 5.Re1: Black to move; White-side scores.
    const blackFen = 'r1bqkb1r/pppp1ppp/2n5/1B2p3/4n3/5N2/PPPP1PPP/RNBQR1K1 b kq - 1 5';
    const s = suggestionFrom(blackFen, [{ depth: 18, pv: ['e4d6'], cp: 20 }, { depth: 18, pv: ['e4f6'], cp: 180 }], 18, 0, 'y');
    expect(s.moves[0]!.win).toBeGreaterThan(s.moves[1]!.win);
    expect(s.moves[1]!.acceptable).toBe(false);
  });
});
