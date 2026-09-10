import { Chess, type Move } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface PlyInfo {
  san: string;
  uci: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  captured?: string;
  piece: string;
  flags: string;
}

/** Replays SAN moves; stops at the first illegal move. */
export function replay(moves: string[], initialFen = START_FEN, limit = moves.length): PlyInfo[] {
  const chess = new Chess(initialFen);
  const out: PlyInfo[] = [];
  for (const san of moves.slice(0, limit)) {
    let m: Move;
    try {
      m = chess.move(san);
    } catch {
      break;
    }
    out.push({
      san: m.san,
      uci: m.lan,
      from: m.from,
      to: m.to,
      fenBefore: m.before,
      fenAfter: m.after,
      captured: m.captured,
      piece: m.piece,
      flags: m.flags,
    });
  }
  return out;
}

/**
 * chess.js 1.x throws on an illegal move (0.x returned null). Code that plays
 * moves from data, timers or the engine goes through these instead, so a bad
 * move becomes a handled null and not an uncaught error inside a callback.
 */
export function tryMove(chess: Chess, move: string | { from: string; to: string; promotion?: string }): Move | null {
  try {
    return chess.move(move);
  } catch {
    return null;
  }
}

export function tryUci(chess: Chess, uci: string): Move | null {
  return tryMove(chess, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

export function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

/** SAN for a UCI line, stopping at the first illegal move. */
export function lineToSan(fen: string, uciLine: string[], max = 12): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciLine.slice(0, max)) {
    try {
      out.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material balance (White minus Black) in pawns. */
export function materialBalance(fen: string): number {
  let sum = 0;
  for (const ch of fen.split(' ')[0]!) {
    const v = PIECE_VALUE[ch.toLowerCase()];
    if (v === undefined) continue;
    sum += ch === ch.toUpperCase() ? v : -v;
  }
  return sum;
}

export function turnOf(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black';
}

/** Formats moves as "12. Nf3 Nc6 13. ..." from a given ply offset. */
export function moveNumberLabel(ply: number): string {
  const n = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${n}.` : `${n}...`;
}

/** Number labels for a line starting at `fen`: before each White move, and "24..." when Black starts. */
export function lineLabels(fen: string, length: number): Array<string | null> {
  const [, turn, , , , full] = fen.split(' ');
  const first = (Number(full) || 1) * 2 - (turn === 'b' ? 0 : 1);
  return Array.from({ length }, (_, i) => (i === 0 || (first + i) % 2 === 1 ? moveNumberLabel(first + i) : null));
}
