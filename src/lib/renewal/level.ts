// The level review: when your rapid rating reaches a new band of 100 (1500,
// 1600), the app puts your games of the new band next to the ones before it:
// focuses with their margins, the Maia calibration, the repertoire gaps.
import { FOCUS_CATEGORIES } from '../positions/focus.ts';
import type { FocusCategory, FocusWeights } from '../positions/types.ts';

export const bandOf = (rating: number) => Math.floor(rating / 100) * 100;

/** Points under the band a game must fall to for a later climb to count as a new crossing. */
const HYSTERESIS = 50;

export interface CalibrationSummary {
  offset: number;
  top3: number | null;
  n: number;
  at: number;
}

export interface LevelReport {
  band: number;
  /** Rapid rating when the band was detected. */
  rating: number;
  detectedAt: number;
  /** End of the game that brought you into the band: the band's games start there. */
  bandStart: number;
  version: number;
  /** Your focuses when you reached the band, frozen. */
  before: FocusWeights;
  calibrationBefore: CalibrationSummary | null;
  /** Measured on games of the new band, once they give enough of the opponents' moves. */
  calibrationAfter?: CalibrationSummary;
}

export interface LevelState {
  highestBand: number;
  /** The stats show a new band before the archive has its games: checked again on the next sync. */
  pending: number | null;
  reports: LevelReport[];
  /** The last band whose report you opened. */
  seen?: number;
}

export interface RatedGame {
  endTime: number;
  timeClass: string;
  rated: boolean;
  userRating: number;
}

/**
 * Where the band starts: your first rated rapid game at the band or above
 * since the last one more than 50 points under it. Rapid only (blitz ratings
 * are on another scale); a dip back to 1495 does not restart the band, a
 * fall to 1440 does. Null until a game shows the band (the stats can be ahead
 * of the monthly archive).
 */
export function bandStartOf(games: RatedGame[], band: number): number | null {
  const rapid = games.filter((g) => g.rated && g.timeClass === 'rapid').sort((a, b) => a.endTime - b.endTime);
  let start: number | null = null;
  for (const g of rapid) {
    if (g.userRating < band - HYSTERESIS) start = null;
    else if (g.userRating >= band && start === null) start = g.endTime;
  }
  return start;
}

export type LevelStep =
  | { kind: 'init'; state: LevelState }
  | { kind: 'none' }
  | { kind: 'pending'; state: LevelState }
  | { kind: 'crossed'; band: number; bandStart: number };

/** What a sync means for the level review, from the rapid rating in the account's stats. */
export function levelStep(state: LevelState | null, rating: number | undefined, games: RatedGame[]): LevelStep {
  if (!rating) return { kind: 'none' };
  const band = bandOf(rating);
  // The first time only records where you are: no report for where you started.
  if (!state) return { kind: 'init', state: { highestBand: band, pending: null, reports: [] } };
  if (band <= state.highestBand) return state.pending !== null ? { kind: 'pending', state: { ...state, pending: null } } : { kind: 'none' };
  const bandStart = bandStartOf(games, band);
  if (bandStart === null) return state.pending === band ? { kind: 'none' } : { kind: 'pending', state: { ...state, pending: band } };
  return { kind: 'crossed', band, bandStart };
}

export interface FocusComparison {
  category: FocusCategory;
  before: number;
  after: number;
  /** Moved beyond the combined margin of the two periods (they share no game). */
  changed: boolean;
}

/** Before and after, per focus. Nothing counts as changed while either side is provisional. */
export function compareFocus(before: FocusWeights, after: FocusWeights): FocusComparison[] {
  const firm = !before.provisional && !after.provisional;
  return FOCUS_CATEGORIES.map((c) => {
    const a = before.shares[c];
    const b = after.shares[c];
    const ha = (a.hi - a.lo) / 2;
    const hb = (b.hi - b.lo) / 2;
    return { category: c, before: a.share, after: b.share, changed: firm && Math.abs(b.share - a.share) > Math.sqrt(ha * ha + hb * hb) };
  });
}
