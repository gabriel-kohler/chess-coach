// Maia-2 was trained on Lichess games, with Lichess ratings; your ratings are
// chess.com's. Instead of guessing a conversion, measure it: how often is the
// move your opponents really played among Maia's first 1 and 3, when their
// chess.com rating is shifted by each offset? The best offset wins.
import { Chess } from 'chess.js';
import { tryMove } from '../chess/replay.ts';
import type { StoredGame } from '../types.ts';
import type { HumanMove, MaiaQuery } from './client.ts';

export const CALIBRATION_KEY = 'maia:calibration';
export const OFFSETS = [0, 100, 200, 300, 400];
/** Used until a calibration exists: a common chess.com to Lichess gap at club level. */
export const DEFAULT_OFFSET = 200;
/** Maia-2 is weak in the opening (it gave 1.Na3 8% at the start), so skip it. */
const MIN_PLY = 20;

export interface CalibrationSample {
  fen: string;
  /** The move the opponent actually played. */
  uci: string;
  oppRating: number;
  userRating: number;
}

export interface OffsetResult {
  offset: number;
  top1: number;
  top3: number;
}

export interface Calibration {
  offset: number;
  n: number;
  at: number;
  results: OffsetResult[];
}

/** Opponent moves after the opening, spread evenly over your recent serious games. */
export function calibrationSamples(games: StoredGame[], max = 300): CalibrationSample[] {
  const pool = games
    .filter((g) => (g.timeClass === 'rapid' || g.timeClass === 'blitz') && !g.initialFen && g.moves.length > MIN_PLY + 6)
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, 120);
  const perGame = Math.max(1, Math.ceil(max / Math.max(1, pool.length)));
  const out: CalibrationSample[] = [];
  for (const g of pool) {
    const chess = new Chess();
    const oppColor = g.userColor === 'white' ? 'b' : 'w';
    const picks: CalibrationSample[] = [];
    for (let ply = 0; ply < g.moves.length; ply++) {
      const fen = chess.fen();
      const mv = tryMove(chess, g.moves[ply]!);
      if (!mv) break;
      if (ply >= MIN_PLY && mv.color === oppColor) picks.push({ fen, uci: mv.lan, oppRating: g.oppRating, userRating: g.userRating });
    }
    // Evenly spaced, so one long game does not dominate.
    const step = Math.max(1, Math.floor(picks.length / perGame));
    for (let i = 0; i < picks.length && out.length < max; i += step) out.push(picks[i]!);
    if (out.length >= max) break;
  }
  return out;
}

export function hitRates(predictions: HumanMove[][], actual: string[]): { top1: number; top3: number } {
  let top1 = 0;
  let top3 = 0;
  predictions.forEach((p, i) => {
    const rank = p.findIndex((m) => m.uci === actual[i]);
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 3) top3++;
  });
  const n = Math.max(1, predictions.length);
  return { top1: top1 / n, top3: top3 / n };
}

/** Best by top-3, then top-1. */
export function bestOffset(results: OffsetResult[]): number {
  return [...results].sort((a, b) => b.top3 - a.top3 || b.top1 - a.top1)[0]?.offset ?? DEFAULT_OFFSET;
}

export async function calibrate(
  samples: CalibrationSample[],
  policies: (items: MaiaQuery[]) => Promise<HumanMove[][]>,
  onProgress?: (done: number, total: number) => void,
  offsets = OFFSETS,
  now = Date.now(),
): Promise<Calibration> {
  const results: OffsetResult[] = [];
  const total = offsets.length * samples.length;
  let done = 0;
  for (const offset of offsets) {
    const preds: HumanMove[][] = [];
    for (let i = 0; i < samples.length; i += 32) {
      const chunk = samples.slice(i, i + 32);
      preds.push(...(await policies(chunk.map((s) => ({ fen: s.fen, eloSelf: s.oppRating + offset, eloOppo: s.userRating + offset })))));
      done += chunk.length;
      onProgress?.(done, total);
    }
    results.push({ offset, ...hitRates(preds, samples.map((s) => s.uci)) });
  }
  return { offset: bestOffset(results), n: samples.length, at: now, results };
}
