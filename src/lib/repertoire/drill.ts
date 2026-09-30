// Repertoire training in the Chessable style: the app plays the opponent, you
// play your repertoire moves; each of your positions is an FSRS card, graded
// by the first try and your time. Lines are chosen so the positions that are
// due (or new) come up.
import { State, type Grade } from 'ts-fsrs';
import { db } from '../db.ts';
import { gradeAttempt } from '../positions/grade.ts';
import { loadExpectedTimes, recordReview } from '../positions/store.ts';
import { attemptIdFor, newRepCard, repCardId, type RepNamespace } from '../srs/cards.ts';
import { ruleFor } from '../srs/fsrs.ts';
import type { Color, RepCard } from '../types.ts';
import type { CompiledSide, RepertoireMove } from './compile.ts';
import type { OpeningTree } from './games.ts';

/** Your cards of one namespace (a color's repertoire, or one deck), by position. */
export async function cardsFor(ns: RepNamespace): Promise<Map<string, RepCard>> {
  const cards = (await db.srsCards.where('id').startsWith(repCardId(ns, '')).toArray()) as RepCard[];
  return new Map(cards.map((c) => [c.epd, c]));
}

/** Every repertoire move is one kind of position: a single time bucket. */
const BUCKET = 'easy' as const;

export async function repertoireExpectedMs(): Promise<number> {
  return (await loadExpectedTimes('rep'))[BUCKET];
}

export interface RepAttempt {
  uci: string;
  correct: boolean;
  timeMs: number;
  hiddenMs: number;
  expectedMs: number;
}

/** Grades your first try at a position: a miss is Again; a right move is Hard, Good or Easy by your time. */
export function repGrade(a: Pick<RepAttempt, 'correct' | 'timeMs' | 'expectedMs'>): Grade {
  return gradeAttempt({ loss: a.correct ? 0 : null, exact: a.correct, timeMs: a.timeMs, gaveUp: false }, a.expectedMs, ruleFor('rep'));
}

/**
 * `attemptId` fixed by a training session makes a repeated save count once.
 * `ns` is where the card lives: your repertoire of that color unless a deck
 * of its own is given.
 */
export async function grade(side: Color, epd: string, a: RepAttempt, now = Date.now(), attemptId?: string, ns: RepNamespace = side) {
  const rating = repGrade(a);
  const cardId = repCardId(ns, epd);
  await recordReview({
    attemptId: attemptId ?? attemptIdFor(cardId),
    cardId,
    at: now,
    grade: rating,
    signals: { uci: a.uci, loss: a.correct ? 0 : null, lossSource: null, exact: a.correct, correct: a.correct, timeMs: a.timeMs, hiddenMs: a.hiddenMs, expectedMs: a.expectedMs, bucket: BUCKET, gaveUp: false },
    create: newRepCard(ns, side, epd, now),
  });
  return rating;
}

/**
 * Picks the opponent's reply at a position: toward due or unseen positions of
 * ours first, then by how often your opponents actually play it. Frequency
 * counts as n^0.75: with snowww_99's games 1.e4 and 1.d4 get 75% of Black
 * drills (89% of real games) and rare first moves still come up once the main
 * lines are learned. A log gave them 22%: nineteen replies nobody plays
 * against you outweighed the two everyone plays.
 */
export interface ReplyPreference {
  /**
   * due: only toward positions with a review due further down (`dueBelow`),
   * while any is reachable. known: never into a position you have not seen
   * (before a game, no new moves); the line ends when only those are left.
   */
  prefer?: 'due' | 'known';
  dueBelow?: Set<string>;
  /**
   * Your moves still ahead from a position (`aheadIn`): a reply weighs 1 +
   * that more, so the lines that go on come up more often than a sideline
   * answered in one move. With snowww_99's games a deck's line grew from 2-4.5
   * to 2.5-6 of your moves.
   */
  ahead?: (epd: string) => number;
  now?: number;
  random?: () => number;
}

export function pickReply(
  rep: CompiledSide,
  epd: string,
  cards: Map<string, RepCard>,
  tree: OpeningTree | null,
  scope: Set<string> | null,
  pref: ReplyPreference = {},
): RepertoireMove | null {
  const pos = rep.positions[epd];
  if (!pos?.moves.length) return null;
  const now = pref.now ?? Date.now();
  let candidates = pos.moves.filter((m) => !scope || scope.has(m.to));
  if (pref.prefer === 'due' && pref.dueBelow) {
    const toward = candidates.filter((m) => pref.dueBelow!.has(m.to));
    if (toward.length) candidates = toward;
  }
  const weight = (m: RepertoireMove) => {
    const next = rep.positions[m.to];
    const card = cards.get(m.to);
    const leaf = !next?.moves.length;
    const urgency = pref.prefer === 'known' ? (leaf ? 0.2 : !card ? 0 : card.due <= now ? 4 : 1) : leaf ? 0.2 : !card ? 3 : card.due <= now ? 4 : 0.6;
    const freq = tree?.get(epd)?.get(m.uci)?.n ?? 0;
    return urgency * (1 + freq) ** 0.75 * (1 + (pref.ahead?.(m.to) ?? 0));
  };
  candidates = candidates.filter((m) => weight(m) > 0);
  if (!candidates.length) return null;
  const total = candidates.reduce((s, m) => s + weight(m), 0);
  let r = (pref.random ?? Math.random)() * total;
  for (const m of candidates) {
    r -= weight(m);
    if (r <= 0) return m;
  }
  return candidates[0]!;
}

/**
 * Positions from which one of your due positions can be reached (the due ones
 * included): a line that stays inside them always meets a review. With a
 * scope (a deck), only its due positions count and only its moves lead there:
 * a line never heads for another deck's review through a transposition.
 */
export function dueBelow(rep: CompiledSide, cards: Map<string, RepCard>, now = Date.now(), scope?: Set<string> | null): Set<string> {
  const parents = new Map<string, string[]>();
  for (const [epd, pos] of Object.entries(rep.positions)) {
    if (scope && !scope.has(epd)) continue;
    for (const m of pos.moves) if (!scope || scope.has(m.to)) (parents.get(m.to) ?? parents.set(m.to, []).get(m.to)!).push(epd);
  }
  const out = new Set<string>();
  const queue: string[] = [];
  for (const [epd, c] of cards) {
    if (scope && !scope.has(epd)) continue;
    if (c.due <= now && !c.suspended && rep.positions[epd]?.moves.length) {
      out.add(epd);
      queue.push(epd);
    }
  }
  while (queue.length) {
    const e = queue.pop()!;
    for (const p of parents.get(e) ?? []) {
      if (!out.has(p)) {
        out.add(p);
        queue.push(p);
      }
    }
  }
  return out;
}

const aheadCache = new WeakMap<CompiledSide, Map<Set<string> | null, (epd: string) => number>>();

/**
 * Your moves still ahead from each position, along its longest line inside
 * the scope (a deck). Worked out once per repertoire and scope.
 */
export function aheadIn(rep: CompiledSide, scope: Set<string> | null): (epd: string) => number {
  const byScope = aheadCache.get(rep) ?? aheadCache.set(rep, new Map()).get(rep)!;
  const known = byScope.get(scope);
  if (known) return known;
  const ours = rep.side === 'white' ? 'w' : 'b';
  const memo = new Map<string, number>();
  const onPath = new Set<string>();
  const walk = (epd: string): number => {
    const hit = memo.get(epd);
    if (hit !== undefined) return hit;
    const pos = rep.positions[epd];
    // A repetition back into the line counts nothing more.
    if (!pos?.moves.length || onPath.has(epd)) return 0;
    onPath.add(epd);
    let n = 0;
    if (epd.split(' ')[1] === ours) n = 1 + walk(pos.moves[0]!.to);
    else for (const m of pos.moves) if (!scope || scope.has(m.to)) n = Math.max(n, walk(m.to));
    onPath.delete(epd);
    memo.set(epd, n);
    return n;
  };
  byScope.set(scope, walk);
  return walk;
}

/** Your due repertoire positions that still exist in the repertoire you train. */
export function dueInRepertoire(rep: CompiledSide, cards: Map<string, RepCard>, now = Date.now()): RepCard[] {
  return [...cards.values()].filter((c) => c.due <= now && !c.suspended && !!rep.positions[c.epd]?.moves.length).sort((a, b) => a.due - b.due);
}

export interface RepertoireProgress {
  total: number;
  learned: number;
  due: number;
}

/** Learned: graduated to FSRS review, so neither new nor in a same-day retry. */
export function progress(cards: Map<string, RepCard>, ours: string[], now = Date.now()): RepertoireProgress {
  let learned = 0;
  let due = 0;
  for (const epd of ours) {
    const c = cards.get(epd);
    if (c && c.state === State.Review) learned++;
    if (c && c.due <= now) due++;
  }
  return { total: ours.length, learned, due };
}
