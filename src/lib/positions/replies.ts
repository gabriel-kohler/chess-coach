// The opponent's replies in a sequence: what people at your opponents' level
// actually play. In the opening (up to move 10) that comes from your own
// games, when they reached the position often enough; later from Maia-2.
import { uciToSan } from '../chess/replay.ts';
import type { HumanMove } from '../maia/encode.ts';
import type { OpeningTree } from '../repertoire/games.ts';
import { statsAt } from '../repertoire/games.ts';
import { epdOf } from '../chess/replay.ts';

export interface HumanReply {
  uci: string;
  san: string;
  /** Share of players who pick it (0-1). */
  p: number;
  source: 'games' | 'maia';
}

export const REPLIES = { minP: 0.1, max: 4, min: 2, openingMaxPly: 20, minGames: 5 } as const;

/** The 3 or 4 likeliest moves: those at 10% or more, at most 4, at least 2. */
export function pickReplies<T extends { p: number }>(moves: T[], opts: { minP: number; max: number; min: number } = REPLIES): T[] {
  const sorted = [...moves].sort((a, b) => b.p - a.p);
  const strong = sorted.filter((m) => m.p >= opts.minP).slice(0, opts.max);
  return strong.length >= opts.min ? strong : sorted.slice(0, Math.min(opts.min, sorted.length));
}

export interface ReplyContext {
  fen: string;
  /** Ply of the position (0 = start): the opening is ply <= 20. */
  ply: number;
  /** Your games as the side that is NOT to move here, when available. */
  tree?: OpeningTree | null;
  /** Ratings on Maia's scale (already offset). */
  oppElo: number;
  userElo: number;
  policy: (fen: string, eloSelf: number, eloOppo: number) => Promise<HumanMove[]>;
}

/** Your opponents' moves at this position in your own games, if seen often enough. */
export function repliesFromGames(tree: OpeningTree, fen: string): Array<{ uci: string; san: string; p: number }> | null {
  const stats = statsAt(tree, epdOf(fen));
  const total = stats.reduce((s, x) => s + x.n, 0);
  if (total < REPLIES.minGames) return null;
  return stats.map((s) => ({ uci: s.uci, san: s.san, p: s.n / total }));
}

export async function humanMoves(ctx: ReplyContext): Promise<HumanReply[]> {
  if (ctx.ply <= REPLIES.openingMaxPly && ctx.tree) {
    const own = repliesFromGames(ctx.tree, ctx.fen);
    if (own) return own.map((m) => ({ ...m, source: 'games' as const }));
  }
  const policy = await ctx.policy(ctx.fen, ctx.oppElo, ctx.userElo);
  return policy.map((m) => ({ uci: m.uci, san: uciToSan(ctx.fen, m.uci) ?? m.uci, p: m.p, source: 'maia' as const }));
}

/** Branches of a sequence: the 3 or 4 replies people really play. */
export async function humanReplies(ctx: ReplyContext): Promise<HumanReply[]> {
  return pickReplies(await humanMoves(ctx));
}

/** The single likeliest reply, for the moves after the branch. */
export async function likeliestReply(ctx: ReplyContext): Promise<HumanReply | null> {
  return (await humanMoves(ctx))[0] ?? null;
}
