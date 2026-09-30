// The rules for taking your repertoire's lines past the start of the middle
// game (scripts/extend-repertoire.mjs). At the opponent's turn: what people at
// your level play, while they have games there, else what masters play, else
// Stockfish; the most played move, and the next one too when it is common. At
// yours: the masters' move when Stockfish finds it within 5 points of its
// best (the repertoire's own rule), else Stockfish's. Pure.
import type { PgnNode } from '../chess/pgn.ts';
import { INACCURACY } from './accept.ts';

export const EXTEND = {
  /** Games at your opponents' level for their moves to count. */
  levelMinGames: 50,
  /** Master games at the position (the opponent) or with the move (yours). */
  mastersMinGames: 20,
  /** A second opponent move joins the line when this share plays it. */
  secondShare: 0.3,
  /** A side this far ahead (centipawns): the game is decided, the line stops. */
  decidedCp: 300,
} as const;

export interface Counted {
  uci: string;
  san: string;
  /** Games with the move. */
  n: number;
}

export type ExtendSource = 'level' | 'masters' | 'engine';

const total = (moves: Counted[] | null) => (moves ?? []).reduce((s, m) => s + m.n, 0);

/** The most played move, and the second when it is common. */
function mainAndCommon(moves: Counted[]): Counted[] {
  const sorted = [...moves].sort((a, b) => b.n - a.n);
  const all = total(sorted);
  const out = sorted.slice(0, 1);
  if (sorted[1] && sorted[1].n / all >= EXTEND.secondShare) out.push(sorted[1]);
  return out;
}

export function opponentReplies(level: Counted[] | null, masters: Counted[] | null, engineBest: string | null): Array<{ uci: string; source: ExtendSource }> {
  if (level && total(level) >= EXTEND.levelMinGames) return mainAndCommon(level).map((m) => ({ uci: m.uci, source: 'level' as const }));
  if (masters && total(masters) >= EXTEND.mastersMinGames) return mainAndCommon(masters).map((m) => ({ uci: m.uci, source: 'masters' as const }));
  return engineBest ? [{ uci: engineBest, source: 'engine' }] : [];
}

/** Whether the masters' move has to be checked: the most played one, with enough games. */
export function mastersChoice(masters: Counted[] | null): Counted | null {
  const top = [...(masters ?? [])].sort((a, b) => b.n - a.n)[0];
  return top && top.n >= EXTEND.mastersMinGames ? top : null;
}

/** Your move: the masters' when it gives up less than 5 points to Stockfish's best (`loss`), else Stockfish's. */
export function ourMove(masters: Counted | null, loss: number | null, engineBest: string | null): { uci: string; source: 'masters' | 'engine' } | null {
  if (masters && loss !== null && loss < INACCURACY) return { uci: masters.uci, source: 'masters' };
  return engineBest ? { uci: engineBest, source: 'engine' } : null;
}

/** Centipawns from the side to move (mates squashed to +-10000): decided either way. */
export const decided = (score: number) => Math.abs(score) >= EXTEND.decidedCp;

/** Lines from the first move as one tree of variations, the first line the main one; `notes[ply]` becomes that move's comment. */
export function treeFromLines(lines: Array<{ moves: string[]; notes?: Record<number, string> }>): PgnNode[] {
  const root: PgnNode = { san: '', nags: [], children: [] };
  for (const l of lines) {
    let node = root;
    l.moves.forEach((san, ply) => {
      let next = node.children.find((c) => c.san === san);
      if (!next) {
        next = { san, nags: [], children: [] };
        node.children.push(next);
      }
      const note = l.notes?.[ply];
      if (note && !next.comment) next.comment = note;
      node = next;
    });
  }
  return root.children;
}
