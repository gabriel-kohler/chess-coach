// @vitest-environment node
import { readFileSync } from 'node:fs';
import { State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { CompiledSide } from '../repertoire/compile';
import type { CompiledRepertoire } from '../repertoire/data';
import type { GamesIndex } from '../repertoire/games';
import { withUserChapters, type UserChapter } from '../repertoire/user';
import { newRepCard } from '../srs/cards';
import type { RepCard } from '../types';
import { REPERTOIRE_DECKS } from './catalog';
import { assignDue, deckForPath, deckStats, positionsAlong, repertoireDecks, startFor, studyDeckView } from './views';
import type { StudyDeck } from './types';

const REP = JSON.parse(readFileSync('public/repertoire.json', 'utf8')) as CompiledRepertoire;
const NOW = new Date(2026, 8, 11, 9, 0).getTime();
const DAY = 86_400_000;
const at = (moves: string[]) => positionsAlong(moves).at(-1)!;

const white = repertoireDecks(REP.sides.white);
const black = repertoireDecks(REP.sides.black);
const deck = (id: string) => [...white, ...black].find((d) => d.id === id)!;

function card(side: 'white' | 'black', epd: string, dueIn: number): RepCard {
  return { ...newRepCard(side, side, epd, NOW - 30 * DAY), state: State.Review, reps: 3, due: NOW + dueIn };
}
const cardsOf = (list: RepCard[]) => new Map(list.map((c) => [c.epd, c]));

describe('your repertoire as opening decks', () => {
  it('every chapter of the file is in exactly one deck, 11 of White and 8 of Black', () => {
    expect(white.map((d) => d.id)).toEqual(REPERTOIRE_DECKS.filter((s) => s.side === 'white').map((s) => s.id));
    expect(black).toHaveLength(8);
    for (const [side, decks] of [['white', white], ['black', black]] as const) {
      const placed = decks.flatMap((d) => d.chapters.map((c) => c.id)).sort();
      expect(placed).toEqual(REP.sides[side].chapters.map((c) => c.id).sort());
    }
  });

  it('a deck is the positions written in its chapters, not everything reachable from their start', () => {
    const rare = deck('b-rare');
    // Its chapter starts at the initial position, yet 1.e4 and 1.d4 belong to other decks.
    expect(rare.scope!.has(at(['e3']))).toBe(true);
    expect(rare.scope!.has(at(['e4']))).toBe(false);
    expect(rare.scope!.has(at(['d4']))).toBe(false);
    expect(deck('b-sicilian').scope!.has(at(['d4']))).toBe(false);
    expect(deck('w-rare').scope!.has(at(['e4', 'c5']))).toBe(false);
    // The Italian's trunk is part of it: 1.e4 is asked there too.
    expect(deck('w-italian').ours).toContain(at([]));
  });

  it('a chapter the list does not name goes to its color\'s rare deck', () => {
    const extra = { ...REP.sides.black, chapters: [...REP.sides.black.chapters, { id: 'black-new-idea', side: 'black' as const, name: 'Nova', entry: ['b3'], own: [at([]), at(['b3'])] }] };
    expect(repertoireDecks(extra).find((d) => d.id === 'b-rare')!.chapters.map((c) => c.id)).toContain('black-new-idea');
  });

  it('a line of your repertoire\'s deck is played from move 1; one from any opening after its opening\'s moves', () => {
    expect(white.every((d) => d.start.length === 0)).toBe(true);
    expect(black.every((d) => d.start.length === 0)).toBe(true);
    const vant: StudyDeck = {
      id: 's-vant', name: "Van't Kruijs", side: 'black', opening: { eco: 'A00', name: "Van't Kruijs Opening", moves: ['e3'] },
      positions: {}, sources: {}, differs: [], frontier: [], size: 30, limits: { minP: 0.02, maxDepth: 10 }, status: 'ready', builtAt: NOW, createdAt: NOW,
    };
    expect(studyDeckView(vant).start).toEqual(['e3']);
  });

  it('the start its lines share', () => {
    expect(deck('b-sicilian').prefix).toEqual(['e4', 'c5']);
    expect(deck('b-kid').prefix).toEqual(['d4', 'Nf6', 'c4', 'g6']);
    expect(deck('w-italian').prefix).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    expect(deck('w-rare').prefix).toEqual(['e4']);
    expect(deck('b-reti-english').prefix).toEqual([]);
  });
});

describe('where a line of a deck starts', () => {
  const italian = deck('w-italian');
  const trunk = positionsAlong(italian.prefix).filter((_, i) => i % 2 === 0).slice(0, 3); // 1.e4, 2.Nf3, 3.Bc4
  it('after the trunk when every position on it is known and not due', () => {
    expect(startFor(italian, cardsOf(trunk.map((e) => card('white', e, DAY))), NOW)).toEqual(italian.prefix);
  });
  it('just before the first of your positions on it that is due, so it is asked', () => {
    expect(startFor(italian, cardsOf(trunk.map((e, i) => card('white', e, i === 0 ? -DAY : DAY))), NOW)).toEqual([]);
    expect(startFor(italian, cardsOf(trunk.map((e, i) => card('white', e, i === 1 ? -DAY : DAY))), NOW)).toEqual(['e4', 'e5']);
    const sicilian = deck('b-sicilian');
    expect(startFor(sicilian, cardsOf([card('black', at(['e4']), -DAY)]), NOW)).toEqual(['e4']);
  });
  it('a new position on the trunk is asked too, except before a game', () => {
    expect(startFor(italian, new Map(), NOW)).toEqual([]);
    expect(startFor(italian, new Map(), NOW, { known: true })).toEqual(italian.prefix);
  });
});

describe('each due card in exactly one deck', () => {
  it('a card several decks share goes to the one with the most due cards; none is lost or repeated', () => {
    const e4 = at([]);
    const onlyIn = (id: string) => deck(id).ours.filter((e) => white.every((d) => d.id === id || !d.ours.includes(e)));
    // The French comes after the Italian in the list, and has more due cards: 1.e4 goes there.
    const italianOwn = onlyIn('w-italian').slice(0, 1);
    const frenchOwn = onlyIn('w-french').slice(0, 2);
    const due = [e4, ...italianOwn, ...frenchOwn];
    const { byDeck, none } = assignDue(white, due);
    expect(byDeck.get('w-italian')).toEqual(italianOwn);
    expect(byDeck.get('w-french')).toEqual([...frenchOwn, e4]);
    expect(none).toEqual([]);
    const all = [...byDeck.values()].flat();
    expect(all.sort()).toEqual([...due].sort());
  });
});

describe('the deck a line of yours belongs to', () => {
  const drafts = (decks: typeof white) => decks.map((d) => ({ ...d, fileOwn: d.scope! }));
  it('by the whole line, not by the gap position alone', () => {
    expect(deckForPath(drafts(black), ['d4', 'Nf6', 'h4'])!.id).toBe('b-tromp');
    expect(deckForPath(drafts(white), ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'h4'])!.id).toBe('w-pirc');
    expect(deckForPath(drafts(white), ['e4', 'a6'])!.id).toBe('w-rare');
    expect(deckForPath(drafts(black), ['e3', 'Nf6', 'b3'])!.id).toBe('b-rare');
  });

  it('on a tie in depth, the longer start, then the rare lines; never a deck whose start the line leaves', () => {
    const set = (...ms: string[][]) => new Set(ms.map(at));
    const short = { id: 'short', prefix: ['e4'], fileOwn: set([], ['e4']) };
    const long = { id: 'long', prefix: ['e4', 'c5'], fileOwn: set([], ['e4']) };
    expect(deckForPath([short, long], ['e4', 'c5', 'Nf3'])!.id).toBe('long');
    const plain = { id: 'plain', prefix: ['e4'], fileOwn: set([], ['e4']) };
    const rare = { id: 'rare', prefix: ['e4'], fileOwn: set([], ['e4']), rare: true };
    expect(deckForPath([plain, rare], ['e4', 'a6'])!.id).toBe('rare');
    // A deck that has the line's deepest position through another move order, but whose start the line does not follow.
    const other = { id: 'other', prefix: ['d4'], fileOwn: set([], ['d4'], ['d4', 'Nf6'], ['d4', 'Nf6', 'h3']) };
    const mine = { id: 'mine', prefix: [], fileOwn: set([]), rare: true };
    expect(deckForPath([other, mine], ['h3', 'Nf6', 'd4'])!.id).toBe('mine');
  });

  it('a chapter of yours never widens where the next one goes', () => {
    const tree: CompiledSide = {
      side: 'black',
      positions: {},
      chapters: [
        { id: 'fa', side: 'black', name: 'A', entry: ['d4', 'Nf6'], own: [at([]), at(['d4']), at(['d4', 'Nf6'])] },
        { id: 'fr', side: 'black', name: 'R', entry: [], own: [at([]), at(['h3']), at(['h3', 'Nf6'])] },
        // Yours, in this order: the first reaches 1.d4 Nf6 2.h3 through 1.h3 Nf6 2.d4.
        { id: 'user:black:1', side: 'black', name: 'U1', entry: ['h3', 'Nf6', 'd4'], own: [at([]), at(['h3']), at(['h3', 'Nf6']), at(['h3', 'Nf6', 'd4'])] },
        { id: 'user:black:2', side: 'black', name: 'U2', entry: ['d4', 'Nf6', 'h3'], own: [at([]), at(['d4']), at(['d4', 'Nf6']), at(['d4', 'Nf6', 'h3'])] },
      ],
    };
    const decks = repertoireDecks(tree, [{ id: 'A', side: 'black', name: 'A', chapters: ['fa'] }, { id: 'R', side: 'black', name: 'R', chapters: ['fr'], rare: true }]);
    expect(decks.find((d) => d.id === 'R')!.chapters.map((c) => c.id)).toEqual(['fr', 'user:black:1']);
    expect(decks.find((d) => d.id === 'A')!.chapters.map((c) => c.id)).toEqual(['fa', 'user:black:2']);
  });

  it('a chapter of yours goes to that deck, and a shallow one does not change where others start', () => {
    const mine: UserChapter = { id: 'user:black:x', side: 'black', name: 'Contra 2.h4', moves: ['d4', 'Nf6', 'h4', 'd5'], createdAt: NOW, source: { epd: at(['d4', 'Nf6']), san: 'h4', games: 3 } };
    const merged = withUserChapters(REP, [mine]).rep;
    const decks = repertoireDecks(merged.sides.black);
    const tromp = decks.find((d) => d.id === 'b-tromp')!;
    expect(tromp.chapters.map((c) => c.id)).toContain('user:black:x');
    // Your chapter's positions come from its own tree, like the file's.
    expect(tromp.chapters.find((c) => c.id === 'user:black:x')!.own).toEqual(expect.arrayContaining([at([]), at(['d4', 'Nf6']), at(['d4', 'Nf6', 'h4'])]));
    expect(tromp.scope!.has(at(['d4', 'Nf6', 'h4']))).toBe(true);
    expect(tromp.prefix).toEqual(['d4', 'Nf6']);
    expect(decks.find((d) => d.id === 'b-kid')!.prefix).toEqual(['d4', 'Nf6', 'c4', 'g6']);
  });
});

describe('your games in a deck', () => {
  const index = (entries: Array<[string[], number, number]>): GamesIndex => ({ tree: new Map(), games: 0, exits: [], recent: new Map(entries.map(([m, n, points]) => [at(m), { n, points }])) });
  it('the games that reached one of the opponent moves the deck covers from its root', () => {
    const idx = index([[[], 100, 50], [['e3'], 6, 2], [['b3'], 4, 1], [['e4'], 60, 30], [['d4'], 30, 15]]);
    // The rare first moves: 1.e3 and 1.b3, not 1.e4 or 1.d4.
    expect(deckStats(deck('b-rare'), idx)).toEqual({ n: 10, points: 3 });
  });
  const study = (side: 'white' | 'black'): StudyDeck => ({
    id: 's-vant', name: "Van't Kruijs", side, opening: { eco: 'A00', name: "Van't Kruijs Opening", moves: ['e3'] },
    positions: { [at(['e3'])]: { epd: at(['e3']), fen: `${at(['e3'])} 0 1`, ply: 1, moves: [{ san: 'e5', uci: 'e7e5', to: at(['e3', 'e5']), nags: [] }] } },
    sources: {}, differs: [], frontier: [], size: 30, limits: { minP: 0.02, maxDepth: 10 }, status: 'ready', builtAt: NOW, createdAt: NOW,
  });
  it('a deck whose root is your move: the root itself', () => {
    expect(deckStats(studyDeckView(study('black')), index([[['e3'], 9, 3], [['e3', 'e5'], 4, 1]]))).toEqual({ n: 9, points: 3 });
  });
  it('a deck from any opening is about the opening: its root, whoever moves there', () => {
    expect(deckStats(studyDeckView(study('white')), index([[['e3'], 9, 3], [['e3', 'e5'], 4, 1]]))).toEqual({ n: 9, points: 3 });
  });
});

describe('an old repertoire file without the chapters positions', () => {
  it('falls back to everything reachable from each chapter', () => {
    const side = REP.sides.black;
    const old: CompiledSide = { ...side, chapters: side.chapters.map(({ own: _, ...c }) => c) };
    const sicilian = repertoireDecks(old).find((d) => d.id === 'b-sicilian')!;
    expect(sicilian.scope!.has(at(['e4', 'c5', 'Nf3']))).toBe(true);
  });
});
