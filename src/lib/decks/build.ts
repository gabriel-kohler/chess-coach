// Grows a deck from any opening, the likeliest line first: at the opponent's
// turn the moves people at your level really play (2 to 4, 10% or more), at
// yours one answer (the one you played in your study and the engine approved,
// else your repertoire's, else Stockfish's). A line is followed while it is
// likely enough (its moves' shares among the replies kept, multiplied) and not too deep; the deck
// stops at its size. Pure: the sources come in as functions, and the state
// goes out after every step, so a build can stop anywhere and go on later.
import { Chess } from 'chess.js';
import { epdOf, tryUci } from '../chess/replay.ts';
import { ExplorerLimited } from '../openings/study.ts';
import { turnOf, type RepertoirePosition } from '../repertoire/compile.ts';
import type { Color } from '../types.ts';
import type { AnswerSource, FrontierNode, StudyDeck } from './types.ts';

export const BUILD = {
  /** Your positions in a new deck; the screen offers these sizes. */
  size: 30,
  sizes: [20, 30, 50],
  /** "Aprofundar": this many more, with the lines allowed a bit rarer and deeper. */
  deepen: 20,
  minP: 0.02,
  maxDepth: 10,
  /** Waits for the explorer's minute before the build stops for now. */
  maxWaits: 3,
} as const;

export type BuildState = Pick<StudyDeck, 'positions' | 'sources' | 'frontier' | 'size' | 'limits' | 'differs'>;

export interface BuildDeps {
  /** What people at your level play at an opponent position (shares 0-1). May throw ExplorerLimited. */
  replies: (fen: string) => Promise<Array<{ uci: string; san: string; p: number }>>;
  /** Your answer at one of your positions, with where it came from and your repertoire's, when that differs. */
  answer: (fen: string) => Promise<{ uci: string; source: AnswerSource; repertoire?: string } | null>;
  /** The explorer asked to wait: resolves when it is time to ask again. */
  wait: () => Promise<void>;
  /** Called with the state after every step (to save it). */
  save?: (s: BuildState) => Promise<void>;
  /** True to stop (a deleted deck, a closed tab): the state stays as it is. */
  stopped?: () => boolean;
}

const plyOf = (fen: string) => {
  const [, turn, , , , full] = fen.split(' ');
  return (Number(full) - 1) * 2 + (turn === 'b' ? 1 : 0);
};

/**
 * Your answer where a deck has one to give without the engine: the move you
 * played in your study and the engine approved, else your repertoire's. The
 * engine's best when neither is there ('engine').
 */
export function pickAnswer(
  fen: string,
  studied: string | undefined,
  repertoire: { uci: string; san: string } | undefined,
): { uci: string; source: AnswerSource; repertoire?: string } | 'engine' {
  const legal = (uci: string | undefined) => !!uci && !!tryUci(new Chess(fen), uci);
  if (legal(studied)) return { uci: studied!, source: 'study', ...(repertoire ? { repertoire: repertoire.san } : {}) };
  if (repertoire && legal(repertoire.uci)) return { uci: repertoire.uci, source: 'repertoire' };
  return 'engine';
}

/** "1...e5": a move with its number, as a position shows it. */
export function moveLabel(fen: string, san: string): string {
  const [, turn, , , , full] = fen.split(' ');
  return `${full}${turn === 'w' ? '.' : '...'}${san}`;
}

/** Your positions in a deck: your move, with an answer. */
export function oursIn(positions: Record<string, RepertoirePosition>, side: Color): number {
  let n = 0;
  for (const [epd, p] of Object.entries(positions)) if (turnOf(epd) === side && p.moves.length) n++;
  return n;
}

/** A new deck's starting state: the position after the opening's moves. */
export function seed(rootFen: string): Pick<BuildState, 'positions' | 'sources' | 'frontier' | 'differs'> {
  return { positions: {}, sources: {}, differs: [], frontier: [{ fen: rootFen, p: 1, depth: 0 }] };
}

const eligible = (n: FrontierNode, limits: BuildState['limits']) => n.p >= limits.minP && n.depth < limits.maxDepth;

/** The likeliest line still open, the first one found on a tie (the same input builds the same deck). */
function takeNext(frontier: FrontierNode[], limits: BuildState['limits']): FrontierNode | null {
  let best = -1;
  for (let i = 0; i < frontier.length; i++) if (eligible(frontier[i]!, limits) && (best < 0 || frontier[i]!.p > frontier[best]!.p)) best = i;
  return best < 0 ? null : frontier.splice(best, 1)[0]!;
}

export interface BuildResult {
  state: BuildState;
  /** done: the size is reached or no line is left to follow; paused: stopped, or the explorer kept asking to wait. */
  status: 'done' | 'paused';
  note?: string;
}

export async function grow(start: BuildState, side: Color, deps: BuildDeps): Promise<BuildResult> {
  const s: BuildState = { ...start, positions: { ...start.positions }, sources: { ...start.sources }, frontier: [...start.frontier], differs: [...start.differs] };

  /** Your answer at a position: the line goes on after it. */
  const answerAt = async (fen: string, p: number, depth: number): Promise<RepertoirePosition['moves'][number] | null> => {
    const epd = epdOf(fen);
    if (s.positions[epd]?.moves.length) return s.positions[epd]!.moves[0]!;
    const a = await deps.answer(fen);
    const chess = new Chess(fen);
    const mv = a ? tryUci(chess, a.uci) : null;
    if (!a || !mv) return null;
    const move = { san: mv.san, uci: mv.lan, to: epdOf(chess.fen()), nags: [] };
    s.positions[epd] = { epd, fen, ply: plyOf(fen), moves: [move] };
    s.sources[epd] = a.source;
    if (a.repertoire && a.repertoire !== mv.san) s.differs.push({ epd, deck: moveLabel(fen, mv.san), repertoire: moveLabel(fen, a.repertoire) });
    if (!chess.isGameOver()) s.frontier.push({ fen: chess.fen(), p, depth: depth + 1 });
    return move;
  };

  let waits = 0;
  while (oursIn(s.positions, side) < s.size) {
    if (deps.stopped?.()) return { state: s, status: 'paused' };
    const node = takeNext(s.frontier, s.limits);
    if (!node) break;
    const epd = epdOf(node.fen);
    // Reached before through another move order: already opened.
    if (s.positions[epd]) continue;
    if (turnOf(epd) === side) {
      await answerAt(node.fen, node.p, node.depth);
    } else {
      let replies: Awaited<ReturnType<BuildDeps['replies']>>;
      try {
        replies = await deps.replies(node.fen);
      } catch (e) {
        if (!(e instanceof ExplorerLimited)) throw e;
        // The line is not cut: it goes back and is asked again after the wait.
        s.frontier.unshift(node);
        if (++waits > BUILD.maxWaits) return { state: s, status: 'paused', note: 'O Lichess pediu para esperar: a montagem continua daqui a pouco.' };
        await deps.wait();
        continue;
      }
      const moves: RepertoirePosition['moves'] = [];
      // Shares among the replies kept: where people spread over many moves, the likely line
      // still goes on (the raw shares of 1.e3 Nf6, 23% and 20%, would end it in 4 moves).
      const kept = replies.reduce((s, r) => s + r.p, 0);
      for (const r of replies) {
        const chess = new Chess(node.fen);
        const mv = tryUci(chess, r.uci);
        if (!mv) continue;
        const p = kept > 0 ? (node.p * r.p) / kept : 0;
        // A line never ends on the opponent's move: a reply you have no answer to stays out.
        if (chess.isGameOver() || (await answerAt(chess.fen(), p, node.depth))) moves.push({ san: mv.san, uci: mv.lan, to: epdOf(chess.fen()), nags: [] });
      }
      if (moves.length) s.positions[epd] = { epd, fen: node.fen, ply: plyOf(node.fen), moves };
    }
    await deps.save?.(s);
  }
  return { state: s, status: 'done' };
}
