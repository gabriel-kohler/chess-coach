// What makes an opponent's move a mistake worth punishing in one of your
// decks, and the exercise it becomes. A move counts when people at your
// opponents' level really play it (the Lichess explorer), it is not the book's
// (your deck already trains those) and Stockfish says it gives up at least 10
// win-chance points. Pure: the scan (scan.ts) brings the explorer and the engine.
import { Chess } from 'chess.js';
import { epdOf, tryUci } from '../chess/replay.ts';
import { moveLabel } from '../decks/build.ts';
import type { DeckView } from '../decks/views.ts';
import type { ExplorerMove } from '../openings/explorer.ts';
import { moveLoss } from '../openings/study.ts';
import { MISTAKE } from '../repertoire/accept.ts';
import { punishPuzzleId } from '../srs/cards.ts';
import type { Color, EngineLine, Puzzle } from '../types.ts';

export const PUNISH = {
  /** Up to move 10: past it the explorer has few games at your level. */
  maxPly: 20,
  /** Games at the position in your opponents' range, for the shares to mean something. */
  minGames: 50,
  /** Share of those games and games with the move, for it to be common. */
  minShare: 0.03,
  minMoveGames: 20,
  /** Win-chance points the move gives up for whoever plays it (a mistake). */
  minLoss: MISTAKE,
  depth: 16,
  /** A position is scanned again after the explorer's month, or when your range changes. */
  staleMs: 30 * 86_400_000,
} as const;

export interface PunishItem {
  /** EPD after the mistake: one exercise per position. */
  id: string;
  side: Color;
  /** The position before the mistake (the opponent to move). */
  before: string;
  fen: string;
  mistake: { uci: string; san: string; share: number; games: number };
  /** Stockfish's answer: the stored solution (any move within 5 points is accepted). */
  best: { uci: string; san: string };
  /** Win-chance points the mistake gives up. */
  loss: number;
  /** The explorer's rating buckets, "1400,1600". */
  buckets: string;
  at: number;
}

export type Candidate = ExplorerMove & { share: number };

/** Common moves at the position that are not the book's: the only ones the engine checks. */
export function candidates(moves: ExplorerMove[], book: Set<string>): Candidate[] {
  const total = moves.reduce((s, m) => s + m.n, 0);
  if (total < PUNISH.minGames) return [];
  return moves
    .filter((m) => !book.has(m.uci))
    .map((m) => ({ ...m, share: m.n / total }))
    .filter((m) => m.share >= PUNISH.minShare && m.n >= PUNISH.minMoveGames);
}

/**
 * Win-chance points a candidate gives up against the best line, for the side
 * that plays it. `best` is the position's best line; `lines` the candidates'
 * own lines (a search restricted to them): a restricted search's first line is
 * only the least bad candidate, never the best move. Null when unknown.
 */
export function lossOf(fen: string, best: EngineLine | undefined, lines: EngineLine[], uci: string): number | null {
  if (!best?.pv[0]) return null;
  if (best.pv[0] === uci) return 0;
  const line = lines.find((l) => l.pv[0] === uci);
  if (!line) return null;
  return moveLoss([best], uci, fen.split(' ')[1] === 'w', line);
}

export function punishItem(side: Color, fen: string, c: Candidate, loss: number, answer: string, buckets: string, now: number): PunishItem | null {
  const chess = new Chess(fen);
  const mv = tryUci(chess, c.uci);
  if (!mv) return null;
  const after = chess.fen();
  const b = tryUci(new Chess(after), answer);
  if (!b) return null;
  return {
    id: epdOf(after),
    side,
    before: epdOf(fen),
    fen,
    mistake: { uci: mv.lan, san: mv.san, share: c.share, games: c.n },
    best: { uci: b.lan, san: b.san },
    loss,
    buckets,
    at: now,
  };
}

/**
 * The decks a mistake belongs to: the ones with its position (your
 * repertoire's by scope, one from any opening by its tree) that do not answer
 * the move already.
 */
export function ownersOf(item: Pick<PunishItem, 'side' | 'before' | 'mistake'>, decks: DeckView[]): DeckView[] {
  return decks.filter((d) => {
    if (d.side !== item.side) return false;
    const pos = d.tree.positions[item.before];
    if (d.scope ? !d.scope.has(item.before) : !pos) return false;
    return !pos?.moves.some((m) => m.uci === item.mistake.uci && (!d.scope || d.scope.has(m.to)));
  });
}

const pct = (x: number) => `${Math.max(1, Math.round(x * 100))}%`;

/** What the exercise says, kept in the puzzle: "Siciliana: 2...Qb6 é jogado por 6% no seu nível e perde 12 pontos de chance. Puna." */
export function punishNote(item: PunishItem, deck: string | null): string {
  const move = moveLabel(item.fen, item.mistake.san);
  return `${deck ? `${deck}: ` : ''}${move} é jogado por ${pct(item.mistake.share)} no seu nível e perde ${Math.round(item.loss)} pontos de chance. Puna.`;
}

export function punishPuzzle(item: PunishItem, deck: string | null, rating: number): Puzzle {
  return {
    id: punishPuzzleId(item.id),
    source: 'punish',
    fen: item.fen,
    moves: [item.mistake.uci, item.best.uci],
    rating: Math.round(rating),
    // "opening", not a motif: the exercise lists no themes of its own.
    themes: ['opening'],
    note: punishNote(item, deck),
    loss: item.loss,
  };
}
