// Database side of the position trainer. Cards are derived from saved
// analyses by an idempotent sync (no hook in the analysis queue), and every
// attempt is logged with its raw signals.
import { State, type Grade } from 'ts-fsrs';
import { db, getKV, type SrsCard } from '../db.ts';
import { tableVersion } from '../data/live.ts';
import { PUNISH_CARD_PREFIX } from '../srs/cards.ts';
import { reviewCard } from '../srs/fsrs.ts';
import { carryMine, LEGACY_MINE_KEY } from '../srs/migrate.ts';
import { buildDailyQueue, localDay, type DailyQueue, type LogLite } from '../srs/queue.ts';
import type { Bucket, CardKind, FsrsFields, ReviewLogRow } from '../srs/types.ts';
import { countMotifs, GAME_MOTIFS_KEY } from '../tactics/gameMotifs.ts';
import type { GameAnalysis, StoredGame } from '../types.ts';
import { GRADING_VERSION, POSITIONS } from './config.ts';
import { deriveSources, planBestCards, type PlanReport } from './derive.ts';
import { focusPopulation, focusShifts, focusWeights, priorityOf, type FocusMove, type PopulationGame } from './focus.ts';
import { expectedTimes, timingSamples } from './grade.ts';
import { inPeriod } from './period.ts';
import { planSequenceCards } from './seqPlan.ts';
import type { PositionsSettings } from './settings.ts';
import type { BestMoveCard, DerivedSource, FocusWeights, MoveScore, PositionKind, SequenceCard } from './types.ts';

export const FOCUS_KEY = 'positions:focus';

export interface SyncReport extends PlanReport {
  cards: number;
}

let chain: Promise<unknown> = Promise.resolve();
let lastRun: { stamp: string; report: SyncReport } | null = null;

const withoutStamp = (w: FocusWeights | null | undefined) => (w ? { ...w, computedAt: 0 } : null);

/** Midnight of the first day of the local month: the focuses are compared with that day. */
export function startOfMonth(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Writes a kv value only when it changed, so live queries on it stay quiet. */
async function putIfChanged<T>(key: string, value: T, comparable: (v: T | undefined) => unknown = (v) => v) {
  const prev = (await db.kv.get(key))?.value as T | undefined;
  if (JSON.stringify(comparable(prev)) !== JSON.stringify(comparable(value))) await db.kv.put({ key, value });
}

export interface FocusInputs {
  sources: DerivedSource[];
  focus: FocusMove[];
  /** Every analysed game, and every game since `earliest` (a gap ends your recent run). */
  popGames: PopulationGame[];
}

/** What the cards and the focuses are computed from: the saved analyses, and the games around them. */
export async function loadFocusInputs(input: { games?: StoredGame[]; analyses?: GameAnalysis[] } | undefined, earliest: number): Promise<FocusInputs> {
  const analyses = input?.analyses ?? (await db.analyses.toArray());
  const games = input?.games
    ? new Map(input.games.map((g) => [g.id, g]))
    : new Map((await db.games.bulkGet(analyses.map((a) => a.gameId))).filter((g): g is StoredGame => !!g).map((g) => [g.id, g]));
  const sources: DerivedSource[] = [];
  const focus: FocusMove[] = [];
  const analysedIds = new Set<string>();
  for (const a of analyses) {
    const g = games.get(a.gameId);
    if (!g) continue;
    const d = deriveSources(g, a);
    sources.push(...d.sources);
    focus.push(...d.focus);
    analysedIds.add(g.id);
  }
  const recent = input?.games ?? (await db.games.where('endTime').aboveOrEqual(earliest).toArray());
  const population = new Map<string, PopulationGame>();
  for (const g of [...games.values(), ...recent]) population.set(g.id, { gameId: g.id, endTime: g.endTime, timeClass: g.timeClass, rated: g.rated, analysed: analysedIds.has(g.id) });
  return { sources, focus, popGames: [...population.values()] };
}

/**
 * Brings the cards in line with the saved analyses. Safe to call any time and
 * as often as needed: calls run one after another, and a second call on the
 * same data writes nothing.
 */
export function syncPositionCards(input?: { games?: StoredGame[]; analyses?: GameAnalysis[] }, now = Date.now(), opts: { ifChanged?: boolean } = {}): Promise<SyncReport> {
  const run = async (): Promise<SyncReport> => {
    // Nothing new since the last run (no game, no analysis, same day): the cards and focuses are as they were.
    const stamp = `${tableVersion('games')}|${tableVersion('analyses')}|${new Date(now).toDateString()}`;
    if (opts.ifChanged && lastRun && lastRun.stamp === stamp) return { ...lastRun.report, created: 0, updated: 0, removed: 0, suspended: 0, revived: 0 };
    const monthStart = startOfMonth(now);
    const { sources, focus, popGames } = await loadFocusInputs(input, monthStart - POSITIONS.focusWindowDays * 86_400_000);
    const pop = focusPopulation(popGames, now);
    const weights = focusWeights(focus, pop, now);
    const shifts = focusShifts(focus, focusPopulation(popGames, monthStart), pop);
    if (Object.keys(shifts).length) weights.change = { since: monthStart, shifts };
    return db.transaction('rw', db.srsCards, db.kv, async () => {
      const existing = (await db.srsCards.where('kind').equals('best').toArray()) as BestMoveCard[];
      const plan = planBestCards(existing, sources, now);
      if (plan.put.length) await db.srsCards.bulkPut(plan.put);
      if (plan.remove.length) await db.srsCards.bulkDelete(plan.remove);
      let roots = (await db.srsCards.where('kind').equals('best').toArray()) as BestMoveCard[];
      // Progress of your own-game puzzles from the old tactics queue.
      const mine = await getKV<Record<string, FsrsFields> | null>(LEGACY_MINE_KEY, null);
      if (mine) {
        const carry = carryMine(roots, mine);
        if (carry.put.length) {
          await db.srsCards.bulkPut(carry.put);
          const byId = new Map(carry.put.map((c) => [c.id, c]));
          roots = roots.map((c) => byId.get(c.id) ?? c);
        }
        if (carry.used.length) {
          const left = Object.fromEntries(Object.entries(mine).filter(([k]) => !carry.used.includes(k)));
          if (Object.keys(left).length) await db.kv.put({ key: LEGACY_MINE_KEY, value: left });
          else await db.kv.delete(LEGACY_MINE_KEY);
        }
      }
      // Sequences follow their position card.
      const seqs = (await db.srsCards.where('kind').equals('seq').toArray()) as SequenceCard[];
      const seqPlan = planSequenceCards(seqs, roots);
      if (seqPlan.put.length) await db.srsCards.bulkPut(seqPlan.put);
      if (seqPlan.remove.length) await db.srsCards.bulkDelete(seqPlan.remove);
      await putIfChanged(FOCUS_KEY, weights, withoutStamp);
      await putIfChanged(GAME_MOTIFS_KEY, countMotifs(roots));
      const report = { ...plan.report, cards: existing.length + plan.report.created - plan.report.removed };
      lastRun = { stamp, report };
      return report;
    });
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

const toLite = (l: ReviewLogRow): LogLite => ({ cardId: l.cardId, note: l.note, gameId: l.gameId, at: l.at, state: l.state });

export type CardFor<K extends PositionKind> = K extends 'best' ? BestMoveCard : SequenceCard;

export function limitsFor(kind: PositionKind, s: PositionsSettings): { newPerDay: number; maxReviewsPerDay: number } {
  return kind === 'best' ? { newPerDay: s.newPerDay, maxReviewsPerDay: s.maxReviewsPerDay } : { newPerDay: s.seqNewPerDay, maxReviewsPerDay: s.seqMaxReviewsPerDay };
}

const cardsOf = <K extends PositionKind>(kind: K) => db.srsCards.where('kind').equals(kind).toArray().then((c) => c as unknown as CardFor<K>[]);

/**
 * The day's queue for one mode. Siblings (the best-move card of a position
 * and its sequences share a note) are buried across modes: a position done
 * today in one mode waits until tomorrow in the other. With a period, only
 * positions from games played in it come up (the "only my mistakes" filter).
 */
export async function loadDailyQueue<K extends PositionKind>(kind: K, settings: PositionsSettings, now = Date.now(), periodDays = 0): Promise<DailyQueue<CardFor<K>>> {
  const day = localDay(now);
  const [cards, allToday, weights] = await Promise.all([
    cardsOf(kind),
    db.reviewLogs.where('at').between(day.start, day.end, true, false).toArray(),
    getKV<FocusWeights | null>(FOCUS_KEY, null),
  ]);
  return buildDailyQueue({
    cards: cards.filter((c) => inPeriod(c, periodDays, now)),
    logsToday: allToday.filter((l) => l.kind === kind).map(toLite),
    siblingLogs: allToday.map(toLite),
    now,
    day,
    limits: limitsFor(kind, settings),
    priority: (c) => priorityOf(c, weights),
    groupOf: (c) => c.primaryGameId,
    maxNewPerGroup: POSITIONS.maxNewPerGame,
  });
}

export interface TodayCounts {
  /** Reviews due today plus learning cards due now. */
  reviews: number;
  news: number;
  doneToday: number;
  /** Every active card of the mode, whatever the period. */
  total: number;
  /** Active cards from games in the period. */
  inPeriod: number;
  /** Reviews due today that the period leaves out. */
  outside: number;
  /** When the next card of the period comes due, if none is due today. */
  nextDue: number | null;
}

export async function positionsTodayCounts(kind: PositionKind, settings: PositionsSettings, now = Date.now(), periodDays = 0): Promise<TodayCounts> {
  const q = await loadDailyQueue(kind, settings, now, periodDays);
  const day = localDay(now);
  const [doneToday, cards] = await Promise.all([
    db.reviewLogs.where('[kind+at]').between([kind, day.start], [kind, day.end], true, false).count(),
    cardsOf(kind).then((c) => c.filter((x) => !x.suspended)),
  ]);
  const inside = cards.filter((c) => inPeriod(c, periodDays, now));
  const reviews = q.reviews.length + q.learning.filter((c) => c.due <= now).length;
  // Nothing left today: whatever waits (new ones over the cap included) comes tomorrow at the earliest.
  const nothing = reviews + q.news.length === 0;
  return {
    reviews,
    news: q.news.length,
    doneToday,
    total: cards.length,
    inPeriod: inside.length,
    outside: cards.filter((c) => !inPeriod(c, periodDays, now) && c.state !== State.New && c.due < day.end).length,
    nextDue: nothing && inside.length ? Math.min(...inside.map((c) => Math.max(c.due, day.end))) : null,
  };
}

export async function loadExpectedTimes(kind: CardKind): Promise<Record<Bucket, number>> {
  const logs = await db.reviewLogs.where('[kind+at]').between([kind, 0], [kind, Number.MAX_SAFE_INTEGER]).reverse().limit(2000).toArray();
  // Punishing an opening mistake is one known move, solved fast: it would make every puzzle look slow.
  return expectedTimes(timingSamples(logs.filter((l) => !l.cardId.startsWith(PUNISH_CARD_PREFIX)), kind));
}

export interface RecordInput {
  attemptId: string;
  cardId: string;
  at: number;
  grade: Grade;
  signals: Pick<ReviewLogRow, 'uci' | 'loss' | 'lossSource' | 'exact' | 'correct' | 'timeMs' | 'hiddenMs' | 'expectedMs' | 'bucket' | 'gaveUp'>;
  /** Sequences: each of your moves, with its own grade. */
  steps?: ReviewLogRow['steps'];
  /** Sequences are saved at their end, with retries and hints already known. */
  outcome?: { hintUsed: boolean; tries: number; solved: boolean };
  /** The card to start from when it does not exist yet (a first puzzle miss, a new repertoire position). */
  create?: SrsCard;
}

/**
 * Applies one review, for any card kind. Reads the card from the database
 * (never a stale copy in memory) and is idempotent per attempt, so a double
 * save or a reload after the first move cannot count the attempt twice.
 */
export async function recordReview(input: RecordInput): Promise<{ next: FsrsFields; logId: number; card: SrsCard }> {
  return db.transaction('rw', db.srsCards, db.reviewLogs, async () => {
    const card = (await db.srsCards.get(input.cardId)) ?? input.create;
    if (!card || card.id !== input.cardId) throw new Error(`card ${input.cardId} not found`);
    const done = await db.reviewLogs.where('attemptId').equals(input.attemptId).first();
    if (done) return { next: done.after, logId: done.id!, card };
    const { next, log } = reviewCard(card, input.grade, input.at, card.kind);
    const showing = (await db.reviewLogs.where('cardId').equals(card.id).count()) + 1;
    await db.srsCards.put({ ...card, ...next });
    const row: ReviewLogRow = {
      attemptId: input.attemptId,
      cardId: card.id,
      kind: card.kind,
      note: card.note,
      gameId: card.primaryGameId,
      at: input.at,
      gradingVersion: GRADING_VERSION,
      ...input.signals,
      showing,
      hintUsed: input.outcome?.hintUsed ?? false,
      tries: input.outcome?.tries ?? 1,
      solved: input.outcome?.solved ?? input.signals.correct,
      ...(input.steps ? { steps: input.steps } : {}),
      rating: input.grade,
      state: log.state,
      due: log.due,
      stability: log.stability,
      difficulty: log.difficulty,
      elapsedDays: log.elapsedDays,
      scheduledDays: log.scheduledDays,
      learningSteps: log.learningSteps,
      after: next,
    };
    const logId = (await db.reviewLogs.add(row)) as number;
    return { next, logId, card: { ...card, ...next } };
  });
}

/** What happened after the first attempt: hint, retries, whether you got there. */
export async function patchReview(logId: number, p: { hintUsed: boolean; tries: number; solved: boolean }): Promise<void> {
  await db.reviewLogs.update(logId, p);
}

export async function cacheEngineScore(cardId: string, s: MoveScore): Promise<void> {
  await db.srsCards
    .where('id')
    .equals(cardId)
    .modify((c) => {
      if (c.kind === 'best' || c.kind === 'seq') c.scored = { ...(c.scored ?? {}), [s.uci]: { loss: s.loss, best: s.best, reply: s.reply } };
    });
}
