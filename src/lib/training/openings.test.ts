// @vitest-environment node
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { epdOf, type CompiledSide, type RepertoirePosition } from '../repertoire/compile';
import { START_EPD, type CompiledRepertoire } from '../repertoire/data';
import type { GamesIndex } from '../repertoire/games';
import type { Outcome } from '../types';
import { repertoireDecks } from '../decks/views';
import { deckTargets, deviationTargets, openingTargets, type TargetGame } from './openings';

const NOW = new Date(2026, 8, 11, 9, 0).getTime();
const DAY = 86_400_000;

function epd(moves: string[]): string {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return epdOf(c.fen());
}

// White: 1.e4, and after 1...e5 2.Nf3 or 1...c5 2.Nf3.
const E4 = epd(['e4']);
const E5 = epd(['e4', 'e5']);
const C5 = epd(['e4', 'c5']);
const position = (e: string, moves: Array<[string, string]>): RepertoirePosition => ({ epd: e, fen: `${e} 0 1`, ply: 0, moves: moves.map(([san, to]) => ({ san, uci: '', to, nags: [] })) });
const white: CompiledSide = {
  side: 'white',
  chapters: [
    { id: 'open', side: 'white', name: 'Aberta', entry: ['e4', 'e5'] },
    { id: 'sic', side: 'white', name: 'Siciliana', entry: ['e4', 'c5'] },
  ],
  positions: {
    [START_EPD]: position(START_EPD, [['e4', E4]]),
    [E4]: position(E4, [['e5', E5], ['c5', C5]]),
    [E5]: position(E5, [['Nf3', epd(['e4', 'e5', 'Nf3'])]]),
    [C5]: position(C5, [['Nf3', epd(['e4', 'c5', 'Nf3'])]]),
  },
};
const black: CompiledSide = { side: 'black', chapters: [], positions: {} };
const rep: CompiledRepertoire = { builtAt: 'x', depth: 1, sides: { white, black } };

const exit = (gameId: string, e: string, outcome: Outcome, daysAgo: number, ply = 2): GamesIndex['exits'][number] => ({ gameId, ply, kind: 'you', epd: e, san: 'Bc4', outcome, endTime: NOW - daysAgo * DAY });
const index = (over: Partial<GamesIndex> = {}): GamesIndex => ({ tree: new Map(), games: 20, exits: [], recent: new Map([[START_EPD, { n: 20, points: 10 }]]), ...over });
const game = (id: string): [string, TargetGame] => [id, { moves: ['e4', 'e5', 'Bc4', 'Nf6'], oppName: `opp-${id}`, endTime: NOW - DAY }];

describe('where you leave the repertoire yourself', () => {
  it('groups your deviations of the last 6 months by position, with the real game up to there', () => {
    const idx = index({ exits: [exit('g1', E5, 'loss', 1), exit('g2', E5, 'loss', 10), exit('g3', E5, 'draw', 20), exit('old', E5, 'loss', 200), exit('once', C5, 'loss', 3)] });
    const out = deviationTargets(rep, idx, 'white', new Map([game('g1'), game('g2'), game('g3'), game('once')]), NOW);
    expect(out).toHaveLength(1); // a single game is not a pattern; a game from 200 days ago is not now
    expect(out[0]!.key).toBe(E5);
    expect(out[0]!.replay).toEqual(['e4', 'e5']);
    // 3 games, 0.5 points: shrunk toward your 50% by 5 games, (0.5 + 2.5) / 8.
    expect(out[0]!.weight).toBeCloseTo(3 * (1 - 3 / 8));
    expect(out[0]!.reason).toContain('3 partidas e marcou 17%');
    expect(out[0]!.reason).toContain('opp-g1');
  });

  it('drops a position no longer in the repertoire you train', () => {
    const gone = epd(['d4']);
    const idx = index({ exits: [exit('g1', gone, 'loss', 1), exit('g2', gone, 'loss', 2)] });
    expect(deviationTargets(rep, idx, 'white', new Map([game('g1'), game('g2')]), NOW)).toEqual([]);
  });
});

describe('opening decks where you score low', () => {
  const decks = repertoireDecks(white, [
    { id: 'w-open', side: 'white', name: 'Aberta', chapters: ['open'] },
    { id: 'w-sic', side: 'white', name: 'Contra a Siciliana', chapters: ['sic'], rare: true },
  ]);

  it('a small sample is pulled toward your average: more games at a smaller deficit can weigh more', () => {
    const idx = index({ recent: new Map([[START_EPD, { n: 100, points: 50 }], [C5, { n: 8, points: 2 }], [E5, { n: 40, points: 16 }]]) });
    const out = deckTargets(decks, idx, 'white');
    expect(out.map((t) => t.deckId)).toEqual(['w-open', 'w-sic']);
    expect(out[0]!.key).toBe(E5);
    expect(out[0]!.weight).toBeCloseTo(40 * (0.5 - (16 + 5) / 50));
    expect(out[1]!.weight).toBeCloseTo(8 * (0.5 - (2 + 5) / 18));
    expect(out[1]!.reason).toBe('Contra a Siciliana: você marca 25% em 8 partidas dos últimos 6 meses; de brancas, sua média é 50%.');
  });

  it('needs 8 recent games, and a score below your average', () => {
    const idx = index({ recent: new Map([[START_EPD, { n: 100, points: 50 }], [C5, { n: 7, points: 0 }], [E5, { n: 30, points: 24 }]]) });
    expect(deckTargets(decks, idx, 'white')).toEqual([]);
  });

  it('a deviation says which deck it is in', () => {
    const idx = index({ exits: [exit('g1', E5, 'loss', 1), exit('g2', E5, 'loss', 2)] });
    const out = deviationTargets(rep, idx, 'white', new Map([game('g1'), game('g2')]), NOW, decks);
    expect(out[0]!.reason.startsWith('Aberta. Nos últimos 6 meses')).toBe(true);
  });
});

it('your own deviations come before the weak decks', () => {
  const idx = index({ exits: [exit('g1', E5, 'loss', 1), exit('g2', E5, 'win', 2)], recent: new Map([[START_EPD, { n: 100, points: 50 }], [C5, { n: 40, points: 4 }]]) });
  const out = openingTargets(rep, { white: idx, black: index() }, new Map([game('g1'), game('g2')]), NOW);
  expect(out.map((t) => t.line)).toEqual(['deviation', 'chapter']);
});
