// Win chance and accuracy. Win chance is Lichess's published curve
// (lila: WinPercent.scala); it drives the eval bar, the graph and the
// classification thresholds.
//
// Accuracy follows the shape of Lichess's AccuracyPercent.scala, but chess.com's
// CAPS model is proprietary and scores club games much lower, so its constants
// were fitted to the accuracies chess.com published for 68 of our games (club
// level, ~1350, rapid and bullet): mean absolute error 2.6 points per player,
// against 7.7 (and +4.4 on average) with Lichess's formula as is. See ACCURACY.
import type { Color, Score } from '../types.ts';

const MULTIPLIER = -0.00368208;

export const ACCURACY = {
  /**
   * Win-chance curve accuracy is measured on. Flatter than MULTIPLIER, like
   * chess.com's rating-aware expected points: at club level a +3 still gets
   * lost often, so losses in lopsided positions keep costing accuracy.
   */
  multiplier: -0.002,
  /** How fast a move's accuracy falls per win-chance point lost. */
  decay: 0.115,
  /**
   * Game accuracy is the harmonic mean of move accuracies, each counted as at
   * least this much, so one disaster weighs like chess.com and not like zero.
   */
  floor: 25,
};

export function cpOf(score: Score | undefined): number {
  if (!score) return 0;
  if (score.mate !== undefined) return score.mate > 0 ? 1000 : score.mate < 0 ? -1000 : 0;
  return Math.max(-1000, Math.min(1000, score.cp ?? 0));
}

/** Win chance (0-100) for White given a White-POV score. */
export function winPercent(score: Score | undefined, multiplier = MULTIPLIER): number {
  const cp = cpOf(score);
  return 50 + 50 * (2 / (1 + Math.exp(multiplier * cp)) - 1);
}

/** Accuracy (0-100) of a move from White-POV scores before it and after it. */
export function moveAccuracy(color: Color, before: Score | undefined, after: Score | undefined): number {
  const sign = color === 'white' ? 1 : -1;
  const diff = sign * (winPercent(before, ACCURACY.multiplier) - winPercent(after, ACCURACY.multiplier));
  if (diff <= 0) return 100;
  const raw = 103.1668100711649 * Math.exp(-ACCURACY.decay * diff) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

/** Game accuracy per color: a floored harmonic mean of its move accuracies. */
export function gameAccuracy(moves: Array<{ color: Color; accuracy: number }>): { white: number; black: number } {
  const of = (color: Color) => {
    const xs = moves.filter((m) => m.color === color);
    return xs.length ? xs.length / xs.reduce((s, m) => s + 1 / Math.max(ACCURACY.floor, m.accuracy), 0) : 0;
  };
  return { white: of('white'), black: of('black') };
}

export function formatScore(score: Score | undefined): string {
  if (!score) return '0.0';
  if (score.mate !== undefined) return score.mate === 0 ? '#' : `${score.mate > 0 ? '' : '-'}M${Math.abs(score.mate)}`;
  const v = (score.cp ?? 0) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`;
}
