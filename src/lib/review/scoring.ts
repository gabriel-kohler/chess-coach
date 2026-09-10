// Win chance and accuracy, using the formulas Lichess publishes
// (lila: WinPercent.scala / AccuracyPercent.scala). chess.com's CAPS model is
// proprietary; these track it closely enough to compare games.
import type { Score } from '../types.ts';

const MULTIPLIER = -0.00368208;

export function cpOf(score: Score | undefined): number {
  if (!score) return 0;
  if (score.mate !== undefined) return score.mate > 0 ? 1000 : score.mate < 0 ? -1000 : 0;
  return Math.max(-1000, Math.min(1000, score.cp ?? 0));
}

/** Win chance (0-100) for White given a White-POV score. */
export function winPercent(score: Score | undefined): number {
  const cp = cpOf(score);
  return 50 + 50 * (2 / (1 + Math.exp(MULTIPLIER * cp)) - 1);
}

/** Accuracy (0-100) of a move given the mover's win chance before and after. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const diff = winBefore - winAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

function stdDev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

/**
 * Game accuracy per color: the mean of a volatility-weighted mean and a
 * harmonic mean of move accuracies, as Lichess computes it.
 * `whiteWins[i]` is White's win chance after ply i (index 0 = start).
 * `moveAccuracies[i]`, when given, overrides the accuracy of ply i+1.
 */
export function gameAccuracy(whiteWins: number[], moveAccuracies?: number[], colors?: Array<'white' | 'black'>): { white: number; black: number } {
  const moves = whiteWins.length - 1;
  if (moves < 1) return { white: 0, black: 0 };
  const windowSize = Math.max(2, Math.min(8, Math.floor(moves / 10)));
  const windows: number[][] = [];
  const pad = Math.min(windowSize, whiteWins.length) - 2;
  for (let i = 0; i < pad; i++) windows.push(whiteWins.slice(0, windowSize));
  for (let i = 0; i + windowSize <= whiteWins.length; i++) windows.push(whiteWins.slice(i, i + windowSize));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));

  const acc: Record<'white' | 'black', Array<[number, number]>> = { white: [], black: [] };
  for (let i = 0; i < moves; i++) {
    const prev = whiteWins[i]!;
    const next = whiteWins[i + 1]!;
    // Games from a set-up position can start with Black to move.
    const white = colors ? colors[i] === 'white' : i % 2 === 0;
    const a = moveAccuracies?.[i] ?? (white ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next));
    acc[white ? 'white' : 'black'].push([a, weights[i] ?? 1]);
  }
  const combine = (xs: Array<[number, number]>) => {
    if (!xs.length) return 0;
    const wsum = xs.reduce((s, [, w]) => s + w, 0);
    const weighted = xs.reduce((s, [a, w]) => s + a * w, 0) / wsum;
    const harmonic = xs.length / xs.reduce((s, [a]) => s + 1 / Math.max(1, a), 0);
    return (weighted + harmonic) / 2;
  };
  return { white: combine(acc.white), black: combine(acc.black) };
}

export function formatScore(score: Score | undefined): string {
  if (!score) return '0.0';
  if (score.mate !== undefined) return score.mate === 0 ? '#' : `${score.mate > 0 ? '' : '-'}M${Math.abs(score.mate)}`;
  const v = (score.cp ?? 0) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`;
}
