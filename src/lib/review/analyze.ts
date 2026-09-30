import { Chess } from 'chess.js';
import { bookPliesFromEcoUrl, parseTimeControl, pgnHeader } from '../chesscom/import.ts';
import { replay, START_FEN } from '../chess/replay.ts';
import { db, setKV } from '../db.ts';
import { EnginePool, type SearchLimits } from '../engine/stockfish.ts';
import { loadOpenings, nameOpening } from '../openings/book.ts';
import { ANALYSIS_VERSION, RESCORABLE_VERSION, type GameAnalysis, type PositionEval, type StoredGame } from '../types.ts';
import { classifyGame } from './classify.ts';
import { gameAccuracy } from './scoring.ts';

export interface AnalyzeOptions {
  depth: number;
  workers: number;
  /**
   * Time cap per position. The default 4 s keeps a manual analysis quick, but
   * on a busy machine it stops before the depth: the automatic analysis uses
   * a long safety cap instead, so its depth really is fixed.
   */
  movetime?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Awaited before each position: background work pausing while you train. */
  wait?: (signal?: AbortSignal) => Promise<void>;
}

function isTerminal(fen: string): boolean {
  const c = new Chess(fen);
  return c.isGameOver();
}

export async function analyzeGame(game: StoredGame, opts: AnalyzeOptions): Promise<GameAnalysis> {
  const initial = game.initialFen ?? START_FEN;
  const plies = replay(game.moves, initial);
  const fens = [initial, ...plies.map((p) => p.fenAfter)];
  const limits: SearchLimits = { depth: opts.depth, movetime: opts.movetime ?? 4000, multipv: 2 };

  const pool = new EnginePool(opts.workers);
  let lines;
  try {
    const todo = fens.map((f, i) => ({ f, i })).filter(({ f }) => !isTerminal(f));
    const results = await pool.analyseMany(todo.map((t) => t.f), limits, opts.onProgress, opts.signal, opts.wait);
    lines = new Array(fens.length).fill(null).map(() => [] as PositionEval['lines']);
    todo.forEach((t, k) => (lines[t.i] = results[k]!));
  } finally {
    pool.terminate();
  }
  const evals: PositionEval[] = fens.map((fen, i) => ({ fen, lines: lines[i]! }));

  const analysis = await scoreGame(game, evals, opts.depth);
  const reached = evals.map((e) => e.lines[0]?.depth).filter((d): d is number => d !== undefined && d > 0);
  if (reached.length) analysis.minDepth = Math.min(...reached);
  await saveAnalysis(analysis);
  return analysis;
}

/**
 * Saves an analysis only if its game is still there: an account switch
 * clears the games while a background analysis may still be running.
 */
async function saveAnalysis(analysis: GameAnalysis) {
  await db.transaction('rw', db.games, db.analyses, async () => {
    if (await db.games.get(analysis.gameId)) await db.analyses.put(analysis);
  });
}

/** Classification and accuracy from engine lines; no engine needed. */
export async function scoreGame(game: StoredGame, evals: PositionEval[], depth: number, createdAt = Date.now()): Promise<GameAnalysis> {
  const plies = replay(game.moves, game.initialFen ?? START_FEN);
  const openings = await loadOpenings();
  const tc = parseTimeControl(game.timeControl);
  const moves = classifyGame({
    plies,
    evals,
    bookPlies: bookPliesFromEcoUrl(pgnHeader(game.pgn, 'ECOUrl'), plies.map((p) => p.san)),
    isBook: (epd) => epd in openings,
    clocks: game.clocks,
    baseTime: tc?.base,
    increment: tc?.increment,
  });
  const opening = nameOpening(openings, plies.map((p) => p.fenAfter));

  return {
    gameId: game.id,
    version: ANALYSIS_VERSION,
    depth,
    createdAt,
    evals,
    moves,
    accuracy: gameAccuracy(moves),
    opening: opening?.name,
  };
}

/** An older analysis whose engine lines are still good: only the scoring changed. */
export function canRescore(analysis: GameAnalysis): boolean {
  return analysis.version !== ANALYSIS_VERSION && (analysis.version ?? 0) >= RESCORABLE_VERSION;
}

export async function rescoreGame(game: StoredGame, analysis: GameAnalysis): Promise<GameAnalysis> {
  const fresh = await scoreGame(game, analysis.evals, analysis.depth, analysis.createdAt);
  if (analysis.minDepth !== undefined) fresh.minDepth = analysis.minDepth;
  await saveAnalysis(fresh);
  return fresh;
}

let rescoring: Promise<number> | null = null;

/**
 * Brings every analysis up to the current scoring from its stored engine
 * lines, so accuracies and counts never mix two formulas. Runs once per
 * scoring version: new analyses are always current.
 */
export function rescoreOutdated(): Promise<number> {
  rescoring ??= (async () => {
    if ((await db.kv.get('rescoredVersion'))?.value === ANALYSIS_VERSION) return 0;
    const ids = await db.analyses.filter(canRescore).primaryKeys();
    let done = 0;
    for (const id of ids) {
      const [game, analysis] = await Promise.all([db.games.get(id), db.analyses.get(id)]);
      // Skip what the queue re-analysed meanwhile.
      if (!game || !analysis || !canRescore(analysis)) continue;
      try {
        await rescoreGame(game, analysis);
        done++;
      } catch (e) {
        console.warn(`rescore ${id}:`, e); // left for "Atualizar análise" on the review page
      }
      await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
    await setKV('rescoredVersion', ANALYSIS_VERSION);
    return done;
  })();
  return rescoring;
}
