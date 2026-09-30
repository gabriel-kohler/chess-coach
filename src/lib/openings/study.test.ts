// @vitest-environment node
import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
import { epdOf } from '../chess/replay';
import type { GamesIndex, OpeningTree } from '../repertoire/games';
import { defaultSide, drawReply, ExplorerLimited, facedOpenings, gamesLine, humanLine, levelMoves, lineForGames, lineForName, loadOpeningLines, moveLoss, searchOpenings, translateQuery } from './study';

const NOW = new Date(2026, 8, 11, 12, 0).getTime();
const all = await loadOpeningLines();
const names = (q: string, n = 3) => searchOpenings(all, q, n).map((l) => l.name);

describe('finding any opening by name', () => {
  it('in English or in Portuguese, accents and apostrophes aside, the opening before its variations', () => {
    expect(names('moderna')[0]).toBe('Modern Defense');
    expect(names("Van't Kruijs")[0]).toBe("Van't Kruijs Opening");
    expect(names('vant kruijs')[0]).toBe("Van't Kruijs Opening");
    expect(names('índia do rei')[0]).toBe("King's Indian Defense");
    expect(names('caro-kann')[0]).toBe('Caro-Kann Defense');
    expect(translateQuery('Defesa Siciliana Najdorf')).toBe('defense sicilian najdorf');
    expect(names('siciliana najdorf', 1)[0]).toMatch(/^Sicilian Defense: Najdorf/);
  });

  it('a word may be the start of a longer one: "van" finds both "Van" openings', () => {
    const found = names('van', 20);
    expect(found).toContain("Van't Kruijs Opening");
    expect(found).toContain('Van Geet Opening');
  });

  it('comes with its moves', () => {
    const line = searchOpenings(all, "van't kruijs", 1)[0]!;
    expect(line.moves).toEqual(['e3']);
    expect(searchOpenings(all, 'modern defense', 1)[0]!.moves).toEqual(['e4', 'g6']);
  });

  it('reads the names as chess.com writes them, and the moves of your games settle the line', () => {
    expect(lineForName(all, 'Vant Kruijs Opening')?.name).toBe("Van't Kruijs Opening");
    expect(lineForName(all, 'Kings Indian Defense')?.name).toBe("King's Indian Defense");
    // chess.com calls 1.e4 "King's Pawn Opening"; in the catalog that name is 1.e4 e5 2.b3.
    const games = [['e4', 'd6', 'd4'], ['e4', 'Nc6', 'Nf3'], ['e4', 'e5', 'Bc4']];
    expect(lineForGames(all, 'Kings Pawn Opening', games)?.moves).toEqual(['e4']);
    expect(lineForGames(all, 'Vant Kruijs Opening', [['e3', 'e5']])?.name).toBe("Van't Kruijs Opening");
    // Two lines are called "King's Indian Attack" (1.Nf3 d5 2.g3 and 1.Nf3 Nf6 2.g3 d5): the one your games follow.
    expect(lineForGames(all, 'Kings Indian Attack', [['Nf3', 'Nf6', 'g3', 'd5', 'Bg2']])?.moves).toEqual(['Nf3', 'Nf6', 'g3', 'd5']);
  });
});

describe('the openings you meet', () => {
  const MOVES: Record<string, string[]> = { Vant: ['e3', 'e5', 'd4'], Sicilian: ['e4', 'c5', 'c3'], Modern: ['e4', 'g6'], Kings: ['e4', 'd6', 'd4'] };
  const g = (opening: string, color: 'white' | 'black', outcome: 'win' | 'loss' | 'draw', daysAgo = 10, timeClass: 'rapid' | 'blitz' | 'bullet' = 'rapid') => ({ opening, userColor: color, outcome, timeClass, endTime: NOW - daysAgo * 86_400_000, moves: MOVES[opening.split(' ')[0]!]! });

  it('the most frequent first, with your score, by the side you played', () => {
    const games = [
      g('Vant Kruijs Opening', 'black', 'loss'),
      g('Vant Kruijs Opening', 'black', 'loss'),
      g('Vant Kruijs Opening', 'black', 'draw'),
      g('Sicilian Defense Alapin Variation', 'black', 'win'),
      g('Sicilian Defense', 'black', 'win', 400), // over a year ago
      g('Modern Defense', 'white', 'win', 5, 'bullet'), // bullet does not count
    ];
    const out = facedOpenings(games, all, NOW);
    expect(out.map((f) => [f.line.name, f.color, f.n, f.score])).toEqual([
      ["Van't Kruijs Opening", 'black', 3, 17],
      ['Sicilian Defense', 'black', 1, 100],
    ]);
    // chess.com's "King's Pawn Opening" (1.e4 d6 2.d4 here) is the catalog's 1.e4, not its 1.e4 e5 2.b3.
    expect(facedOpenings([g('Kings Pawn Opening', 'white', 'win')], all, NOW)[0]!.line.moves).toEqual(['e4']);
  });

  it('your side by default is the one your games reach it with; a "Defense" otherwise means Black', () => {
    const modern = searchOpenings(all, 'modern defense', 1)[0]!;
    const london = searchOpenings(all, 'london system', 1)[0]!;
    expect(defaultSide(modern, null)).toBe('black');
    expect(defaultSide(london, null)).toBe('white');
    const c = new Chess();
    c.move('e4');
    c.move('g6');
    const tree: OpeningTree = new Map([[epdOf(c.fen()), new Map([['d2d4', { san: 'd4', uci: 'd2d4', n: 7, points: 4 }]])]]);
    const index = { white: { tree, games: 7, exits: [], recent: new Map() }, black: { tree: new Map(), games: 0, exits: [], recent: new Map() } } as Record<'white' | 'black', GamesIndex>;
    expect(defaultSide(modern, index)).toBe('white');
  });
});

describe('the lines from the opening', () => {
  const start = new Chess();
  start.move('e3');
  const fen = start.fen();

  it('at your level in the opening: the explorer in your rating range, your opponents where only your games know', async () => {
    // Black (you) after 1.e3. A Maia that would answer too, to see it is not asked this early.
    const policy = vi.fn(async (f: string, _self: number, _opp: number) => {
      const c = new Chess(f);
      return [{ uci: c.turn() === 'b' ? (c.get('e5') ? 'e5d4' : 'e7e5') : 'g1f3', p: 0.6 }];
    });
    const c = new Chess(fen);
    c.move('e5');
    const tree: OpeningTree = new Map([[epdOf(c.fen()), new Map([['d2d4', { san: 'd4', uci: 'd2d4', n: 6, points: 2 }], ['b1c3', { san: 'Nc3', uci: 'b1c3', n: 2, points: 1 }]])]]);
    const explorer = vi.fn(async (f: string, _elo: number) => {
      const c = new Chess(f);
      // People at your level: after 1.e3 mostly 1...e5, then 3...exd4.
      return c.turn() === 'b' ? [{ uci: c.get('e5') ? 'e5d4' : 'e7e5', san: '', n: 900 }, { uci: 'g8f6', san: 'Nf6', n: 300 }] : null;
    });
    const line = await humanLine(fen, { tree, userColor: 'black', userElo: 1670, oppElo: 1690, policy, explorer }, 3);
    expect(line.map((m) => [m.san, m.source])).toEqual([['e5', 'explorer'], ['d4', 'games'], ['exd4', 'explorer']]);
    expect(line[0]!.p).toBeCloseTo(0.75);
    expect(line[1]!.p).toBeCloseTo(6 / 8);
    // In the opening Maia is not asked; the explorer at your rating is.
    expect(policy).not.toHaveBeenCalled();
    expect(explorer.mock.calls[0]![1]).toBe(1670);
  });

  it('never trusts Maia in the opening: without the explorer or your games the line stops', async () => {
    const policy = vi.fn(async () => [{ uci: 'g8f6', p: 0.76 }]);
    expect(await humanLine(fen, { tree: null, userColor: 'black', userElo: 1670, oppElo: 1670, policy, explorer: null })).toEqual([]);
    expect(policy).not.toHaveBeenCalled();
  });

  it('past move 10, Maia at the rating of whoever is to move', async () => {
    const c = new Chess();
    for (const m of ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7', 'Ne1', 'Nd7', 'Nd3', 'f5', 'Bd2']) c.move(m);
    const policy = vi.fn(async (_f: string, _self: number, _opp: number) => [{ uci: 'g8h8', p: 0.3 }]);
    const moves = await levelMoves(c.fen(), { tree: null, userColor: 'black', userElo: 1670, oppElo: 1690, policy, explorer: null });
    expect(moves).toEqual([{ uci: 'g8h8', san: 'Kh8', p: 0.3, source: 'maia' }]);
    expect(policy.mock.calls[0]!.slice(1)).toEqual([1670, 1690]);
  });

  it('Lichess asking to wait is not "nobody plays this": it goes up; any other failure falls back', async () => {
    const limited = vi.fn(async () => Promise.reject(new ExplorerLimited()));
    await expect(levelMoves(fen, { tree: null, userColor: 'black', userElo: 1670, oppElo: 1670, policy: null, explorer: limited })).rejects.toBeInstanceOf(ExplorerLimited);
    const broken = vi.fn(async () => Promise.reject(new Error('network')));
    expect(await levelMoves(fen, { tree: null, userColor: 'black', userElo: 1670, oppElo: 1670, policy: null, explorer: broken })).toEqual([]);
  });

  it('in your games: the move most played each time, with your score', () => {
    const c = new Chess(fen);
    const tree: OpeningTree = new Map([[epdOf(c.fen()), new Map([['e7e5', { san: 'e5', uci: 'e7e5', n: 3, points: 1 }], ['d7d5', { san: 'd5', uci: 'd7d5', n: 1, points: 1 }]])]]);
    expect(gamesLine(fen, tree)).toEqual([{ san: 'e5', uci: 'e7e5', p: 0.75, n: 3, score: 33 }]);
  });
});

describe('judging your move', () => {
  const lines = [
    { depth: 16, cp: 40, pv: ['e7e5'] },
    { depth: 16, cp: 60, pv: ['d7d5'] },
  ];

  it('the win-chance points it gives up against the best, from your side', () => {
    // Black to move: +40 for White is -40 for you; +60 is a little worse.
    expect(moveLoss(lines, 'e7e5', false)).toBe(0);
    expect(moveLoss(lines, 'd7d5', false)).toBeCloseTo(1.84, 1);
    // Not among the engine's lines: scored after the move.
    expect(moveLoss(lines, 'f7f6', false, { depth: 14, cp: 400, pv: [] })).toBeGreaterThan(25);
    expect(moveLoss(lines, 'f7f6', false)).toBeNull();
  });

  it('draws a reply as often as people play it', () => {
    const moves = [{ san: 'a', p: 0.7 }, { san: 'b', p: 0.3 }];
    expect(drawReply(moves, () => 0.5)!.san).toBe('a');
    expect(drawReply(moves, () => 0.8)!.san).toBe('b');
    expect(drawReply([], () => 0.5)).toBeNull();
  });
});
