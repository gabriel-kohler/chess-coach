// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { epdOf } from '../chess/replay';
import { positionsAlong, repertoireDecks, studyDeckView } from '../decks/views';
import type { StudyDeck } from '../decks/types';
import type { CompiledRepertoire } from '../repertoire/data';
import { candidates, lossOf, ownersOf, PUNISH, punishItem, punishPuzzle } from './find';

const REP = JSON.parse(readFileSync('public/repertoire.json', 'utf8')) as CompiledRepertoire;
const at = (m: string[]) => positionsAlong(m).at(-1)!;
const fenAfter = (m: string[]) => {
  const c = new Chess();
  for (const x of m) c.move(x);
  return c.fen();
};
const mv = (uci: string, n: number) => ({ uci, san: uci, n });

describe('a common mistake at your level', () => {
  it('only moves people really play there, and not the book\'s', () => {
    const moves = [mv('e7e5', 450), mv('d7d5', 200), mv('g8f6', 40), mv('b7b6', 29), mv('h7h5', 19), mv('a7a5', 262)];
    // 1000 games: 3% is 30. b6 has 29 games (2.9%), h5 19; Nf6 is the book.
    expect(candidates(moves, new Set(['g8f6'])).map((c) => c.uci)).toEqual(['e7e5', 'd7d5', 'a7a5']);
    // Fewer than 50 games at the position: the shares mean nothing.
    expect(candidates([mv('e7e5', 30), mv('a7a5', 19)], new Set())).toEqual([]);
    // 3% but fewer than 20 games.
    expect(candidates([mv('e7e5', 580), mv('a7a5', 19)], new Set()).map((c) => c.uci)).toEqual(['e7e5']);
    expect(candidates(moves, new Set())[0]!.share).toBeCloseTo(0.45);
  });

  it('the loss is against the best move, not against the least bad of the checked ones', () => {
    // Black to move after 1.e3: the best line holds 0; two candidates at -250 and -400 (from White: +250, +400).
    const fen = fenAfter(['e3']);
    const best = { depth: 16, cp: 0, pv: ['e7e5'] };
    const lines = [{ depth: 16, cp: 250, pv: ['g7g5'] }, { depth: 16, cp: 400, pv: ['f7f6'] }];
    const g5 = lossOf(fen, best, lines, 'g7g5')!;
    expect(g5).toBeGreaterThan(PUNISH.minLoss);
    expect(lossOf(fen, best, lines, 'f7f6')!).toBeGreaterThan(g5);
    expect(lossOf(fen, best, lines, 'e7e5')).toBe(0);
    expect(lossOf(fen, best, lines, 'a7a6')).toBeNull();
    // White to move: the same numbers from White's side.
    const w = fenAfter([]);
    expect(lossOf(w, { depth: 16, cp: 30, pv: ['e2e4'] }, [{ depth: 16, cp: -300, pv: ['g2g4'] }], 'g2g4')!).toBeGreaterThan(PUNISH.minLoss);
  });

  it('becomes an exercise: the app plays the mistake, you find the punishment', () => {
    const fen = fenAfter(['e4', 'e5', 'Nf3']);
    const item = punishItem('white', fen, { uci: 'f7f6', san: 'f6', n: 90, share: 0.06 }, 14, 'f3e5', '1400,1600', 1)!;
    expect(item).toMatchObject({ id: at(['e4', 'e5', 'Nf3', 'f6']), before: epdOf(fen), mistake: { san: 'f6', share: 0.06 }, best: { san: 'Nxe5' } });
    expect(punishItem('white', fen, { uci: 'e2e4', san: '', n: 90, share: 0.06 }, 14, 'f3e5', '', 1)).toBeNull();
    const puzzle = punishPuzzle(item, 'Italiana', 1370);
    expect(puzzle).toMatchObject({ id: `punish:${item.id}`, source: 'punish', fen, moves: ['f7f6', 'f3e5'], themes: ['opening'] });
    expect(puzzle.note).toBe('Italiana: 2...f6 é jogado por 6% no seu nível e perde 14 pontos de chance. Puna.');
  });
});

describe('the decks a mistake belongs to', () => {
  const white = repertoireDecks(REP.sides.white);
  it('your repertoire\'s by scope; a move a deck already answers is not its mistake', () => {
    // Black to move after 1.e4 c5 2.c3: only the Alapin deck has it.
    const before = at(['e4', 'c5', 'c3']);
    const item = { side: 'white' as const, before, mistake: { uci: 'h7h5', san: '', share: 0, games: 0 } };
    expect(ownersOf(item, white).map((d) => d.id)).toEqual(['w-sicilian']);
    const book = REP.sides.white.positions[before]!.moves[0]!;
    expect(ownersOf({ ...item, mistake: { ...item.mistake, uci: book.uci } }, white)).toEqual([]);
  });

  it('a deck from any opening by its own tree, with its own book', () => {
    const afterE3 = at(['e3']);
    const deck: StudyDeck = {
      id: 's-vant', name: "Van't Kruijs Opening", side: 'black', opening: { eco: 'A00', name: "Van't Kruijs Opening", moves: ['e3'] },
      positions: { [at(['e3', 'e5'])]: { epd: at(['e3', 'e5']), fen: fenAfter(['e3', 'e5']), ply: 2, moves: [{ san: 'd4', uci: 'd2d4', to: at(['e3', 'e5', 'd4']), nags: [] }] }, [afterE3]: { epd: afterE3, fen: fenAfter(['e3']), ply: 1, moves: [{ san: 'e5', uci: 'e7e5', to: at(['e3', 'e5']), nags: [] }] } },
      sources: {}, differs: [], frontier: [], size: 30, limits: { minP: 0.02, maxDepth: 10 }, status: 'ready', builtAt: 1, createdAt: 1,
    };
    const view = studyDeckView(deck);
    const mistake = (uci: string) => ({ side: 'black' as const, before: at(['e3', 'e5']), mistake: { uci, san: '', share: 0, games: 0 } });
    expect(ownersOf(mistake('f2f4'), [view]).map((d) => d.id)).toEqual(['s-vant']);
    expect(ownersOf(mistake('d2d4'), [view])).toEqual([]);
    expect(ownersOf({ ...mistake('f2f4'), before: at(['d4']) }, [view])).toEqual([]);
  });
});
