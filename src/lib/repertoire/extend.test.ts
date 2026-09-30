// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePgn, writePgn, type PgnNode } from '../chess/pgn';
import { compileChapter } from './compile';
import { decided, EXTEND, mastersChoice, opponentReplies, ourMove, treeFromLines, type Counted } from './extend';

const strip = (nodes: PgnNode[]): unknown => nodes.map((n) => ({ san: n.san, nags: n.nags, comment: n.comment, preComment: n.preComment, children: strip(n.children) }));
const m = (uci: string, n: number): Counted => ({ uci, san: uci, n });

describe('writing a repertoire back as PGN', () => {
  it('every chapter of the repertoire files reads back to the same tree and the same positions', () => {
    const dir = 'src/data/repertoire';
    const files = readdirSync(dir).filter((f) => f.endsWith('.pgn') && !f.includes('middlegame'));
    let chapters = 0;
    for (const f of files) {
      for (const game of parsePgn(readFileSync(`${dir}/${f}`, 'utf8'))) {
        const again = parsePgn(writePgn(game));
        expect(again).toHaveLength(1);
        expect(again[0]!.headers).toEqual(game.headers);
        expect(again[0]!.comment).toBe(game.comment);
        expect(strip(again[0]!.moves)).toEqual(strip(game.moves));
        expect(compileChapter(again[0]!).positions).toEqual(compileChapter(game).positions);
        chapters++;
      }
    }
    expect(chapters).toBe(35);
    // 35 chapters written, read and compiled twice: 1.5 s alone, past the default 5 s on a loaded machine.
  }, 20_000);

  it('lines from the first move become one tree, with a comment where each line leaves the book', () => {
    const tree = treeFromLines([
      { moves: ['d4', 'Nf6', 'c4', 'g6'], notes: { 3: 'Meio-jogo.' } },
      { moves: ['d4', 'Nf6', 'Nf3', 'g6'] },
    ]);
    const text = writePgn({ headers: { Id: 'x', Side: 'black' }, moves: tree });
    expect(text).toContain('1. d4 Nf6 2. c4 (2. Nf3 g6) 2... g6 {Meio-jogo.}');
    expect(parsePgn(text)[0]!.moves[0]!.children[0]!.children.map((c) => c.san)).toEqual(['c4', 'Nf3']);
  });
});

describe('the moves that take a line further', () => {
  it('the opponent: your level while it has games, then masters, then Stockfish; a second move only when common', () => {
    // 35 games at your level: too few, the masters decide.
    expect(opponentReplies([m('b2b4', 20), m('f1e1', 15)], [m('f1e1', 900)], 'a2a4')).toEqual([{ uci: 'f1e1', source: 'masters' }]);
    // 50 games or more at your level: theirs, and the second when 30% play it.
    expect(opponentReplies([m('b2b4', 40), m('f1e1', 30)], null, null).map((r) => r.uci)).toEqual(['b2b4', 'f1e1']);
    expect(opponentReplies([m('b2b4', 80), m('f1e1', 20)], null, null).map((r) => r.uci)).toEqual(['b2b4']);
    expect(opponentReplies(null, [m('f1e1', 10), m('b2b4', 5)], 'a2a4')).toEqual([{ uci: 'a2a4', source: 'engine' }]);
    expect(opponentReplies(null, null, null)).toEqual([]);
    expect(EXTEND.levelMinGames).toBe(50);
  });

  it('yours: the masters\' move when it is within 5 points of the best, else Stockfish\'s', () => {
    expect(mastersChoice([m('f7f5', 816), m('g8h8', 141)])).toMatchObject({ uci: 'f7f5' });
    expect(mastersChoice([m('f7f5', 19)])).toBeNull();
    expect(ourMove(mastersChoice([m('f7f5', 816)]), 3.2, 'g8h8')).toEqual({ uci: 'f7f5', source: 'masters' });
    expect(ourMove(mastersChoice([m('f7f5', 816)]), 5, 'g8h8')).toEqual({ uci: 'g8h8', source: 'engine' });
    expect(ourMove(null, null, 'g8h8')).toEqual({ uci: 'g8h8', source: 'engine' });
    expect(ourMove(null, null, null)).toBeNull();
  });

  it('a decided game stops the line', () => {
    expect(decided(300)).toBe(true);
    expect(decided(-9990)).toBe(true);
    expect(decided(120)).toBe(false);
  });
});
