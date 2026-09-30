// Cards of the position trainer: positions from your analysed games where
// your move lost 5 or more win-chance points.
import type { SrsCardBase } from '../srs/types.ts';
import type { Classification, Color, Score, TimeClass } from '../types.ts';

/** An engine line as stored on a card. `score` is from White's point of view. */
export interface StoredLine {
  pv: string[];
  score: Score;
  depth: number;
}

export type FocusCategory =
  | 'opening'
  | 'middlegame'
  | 'endgame'
  | 'convert'
  | 'balanced'
  | 'defend'
  | 'fast'
  | 'lowClock'
  | 'blunder'
  | 'mistake'
  | 'inaccuracy'
  | 'miss';

/** One time you reached the position in a game. */
/** The two Posições modes. */
export type PositionKind = 'best' | 'seq';

export interface SourceRef {
  gameId: string;
  ply: number;
  endTime: number;
  oppName: string;
  timeClass: TimeClass;
  /** The move you played there. */
  uci: string;
  san: string;
  loss: number;
  classification: Classification;
  /** Engine line after your move: the punishment. Starts with the opponent's move. */
  reply: StoredLine | null;
  /** Analysis signature the source was derived from. */
  sig: string;
}

export interface DerivedSource extends SourceRef {
  epd: string;
  fen: string;
  color: Color;
  prevMove: { from: string; to: string } | null;
  best: StoredLine & { uci: string; san: string };
  second: (StoredLine & { uci: string }) | null;
  stableFrom: number | null;
  categories: FocusCategory[];
}

export interface ScoredMove {
  loss: number;
  best: StoredLine & { uci: string };
  reply: StoredLine | null;
}

export interface BestMoveCard extends SrsCardBase {
  kind: 'best';
  epd: string;
  fen: string;
  color: Color;
  prevMove: DerivedSource['prevMove'];
  best: DerivedSource['best'];
  second: DerivedSource['second'];
  stableFrom: number | null;
  bucket: 'easy' | 'medium' | 'hard';
  /** Sum of the loss over every game that reached the position. */
  totalLoss: number;
  categories: FocusCategory[];
  /** Newest game first. */
  sources: SourceRef[];
  sig: string;
  /** Engine verdicts on moves you tried here, reused until the sources change. */
  scored?: Record<string, ScoredMove>;
}

/** What a move is scored against: a card's position, or a position inside a sequence. */
export interface ScoreTarget {
  fen: string;
  color: Color;
  prevMove: { from: string; to: string } | null;
  best: StoredLine & { uci: string; san: string };
  second: (StoredLine & { uci: string }) | null;
  sources?: SourceRef[];
  scored?: Record<string, ScoredMove>;
}

/** One line of a position's sequences (see sequence.ts): a card of its own. */
export interface SequenceCard extends SrsCardBase {
  kind: 'seq';
  /** The best-move card of the same position. */
  rootId: string;
  epd: string;
  fen: string;
  color: Color;
  prevMove: DerivedSource['prevMove'];
  best: DerivedSource['best'];
  second: DerivedSource['second'];
  stableFrom: number | null;
  bucket: 'easy' | 'medium' | 'hard';
  totalLoss: number;
  categories: FocusCategory[];
  sources: SourceRef[];
  branch: import('./sequence.ts').SeqBranch;
  /** Rules and Maia offset the line was built with. */
  built: { version: number; offset: number; at: number };
  /** Engine verdicts on moves tried at the first position of the line. */
  scored?: Record<string, ScoredMove>;
}

export interface MoveScore {
  uci: string;
  loss: number;
  exact: boolean;
  source: 'best' | 'mate' | 'stored' | 'game' | 'engine';
  best: StoredLine & { uci: string };
  /** Opponent's best answer to the move, when known. */
  reply: StoredLine | null;
}

export interface FocusShare {
  /** Share of the win-chance points you lost (0-1). */
  share: number;
  /** Moves with a loss of 5 points or more. */
  count: number;
  /** 90% interval of the share, by resampling the games. */
  lo: number;
  hi: number;
}

/** A focus that moved beyond its margin since a date. */
export interface FocusShift {
  from: number;
  to: number;
  /** 90% interval of the difference; it never contains zero. */
  lo: number;
  hi: number;
}

export interface FocusWeights {
  version: number;
  computedAt: number;
  games: number;
  /** 90 when the recent run of games was used, null for every analysed game (provisional). */
  windowDays: number | null;
  totalLoss: number;
  /** Your most recent games analysed in a row: the numbers are firm from 30 on. */
  block: number;
  provisional: boolean;
  shares: Record<FocusCategory, FocusShare>;
  /** Focuses that moved beyond the margin since the first day of the month. */
  change?: { since: number; shifts: Partial<Record<FocusCategory, FocusShift>> };
}
