// Every number the position trainer uses, in one place.
export const POSITIONS = {
  /** A move becomes a card when it lost at least this many win-chance points. */
  minLoss: 5,
  /** Up to this loss a move counts as right (Best or Excellent). */
  goodLoss: 2,
  /** Above this loss the first attempt is Again. */
  againLoss: 5,
  /** Right but slower than this multiple of the expected time: Hard. */
  slowFactor: 2,
  /** The exact best move faster than this multiple of the expected time: Easy. */
  fastFactor: 0.5,
  /** Engine depth where the best move settled: up to 6 easy, up to 12 medium, above hard. */
  bucketEasyMax: 6,
  bucketMediumMax: 12,
  defaultExpectedMs: { easy: 10_000, medium: 20_000, hard: 40_000 },
  minTimingSamples: 20,
  timingWindow: 100,
  expectedClampMs: [5_000, 120_000] as const,
  /** Skip sources where you were still at or above this win chance after your move. */
  stillWinning: 90,
  scoreDepth: 16,
  engineTimeoutMs: 25_000,
  /** Learning cards due within this window may be shown early when nothing else is left. */
  learnAheadMs: 20 * 60_000,
  maxNewPerGame: 2,
  /** Focuses look back this far; how many games they need is RENEWAL.focusMinBlock. */
  focusWindowDays: 90,
  convertMin: 70,
  defendMax: 30,
  lowClockShare: 0.1,
  fastShare: 0.5,
  severity: { blunder: 20, mistake: 10, inaccuracy: 5 },
} as const;

/** Bump when move scoring changes: it clears the cached engine verdicts. */
export const SCORE_VERSION = 1;
/** Bump when the grading rule changes: stored in every review log. */
export const GRADING_VERSION = 1;
