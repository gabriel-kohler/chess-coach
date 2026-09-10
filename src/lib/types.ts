export type Color = 'white' | 'black';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type Outcome = 'win' | 'loss' | 'draw';

export interface StoredGame {
  /** chess.com game uuid */
  id: string;
  url: string;
  archive: string; // "2026/09"
  timeClass: TimeClass;
  timeControl: string; // "600", "180+2", "1/86400"
  rated: boolean;
  endTime: number; // epoch ms
  /** Start of the game (PGN UTCDate + UTCTime), epoch ms. */
  startTime?: number;
  userColor: Color;
  userRating: number;
  oppRating: number;
  oppName: string;
  outcome: Outcome;
  /** chess.com result code for the user: win, checkmated, timeout, resigned, abandoned, ... */
  userResult: string;
  oppResult: string;
  eco?: string;
  opening?: string;
  moves: string[]; // SAN
  /** Seconds left on the mover's clock after each ply. */
  clocks: Array<number | null>;
  /** chess.com's own accuracies, present when the game was reviewed there. */
  ccAccuracy?: { white: number; black: number };
  initialFen?: string;
  pgn: string;
}

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export const CLASSIFICATIONS: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
];

/** Engine score from White's point of view. Exactly one of cp/mate is set. */
export interface Score {
  cp?: number;
  mate?: number;
}

export interface EngineLine extends Score {
  depth: number;
  /** UCI moves */
  pv: string[];
  /**
   * Only on the best line: the shallowest depth from which the engine kept
   * this move as its choice. Low = obvious, high = hard to find.
   */
  stableFrom?: number;
}

export interface PositionEval {
  fen: string;
  /** Best lines, best first, scores from White's point of view. */
  lines: EngineLine[];
}

export interface MoveReview {
  ply: number; // 1-based
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  classification: Classification;
  /** Win chance for the mover (0-100) before and after the move. */
  winBefore: number;
  winAfter: number;
  accuracy: number;
  bestUci?: string;
  bestSan?: string;
  /** Engine line after the best move, in UCI, starting with the best move. */
  bestLine?: string[];
  scoreAfter: Score;
  clock?: number | null;
  timeSpent?: number | null;
  /** Win chance lost against the engine's choice (mover's view). */
  loss?: number;
  /** How much worse the second-best move was (win-chance points). */
  secondGap?: number;
  /** Depth at which the engine settled on the best move here. */
  difficulty?: number;
  /** Depth at which the engine settled on the opponent's best reply. */
  punishDepth?: number;
  tags?: MoveTag[];
}

/**
 * Teaching labels. obvious-miss: a short, concrete tactic the engine sees
 * almost immediately and you did not play. obvious-blunder: your move allowed
 * one. only-move / hard-find: you found the single good move, or a deep one.
 */
export type MoveTag = 'obvious-miss' | 'obvious-blunder' | 'only-move' | 'hard-find';

/** Bumped when the analysis format or scoring changes; older analyses get redone. */
export const ANALYSIS_VERSION = 3;
/**
 * Oldest version whose engine lines are still valid: those only get their
 * classification and accuracy recomputed, without running the engine again.
 * v3: accuracy calibrated to chess.com, chess.com's book, stricter "great".
 */
export const RESCORABLE_VERSION = 2;

export interface GameAnalysis {
  gameId: string;
  version?: number;
  depth: number;
  createdAt: number;
  evals: PositionEval[]; // index = ply (0 = initial position)
  moves: MoveReview[];
  accuracy: { white: number; black: number };
  /** Estimated performance rating for each side, from accuracy. */
  opening?: string;
}

export interface Glicko {
  rating: number;
  rd: number;
  vol: number;
}

export interface ThemeStat extends Glicko {
  attempts: number;
  solved: number;
  lastAt: number;
}

export interface TacticsState {
  rating: Glicko;
  themes: Record<string, ThemeStat>;
  placementDone: boolean;
  /** Rolling record of the last attempts on NEW puzzles, true = solved. */
  recent: boolean[];
  /** Difficulty shift (rating points) set by the success-rate controller. */
  stretch: number;
  /** Rating history, one point per day with activity. */
  history: Array<{ day: string; rating: number }>;
  updatedAt: number;
}

export type PuzzleSource = 'lichess' | 'mine';

export interface Puzzle {
  id: string;
  source: PuzzleSource;
  /** Position before the setup move (Lichess format) or before the solution (own games). */
  fen: string;
  /** UCI line. For Lichess puzzles the first move is the opponent's setup move. */
  moves: string[];
  rating: number;
  themes: string[];
  popularity?: number;
  plays?: number;
  /** For own-game puzzles: link back to the game and ply. */
  gameId?: string;
  ply?: number;
  note?: string;
  tags?: MoveTag[];
}

export interface PuzzleAttempt {
  id?: number;
  puzzleId: string;
  source: PuzzleSource;
  at: number;
  solved: boolean;
  timeMs: number;
  puzzleRating: number;
  ratingBefore: number;
  ratingAfter: number;
  themes: string[];
  mode: 'new' | 'review' | 'mine' | 'placement';
}

/** Spaced repetition card for a puzzle that was failed (or an own-game mistake). */
export interface PuzzleCard {
  id: string; // puzzle id
  puzzle: Puzzle;
  due: number;
  interval: number; // days
  reps: number; // consecutive successful reviews
  lapses: number;
  createdAt: number;
  lastAt: number;
  mastered: boolean;
}

export interface RepertoireCard {
  key: string; // `${side}|${epd}`
  side: Color;
  epd: string;
  due: number;
  interval: number; // days
  reps: number;
  lapses: number;
  lastAt: number;
}

export interface ArchiveMeta {
  url: string;
  month: string; // "2026/09"
  fetchedAt: number;
  complete: boolean;
  count: number;
}
