// The two sessions: Treinar (once a day, the long one) and Aquecer (five
// minutes before games). Every number of the composition is here.
export const TRAINING = {
  /** Bumped when the stored session's shape changes: an older one is rebuilt. */
  version: 1,
  /** Recommended: a normal day's reviews, 5 to 8 new mistakes, ~10 puzzles, 3 to 5 lines, an endgame. */
  dailyMinutes: 30,
  dailyChoices: [20, 30, 45, 60],
  warmupMinutes: 5,
  moreMinutes: 10,
  /** Shares of the daily budget. Reviews at most half; the rest is new material. */
  reviewShare: 0.5,
  openingsShare: 0.15,
  tacticsMinShare: 0.15,
  endgameMs: 3 * 60_000,
  /** An endgame comes in when at least this share of your lost points happens in endgames. */
  endgameMinShare: 0.2,
  /** A new position usually comes back within the session (its 10-minute step). */
  newRepeatFactor: 1.6,
  /** Due repertoire positions one review line is counted for. */
  repPerLine: 3,
  /** New opponent mistakes to punish a day (Aberturas > Punir), with their own time on top of the openings'. */
  punishPerDay: 3,
  /** A warm-up left for longer than this is stale: the next one starts over. */
  warmupResumeMs: 30 * 60_000,
  warmupPuzzles: { min: 3, max: 6 },
  /** Time per step on top of the thinking: reading the verdict, the animations. */
  overheadMs: { best: 15_000, seq: 20_000, puzzle: 10_000, rep: 5_000 },
  defaults: { puzzleMs: 25_000, repLineMoves: 6, opponentMoveMs: 420 },
  /** Your median time on a puzzle, held inside this range for the plan. */
  puzzleMsClamp: [15_000, 90_000] as [number, number],
  /** A step open longer than this counts this long (a break, a walk away). */
  maxStepMs: 10 * 60_000,
  openings: { deviationMinGames: 2, deviationShrink: 5, chapterMinGames: 8, chapterShrink: 10 },
  endgame: { firmSuccesses: 3, firmRate: 0.6, restDays: 2 },
};
