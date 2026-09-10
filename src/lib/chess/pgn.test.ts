import { describe, expect, it } from 'vitest';
import { mainLine, parseClockedMainLine, parsePgn } from './pgn';

describe('parsePgn', () => {
  it('reads headers, comments, NAGs and nested variations', () => {
    const [game] = parsePgn(`[Id "t"]
[Side "white"]

{Intro} 1. e4 e5 (1... c5 2. c3 (2. Nf3 d6) 2... d5) 2. Nf3 {Comment} Nc6 3. Bc4?! $1 *`);
    expect(game!.headers).toEqual({ Id: 't', Side: 'white' });
    expect(game!.comment).toBe('Intro');
    expect(mainLine(game!)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    const e4 = game!.moves[0]!;
    expect(e4.children.map((c) => c.san)).toEqual(['e5', 'c5']);
    const c5 = e4.children[1]!;
    expect(c5.children[0]!.children.map((c) => c.san)).toEqual(['d5']);
    expect(c5.children.map((c) => c.san)).toEqual(['c3', 'Nf3']);
    const nf3 = e4.children[0]!.children[0]!;
    expect(nf3.comment).toBe('Comment');
    const bc4 = nf3.children[0]!.children[0]!;
    expect(bc4.nags).toEqual([6, 1]);
  });

  it('handles "12..." move numbers and glued numbers', () => {
    const [game] = parsePgn('1.e4 e5 2.Nf3 (2.Bc4 Nf6) 2...Nc6');
    expect(mainLine(game!)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('keeps a comment written at the start of a variation as preComment', () => {
    const [game] = parsePgn('1. e4 e5 ({Also good:} 1... c5) 2. Nf3');
    expect(game!.moves[0]!.children[1]!.preComment).toBe('Also good:');
  });

  it('rejects unbalanced parentheses', () => {
    expect(() => parsePgn('1. e4 (1. d4 d5')).toThrow();
  });
});

describe('parseClockedMainLine', () => {
  it('extracts moves and clocks from a chess.com PGN', () => {
    const pgn = `[Event "Live Chess"]
[TimeControl "600"]

1. e4 {[%clk 0:09:58.5]} 1... e5 {[%clk 0:09:57.1]} 2. Nf3 {[%clk 0:09:50]} 2... Nc6 {[%clk 0:09:49.9]} 1-0`;
    const { moves, clocks } = parseClockedMainLine(pgn);
    expect(moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(clocks).toEqual([598.5, 597.1, 590, 589.9]);
  });
});
