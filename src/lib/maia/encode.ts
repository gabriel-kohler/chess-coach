// Maia-2 input encoding and output decoding, ported from maia2-js
// (npm maia2-js 1.0.3, MIT), itself a port of CSSLab's Maia-2 (MIT,
// github.com/CSSLab/maia2). The move list in moves.json is theirs: its order
// is the order of the model's output logits.
//
// The model always sees White to move: a Black-to-move position is mirrored
// (ranks flipped, colors swapped) and its moves are mirrored back.
import { Chess } from 'chess.js';
import MOVES from './moves.json' with { type: 'json' };

export const NUM_CHANNELS = 18;
export const BOARD_SIZE = 8;
export const ALL_MOVES: readonly string[] = MOVES as string[];

const MOVE_INDEX = new Map<string, number>(ALL_MOVES.map((m, i) => [m, i]));
const PIECE_CHANNEL: Record<string, number> = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

export function mirrorSquare(square: string): string {
  return `${square[0]}${9 - Number(square[1])}`;
}

export function mirrorMove(uci: string): string {
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + uci.slice(4);
}

export function moveIndex(uci: string): number | undefined {
  return MOVE_INDEX.get(uci);
}

/** Elo bucket: 0 below 1100, then one per 100 points, 10 from 2000 up. */
export function eloToCategory(elo: number): number {
  if (elo < 1100) return 0;
  if (elo >= 2000) return 10;
  return Math.floor((elo - 1100) / 100) + 1;
}

/** The position with ranks flipped and colors swapped (White to move). */
export function mirrorFen(fen: string): string {
  const [board, turn, castling, ep, half, full] = fen.split(' ') as [string, string, string, string, string?, string?];
  const rows = board.split('/').reverse().map((row) => [...row].map((c) => (/[a-z]/.test(c) ? c.toUpperCase() : c.toLowerCase())).join(''));
  let cast = '-';
  if (castling !== '-') {
    cast = '';
    if (castling.includes('k')) cast += 'K';
    if (castling.includes('q')) cast += 'Q';
    if (castling.includes('K')) cast += 'k';
    if (castling.includes('Q')) cast += 'q';
    cast ||= '-';
  }
  return `${rows.join('/')} ${turn === 'w' ? 'b' : 'w'} ${cast} ${ep === '-' ? '-' : mirrorSquare(ep)} ${half ?? 0} ${full ?? 1}`;
}

/** 18 x 8 x 8 planes, row = rank index (0 = rank 1), column = file. */
export function boardToTensor(chess: Chess): Float32Array {
  const t = new Float32Array(NUM_CHANNELS * BOARD_SIZE * BOARD_SIZE);
  const set = (ch: number, row: number, col: number) => (t[ch * 64 + row * 8 + col] = 1);
  const fill = (ch: number) => t.fill(1, ch * 64, ch * 64 + 64);
  const board = chess.board();
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const p = board[7 - rank]![file];
      if (p) set(PIECE_CHANNEL[p.type]! + (p.color === 'w' ? 0 : 6), rank, file);
    }
  }
  if (chess.turn() === 'w') fill(12);
  const [, , castling, ep] = chess.fen().split(' ');
  if (castling!.includes('K')) fill(13);
  if (castling!.includes('Q')) fill(14);
  if (castling!.includes('k')) fill(15);
  if (castling!.includes('q')) fill(16);
  if (ep && ep !== '-') set(17, Number(ep[1]) - 1, ep.charCodeAt(0) - 97);
  return t;
}

export interface Encoded {
  tensor: Float32Array;
  mirrored: boolean;
  /** Legal moves of the real position with their index in the model output. */
  legal: Array<{ uci: string; index: number }>;
}

export function encodePosition(fen: string): Encoded {
  const real = new Chess(fen);
  const mirrored = real.turn() === 'b';
  const seen = mirrored ? new Chess(mirrorFen(fen), { skipValidation: true }) : real;
  const legal: Encoded['legal'] = [];
  for (const m of real.moves({ verbose: true })) {
    const uci = m.from + m.to + (m.promotion ?? '');
    const index = moveIndex(mirrored ? mirrorMove(uci) : uci);
    if (index !== undefined) legal.push({ uci, index });
  }
  return { tensor: boardToTensor(seen), mirrored, legal };
}

export interface HumanMove {
  uci: string;
  /** Probability that a player of that rating picks the move (0-1). */
  p: number;
}

/** Softmax over the legal moves only, most likely first. */
export function policyFromLogits(logits: ArrayLike<number>, legal: Encoded['legal']): HumanMove[] {
  if (!legal.length) return [];
  let max = -Infinity;
  for (const { index } of legal) max = Math.max(max, logits[index]!);
  const exps = legal.map(({ index }) => Math.exp(logits[index]! - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return legal.map(({ uci }, i) => ({ uci, p: exps[i]! / sum })).sort((a, b) => b.p - a.p);
}
