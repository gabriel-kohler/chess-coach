import { describe, expect, it } from 'vitest';
import { replay } from '../chess/replay';
import type { EngineLine, PositionEval } from '../types';
import { classifyGame } from './classify';
import { gameAccuracy, moveAccuracy, winPercent } from './scoring';

describe('scoring', () => {
  it('win percent is 50 at equality and saturates with mate', () => {
    expect(winPercent({ cp: 0 })).toBeCloseTo(50, 5);
    expect(winPercent({ cp: 300 })).toBeGreaterThan(75);
    expect(winPercent({ mate: 3 })).toBeGreaterThan(97);
    expect(winPercent({ mate: -3 })).toBeLessThan(3);
  });

  it('a move that keeps the win chance is 100% accurate', () => {
    expect(moveAccuracy('white', { cp: 50 }, { cp: 50 })).toBe(100);
    expect(moveAccuracy('white', { cp: 50 }, { cp: 80 })).toBe(100);
    expect(moveAccuracy('black', { cp: -50 }, { cp: -80 })).toBe(100);
    expect(moveAccuracy('white', { cp: 300 }, { cp: -300 })).toBeLessThan(10);
    expect(moveAccuracy('black', { cp: -300 }, { cp: 300 })).toBeLessThan(10);
  });

  it('small losses cost more than on the Lichess curve, as on chess.com', () => {
    // Half a pawn thrown away at equality.
    expect(moveAccuracy('white', { cp: 0 }, { cp: -50 })).toBeLessThan(80);
    expect(moveAccuracy('white', { cp: 0 }, { cp: -50 })).toBeGreaterThan(60);
    // Still counts when already winning: +8 down to +5.
    expect(moveAccuracy('white', { cp: 800 }, { cp: 500 })).toBeLessThan(70);
  });

  it('game accuracy punishes a blunder but one disaster cannot sink it', () => {
    const flat = Array.from({ length: 40 }, (_, i) => ({ color: i % 2 ? 'black' : 'white', accuracy: 100 }) as const);
    expect(gameAccuracy(flat).white).toBeCloseTo(100, 6);
    const blunder = flat.map((m, i) => (i === 20 ? { ...m, accuracy: 0 } : m));
    const acc = gameAccuracy(blunder);
    expect(acc.white).toBeLessThan(90);
    expect(acc.white).toBeGreaterThan(80);
    expect(acc.black).toBeCloseTo(100, 6);
  });
});

const line = (cp: number, pv: string[], mate?: number): EngineLine => (mate !== undefined ? { depth: 16, mate, pv } : { depth: 16, cp, pv });

describe('classifyGame', () => {
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
  const plies = replay(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
  const evals: PositionEval[] = [
    { fen: '', lines: [line(30, ['e2e4']), line(20, ['d2d4'])] },
    { fen: '', lines: [line(30, ['e7e5']), line(35, ['c7c5'])] },
    { fen: '', lines: [line(30, ['g1f3']), line(25, ['d1h5'])] },
    { fen: '', lines: [line(-20, ['b8c6']), line(-10, ['g8f6'])] },
    { fen: '', lines: [line(10, ['f1c4']), line(0, ['b1c3'])] },
    { fen: '', lines: [line(0, ['g7g6']), line(300, ['g8f6']), line(0, ['d8e7'])] },
    { fen: '', lines: [line(0, ['d1f7'], 1)] },
    { fen: '', lines: [] },
  ];
  evals.forEach((e, i) => (e.fen = i === 0 ? plies[0]!.fenBefore : plies[i - 1]!.fenAfter));
  const reviews = classifyGame({ plies, evals });

  it('marks the engine move as best', () => {
    expect(reviews[0]!.classification).toBe('best');
  });

  it('marks Nf6?? allowing mate as a blunder with the engine alternative', () => {
    const nf6 = reviews[5]!;
    expect(nf6.san).toBe('Nf6');
    expect(nf6.classification).toBe('blunder');
    expect(nf6.bestSan).toBe('g6');
  });

  it('scores the mating move as best and winning', () => {
    const mate = reviews[6]!;
    expect(mate.classification === 'best' || mate.classification === 'great').toBe(true);
    expect(mate.winAfter).toBeGreaterThan(97);
  });

  it('flags book moves when a book lookup is given', () => {
    const withBook = classifyGame({ plies, evals, isBook: () => true });
    expect(withBook[0]!.classification).toBe('book');
  });

  it("uses chess.com's book depth when known, whatever the lookup says", () => {
    const r = classifyGame({ plies, evals, bookPlies: 2, isBook: () => true });
    expect(r.map((m) => m.classification).slice(0, 3)).toEqual(['book', 'book', 'best']);
  });

  it('calls a quiet only move great', () => {
    // 2.Qh5 is the only good move: 2.Nf3 would drop two pawns' worth.
    const only = evals.map((e, i) => (i === 2 ? { ...e, lines: [line(30, ['d1h5']), line(-200, ['g1f3'])] } : e));
    expect(classifyGame({ plies, evals: only })[2]!.classification).toBe('great');
  });
});

describe('brilliant moves', () => {
  const at = (fen: string, san: string, before: EngineLine[], after: EngineLine[]) => {
    const plies = replay([san], fen);
    return classifyGame({ plies, evals: [{ fen, lines: before }, { fen: plies[0]!.fenAfter, lines: after }] })[0]!;
  };

  it('taking a queen and leaving a rook en prise is not a sacrifice', () => {
    // Nxd5 wins the queen and opens the long diagonal onto the a1 rook.
    const m = at('6kb/8/8/3q4/8/2N5/8/R5K1 w - - 0 1', 'Nxd5', [line(0, ['c3d5']), line(-800, ['g1f2'])], [line(0, ['h8a1', 'g1f2'])]);
    expect(m.classification).toBe('best');
  });

  it("does not credit the next move's sacrifice to a quiet move", () => {
    // After a3 a6 the engine goes Bxh7+ Kxh7: the sacrifice is Bxh7+, not a3.
    const m = at('6k1/p6p/8/8/8/3B4/P7/6K1 w - - 0 1', 'a3', [line(0, ['a2a3']), line(0, ['g1f2'])], [line(0, ['a7a6', 'd3h7', 'g8h7', 'g1f2'])]);
    expect(m.classification).toBe('best');
  });
});

describe('great moves', () => {
  // 1.e4 d5 2.exd5 Qxd5: the recapture is the only good move but it is natural.
  const plies = replay(['e4', 'd5', 'exd5', 'Qxd5']);
  const evals: PositionEval[] = [
    { fen: '', lines: [line(30, ['e2e4']), line(25, ['d2d4'])] },
    { fen: '', lines: [line(40, ['d7d5']), line(45, ['e7e5'])] },
    { fen: '', lines: [line(40, ['e4d5']), line(-20, ['b1c3'])] },
    { fen: '', lines: [line(30, ['d8d5']), line(250, ['g8f6'])] },
    { fen: '', lines: [line(35, ['b1c3'])] },
  ];
  evals.forEach((e, i) => (e.fen = i === 0 ? plies[0]!.fenBefore : plies[i - 1]!.fenAfter));

  it('never marks a capture as great, even as the only move', () => {
    const r = classifyGame({ plies, evals });
    expect(r[2]!.classification).toBe('best'); // exd5, only move for White
    expect(r[3]!.classification).toBe('best'); // Qxd5, only move for Black
    expect(r[3]!.tags).toContain('only-move');
  });
});
