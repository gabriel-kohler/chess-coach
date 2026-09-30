import type { RepertoirePosition } from '../repertoire/compile.ts';
import type { Color } from '../types.ts';

/** An opponent position still to be opened up, and how likely the line to it is. */
export interface FrontierNode {
  fen: string;
  /** Product of the shares of the opponent's moves on the way, each among the replies kept there (0-1). */
  p: number;
  /** Your moves after the deck's root. */
  depth: number;
}

/** Where one of your answers came from, the first that has one. */
export type AnswerSource = 'study' | 'repertoire' | 'engine';

/**
 * A deck built from any opening (Aberturas > Qualquer abertura): its own
 * tree, grown from the lines people at your level play, and its own cards
 * (`rep:d:<id>|<epd>`), so it can answer a position differently from your
 * repertoire.
 */
export interface StudyDeck {
  /** No "|": card ids are built from it. */
  id: string;
  name: string;
  side: Color;
  /** The catalog line it starts from: its moves play by themselves. */
  opening: { eco: string; name: string; moves: string[] };
  /** Positions built so far, both sides, in the repertoire's shape. */
  positions: Record<string, RepertoirePosition>;
  /** Your answer at each of your positions and where it came from. */
  sources: Record<string, AnswerSource>;
  /** Your positions where your repertoire answers something else ("1...e5" against "1...Nf6"). */
  differs: Array<{ epd: string; deck: string; repertoire: string }>;
  /** Positions not opened up yet, however unlikely or deep: the building goes on from here. */
  frontier: FrontierNode[];
  /** Your positions wanted in total. */
  size: number;
  /** How unlikely and how deep a line may get before the building stops there; "Aprofundar" relaxes them. */
  limits: { minP: number; maxDepth: number };
  status: 'building' | 'ready';
  /** Why the last building stopped early, when it did. */
  note?: string;
  builtAt: number | null;
  createdAt: number;
}
