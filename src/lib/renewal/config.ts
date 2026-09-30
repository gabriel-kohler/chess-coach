// Every number of the renewal: what runs by itself after each sync, so the
// training keeps up with your games without anyone running a script.
export const RENEWAL = {
  /** Background analysis: one worker, a real fixed depth (no 4 s cut), a safety cap per position. */
  autoDepth: 16,
  autoWorkers: 1,
  autoSafetyMs: 30_000,
  /** Rated rapid and blitz games analysed at first; every new one after that. */
  backlogGames: 60,
  /** Focus margins: resamples over games, and the recent run of games they need. */
  focusBootstrap: 400,
  focusMinBlock: 30,
  /** Repertoire gaps: how far back, and how often an opponent must have played the move. */
  gapsDays: 180,
  gapsMinGames: 2,
  gapsSuggested: 5,
  suggestDepth: 18,
  suggestMultipv: 3,
  /** Maia is recalibrated when its calibration is older than this, with at least this many samples. */
  calibrationMaxAgeDays: 30,
  calibrationMinSamples: 50,
  /** A stale sync (older than this) runs on its own when the app opens. */
  syncEveryMs: 10 * 60_000,
} as const;

/** kv keys derived from the account's games: an account switch clears them. */
export const ACCOUNT_KEYS = {
  level: 'level:state',
  gapSuggestions: 'repertoire:gapSuggestions',
  backlogSince: 'renewal:backlogSince',
} as const;

/** Bump when the focus population or categories change: the order of new positions changes with them. */
export const FOCUS_VERSION = 1;
/** Bump when the gap rules change: cached suggestions are dropped. */
export const GAPS_VERSION = 1;
/** Bump when the level review changes: stored reports carry it. */
export const LEVEL_VERSION = 1;
