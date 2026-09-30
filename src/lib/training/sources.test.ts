// @vitest-environment node
import { readFileSync } from 'node:fs';
import { State } from 'ts-fsrs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { positionsAlong, repertoireDecks, studyDeckView } from '../decks/views';
import type { BestMoveCard, FocusCategory, FocusShare, FocusWeights } from '../positions/types';
import type { CompiledRepertoire } from '../repertoire/data';
import type { GamesIndex } from '../repertoire/games';
import { deckNamespace, newRepCard, type RepNamespace } from '../srs/cards';
import type { Color, RepCard } from '../types';
import { TRAINING } from './config';
import { dailyPunish, loadTimes, pickReminder, repDue, warmupDeck } from './sources';

const NOW = new Date(2026, 8, 11, 9, 0).getTime();

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('your time on a puzzle, for the plan', () => {
  const attempts = (n: number, timeMs: number) =>
    db.attempts.bulkAdd(Array.from({ length: n }, (_, i) => ({ puzzleId: `p${i}`, source: 'lichess' as const, at: NOW - i, solved: false, timeMs, puzzleRating: 1500, ratingBefore: 1500, ratingAfter: 1500, themes: [], mode: 'new' as const })));

  it('is the default until there are 10 attempts', async () => {
    await attempts(9, 40_000);
    expect((await loadTimes()).puzzleMs).toBe(TRAINING.defaults.puzzleMs);
  });

  it('punishing opening mistakes (one known move) does not count as a puzzle\'s time', async () => {
    await attempts(12, 40_000);
    await db.attempts.bulkAdd(Array.from({ length: 30 }, (_, i) => ({ puzzleId: `punish:${i}`, source: 'punish' as const, at: NOW + i, solved: true, timeMs: 2_000, puzzleRating: 1370, ratingBefore: 1500, ratingAfter: 1500, themes: [], mode: 'punish' as const })));
    expect((await loadTimes()).puzzleMs).toBe(40_000);
  });

  it('is your median, but solutions asked for at once do not make puzzles look instant', async () => {
    await attempts(12, 40_000);
    expect((await loadTimes()).puzzleMs).toBe(40_000);
    await db.attempts.clear();
    await attempts(12, 1_000);
    expect((await loadTimes()).puzzleMs).toBe(TRAINING.puzzleMsClamp[0]);
    await db.attempts.clear();
    await attempts(12, 200_000);
    expect((await loadTimes()).puzzleMs).toBe(TRAINING.puzzleMsClamp[1]);
  });
});

describe('due repertoire lines by opening deck', () => {
  const REP = JSON.parse(readFileSync('public/repertoire.json', 'utf8')) as CompiledRepertoire;
  const white = repertoireDecks(REP.sides.white);
  const onlyIn = (id: string) => white.find((d) => d.id === id)!.ours.filter((e) => white.every((d) => d.id === id || !d.ours.includes(e)));
  const due = (ns: RepNamespace, side: Color, epd: string, dueIn = -1): RepCard => ({ ...newRepCard(ns, side, epd, NOW - 9e8), state: State.Review, reps: 2, due: NOW + dueIn });

  it('each due card in one deck, the trunk with the deck that has the most; a deck from any opening has its own', async () => {
    const italian = onlyIn('w-italian').slice(0, 2);
    const french = onlyIn('w-french').slice(0, 1);
    const sicilian = repertoireDecks(REP.sides.black).find((d) => d.id === 'b-sicilian')!.ours.filter((e) => e !== positionsAlong(['e4']).at(-1)).slice(0, 1);
    const afterE3 = positionsAlong(['e3']).at(-1)!;
    const vant = studyDeckView({
      id: 's-vant', name: "Van't Kruijs Opening", side: 'black', opening: { eco: 'A00', name: "Van't Kruijs Opening", moves: ['e3'] },
      positions: { [afterE3]: { epd: afterE3, fen: `${afterE3} 0 1`, ply: 1, moves: [{ san: 'e5', uci: 'e7e5', to: positionsAlong(['e3', 'e5']).at(-1)!, nags: [] }] } },
      sources: {}, differs: [], frontier: [], size: 30, limits: { minP: 0.02, maxDepth: 10 }, status: 'ready', builtAt: NOW, createdAt: NOW,
    });
    await db.srsCards.bulkPut([
      due('white', 'white', positionsAlong([]).at(-1)!),
      ...italian.map((e) => due('white', 'white', e)),
      ...french.map((e) => due('white', 'white', e)),
      due('white', 'white', onlyIn('w-caro')[0]!, 86_400_000), // not due
      ...sicilian.map((e) => due('black', 'black', e)),
      due(deckNamespace('s-vant'), 'black', afterE3),
    ]);
    const groups = await repDue(REP, [vant], NOW);
    expect(groups).toEqual([
      { side: 'white', due: 3, deckId: 'w-italian', name: 'Italiana' },
      { side: 'white', due: 1, deckId: 'w-french', name: 'Contra a Francesa' },
      { side: 'black', due: 1, deckId: 'b-sicilian', name: 'Siciliana' },
      { side: 'black', due: 1, deckId: 's-vant', name: "Van't Kruijs Opening" },
    ]);
  });

  it('before a game, the deck you met most among those with a position you know', () => {
    const recent = (entries: Array<[string[], number]>): GamesIndex => ({ tree: new Map(), games: 0, exits: [], recent: new Map(entries.map(([m, n]) => [positionsAlong(m).at(-1)!, { n, points: n / 2 }])) });
    // The games through the opponent's moves each deck covers from its root.
    const idx = recent([[['e4', 'e6', 'd4', 'd5'], 30], [['e4', 'c5', 'c3', 'd5'], 50]]);
    const known = (ids: string[]) => new Map(ids.flatMap((id) => onlyIn(id).slice(0, 1)).map((e) => [e, due('white', 'white', e, 86_400_000)]));
    // The Sicilian is met most, but you know nothing of it yet.
    expect(warmupDeck(white, known(['w-french']), idx)!.id).toBe('w-french');
    expect(warmupDeck(white, known(['w-french', 'w-sicilian']), idx)!.id).toBe('w-sicilian');
    expect(warmupDeck(white, new Map(), idx)).toBeNull();
  });
});

describe('the day\'s mistakes to punish', () => {
  const REP = JSON.parse(readFileSync('public/repertoire.json', 'utf8')) as CompiledRepertoire;
  const before = positionsAlong(['e4', 'c5', 'c3']).at(-1)!;
  const item = (id: string, share: number) => ({ id, side: 'white', before, fen: `${before} 0 2`, mistake: { uci: 'h7h5', san: 'h5', share, games: 100 }, best: { uci: 'd2d4', san: 'd4' }, loss: 12, buckets: 'b', at: NOW });
  const idx = (): GamesIndex => ({ tree: new Map(), games: 0, exits: [], recent: new Map() });

  it('at most 3 a day, counting what you tried today and what the session already has', async () => {
    await db.kv.put({ key: 'punish:items', value: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((k, i) => [k, item(k, 0.1 + i / 100)])) });
    const openings = { rep: REP, data: { index: { white: idx(), black: idx() }, gaps: [] } } as never;
    expect((await dailyPunish(openings, [], NOW)).map((s) => s.puzzle.id)).toEqual(['punish:e', 'punish:d', 'punish:c']);
    // One tried today in a deck's session, one already in today's session: one more.
    await db.attempts.add({ puzzleId: 'punish:e', source: 'punish', at: NOW, solved: true, timeMs: 3_000, puzzleRating: 1370, ratingBefore: 1500, ratingAfter: 1500, themes: [], mode: 'punish' });
    const more = await dailyPunish(openings, [], NOW, new Set(['puzzle:punish:d']));
    expect(more.map((s) => s.puzzle.id)).toEqual(['punish:c']);
    expect(more[0]).toMatchObject({ mode: 'punish', puzzle: { source: 'punish' } });
  });
});

describe('the warm-up reminder', () => {
  const shares = (s: Partial<Record<FocusCategory, number>>): FocusWeights => {
    const all = ['opening', 'middlegame', 'endgame', 'convert', 'balanced', 'defend', 'fast', 'lowClock', 'blunder', 'mistake', 'inaccuracy', 'miss'] as FocusCategory[];
    const f = (share: number): FocusShare => ({ share, count: 1, lo: share, hi: share });
    return { version: 1, computedAt: NOW, games: 40, windowDays: 90, totalLoss: 100, block: 40, provisional: false, shares: Object.fromEntries(all.map((k) => [k, f(s[k] ?? 0)])) as FocusWeights['shares'] };
  };
  const card = (id: string, categories: FocusCategory[], over: Partial<BestMoveCard> = {}) => ({ id, categories, suspended: 0, reps: 2, state: State.Review, due: NOW + 86_400_000, totalLoss: 10, ...over }) as BestMoveCard;

  it('is your costliest kind among converting, defending and the clock; balanced never counts', () => {
    const w = shares({ balanced: 0.6, defend: 0.3, convert: 0.1 });
    const out = pickReminder([card('c', ['convert']), card('d', ['defend']), card('b', ['balanced'])], w, NOW);
    expect(out).toMatchObject({ category: 'defend', due: false });
    expect(out!.card.id).toBe('d');
  });

  it('graded when due; never a position you have not seen; the next kind when one has none', () => {
    const w = shares({ lowClock: 0.4, convert: 0.2 });
    // A new card is due from the day it is made: still not a lesson for right before a game.
    const fresh = (id: string, c: FocusCategory) => card(id, [c], { reps: 0, state: State.New, due: NOW - 1 });
    const cards = [fresh('new', 'lowClock'), card('due', ['convert'], { due: NOW - 1, totalLoss: 5 }), card('big', ['convert'], { totalLoss: 50 })];
    expect(pickReminder(cards, w, NOW)).toMatchObject({ category: 'convert', due: true, card: { id: 'due' } });
    expect(pickReminder([fresh('new', 'fast')], w, NOW)).toBeNull();
  });
});
