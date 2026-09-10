// Move classification in the spirit of chess.com's Classification V2.
// Thresholds are in win-chance points (chess.com publishes them as expected
// points): best 0, excellent <= 2, good <= 5, inaccuracy <= 10,
// mistake <= 20, blunder > 20. Brilliant, great, miss and book are layered on
// top, plus teaching tags based on how deep the engine had to look.
import { Chess } from 'chess.js';
import { epdOf, materialBalance, uciToSan, type PlyInfo } from '../chess/replay.ts';
import { payoff, perpetualLine } from '../explain/facts.ts';
import { enPrise, VALUE } from '../explain/motifs.ts';
import type { Classification, Color, EngineLine, MoveReview, MoveTag, PositionEval, Score } from '../types.ts';
import { moveAccuracy, winPercent } from './scoring.ts';

export interface ClassifyInput {
  plies: PlyInfo[];
  evals: PositionEval[]; // evals[i] = position after ply i, evals[0] = start
  /**
   * Plies chess.com counts as book (see bookPliesFromEcoUrl). When known,
   * exactly these are book; otherwise `isBook` decides position by position.
   */
  bookPlies?: number;
  isBook?: (epd: string) => boolean;
  clocks?: Array<number | null>;
  increment?: number;
  baseTime?: number;
}

const THRESHOLDS: Array<[number, Classification]> = [
  [2, 'excellent'],
  [5, 'good'],
  [10, 'inaccuracy'],
  [20, 'mistake'],
];

/** Depth at or below which a tactic counts as "obvious" for a club player. */
export const OBVIOUS_DEPTH = 6;
/** Depth at or above which finding the best move is genuinely hard. */
export const HARD_DEPTH = 12;

function lineScore(line: EngineLine | undefined): Score | undefined {
  if (!line) return undefined;
  return line.mate !== undefined ? { mate: line.mate } : { cp: line.cp };
}

/** Win chance for `color` given a White-POV score. */
function winFor(color: Color, score: Score | undefined): number {
  const w = winPercent(score);
  return color === 'white' ? w : 100 - w;
}

/** Score of the position after a ply, handling mate and stalemate on the board. */
function terminalScore(fenAfter: string, mover: Color): Score | undefined {
  const chess = new Chess(fenAfter);
  if (chess.isCheckmate()) return { mate: mover === 'white' ? 1 : -1 };
  if (chess.isDraw() || chess.isStalemate()) return { cp: 0 };
  return undefined;
}

/**
 * A sacrifice leaves material the opponent can win: either the engine's line
 * shows the mover two points down after the reply and the mover's next move,
 * or a static exchange on one of the mover's pieces loses at least two points
 * (net of what the move itself captured). The line stops before the mover's
 * second move, so a sacrifice coming next (Bxe7 Nxe7 Bxh7+) isn't credited
 * to the move before it.
 */
function isSacrifice(ply: PlyInfo, after: PositionEval | undefined, mover: Color): boolean {
  const sign = mover === 'white' ? 1 : -1;
  const before = sign * materialBalance(ply.fenBefore);
  const pv = after?.lines[0]?.pv ?? [];
  const chess = new Chess(ply.fenAfter);
  let worst = sign * materialBalance(ply.fenAfter);
  for (const uci of pv.slice(0, 2)) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    worst = Math.min(worst, sign * materialBalance(chess.fen()));
  }
  const final = sign * materialBalance(chess.fen());
  if (worst <= before - 2 && final <= before - 2) return true;

  // Net of the capture wherever the hanging piece stands: taking a queen and
  // leaving a rook en prise is a win, not a sacrifice.
  const color = mover === 'white' ? 'w' : 'b';
  const captured = ply.captured ? VALUE[ply.captured]! : 0;
  return enPrise(ply.fenAfter, color).some((p) => p.loss - captured >= 2);
}

/**
 * A concrete gain (mate, promotion, material or a perpetual check) for the
 * side to move within the first `plies` of a line, material counted from
 * `baseFen` (see `payoff`).
 */
function quickPayoff(fen: string, line: EngineLine | undefined, plies = 4, baseFen = fen): boolean {
  if (!line?.pv.length) return false;
  if (line.mate !== undefined && Math.abs(line.mate) <= 2) return true;
  if (perpetualLine(fen, { ...line, pv: line.pv.slice(0, plies + 4) })) return true;
  const p = payoff(fen, line.pv, plies + 2, baseFen);
  return !!p && p.index < plies && (p.kind !== 'material' || Math.abs(p.swing) >= 2);
}

export function classifyGame(input: ClassifyInput): MoveReview[] {
  const { plies, evals, isBook, clocks, bookPlies } = input;
  const reviews: MoveReview[] = [];
  let inBook = !bookPlies && !!isBook;

  for (let i = 0; i < plies.length; i++) {
    const ply = plies[i]!;
    const mover: Color = ply.fenBefore.split(' ')[1] === 'w' ? 'white' : 'black';
    const before = evals[i];
    const after = evals[i + 1];
    const bestLine = before?.lines[0];
    const secondLine = before?.lines[1];
    const bestUci = bestLine?.pv[0];

    const scoreBefore = lineScore(bestLine) ?? { cp: 0 };
    const playedLine = before?.lines.find((l) => l.pv[0] === ply.uci);
    const scoreAfter = terminalScore(ply.fenAfter, mover) ?? lineScore(after?.lines[0]) ?? lineScore(playedLine) ?? scoreBefore;

    const winBefore = winFor(mover, scoreBefore);
    // Prefer the parent search for the played move when it has it: same
    // search, same depth, so best-vs-played is compared fairly.
    const scoreForLoss = ply.uci === bestUci ? scoreBefore : playedLine ? lineScore(playedLine)! : scoreAfter;
    const winAfter = winFor(mover, scoreAfter);
    const loss = Math.max(0, winBefore - winFor(mover, scoreForLoss));
    const legalMoves = new Chess(ply.fenBefore).moves().length;
    const secondGap = legalMoves > 1 && secondLine && bestLine ? winFor(mover, lineScore(bestLine)) - winFor(mover, lineScore(secondLine)) : undefined;

    let cls: Classification = 'blunder';
    if (ply.uci === bestUci || loss < 0.5) cls = 'best';
    else {
      for (const [limit, c] of THRESHOLDS) {
        if (loss <= limit) { cls = c; break; }
      }
    }

    // Book: chess.com's opening line when we know it, otherwise every move so
    // far is a known opening position.
    if (bookPlies) {
      if (i < bookPlies) cls = 'book';
    } else if (inBook) {
      if (isBook!(epdOf(ply.fenAfter)) && loss <= 5) cls = 'book';
      else inBook = false;
    }

    const prev = reviews[i - 1];
    const opponentErred = !!prev && (prev.classification === 'mistake' || prev.classification === 'blunder' || prev.classification === 'miss');
    // Our win chance before the opponent's last move.
    const winBeforeTheirError = prev ? 100 - prev.winBefore : winBefore;

    if (cls !== 'book') {
      if ((cls === 'best' || cls === 'excellent') && winBefore < 90 && winAfter >= 50 && isSacrifice(ply, after, mover)) {
        cls = 'brilliant';
      } else if (cls === 'best' && secondGap !== undefined && secondGap >= 10 && !ply.captured && winBefore < 97 && winAfter >= 45) {
        // Great, as rare as on chess.com: the only good move, and one you had
        // to see. Captures and recaptures are natural candidates (they were
        // two thirds of the old "great" moves), and in a decided position
        // (mate on, or +9) nothing is critical any more.
        cls = 'great';
      }

      // Miss: the opponent just erred (or mate was on) and this move let it go.
      if ((cls === 'mistake' || cls === 'blunder' || cls === 'inaccuracy') && loss >= 10) {
        const hadMate = bestLine?.mate !== undefined && (mover === 'white' ? bestLine.mate > 0 : bestLine.mate < 0);
        const stillOk = prev ? winAfter >= winBeforeTheirError - 5 : false;
        if (hadMate || (opponentErred && stillOk)) cls = 'miss';
      }
    }

    // Teaching tags: how visible the missed idea or the punishment was.
    const tags: MoveTag[] = [];
    const difficulty = bestLine?.stableFrom;
    const punishDepth = after?.lines[0]?.stableFrom;
    if (loss >= 10) {
      if (difficulty !== undefined && difficulty <= OBVIOUS_DEPTH && quickPayoff(ply.fenBefore, bestLine)) tags.push('obvious-miss');
      if (punishDepth !== undefined && punishDepth <= OBVIOUS_DEPTH && quickPayoff(ply.fenAfter, after?.lines[0], 4, ply.fenBefore)) tags.push('obvious-blunder');
    } else if (cls === 'best' || cls === 'great' || cls === 'brilliant') {
      if (secondGap !== undefined && secondGap >= 10) tags.push('only-move');
      if (difficulty !== undefined && difficulty >= HARD_DEPTH && (secondGap ?? 0) >= 5) tags.push('hard-find');
    }

    let timeSpent: number | null = null;
    const clock = clocks?.[i] ?? null;
    if (clocks && clock !== null) {
      const prevClock = i >= 2 ? clocks[i - 2] : input.baseTime ?? null;
      if (prevClock !== null && prevClock !== undefined) timeSpent = Math.max(0, prevClock - clock + (input.increment ?? 0));
    }

    reviews.push({
      ply: i + 1,
      color: mover,
      san: ply.san,
      uci: ply.uci,
      fenBefore: ply.fenBefore,
      fenAfter: ply.fenAfter,
      classification: cls,
      winBefore,
      winAfter,
      accuracy: moveAccuracy(mover, scoreBefore, scoreForLoss),
      bestUci,
      bestSan: bestUci ? uciToSan(ply.fenBefore, bestUci) ?? undefined : undefined,
      bestLine: bestLine?.pv,
      scoreAfter,
      clock,
      timeSpent,
      loss,
      secondGap,
      difficulty,
      punishDepth,
      tags,
    });
  }
  return reviews;
}
