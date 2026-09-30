// Why a punishment punishes, shown after the exercise and only when asked:
// its line, then Stockfish's, up to where it pays off (mate, a promotion,
// material that stays), with what it wins and what the punishing move does.
// Pure: the engine's line (from the position after the exercise) comes in.
import { Chess, type Move } from 'chess.js';
import { materialBalance, tryUci } from '../chess/replay.ts';
import { payoff } from '../explain/facts.ts';
import { motifsOf } from '../explain/motifs.ts';
import type { EngineLine, Puzzle, Score } from '../types.ts';

export const WHY = {
  depth: 18,
  /** Plies after the winning move: the recaptures land before the line ends. */
  settle: 2,
  /** Engine plies shown when the line wins nothing: its plan, not the engine's tail. */
  quiet: 8,
} as const;

export interface WhyMove {
  /** Plies of the line up to this move: where the board shows it. */
  ply: number;
  /** "7." or "7...". */
  label: string;
  san: string;
}

export interface PunishWhy {
  /** From the puzzle's position: the exercise's moves, then Stockfish's. */
  moves: string[];
  /** How many of `moves` are the exercise's own. */
  solved: number;
  /** Where it pays off; null when the engine wins nothing in its line (the advantage is positional). */
  payoff: (WhyMove & { kind: 'mate' | 'promotion' | 'material'; what: string }) | null;
  /** The punishing move and what the motif detector sees in it ("garfo: ..."), when it sees something. */
  idea: (WhyMove & { motifs: string[] }) | null;
  /** The line's evaluation, from White's view. */
  score: Score;
  depth: number;
}

const PIECES: Array<[type: string, one: string, many: string, fem: boolean]> = [
  ['q', 'dama', 'damas', true],
  ['r', 'torre', 'torres', true],
  ['b', 'bispo', 'bispos', false],
  ['n', 'cavalo', 'cavalos', false],
  ['p', 'peão', 'peões', false],
];
const VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };

function counts(fen: string, color: 'w' | 'b'): Record<string, number> {
  const out: Record<string, number> = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  for (const ch of fen.split(' ')[0]!) {
    const t = ch.toLowerCase();
    if (t in out && (ch === t) === (color === 'b')) out[t]!++;
  }
  return out;
}

function pieces(n: Record<string, number>): string {
  const parts = PIECES.filter(([t]) => n[t]! > 0).map(([t, one, many, fem]) => {
    const k = n[t]!;
    if (k === 1) return `${fem ? 'uma' : 'um'} ${one}`;
    return `${k === 2 ? (fem ? 'duas' : 'dois') : k === 3 ? 'três' : k} ${many}`;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : (parts[0] ?? '');
}

/**
 * What changed hands between two positions, for `us`: "um cavalo", "a
 * qualidade", "um bispo por um peão". Null when it is not a gain of at least
 * a pawn, or a pawn became a piece (the promotion says it).
 */
export function gainOf(before: string, after: string, us: 'w' | 'b'): string | null {
  const them = us === 'w' ? 'b' : 'w';
  const [ours0, ours1, theirs0, theirs1] = [counts(before, us), counts(after, us), counts(before, them), counts(after, them)];
  const won: Record<string, number> = {};
  const lost: Record<string, number> = {};
  for (const [t] of PIECES) {
    const w = theirs0[t]! - theirs1[t]!;
    const l = ours0[t]! - ours1[t]!;
    if (w < 0 || l < 0) return null;
    const both = Math.min(w, l);
    won[t] = w - both;
    lost[t] = l - both;
  }
  const value = (n: Record<string, number>) => PIECES.reduce((s, [t]) => s + n[t]! * VALUE[t]!, 0);
  if (value(won) - value(lost) < 1) return null;
  const only = (n: Record<string, number>, t: string) => PIECES.every(([x]) => n[x] === (x === t ? 1 : 0));
  if (only(won, 'r') && (only(lost, 'b') || only(lost, 'n'))) return 'a qualidade';
  return value(lost) ? `${pieces(won)} por ${pieces(lost)}` : pieces(won);
}

const labelOf = (mv: Move) => `${mv.before.split(' ')[5]}${mv.color === 'w' ? '.' : '...'}`;

/** The motifs that say a capture wins something. */
const CAPTURES = new Set(['hangingPiece', 'winsMaterial']);

/** `engine`: Stockfish's line from the position after the puzzle's last move. */
export function punishWhy(puzzle: Pick<Puzzle, 'fen' | 'moves'>, engine: EngineLine): PunishWhy {
  const chess = new Chess(puzzle.fen);
  const plies: Move[] = [];
  for (const uci of [...puzzle.moves, ...engine.pv]) {
    const mv = tryUci(chess, uci);
    if (!mv) break;
    plies.push(mv);
  }
  const solved = Math.min(puzzle.moves.length, plies.length);
  const score: Score = engine.mate !== undefined ? { mate: engine.mate } : { cp: engine.cp ?? 0 };
  const mistake = plies[0];
  if (!mistake) return { moves: [], solved: 0, payoff: null, idea: null, score, depth: engine.depth };
  const us = mistake.color === 'w' ? 'b' : 'w';
  const at = (i: number): WhyMove => ({ ply: i + 1, label: labelOf(plies[i]!), san: plies[i]!.san });

  // The punisher's line starts after the mistake; material counts from before it (Nxe4?? Nxe4 wins a piece for a pawn).
  const p = payoff(mistake.after, plies.slice(1).map((m) => m.lan), 24, puzzle.fen);
  const end = Math.min(plies.length, Math.max(solved, p ? p.index + 2 + (p.kind === 'mate' ? 0 : WHY.settle) : solved + WHY.quiet));
  let what: string | null = null;
  if (p) {
    const gain = p.kind === 'material' ? gainOf(puzzle.fen, plies[end - 1]!.after, us) : null;
    what = p.kind === 'mate' ? 'dá mate' : p.kind === 'promotion' ? 'promove o peão' : gain ? `ganha ${gain}` : `ganha ${p.swing} ponto${p.swing === 1 ? '' : 's'} de material`;
  }

  // A capture that only takes back what the mistake took (7...Bxf3 8.Bxf3) wins nothing: no "ganha material" for it.
  const first = plies[1];
  const sign = us === 'w' ? 1 : -1;
  const even = !!first && sign * (materialBalance(first.after) - materialBalance(puzzle.fen)) < 1;
  const motifs = first ? motifsOf(mistake.after, first.lan).filter((m) => !(even && CAPTURES.has(m.theme))).map((m) => m.text) : [];
  return {
    moves: plies.slice(0, end).map((m) => m.lan),
    solved,
    payoff: p && what ? { ...at(p.index + 1), kind: p.kind, what } : null,
    idea: first && motifs.length ? { ...at(1), motifs: motifs.slice(0, 2) } : null,
    score,
    depth: engine.depth,
  };
}
