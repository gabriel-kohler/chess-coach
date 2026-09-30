// Which mistakes to punish come up: a few new ones in the day's training, the
// ones worth most first, and a deck's own session (its reviews, then new ones,
// then Lichess puzzles from its openings). Pure.
import type { DeckView } from '../decks/views.ts';
import { punishPuzzleId } from '../srs/cards.ts';
import { reviewReason, type SessionItem } from '../tactics/trainer.ts';
import type { Puzzle, PuzzleSrsCard } from '../types.ts';
import { ownersOf, punishPuzzle, type PunishItem } from './find.ts';

export const PUNISH_SESSION = { mistakes: 10, lichess: 10 } as const;

/** How much a mistake is worth learning to punish: how often it is played, how much it gives up, how often your games get there. */
export const worth = (item: PunishItem, reach: number) => item.mistake.share * item.loss * (1 + reach);

/**
 * New mistakes for the day: none with a card already, none already planned or
 * tried today (so "Mais 10 minutos" does not bring more), up to the day's limit.
 */
export function pickDaily(items: PunishItem[], opts: { carded: Set<string>; planned: Set<string>; limit: number; reach: (item: PunishItem) => number }): PunishItem[] {
  const room = Math.max(0, opts.limit - opts.planned.size);
  return items
    .filter((i) => !opts.carded.has(punishPuzzleId(i.id)) && !opts.planned.has(punishPuzzleId(i.id)))
    .map((i) => ({ i, w: worth(i, opts.reach(i)) }))
    .sort((a, b) => b.w - a.w || a.i.id.localeCompare(b.i.id))
    .slice(0, room)
    .map((x) => x.i);
}

/** The puzzle a new mistake is shown with, named after the first deck it belongs to. */
export function newPunishItem(item: PunishItem, decks: DeckView[], rating: number): SessionItem {
  const puzzle = punishPuzzle(item, ownersOf(item, decks)[0]?.name ?? null, rating);
  return { puzzle, mode: 'punish', reason: puzzle.note ?? '' };
}

/** A deck's session: its due punish reviews, then new mistakes of it, then Lichess opening puzzles of its openings. */
export function deckSession(deck: DeckView, items: PunishItem[], cards: Map<string, PuzzleSrsCard>, lichess: Puzzle[], rating: number, now: number, reach: (item: PunishItem) => number = () => 0): SessionItem[] {
  const mine = items.filter((i) => ownersOf(i, [deck]).length > 0);
  const due = mine
    .map((i) => cards.get(punishPuzzleId(i.id)))
    .filter((c): c is PuzzleSrsCard => !!c && !c.suspended && c.due <= now)
    .sort((a, b) => a.due - b.due)
    .map((c): SessionItem => ({ puzzle: c.puzzle, mode: 'review', reason: reviewReason(c) }));
  const fresh = mine
    .filter((i) => !cards.has(punishPuzzleId(i.id)))
    .sort((a, b) => worth(b, reach(b)) - worth(a, reach(a)) || a.id.localeCompare(b.id))
    .slice(0, PUNISH_SESSION.mistakes)
    .map((i) => newPunishItem(i, [deck], rating));
  const puzzles = lichess.slice(0, PUNISH_SESSION.lichess).map((p): SessionItem => ({ puzzle: p, mode: 'punish', reason: `Puzzle de abertura do Lichess: ${p.note ?? deck.name}.` }));
  return [...due, ...fresh, ...puzzles];
}
