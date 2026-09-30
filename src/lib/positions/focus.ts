// Your focuses: where the win-chance points you lose actually go. Each move is
// tagged along five dimensions (phase, situation, clock, severity, missed
// chance); a focus weighs as much as the share of points lost inside it.
import { parseTimeControl } from '../chesscom/import.ts';
import { pairedDifference, shareIntervals } from '../renewal/bootstrap.ts';
import { FOCUS_VERSION, RENEWAL } from '../renewal/config.ts';
import { fnv1a, mulberry32 } from '../renewal/prng.ts';
import { phaseOf } from '../stats/compute.ts';
import type { GameAnalysis, MoveReview, StoredGame, TimeClass } from '../types.ts';
import { POSITIONS } from './config.ts';
import { median } from './grade.ts';
import type { FocusCategory, FocusShift, FocusWeights } from './types.ts';

export const FOCUS_CATEGORIES: FocusCategory[] = [
  'opening',
  'middlegame',
  'endgame',
  'convert',
  'balanced',
  'defend',
  'fast',
  'lowClock',
  'blunder',
  'mistake',
  'inaccuracy',
  'miss',
];

export const FOCUS_LABEL: Record<FocusCategory, string> = {
  opening: 'Abertura',
  middlegame: 'Meio-jogo',
  endgame: 'Final',
  convert: 'Convertendo vantagem',
  balanced: 'Posição equilibrada',
  defend: 'Defendendo',
  fast: 'Lance rápido demais',
  lowClock: 'Relógio apertado',
  blunder: 'Capivarada',
  mistake: 'Erro',
  inaccuracy: 'Imprecisão',
  miss: 'Chance perdida',
};

/** Dimensions a move is tagged on; the priority divides by this fixed count. */
const DIMENSIONS = 5;

export interface GameContext {
  /** Base time in seconds, null for daily games. */
  base: number | null;
  /** Median of your think times in the game, in seconds. */
  medianSpent: number | null;
  /** Game started from a set-up position: phase comes from material only. */
  fromPosition: boolean;
}

export function gameContext(g: StoredGame, a: GameAnalysis): GameContext {
  const tc = g.timeClass === 'daily' ? null : parseTimeControl(g.timeControl);
  const spent = a.moves.filter((m) => m.color === g.userColor && m.timeSpent != null).map((m) => m.timeSpent!);
  return { base: tc?.base ?? null, medianSpent: spent.length ? median(spent) : null, fromPosition: !!g.initialFen };
}

export function moveLoss(m: MoveReview): number {
  return m.loss ?? Math.max(0, m.winBefore - m.winAfter);
}

export function categoriesOf(m: MoveReview, ctx: GameContext): FocusCategory[] {
  const out: FocusCategory[] = [phaseOf(m.fenBefore, ctx.fromPosition ? 99 : m.ply)];
  out.push(m.winBefore >= POSITIONS.convertMin ? 'convert' : m.winBefore <= POSITIONS.defendMax ? 'defend' : 'balanced');
  if (ctx.base != null) {
    if (m.clock != null && m.clock < POSITIONS.lowClockShare * ctx.base) out.push('lowClock');
    else if (ctx.medianSpent != null && m.timeSpent != null && m.timeSpent < POSITIONS.fastShare * ctx.medianSpent) out.push('fast');
  }
  const loss = moveLoss(m);
  const { blunder, mistake, inaccuracy } = POSITIONS.severity;
  if (loss >= blunder) out.push('blunder');
  else if (loss >= mistake) out.push('mistake');
  else if (loss >= inaccuracy) out.push('inaccuracy');
  if (m.classification === 'miss') out.push('miss');
  return out;
}

/** One of your moves that lost points, as the focus weights see it. */
export interface FocusMove {
  gameId: string;
  endTime: number;
  loss: number;
  categories: FocusCategory[];
}

const DAY = 86_400_000;

/** Only rated rapid and blitz measure your focuses: bullet and daily games are another game. */
export const countsForFocus = (g: { timeClass: TimeClass; rated: boolean }) => g.rated && (g.timeClass === 'rapid' || g.timeClass === 'blitz');

export interface PopulationGame {
  gameId: string;
  endTime: number;
  timeClass: TimeClass;
  rated: boolean;
  analysed: boolean;
}

/** The games the focuses are measured on. */
export interface Population {
  ids: string[];
  /** Your most recent games analysed in a row. */
  block: number;
  provisional: boolean;
  windowDays: number | null;
}

/**
 * Your recent run of games: rated rapid and blitz of the last 90 days, newest
 * first, all analysed. Games still waiting at the top are skipped, and the run
 * stops at the first one not analysed, so a backlog analysed losses first
 * cannot tilt the numbers toward losses. Under 30 games the numbers use every
 * analysed game that counts, and say they are provisional.
 */
export function focusPopulation(games: PopulationGame[], now: number, sinceOverride?: number): Population {
  const since = sinceOverride ?? now - POSITIONS.focusWindowDays * DAY;
  const eligible = games.filter((g) => countsForFocus(g) && g.endTime <= now).sort((a, b) => b.endTime - a.endTime || a.gameId.localeCompare(b.gameId));
  const block: string[] = [];
  for (const g of eligible) {
    if (g.endTime < since) break;
    if (!g.analysed) {
      if (block.length) break;
      continue;
    }
    block.push(g.gameId);
  }
  const windowDays = sinceOverride === undefined ? POSITIONS.focusWindowDays : Math.ceil((now - since) / DAY);
  if (block.length >= RENEWAL.focusMinBlock) return { ids: block, block: block.length, provisional: false, windowDays };
  // A period of its own (a rating band) never borrows games from before it.
  const fallback = eligible.filter((g) => g.analysed && (sinceOverride === undefined || g.endTime >= since));
  return { ids: fallback.map((g) => g.gameId), block: block.length, provisional: true, windowDays: null };
}

/** One vector per game, sorted by id: points lost per category, then the total. */
function gameVectors(moves: FocusMove[], ids: string[]): { ids: string[]; vectors: Float64Array[] } {
  const sorted = [...new Set(ids)].sort();
  const at = new Map(sorted.map((id, i) => [id, i]));
  const K = FOCUS_CATEGORIES.length;
  const vectors = sorted.map(() => new Float64Array(K + 1));
  for (const m of moves) {
    const i = at.get(m.gameId);
    if (i === undefined || m.loss < POSITIONS.minLoss) continue;
    const v = vectors[i]!;
    for (const c of m.categories) v[FOCUS_CATEGORIES.indexOf(c)]! += m.loss;
    v[K]! += m.loss;
  }
  return { ids: sorted, vectors };
}

const seeded = (ids: string[], salt: string) => mulberry32(fnv1a(`${ids.join(',')}|${FOCUS_VERSION}|${salt}`));

/** Shares of the points lost per focus, with a 90% margin from resampling the games. */
export function focusWeights(moves: FocusMove[], pop: Population, now: number): FocusWeights {
  const inScope = new Set(pop.ids);
  const scoped = moves.filter((m) => inScope.has(m.gameId) && m.loss >= POSITIONS.minLoss);
  const totalLoss = scoped.reduce((s, m) => s + m.loss, 0);
  const shares = Object.fromEntries(FOCUS_CATEGORIES.map((c) => [c, { share: 0, count: 0, lo: 0, hi: 0 }])) as FocusWeights['shares'];
  for (const m of scoped) {
    for (const c of m.categories) {
      shares[c].count++;
      shares[c].share += totalLoss ? m.loss / totalLoss : 0;
    }
  }
  const { ids, vectors } = gameVectors(scoped, pop.ids);
  const margin = shareIntervals(vectors, seeded(ids, 'shares'), RENEWAL.focusBootstrap);
  FOCUS_CATEGORIES.forEach((c, k) => {
    shares[c].share = round4(shares[c].share);
    shares[c].lo = round4(margin.lo[k] ?? shares[c].share);
    shares[c].hi = round4(margin.hi[k] ?? shares[c].share);
  });
  return { version: FOCUS_VERSION, computedAt: now, games: inScope.size, windowDays: pop.windowDays, totalLoss, block: pop.block, provisional: pop.provisional, shares };
}

// Rounded so a recomputation on the same data compares equal byte for byte.
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Focuses that moved beyond the margin between two sets of games that may
 * overlap (the recent run now and at the start of the month): the 90%
 * interval of the difference must leave zero out. Nothing is announced while
 * either side is provisional.
 */
export function focusShifts(moves: FocusMove[], before: Population, after: Population): Partial<Record<FocusCategory, FocusShift>> {
  if (before.provisional || after.provisional) return {};
  const a = new Set(before.ids);
  const b = new Set(after.ids);
  const { ids, vectors } = gameVectors(moves, [...a, ...b]);
  const diff = pairedDifference(vectors, ids.map((id) => a.has(id)), ids.map((id) => b.has(id)), seeded(ids, 'shift'), RENEWAL.focusBootstrap);
  const shareOf = (set: Set<string>) => {
    const vs = vectors.filter((_, i) => set.has(ids[i]!));
    const K = FOCUS_CATEGORIES.length;
    const total = vs.reduce((s, v) => s + v[K]!, 0);
    return (k: number) => (total ? vs.reduce((s, v) => s + v[k]!, 0) / total : 0);
  };
  const from = shareOf(a);
  const to = shareOf(b);
  const out: Partial<Record<FocusCategory, FocusShift>> = {};
  FOCUS_CATEGORIES.forEach((c, k) => {
    const lo = diff.lo[k] ?? 0;
    const hi = diff.hi[k] ?? 0;
    if (lo > 0 || hi < 0) out[c] = { from: round4(from(k)), to: round4(to(k)), lo: round4(lo), hi: round4(hi) };
  });
  return out;
}

/** How much a position's focuses matter to you, 0-1. */
export function focusFactor(categories: FocusCategory[], w: FocusWeights | null): number {
  if (!w || !w.totalLoss) return 1;
  return categories.reduce((s, c) => s + (w.shares[c]?.share ?? 0), 0) / DIMENSIONS;
}

/** Order of new positions: the loss (summed over games) times the focus factor. */
export function priorityOf(card: { totalLoss: number; categories: FocusCategory[] }, w: FocusWeights | null): number {
  return card.totalLoss * focusFactor(card.categories, w);
}
