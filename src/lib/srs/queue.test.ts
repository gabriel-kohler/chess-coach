import { State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { buildDailyQueue, localDay, pickNext, type LogLite, type QueueCard } from './queue';

const NOW = new Date(2026, 8, 10, 9, 0).getTime(); // 09:00 local
const day = localDay(NOW);
const HOUR = 3_600_000;

interface Card extends QueueCard {
  game: string | null;
  p: number;
}
let seq = 0;
const card = (over: Partial<Card>): Card => ({ id: `c${seq++}`, note: `n${seq}`, state: State.New, due: NOW, reps: 0, suspended: 0, createdAt: seq, game: null, p: 0, ...over });
const review = (over: Partial<Card> = {}) => card({ state: State.Review, reps: 3, ...over });
const build = (cards: Card[], logsToday: LogLite[] = [], limits = { newPerDay: 10, maxReviewsPerDay: 100 }, random = () => 0.5) =>
  buildDailyQueue({ cards, logsToday, now: NOW, day, limits, priority: (c) => c.p, groupOf: (c) => c.game, maxNewPerGroup: 2, random });
const log = (c: Card, state: State, at = NOW - HOUR): LogLite => ({ cardId: c.id, note: c.note, gameId: c.game, at, state });

describe('daily queue', () => {
  it('includes reviews due later today and leaves tomorrow out', () => {
    const tonight = review({ due: new Date(2026, 8, 10, 23, 0).getTime() });
    const tomorrow = review({ due: new Date(2026, 8, 11, 8, 0).getTime() });
    expect(build([tonight, tomorrow]).reviews).toEqual([tonight]);
  });

  it('orders reviews by due day, breaking ties at random', () => {
    const old = review({ due: NOW - 3 * 24 * HOUR });
    const a = review({ due: NOW - HOUR });
    const b = review({ due: NOW - 2 * HOUR });
    let n = 0;
    const seeded = () => [0.9, 0.1, 0.5][n++ % 3]!;
    const q = build([a, b, old], [], undefined, seeded).reviews;
    expect(q[0]).toBe(old);
    expect(new Set(q.slice(1))).toEqual(new Set([a, b]));
  });

  it('brings new cards by priority, up to the daily limit', () => {
    const low = card({ p: 1 });
    const high = card({ p: 9 });
    const mid = card({ p: 5 });
    expect(build([low, high, mid], [], { newPerDay: 2, maxReviewsPerDay: 100 }).news).toEqual([high, mid]);
  });

  it('counts cards already introduced today against the limit and the per-game cap', () => {
    const done = card({ game: 'g1' });
    const cards = [card({ game: 'g1', p: 3 }), card({ game: 'g1', p: 2 }), card({ game: 'g2', p: 1 })];
    const q = build([...cards, done], [log(done, State.New)], { newPerDay: 3, maxReviewsPerDay: 100 });
    expect(q.counts.newToday).toBe(1);
    expect(q.news.map((c) => c.game)).toEqual(['g1', 'g2']);
  });

  it('new cards never push the day past its review budget', () => {
    const due = Array.from({ length: 95 }, () => review({ due: NOW - HOUR }));
    const fresh = Array.from({ length: 10 }, () => card({}));
    const q = build([...due, ...fresh]);
    expect(q.reviews).toHaveLength(95);
    expect(q.news).toHaveLength(5);
  });

  it('buries siblings: a review beats its new sibling, and a sibling seen today waits', () => {
    const r = review({ note: 'root', due: NOW - HOUR });
    const n = card({ note: 'root' });
    expect(build([r, n]).news).toEqual([]);
    const other = card({ note: 'root2' });
    const sibling = card({ note: 'root2' });
    expect(build([sibling], [log(other, State.New)]).news).toEqual([]);
    // A card is not buried by its own earlier review today.
    const self = review({ note: 'root3', due: NOW - HOUR });
    expect(build([self], [log(self, State.Review)]).reviews).toEqual([self]);
  });

  it('a sibling done today in the other mode buries the card, without counting against this mode', () => {
    const seq = card({ note: 'pos', game: 'g9' });
    const bestDone = card({ note: 'pos' });
    const q = buildDailyQueue({ cards: [seq], logsToday: [], siblingLogs: [log(bestDone, State.New)], now: NOW, day, limits: { newPerDay: 5, maxReviewsPerDay: 50 }, priority: () => 1, groupOf: (c) => c.game, maxNewPerGroup: 2 });
    expect(q.news).toEqual([]);
    expect(q.counts.newToday).toBe(0);
  });

  it('learning cards are never capped, suspended cards never shown', () => {
    const learning = Array.from({ length: 5 }, (_, k) => card({ state: State.Learning, reps: 1, due: NOW + k }));
    const q = build([...learning, card({ suspended: 1 })], [], { newPerDay: 0, maxReviewsPerDay: 0 });
    expect(q.learning).toHaveLength(5);
    expect(q.news).toHaveLength(0);
  });
});

describe('next card', () => {
  const MIN = 60_000;
  it('takes a due learning card first, but not the one just shown', () => {
    const l1 = card({ state: State.Learning, due: NOW - MIN });
    const q1 = review();
    expect(pickNext({ queue: [q1], learning: new Map([[l1.id, l1]]), lastId: null }, NOW, 20 * MIN)).toEqual({ card: l1, from: 'learning' });
    expect(pickNext({ queue: [q1], learning: new Map([[l1.id, l1]]), lastId: l1.id }, NOW, 20 * MIN)).toEqual({ card: q1, from: 'queue' });
  });

  it('shows the same learning card again when nothing else is left', () => {
    const l1 = card({ state: State.Learning, due: NOW - MIN });
    expect(pickNext({ queue: [], learning: new Map([[l1.id, l1]]), lastId: l1.id }, NOW, 20 * MIN)?.card).toBe(l1);
  });

  it('learns ahead up to 20 minutes, then ends', () => {
    const soon = card({ state: State.Learning, due: NOW + 10 * MIN });
    expect(pickNext({ queue: [], learning: new Map([[soon.id, soon]]), lastId: null }, NOW, 20 * MIN)).toEqual({ card: soon, from: 'ahead' });
    const later = card({ state: State.Learning, due: NOW + 30 * MIN });
    expect(pickNext({ queue: [], learning: new Map([[later.id, later]]), lastId: null }, NOW, 20 * MIN)).toBeNull();
  });
});
