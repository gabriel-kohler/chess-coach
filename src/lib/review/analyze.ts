import { Chess } from 'chess.js';
import { parseTimeControl } from '../chesscom/import.ts';
import { replay, START_FEN } from '../chess/replay.ts';
import { db } from '../db.ts';
import { EnginePool, type SearchLimits } from '../engine/stockfish.ts';
import { loadOpenings, nameOpening } from '../openings/book.ts';
import { ANALYSIS_VERSION, type GameAnalysis, type PositionEval, type StoredGame } from '../types.ts';
import { classifyGame } from './classify.ts';
import { gameAccuracy, winPercent } from './scoring.ts';

export interface AnalyzeOptions {
  depth: number;
  workers: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function isTerminal(fen: string): boolean {
  const c = new Chess(fen);
  return c.isGameOver();
}

export async function analyzeGame(game: StoredGame, opts: AnalyzeOptions): Promise<GameAnalysis> {
  const initial = game.initialFen ?? START_FEN;
  const plies = replay(game.moves, initial);
  const fens = [initial, ...plies.map((p) => p.fenAfter)];
  const limits: SearchLimits = { depth: opts.depth, movetime: 4000, multipv: 2 };

  const pool = new EnginePool(opts.workers);
  let lines;
  try {
    const todo = fens.map((f, i) => ({ f, i })).filter(({ f }) => !isTerminal(f));
    const results = await pool.analyseMany(todo.map((t) => t.f), limits, opts.onProgress, opts.signal);
    lines = new Array(fens.length).fill(null).map(() => [] as PositionEval['lines']);
    todo.forEach((t, k) => (lines[t.i] = results[k]!));
  } finally {
    pool.terminate();
  }
  const evals: PositionEval[] = fens.map((fen, i) => ({ fen, lines: lines[i]! }));

  const openings = await loadOpenings();
  const tc = parseTimeControl(game.timeControl);
  const moves = classifyGame({
    plies,
    evals,
    isBook: (epd) => epd in openings,
    clocks: game.clocks,
    baseTime: tc?.base,
    increment: tc?.increment,
  });

  // Position evals give the volatility weights; move accuracies come from the
  // classification so a "best" move always counts as 100.
  const whiteWins = [winPercent(evals[0]?.lines[0]), ...moves.map((m) => (m.color === 'white' ? m.winAfter : 100 - m.winAfter))];
  const accuracy = gameAccuracy(whiteWins, moves.map((m) => m.accuracy), moves.map((m) => m.color));
  const opening = nameOpening(openings, plies.map((p) => p.fenAfter));

  const analysis: GameAnalysis = {
    gameId: game.id,
    version: ANALYSIS_VERSION,
    depth: opts.depth,
    createdAt: Date.now(),
    evals,
    moves,
    accuracy,
    opening: opening?.name,
  };
  await db.analyses.put(analysis);
  return analysis;
}
