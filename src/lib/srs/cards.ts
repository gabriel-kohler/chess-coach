// Ids and fresh cards for the kinds outside Posições. Every kind shares one
// table, so an id starts with its kind.
import type { Color, Puzzle, PuzzleSrsCard, RepCard } from '../types.ts';
import { newFsrsFields } from './fsrs.ts';

/**
 * Where a repertoire card lives: the color for your repertoire (one card per
 * position, whatever deck shows it), `d:<deck id>` for a deck built from any
 * opening, which may answer a position differently.
 */
export type RepNamespace = Color | `d:${string}`;

export const deckNamespace = (deckId: string): RepNamespace => `d:${deckId}`;
export const repCardId = (ns: RepNamespace, epd: string) => `rep:${ns}|${epd}`;
export const puzzleCardId = (puzzleId: string) => `puzzle:${puzzleId}`;
/** Punishing an opening mistake: one exercise per position after the mistake. */
export const punishPuzzleId = (epdAfter: string) => `punish:${epdAfter}`;
export const PUNISH_CARD_PREFIX = puzzleCardId(punishPuzzleId(''));

export function newRepCard(ns: RepNamespace, side: Color, epd: string, now: number): RepCard {
  const id = repCardId(ns, epd);
  const deck = ns.startsWith('d:') ? { deck: ns.slice(2) } : {};
  return { id, kind: 'rep', note: id, primaryGameId: null, createdAt: now, suspended: 0, side, epd, ...deck, ...newFsrsFields(now) };
}

export function newPuzzleCard(puzzle: Puzzle, now: number): PuzzleSrsCard {
  const id = puzzleCardId(puzzle.id);
  return { id, kind: 'puzzle', note: id, primaryGameId: null, createdAt: now, suspended: 0, puzzle, ...newFsrsFields(now) };
}

/** One attempt at a card: the key that keeps a double save from counting twice. */
export const attemptIdFor = (cardId: string) => `${cardId}|${Date.now()}|${Math.random().toString(36).slice(2)}`;

/** Moves your solution line has: a Lichess line opens with the opponent's setup move. */
export function yourMoves(p: Puzzle): number {
  return Math.ceil((p.moves.length - 1) / 2);
}
