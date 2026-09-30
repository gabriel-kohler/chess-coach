// @vitest-environment node
import { readFileSync } from 'node:fs';
import { State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { positionsAlong, repertoireDecks } from '../decks/views';
import type { CompiledRepertoire } from '../repertoire/data';
import { newPuzzleCard } from '../srs/cards';
import type { Puzzle, PuzzleSrsCard } from '../types';
import { punishPuzzle, type PunishItem } from './find';
import { deckSession, pickDaily, PUNISH_SESSION, worth } from './select';

const REP = JSON.parse(readFileSync('public/repertoire.json', 'utf8')) as CompiledRepertoire;
const at = (m: string[]) => positionsAlong(m).at(-1)!;
const NOW = 1_000 * 86_400_000;
const alapin = repertoireDecks(REP.sides.white).find((d) => d.id === 'w-sicilian')!;
const before = at(['e4', 'c5', 'c3']);

const item = (id: string, share: number, loss: number, over: Partial<PunishItem> = {}): PunishItem => ({
  id, side: 'white', before, fen: `${before} 0 2`, mistake: { uci: 'h7h5', san: 'h5', share, games: 100 }, best: { uci: 'd2d4', san: 'd4' }, loss, buckets: 'b', at: NOW, ...over,
});

describe('new mistakes for the day', () => {
  it('the ones worth most, none with a card, within the day\'s limit minus what was planned or tried', () => {
    const items = [item('a', 0.1, 12), item('b', 0.05, 30), item('c', 0.2, 11), item('d', 0.3, 40)];
    const reach = (i: PunishItem) => (i.id === 'a' ? 10 : 0);
    // Worth: a 0.1x12x11 = 13.2, b 1.5, c 2.2, d 12 (carded).
    const picked = pickDaily(items, { carded: new Set(['punish:d']), planned: new Set(), limit: 3, reach });
    expect(picked.map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(worth(items[0]!, 10)).toBeCloseTo(13.2);
    // Two already tried or in the session today: room for one more, and never one of them again.
    expect(pickDaily(items, { carded: new Set(), planned: new Set(['punish:a', 'punish:x']), limit: 3, reach }).map((i) => i.id)).toEqual(['d']);
    expect(pickDaily(items, { carded: new Set(), planned: new Set(['punish:a', 'punish:b', 'punish:c']), limit: 3, reach })).toEqual([]);
  });
});

describe('a deck\'s session of punishments', () => {
  it('its due reviews first, then its new mistakes, then Lichess puzzles of its openings', () => {
    const mine = Array.from({ length: 13 }, (_, k) => item(`m${k}`, 0.05 + k / 100, 12));
    const other = item('other', 0.5, 50, { before: at(['e4', 'e5']) });
    const dueCard = { ...newPuzzleCard(punishPuzzle(mine[0]!, 'X', 1370), NOW - 5 * 86_400_000), state: State.Review, due: NOW - 1 } as PuzzleSrsCard;
    const laterCard = { ...newPuzzleCard(punishPuzzle(mine[1]!, 'X', 1370), NOW), state: State.Review, due: NOW + 86_400_000 } as PuzzleSrsCard;
    const cards = new Map([[dueCard.puzzle.id, dueCard], [laterCard.puzzle.id, laterCard]]);
    const lichess: Puzzle[] = Array.from({ length: 12 }, (_, k) => ({ id: `L${k}`, source: 'lichess', fen: '8/8/8/8/8/8/8/8 b - - 0 1', moves: ['a1a2', 'a2a3'], rating: 1400, themes: [], note: 'Sicilian Defense Alapin Variation' }));
    const s = deckSession(alapin, [...mine, other], cards, lichess, 1370, NOW);
    expect(s[0]).toMatchObject({ mode: 'review', puzzle: { id: 'punish:m0' } });
    const fresh = s.filter((x) => x.mode === 'punish' && x.puzzle.source === 'punish');
    expect(fresh).toHaveLength(PUNISH_SESSION.mistakes);
    // Not the other deck's, not the ones with a card; the most common first.
    expect(fresh.map((x) => x.puzzle.id)).not.toContain('punish:other');
    expect(fresh.map((x) => x.puzzle.id)).not.toContain('punish:m1');
    expect(fresh[0]!.puzzle.id).toBe('punish:m12');
    expect(fresh[0]!.reason).toMatch(/^Contra a Siciliana \(Alapin\): 2\.\.\.h5 é jogado por/);
    expect(s.slice(-PUNISH_SESSION.lichess).every((x) => x.puzzle.source === 'lichess' && x.mode === 'punish')).toBe(true);
    expect(s).toHaveLength(1 + PUNISH_SESSION.mistakes + PUNISH_SESSION.lichess);
  });
});
