// Builds the sequences of a position: you play the engine's best move, the
// opponent answers with one of the 3 or 4 moves people really play, and each
// answer becomes its own line. After that branch the opponent plays the
// likeliest human move, and you the engine's best, until one of:
//  - a concrete gain: mate, promotion, material that holds, or perpetual check;
//  - advantage gained: your win chance moved up a band from the start, holds
//    against the best defense, and nothing forced (check, capture) is pending;
//  - advantage kept: 3 moves of yours, or up to 5 while a concrete gain is pending.
import { Chess } from 'chess.js';
import { tryUci, uciToSan } from '../chess/replay.ts';
import { payoff, perpetualLine, winFor } from '../explain/facts.ts';
import type { Color, EngineLine, Score } from '../types.ts';
import type { HumanReply } from './replies.ts';
import type { StoredLine } from './types.ts';

export const SEQ = { maxUserMoves: 3, maxWithPending: 5, bands: [20, 40, 60, 80], pendingPlies: 4 } as const;
/** Bump when the building rules change: old sequences get rebuilt. */
export const SEQ_VERSION = 1;

export interface SeqNode {
  /** Position with you to move. */
  fen: string;
  ply: number;
  best: StoredLine & { uci: string; san: string };
  second: (StoredLine & { uci: string }) | null;
  stableFrom: number | null;
}

export type SeqEndKind = 'mate' | 'material' | 'promotion' | 'perpetual' | 'advantage' | 'kept';

export interface SeqEnd {
  kind: SeqEndKind;
  /** Your win chance with best play at the start and at the end. */
  winStart: number;
  winEnd: number;
  /** Material won, for 'material'. */
  points?: number;
}

export interface SeqBranch {
  /** The human answer that opens this line. */
  reply: HumanReply;
  /** Your positions after the branch, in order (the root is the card itself). */
  nodes: SeqNode[];
  /** Opponent moves: replies[i] comes right before nodes[i]. */
  replies: HumanReply[];
  end: SeqEnd;
  /** Whole line in UCI from the root: your move, reply, your move... */
  moves: string[];
}

export interface SeqRoot {
  fen: string;
  ply: number;
  color: Color;
  best: StoredLine & { uci: string; san: string };
}

export interface SeqDeps {
  /** Engine lines (MultiPV 2), scores from White's point of view. */
  analyse(fen: string): Promise<EngineLine[]>;
  /** The 3 or 4 replies people play, opponent to move. */
  replies(fen: string, ply: number): Promise<HumanReply[]>;
  /** The likeliest human reply, opponent to move. */
  likeliest(fen: string, ply: number): Promise<HumanReply | null>;
}

const scoreOf = (l: EngineLine | StoredLine): Score => ('score' in l ? l.score : l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 });

export function band(win: number): number {
  return SEQ.bands.filter((b) => win >= b).length;
}

function play(fen: string, uci: string): Chess | null {
  const c = new Chess(fen);
  return tryUci(c, uci) ? c : null;
}

/** No check or capture in the two plies after your move: nothing forced left to play. */
export function quietAhead(fen: string, pv: string[]): boolean {
  const c = new Chess(fen);
  if (!tryUci(c, pv[0] ?? '')) return false;
  for (const uci of pv.slice(1, 3)) {
    const m = tryUci(c, uci);
    if (!m) break;
    if (m.captured || m.san.includes('+') || m.san.includes('#')) return false;
  }
  return true;
}

function node(fen: string, ply: number, lines: EngineLine[]): SeqNode | null {
  const best = lines[0];
  const uci = best?.pv[0];
  if (!best || !uci) return null;
  const san = uciToSan(fen, uci);
  if (!san) return null;
  const second = lines[1]?.pv[0] ? { pv: lines[1].pv.slice(0, 16), score: scoreOf(lines[1]), depth: lines[1].depth, uci: lines[1].pv[0] } : null;
  return { fen, ply, best: { pv: best.pv.slice(0, 16), score: scoreOf(best), depth: best.depth, uci, san }, second, stableFrom: best.stableFrom ?? null };
}

/** A lesson of one move (mate, or material won and kept right away) has no sequence. */
export function oneMoveLesson(root: SeqRoot): boolean {
  const after = play(root.fen, root.best.uci);
  if (!after || after.isGameOver()) return true;
  const p = payoff(root.fen, root.best.pv, 6);
  return !!p && p.index === 0;
}

export async function buildBranches(root: SeqRoot, deps: SeqDeps): Promise<SeqBranch[] | null> {
  if (oneMoveLesson(root)) return null;
  const after0 = play(root.fen, root.best.uci)!;
  const winStart = winFor(root.color, root.best.score);
  const replies = await deps.replies(after0.fen(), root.ply + 1);
  const branches: SeqBranch[] = [];

  for (const reply of replies) {
    const start = play(after0.fen(), reply.uci);
    if (!start) continue;
    let fen = start.fen();
    let ply = root.ply + 2;
    const moves = [root.best.uci, reply.uci];
    const nodes: SeqNode[] = [];
    const answers: HumanReply[] = [reply];
    let limit: number = SEQ.maxUserMoves;
    let userMoves = 1; // the root move
    let end: SeqEnd | null = null;

    while (!end) {
      const here = new Chess(fen);
      if (here.isGameOver()) {
        end = { kind: 'kept', winStart, winEnd: winStart };
        break;
      }
      const n = node(fen, ply, await deps.analyse(fen));
      if (!n) {
        end = { kind: 'kept', winStart, winEnd: winStart };
        break;
      }
      nodes.push(n);
      userMoves++;
      moves.push(n.best.uci);
      const afterUser = play(fen, n.best.uci)!;
      const winEnd = winFor(root.color, n.best.score);
      const asLine: EngineLine = { depth: n.best.depth, pv: n.best.pv, ...n.best.score };
      const gain = payoff(fen, n.best.pv, 8, root.fen);

      if (afterUser.isCheckmate()) end = { kind: 'mate', winStart, winEnd: 100 };
      else if (perpetualLine(fen, asLine)) end = { kind: 'perpetual', winStart, winEnd };
      else if (gain && gain.index === 0) end = gain.kind === 'promotion' ? { kind: 'promotion', winStart, winEnd } : { kind: 'material', winStart, winEnd, points: gain.swing };
      else if (band(winEnd) > band(winStart) && quietAhead(fen, n.best.pv)) end = { kind: 'advantage', winStart, winEnd };
      else {
        const mateSoon = n.best.score.mate !== undefined && (root.color === 'white' ? n.best.score.mate > 0 : n.best.score.mate < 0) && Math.abs(n.best.score.mate) <= 3;
        const pending = mateSoon || (!!gain && gain.index <= SEQ.pendingPlies);
        if (pending) limit = SEQ.maxWithPending;
        if (userMoves >= limit) end = { kind: 'kept', winStart, winEnd };
      }
      if (end) break;

      const next = await deps.likeliest(afterUser.fen(), ply + 1);
      const replied = next ? play(afterUser.fen(), next.uci) : null;
      if (!next || !replied) {
        end = { kind: 'kept', winStart, winEnd };
        break;
      }
      answers.push(next);
      moves.push(next.uci);
      fen = replied.fen();
      ply += 2;
    }
    branches.push({ reply, nodes, replies: answers, end, moves });
  }
  return branches;
}
