// Lichess opening puzzles for a deck: an opponent's mistake in a real game of
// one of its openings, punished. Tagged by the Lichess database with the
// opening family and variation (scripts/build-puzzles.mjs keeps them).
import { lichessTag, REPERTOIRE_DECKS } from '../decks/catalog.ts';
import type { DeckView } from '../decks/views.ts';
import { loadOpeningPuzzles, openingFamilies, type OpeningPuzzle } from '../tactics/bank.ts';
import { attemptedIds, loadTactics } from '../tactics/trainer.ts';
import type { Color, Puzzle } from '../types.ts';

/** Its openings as Lichess tags them: the list for your repertoire's decks; the catalog name for a deck from any opening. */
export function deckTags(deck: Pick<DeckView, 'id' | 'kind' | 'name'>): string[] {
  if (deck.kind === 'repertoire') return REPERTOIRE_DECKS.find((s) => s.id === deck.id)?.lichess ?? [];
  // "Sicilian Defense: Najdorf Variation, English Attack": its variation, then its family.
  const variation = lichessTag(deck.name.split(',')[0]!);
  const family = lichessTag(deck.name.split(':')[0]!);
  return variation === family ? [family] : [variation, family];
}

/** The database's file a tag is in: the tag itself when it is a family, else the longest family it starts with. */
export function familyFor(tag: string, families: string[]): string | null {
  if (families.includes(tag)) return tag;
  return families.filter((f) => tag.startsWith(`${f}_`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * Up to `n` puzzles you have not tried: one of the tags (its family or its
 * variation), your color solving (the side not to move plays the setup
 * mistake), within `window` of your tactics rating, the closest first, the
 * first tag's before the others.
 */
export function pickOpeningPuzzles(pool: OpeningPuzzle[], tags: string[], side: Color, rating: number, seen: Set<string>, n: number, window = 150): Puzzle[] {
  const rank = (p: OpeningPuzzle) => {
    const i = tags.findIndex((t) => t === p.variation || t === p.family);
    return i < 0 ? Infinity : i;
  };
  const solver = (p: Puzzle): Color => (p.fen.split(' ')[1] === 'w' ? 'black' : 'white');
  return pool
    .filter((p) => rank(p) < Infinity && solver(p) === side && Math.abs(p.rating - rating) <= window && !seen.has(p.id))
    .sort((a, b) => rank(a) - rank(b) || Math.abs(a.rating - rating) - Math.abs(b.rating - rating) || a.id.localeCompare(b.id))
    .slice(0, n)
    .map(({ family: _f, variation, ...p }) => ({ ...p, note: variation.replace(/_/g, ' ') }));
}

export async function lichessForDeck(deck: DeckView, n = 10): Promise<Puzzle[]> {
  const tags = deckTags(deck);
  if (!tags.length) return [];
  const families = await openingFamilies();
  const files = [...new Set(tags.map((t) => familyFor(t, families)).filter((f): f is string => !!f))];
  if (!files.length) return [];
  const [pools, state, seen] = await Promise.all([Promise.all(files.map(loadOpeningPuzzles)), loadTactics(), attemptedIds()]);
  return pickOpeningPuzzles(pools.flat(), tags, deck.side, state.rating.rating, seen, n);
}
