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
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(60, 65)).toBe(100);
    expect(moveAccuracy(80, 20)).toBeLessThan(10);
  });

  it('game accuracy punishes a blunder but not to zero', () => {
    const flat = Array.from({ length: 41 }, () => 50);
    expect(gameAccuracy(flat).white).toBeGreaterThan(99);
    const blunder = [...flat];
    for (let i = 21; i < blunder.length; i++) blunder[i] = 10; // White collapses on ply 21
    const acc = gameAccuracy(blunder);
    expect(acc.white).toBeLessThan(90);
    expect(acc.white).toBeGreaterThan(40);
    expect(acc.black).toBeGreaterThan(95);
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
});
