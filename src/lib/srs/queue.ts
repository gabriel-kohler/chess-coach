// The day's queue: due reviews first, ordered by due day with a
// random tie-break, then new cards up to the daily limit; siblings buried;
// new cards never push the day past its review budget. Days are local days
// (midnight in Brazil), not UTC, so the day does not turn at 21:00.
import { State } from 'ts-fsrs';

export interface QueueCard {
  id: string;
  note: string;
  state: State;
  due: number;
  reps: number;
  suspended: 0 | 1;
  createdAt: number;
}

/** What the queue needs from today's review logs. */
export interface LogLite {
  cardId: string;
  note: string;
  gameId: string | null;
  at: number;
  /** State of the card before the review. */
  state: State;
}

export interface DayRange {
  start: number;
  end: number;
}

export function localDay(now: number): DayRange {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { start, end };
}

export interface DailyQueue<C> {
  learning: C[];
  reviews: C[];
  news: C[];
  counts: { newToday: number; reviewsToday: number };
}

export interface QueueInput<C extends QueueCard> {
  cards: C[];
  logsToday: LogLite[];
  now: number;
  day: DayRange;
  limits: { newPerDay: number; maxReviewsPerDay: number };
  priority: (c: C) => number;
  groupOf: (c: C) => string | null;
  maxNewPerGroup: number;
  random?: () => number;
  /** Today's logs of every card kind, for burying siblings across modes. Defaults to logsToday. */
  siblingLogs?: LogLite[];
}

const DAY_MS = 86_400_000;
const isLearning = (s: State) => s === State.Learning || s === State.Relearning;

export function buildDailyQueue<C extends QueueCard>(i: QueueInput<C>): DailyQueue<C> {
  const random = i.random ?? Math.random;
  const active = i.cards.filter((c) => !c.suspended);
  const introduced = new Set(i.logsToday.filter((l) => l.state === State.New).map((l) => l.cardId));
  const reviewsToday = i.logsToday.filter((l) => l.state === State.Review).length;

  const learning = active.filter((c) => isLearning(c.state) && c.due < i.day.end).sort((a, b) => a.due - b.due);

  const dayOf = (t: number) => Math.floor((t - i.day.start) / DAY_MS);
  const keyed = active.filter((c) => c.state === State.Review && c.due < i.day.end).map((c) => ({ c, day: dayOf(c.due), r: random() }));
  keyed.sort((a, b) => a.day - b.day || a.r - b.r);
  let reviewPool = keyed.map((k) => k.c);

  let newPool = active
    .filter((c) => c.state === State.New && c.reps === 0)
    .map((c) => ({ c, p: i.priority(c) }))
    .sort((a, b) => b.p - a.p || a.c.createdAt - b.c.createdAt)
    .map((x) => x.c);

  // Bury siblings: one card per note, and none whose sibling was already seen today.
  const seenToday = new Map<string, Set<string>>();
  for (const l of i.siblingLogs ?? i.logsToday) {
    const s = seenToday.get(l.note) ?? new Set<string>();
    s.add(l.cardId);
    seenToday.set(l.note, s);
  }
  const kept = new Set<string>();
  const usedNotes = new Set<string>();
  for (const c of [...reviewPool, ...newPool]) {
    if (usedNotes.has(c.note)) continue;
    const today = seenToday.get(c.note);
    if (today && [...today].some((id) => id !== c.id)) continue;
    usedNotes.add(c.note);
    kept.add(c.id);
  }
  reviewPool = reviewPool.filter((c) => kept.has(c.id));
  newPool = newPool.filter((c) => kept.has(c.id));

  const reviewLeft = Math.max(0, i.limits.maxReviewsPerDay - reviewsToday);
  const reviews = reviewPool.slice(0, reviewLeft);
  const newLeft = Math.max(0, i.limits.newPerDay - introduced.size);
  const newCap = Math.min(newLeft, Math.max(0, reviewLeft - reviews.length));

  const perGroup = new Map<string, number>();
  for (const l of i.logsToday) {
    if (l.state !== State.New || !l.gameId) continue;
    perGroup.set(l.gameId, (perGroup.get(l.gameId) ?? 0) + 1);
  }
  const news: C[] = [];
  for (const c of newPool) {
    if (news.length >= newCap) break;
    const g = i.groupOf(c);
    if (g) {
      const n = perGroup.get(g) ?? 0;
      if (n >= i.maxNewPerGroup) continue;
      perGroup.set(g, n + 1);
    }
    news.push(c);
  }

  return { learning, reviews, news, counts: { newToday: introduced.size, reviewsToday } };
}

export interface SessionState<C> {
  /** Reviews then new cards, in the order built for the day. */
  queue: C[];
  /** Cards in (re)learning, keyed by id, with their current due. */
  learning: Map<string, C>;
  lastId: string | null;
}

export type Pick<C> = { card: C; from: 'learning' | 'queue' | 'ahead' } | null;

/**
 * Next card: a due learning card (not the one just shown, unless nothing else
 * is left), else the queue, else a learning card due soon, else the end.
 */
export function pickNext<C extends QueueCard>(s: SessionState<C>, now: number, learnAheadMs: number): Pick<C> {
  const learning = [...s.learning.values()].sort((a, b) => a.due - b.due);
  const due = learning.filter((c) => c.due <= now);
  const fresh = due.find((c) => c.id !== s.lastId);
  if (fresh) return { card: fresh, from: 'learning' };
  if (s.queue.length) return { card: s.queue[0]!, from: 'queue' };
  if (due.length) return { card: due[0]!, from: 'learning' };
  const soon = learning.find((c) => c.due <= now + learnAheadMs);
  return soon ? { card: soon, from: 'ahead' } : null;
}
