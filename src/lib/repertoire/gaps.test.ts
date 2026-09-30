import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { makeGame } from '../../test/positionFixtures';
import { parsePgn } from '../chess/pgn';
import type { StoredGame } from '../types';
import { compileChapter, epdOf, mergeSides, type CompiledSide } from './compile';
import { chapterRoot, ourPositionsBelow, type CompiledRepertoire } from './data';
import { repertoireGaps } from './gaps';
import { userChapterId, withUserChapters, type UserChapter } from './user';

const NOW = Date.UTC(2026, 8, 10);
const DAY = 86_400_000;

function side(pgn: string): Record<'white' | 'black', CompiledSide> {
  const results = parsePgn(pgn).map(compileChapter);
  for (const r of results) expect(r.errors).toEqual([]);
  return mergeSides(results).sides;
}

// White: 1.e4 e5 2.Nf3 Nc6 3.Bb5, 1.e4 c5 2.Nf3 (ends), and 1.d4 lines built to transpose.
const WHITE = `[Side "white"]
[Id "w1"]
[Name "Espanhola"]

1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 *

[Side "white"]
[Id "w2"]
[Name "Gambito da Dama"]

1. d4 Nf6 2. c4 e6 3. Nc3 *

[Side "white"]
[Id "w3"]
[Name "Gambito da Dama, com e6"]

1. d4 e6 2. c4 d5 3. Nc3 *
`;

const BLACK = `[Side "black"]
[Id "b1"]
[Name "Siciliana"]

1. e4 c5 2. Nf3 d6 *
`;

const reps = { ...side(WHITE), black: side(BLACK).black };
const game = (id: string, moves: string[], over: Partial<StoredGame> = {}) => makeGame({ id, moves, clocks: moves.map(() => 300), endTime: NOW - 10 * DAY, ...over });

describe('repertoire gaps', () => {
  const games = [
    game('g1', ['e4', 'e5', 'Nf3', 'd6', 'd4']),
    game('g2', ['e4', 'e5', 'Nf3', 'd6', 'Bc4'], { endTime: NOW - 2 * DAY }),
    game('g3', ['e4', 'e5', 'Nf3', 'Nf6']), // once only
    game('g4', ['e4', 'c5', 'Nf3', 'Nc6']), // the line ends at 2.Nf3: no gap
    game('g5', ['e4', 'e5', 'Bc4', 'Nf6']), // you left the line yourself
    game('g6', ['d4', 'e6', 'c4', 'Nf6', 'Nc3']), // transposes into the 1...Nf6 line
    game('g7', ['d4', 'e6', 'c4', 'Nf6', 'Nc3']),
    game('old1', ['e4', 'e5', 'Nf3', 'f5'], { endTime: NOW - 200 * DAY }),
    game('old2', ['e4', 'e5', 'Nf3', 'f5'], { endTime: NOW - 190 * DAY }),
    game('bullet', ['e4', 'e5', 'Nf3', 'd6'], { timeClass: 'bullet' }),
    game('b1', ['e4', 'c5', 'c3'], { userColor: 'black' }),
    game('b2', ['e4', 'c5', 'c3', 'Nf6'], { userColor: 'black' }),
  ];

  it('the most frequent first, twice at least, in the last 6 months of rated rapid and blitz', async () => {
    const gaps = await repertoireGaps(games, reps, NOW);
    expect(gaps.map((g) => `${g.side}:${g.san}:${g.games.length}`)).toEqual(['white:d6:2', 'black:c3:2']);
    const d6 = gaps[0]!;
    expect(d6.path).toEqual(['e4', 'e5', 'Nf3', 'd6']);
    expect(d6.lastPlayed).toBe(NOW - 2 * DAY);
    const c = new Chess();
    for (const san of d6.path) c.move(san);
    expect(d6.childEpd).toBe(epdOf(c.fen()));
  });

  it('a longer window brings the old ones back; a lower minimum shows the rare ones', async () => {
    const all = await repertoireGaps(games, reps, NOW, { sinceDays: 365, minGames: 1 });
    expect(all.map((g) => g.san).sort()).toEqual(['Nf6', 'c3', 'd6', 'f5']);
  });
});

describe('your chapters', () => {
  const rep: CompiledRepertoire = { builtAt: 'x', depth: 16, sides: reps };
  const chapter = (moves: string[], over: Partial<UserChapter> = {}): UserChapter => {
    const c = new Chess();
    for (const san of moves.slice(0, -1)) c.move(san);
    return { id: userChapterId('white', epdOf(c.fen())), side: 'white', name: 'Espanhola: resposta a 3...d6', moves, createdAt: 1, source: { epd: 'e', san: 'd6', games: 2 }, ...over };
  };

  it('adds the answer without touching the file, and the drill asks only for it', () => {
    const before = JSON.stringify(rep);
    const c = chapter(['e4', 'e5', 'Nf3', 'd6', 'd4']);
    const { rep: merged, rejected } = withUserChapters(rep, [c]);
    expect(rejected).toEqual([]);
    expect(JSON.stringify(rep)).toBe(before);
    const white = merged.sides.white;
    const ch = white.chapters.find((x) => x.id === c.id)!;
    expect(ch.entry).toEqual(['e4', 'e5', 'Nf3', 'd6']);
    const root = chapterRoot(ch.entry);
    expect(white.positions[root]!.moves.map((m) => m.san)).toEqual(['d4']);
    expect(ourPositionsBelow(white, root)).toEqual([root]);
    // The file's own answers along the path are still one per position.
    const afterNf3 = white.positions[epdOf(new Chess('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2').fen())]!;
    expect(afterNf3.moves.map((m) => m.san)).toEqual(['Nc6', 'd6']);
  });

  it('a chapter that answers differently from the file is set aside', () => {
    const clash = chapter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']); // the file plays 3.Bb5
    const { rep: merged, rejected } = withUserChapters(rep, [clash]);
    expect(rejected.map((r) => r.chapter.id)).toEqual([clash.id]);
    expect(rejected[0]!.reason).toContain('Bb5');
    expect(merged.sides.white.chapters.some((x) => x.id === clash.id)).toBe(false);
  });
});
