// The rule every repertoire move follows, shared by the offline build
// (scripts/build-repertoire.mjs) and the gap suggestions in the app: your move
// may lose less than 5 win-chance points against the engine's best. From 5 it
// is an inaccuracy, from 10 a mistake.
export const INACCURACY = 5;
export const MISTAKE = 10;

/** Lichess's win chance for a score in centipawns, clamped at ±1000. */
export function winPct(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
}

/** A score from the side to move: centipawns, a mate as ±(10000 - n). */
export function moverScore(line: { cp?: number; mate?: number }): number {
  if (line.mate !== undefined) return line.mate > 0 ? 10000 - line.mate : -10000 - line.mate;
  return line.cp ?? 0;
}

/** The same, from an engine line scored from White's side (the app's engine). */
export function moverScoreFromWhite(line: { cp?: number; mate?: number }, whiteToMove: boolean): number {
  const sign = whiteToMove ? 1 : -1;
  return moverScore(line.mate !== undefined ? { mate: sign * line.mate } : { cp: sign * (line.cp ?? 0) });
}

/** Win-chance points a move gives up against the best, both scored from the side to move. */
export function winDrop(best: number, ours: number): number {
  return winPct(best) - winPct(ours);
}

export function acceptable(best: number, ours: number): boolean {
  return winDrop(best, ours) < INACCURACY;
}
