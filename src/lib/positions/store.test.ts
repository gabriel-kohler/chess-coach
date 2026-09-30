// @vitest-environment node
// Dexie needs no DOM. fake-indexeddb comes from src/test/setup.ts.
import { Rating, State, type Grade } from 'ts-fsrs';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeAnalysis, makeGame } from '../../test/positionFixtures';
import { db } from '../db';
import { newPuzzleCard } from '../srs/cards';
import { LEGACY_MINE_KEY } from '../srs/migrate';
import type { FsrsFields } from '../srs/types';
import type { EngineLine } from '../types';
import { loadDailyQueue, positionsTodayCounts, recordReview, syncPositionCards, type RecordInput } from './store';
import type { BestMoveCard } from './types';

const NOW = new Date(2026, 8, 10, 9, 0).getTime();
const DAY = 86_400_000;
const limits = { newPerDay: 10, maxReviewsPerDay: 100, seqNewPerDay: 5, seqMaxReviewsPerDay: 50 };
const bestCards = async () => (await db.srsCards.where('kind').equals('best').toArray()) as BestMoveCard[];
const best = (uci: string): EngineLine[] => [{ depth: 16, cp: 60, pv: [uci, 'a7a6'], stableFrom: 8 }];

// One game, three of your moves lost points: 7.c3, 9.d4 and 15.Nbxd2.
function fixture(loss7 = 8, version = 3) {
  const game = makeGame({ endTime: NOW - 86_400_000 });
  const analysis = makeAnalysis(
    game,
    {
      7: { loss: loss7, winBefore: 55, winAfter: 55 - loss7, classification: 'inaccuracy' },
      9: { loss: 12, winBefore: 50, winAfter: 38, classification: 'mistake' },
      15: { loss: 25, winBefore: 50, winAfter: 25, classification: 'blunder' },
    },
    { 6: best('c4b5'), 8: best('c4b5'), 14: best('f3d2') },
    { version },
  );
  return { game, analysis };
}

async function seed(loss7 = 8, version = 3) {
  const { game, analysis } = fixture(loss7, version);
  await db.games.put(game);
  await db.analyses.put(analysis);
}

const input = (cardId: string, attemptId = 'a1', grade: Grade = Rating.Good): RecordInput => ({
  attemptId,
  cardId,
  at: NOW,
  grade,
  signals: { uci: 'c4b5', loss: 0, lossSource: 'best', exact: true, correct: true, timeMs: 8000, hiddenMs: 0, expectedMs: 20000, bucket: 'medium', gaveUp: false },
});

beforeEach(async () => {
  await db.delete(); // Dexie 4.4 closes the database and does not reopen it by itself
  await db.open();
});

describe('position cards in the database', () => {
  it('the first sync creates the cards, the second changes nothing', async () => {
    await seed();
    const first = await syncPositionCards(undefined, NOW);
    expect(first.created).toBe(3);
    const second = await syncPositionCards(undefined, NOW + 1);
    expect(second).toMatchObject({ created: 0, updated: 0, removed: 0, suspended: 0, unchanged: 3 });
  });

  it('a re-scored analysis after a review keeps the review history', async () => {
    await seed(8, 2);
    await syncPositionCards(undefined, NOW);
    const card = (await bestCards()).find((c) => c.sources[0]!.ply === 7)!;
    await recordReview(input(card.id));
    const reviewed = (await db.srsCards.get(card.id))!;
    await seed(12, 3);
    const r = await syncPositionCards(undefined, NOW + 1);
    // The new analysis version changes the signature of all three cards.
    expect(r.updated).toBe(3);
    const after = (await db.srsCards.get(card.id)) as BestMoveCard;
    expect(after.totalLoss).toBe(12);
    expect([after.reps, after.state, after.due]).toEqual([reviewed.reps, reviewed.state, reviewed.due]);
  });

  it('the same attempt saved twice counts once', async () => {
    await seed();
    await syncPositionCards(undefined, NOW);
    const [card] = await db.srsCards.toArray();
    await recordReview(input(card!.id));
    await recordReview(input(card!.id));
    expect(await db.reviewLogs.count()).toBe(1);
    expect((await db.srsCards.get(card!.id))!.reps).toBe(1);
  });

  it('a sync running during a review never overwrites it', async () => {
    await seed();
    await syncPositionCards(undefined, NOW);
    const [card] = await db.srsCards.toArray();
    await Promise.all([recordReview(input(card!.id)), syncPositionCards(undefined, NOW + 1)]);
    expect((await db.srsCards.get(card!.id))!.reps).toBe(1);
  });

  it('counts today: one new position done leaves one more from that game', async () => {
    await seed();
    await syncPositionCards(undefined, NOW);
    expect((await positionsTodayCounts('best', limits, NOW)).news).toBe(2); // two per game
    const q = await loadDailyQueue('best', limits, NOW);
    await recordReview(input(q.news[0]!.id, 'a1', Rating.Again));
    const after = await positionsTodayCounts('best', limits, NOW + 1000);
    expect(after.news).toBe(1);
    expect(after.doneToday).toBe(1);
    // The missed card is in learning, due in a minute: not yet counted as due.
    expect(after.reviews).toBe(0);
    expect((await positionsTodayCounts('best', limits, NOW + 61_000)).reviews).toBe(1);
  });

  it('a deleted analysis suspends a reviewed card and removes the rest', async () => {
    await seed();
    await syncPositionCards(undefined, NOW);
    const [card] = await db.srsCards.toArray();
    await recordReview(input(card!.id));
    await db.analyses.clear();
    const r = await syncPositionCards(undefined, NOW + 1);
    expect(r).toMatchObject({ suspended: 1, removed: 2 });
    const kept = (await db.srsCards.get(card!.id))!;
    expect(kept.suspended).toBe(1);
    expect(kept.state).not.toBe(State.New);
  });

  it('creates the card on its first review when asked to, and only then', async () => {
    const puzzle = { id: 'p1', source: 'lichess' as const, fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2', 'a7a6'], rating: 1500, themes: [] };
    await expect(recordReview(input('puzzle:p1'))).rejects.toThrow('not found');
    await expect(recordReview({ ...input('puzzle:p1'), create: newPuzzleCard({ ...puzzle, id: 'other' }, NOW) })).rejects.toThrow('not found');
    await recordReview({ ...input('puzzle:p1', 'a2', Rating.Again), create: newPuzzleCard(puzzle, NOW) });
    const card = (await db.srsCards.get('puzzle:p1'))!;
    expect([card.kind, card.reps]).toEqual(['puzzle', 1]);
    // Puzzles skip the same-day steps: a miss comes back tomorrow, as before FSRS.
    expect(card.due - NOW).toBe(DAY);
  });
});

// Two games: 7.c3 and 9.d4 lost points two days ago, 15.Nbxd2 twenty days ago.
async function seedTwoGames() {
  const recent = makeGame({ id: 'recent', endTime: NOW - 2 * DAY });
  const old = makeGame({ id: 'old', endTime: NOW - 20 * DAY });
  await db.games.bulkPut([recent, old]);
  await db.analyses.bulkPut([
    makeAnalysis(
      recent,
      { 7: { loss: 8, winBefore: 55, winAfter: 47, classification: 'inaccuracy' }, 9: { loss: 12, winBefore: 50, winAfter: 38, classification: 'mistake' } },
      { 6: best('c4b5'), 8: best('c4b5') },
      { version: 3 },
    ),
    makeAnalysis(old, { 15: { loss: 25, winBefore: 50, winAfter: 25, classification: 'blunder' } }, { 14: best('f3d2') }, { version: 3 }),
  ]);
  await syncPositionCards(undefined, NOW);
}

describe('the "only my mistakes" period', () => {
  const gamesIn = async (days: number, now = NOW) => (await loadDailyQueue('best', limits, now, days)).news.map((c) => c.sources[0]!.gameId).sort();

  it('keeps only positions from games of the chosen period', async () => {
    await seedTwoGames();
    expect(await gamesIn(7)).toEqual(['recent', 'recent']);
    expect(await gamesIn(30)).toEqual(['old', 'recent', 'recent']);
    expect(await gamesIn(0)).toEqual(['old', 'recent', 'recent']);
    // The old game's position is new, not a review: nothing due is left out.
    expect(await positionsTodayCounts('best', limits, NOW, 7)).toMatchObject({ inPeriod: 2, total: 3, news: 2, outside: 0 });
  });

  it('never serves a position before its review date', async () => {
    await seedTwoGames();
    const [a, b] = (await loadDailyQueue('best', limits, NOW, 7)).news;
    await recordReview(input(a!.id, 'a1', Rating.Easy));
    await recordReview(input(b!.id, 'a2', Rating.Easy));
    const c = await positionsTodayCounts('best', limits, NOW + 1000, 7);
    expect(c.reviews + c.news).toBe(0);
    expect(c.nextDue).toBeGreaterThan(NOW + 2 * DAY);
  });

  it('counts the reviews due today that the period leaves out', async () => {
    await seedTwoGames();
    const old = (await bestCards()).find((c) => c.sources[0]!.gameId === 'old')!;
    await recordReview(input(old.id, 'a1', Rating.Easy));
    // Ten days later the old game is 30 days back, the recent one 12: a 14-day period leaves the review out.
    const later = NOW + 10 * DAY;
    const c = await positionsTodayCounts('best', limits, later, 14);
    expect(c.outside).toBe(1);
    expect(await gamesIn(14, later)).toEqual(['recent', 'recent']);
    expect((await positionsTodayCounts('best', limits, later, 0)).reviews).toBe(1);
  });
});

describe('own-game progress from the old tactics queue', () => {
  const learned = (over: Partial<FsrsFields> = {}): FsrsFields => ({
    due: NOW + 3 * DAY, stability: 7, difficulty: 4, elapsed_days: 0, scheduled_days: 7, learning_steps: 0, reps: 2, lapses: 0, state: State.Review, last_review: NOW - 4 * DAY, ...over,
  });

  it('a position never reviewed here takes the most recent progress of its games, once', async () => {
    await seed();
    await db.kv.put({ key: LEGACY_MINE_KEY, value: { 'g1:9': learned() } });
    await syncPositionCards(undefined, NOW);
    const card = (await bestCards()).find((c) => c.sources[0]!.ply === 9)!;
    expect([card.state, card.stability, card.due, card.last_review]).toEqual([State.Review, 7, NOW + 3 * DAY, NOW - 4 * DAY]);
    expect(await db.kv.get(LEGACY_MINE_KEY)).toBeUndefined();
    // The other positions of the game had no progress to take.
    expect((await bestCards()).filter((c) => c.state === State.New)).toHaveLength(2);
    expect((await syncPositionCards(undefined, NOW + 1)).updated).toBe(0);
  });

  it('a position with reviews of its own keeps them, and unmatched progress waits', async () => {
    await seed();
    await syncPositionCards(undefined, NOW);
    const card = (await bestCards()).find((c) => c.sources[0]!.ply === 9)!;
    await recordReview(input(card.id));
    const mine = await db.srsCards.get(card.id);
    await db.kv.put({ key: LEGACY_MINE_KEY, value: { 'g1:9': learned(), 'g2:5': learned() } });
    await syncPositionCards(undefined, NOW + 1);
    expect(await db.srsCards.get(card.id)).toEqual(mine);
    expect((await db.kv.get(LEGACY_MINE_KEY))?.value).toEqual({ 'g2:5': learned() });
  });
});
