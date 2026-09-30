// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeAnalysis, makeGame } from '../../test/positionFixtures';
import { db } from '../db';
import { syncPositionCards } from '../positions/store';
import { changedTables, tableVersion, watchDatabase } from './live';
import { queryClient } from './queryClient';

describe('database changes', () => {
  it('reads the table names out of Dexie change keys, for this database only', () => {
    const parts = { 'idb://chess-coach/games/': 1, 'idb://chess-coach/games/endTime': 1, 'idb://chess-coach/analyses/:dels': 1, 'idb://other/games/': 1 };
    expect([...changedTables(parts, 'chess-coach')].sort()).toEqual(['analyses', 'games']);
  });
});

describe('the cache follows the database', () => {
  const NOW = Date.UTC(2026, 8, 10, 12);
  beforeAll(async () => {
    await db.delete();
    await db.open();
    watchDatabase();
  });

  it('a change to a table refreshes the cached queries that read it, and only those', async () => {
    let games = 0;
    let other = 0;
    const g = queryClient.fetchQuery({ queryKey: ['t-games'], queryFn: async () => ++games, meta: { tables: ['games'] }, staleTime: Infinity });
    const o = queryClient.fetchQuery({ queryKey: ['t-other'], queryFn: async () => ++other, meta: { tables: ['narrations'] }, staleTime: Infinity });
    await Promise.all([g, o]);
    // Invalidation marks both kinds stale only when their table changes.
    await db.games.put(makeGame({ id: 'x1' }));
    await vi.waitFor(() => expect(queryClient.getQueryState(['t-games'])?.isInvalidated).toBe(true), { timeout: 3000 });
    expect(queryClient.getQueryState(['t-other'])?.isInvalidated).toBe(false);
  });

  it('the pipeline sync skips when no game or analysis changed, and runs again after one did', async () => {
    const game = makeGame({ id: 'p1', endTime: NOW - 86_400_000 });
    await db.games.put(game);
    await db.analyses.put(makeAnalysis(game, { 9: { loss: 12, winBefore: 50, winAfter: 38, classification: 'mistake' } }, { 8: [{ depth: 16, cp: 60, pv: ['c4b5'], stableFrom: 8 }] }, { version: 3 }));
    await vi.waitFor(() => expect(tableVersion('analyses')).toBeGreaterThan(0));
    const first = await syncPositionCards(undefined, NOW, { ifChanged: true });
    expect(first.created).toBe(1);
    await db.srsCards.clear(); // not a game nor an analysis: the next pipeline sync does not look
    expect((await syncPositionCards(undefined, NOW + 1, { ifChanged: true })).created).toBe(0);
    expect(await db.srsCards.count()).toBe(0);
    const v = tableVersion('analyses');
    await db.analyses.put({ ...(await db.analyses.get('p1'))!, createdAt: NOW });
    await vi.waitFor(() => expect(tableVersion('analyses')).toBeGreaterThan(v));
    expect((await syncPositionCards(undefined, NOW + 2, { ifChanged: true })).created).toBe(1);
  });
});
