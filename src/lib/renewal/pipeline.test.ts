// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../test/positionFixtures';
import { db } from '../db';

// Everything heavy is replaced: the test is about what runs, when, and in which order.
const listeners: { synced?: () => void; switching?: () => void } = {};
let release: (() => void) | null = null;
const cardSyncs: number[] = [];
vi.mock('../chesscom/sync.ts', () => ({
  getAccount: async () => ({ username: 'me', syncedAt: Date.now() }),
  syncAccount: vi.fn(async () => 0),
  onSynced: (l: () => void) => ((listeners.synced = l), () => undefined),
  onSwitching: (l: () => void) => ((listeners.switching = l), () => undefined),
}));
vi.mock('../positions/store.ts', () => ({
  // The first pass waits until the test releases it, so later kicks pile up meanwhile.
  syncPositionCards: vi.fn(async () => {
    cardSyncs.push(Date.now());
    if (cardSyncs.length === 1) await new Promise<void>((r) => (release = r));
  }),
}));
vi.mock('./levelStore.ts', () => ({ checkLevel: vi.fn(async () => null), calibrateNewBand: vi.fn(async () => null) }));
vi.mock('../positions/seqStore.ts', () => ({ ensureCalibration: vi.fn(async () => null), ensureSequences: vi.fn(async () => ({ built: 0, skipped: 0 })) }));
vi.mock('./suggest.ts', () => ({ suggestGaps: vi.fn(async () => 0) }));
vi.mock('../repertoire/userChapters.ts', () => ({ loadMergedRepertoire: vi.fn(async () => null) }));
const queued: string[][] = [];
const cleared = vi.fn();
vi.mock('../review/queue.ts', () => ({
  setAutoQueue: (ids: string[]) => queued.push(ids),
  clearQueue: () => cleared(),
  whenIdle: async () => undefined,
  getQueueState: () => ({ running: false }),
}));

const { kick, startRenewal } = await import('./pipeline');

const NOW = Date.now();
beforeAll(async () => {
  await db.delete();
  await db.open();
  // 62 rated rapid games: the backlog takes the 60 most recent; bullet never counts.
  await db.games.bulkPut([
    ...Array.from({ length: 62 }, (_, i) => makeGame({ id: `r${String(i).padStart(2, '0')}`, endTime: NOW - i * 3_600_000, outcome: i % 3 === 0 ? 'loss' : 'win' })),
    makeGame({ id: 'bullet', timeClass: 'bullet', endTime: NOW, outcome: 'loss' }),
  ]);
  await db.analyses.put({ gameId: 'r00', version: 3, depth: 16, createdAt: 0, evals: [], moves: [], accuracy: { white: 0, black: 0 } });
});

beforeEach(() => {
  queued.length = 0;
});

describe('renewal pipeline', () => {
  it('kicks while it runs merge into one more pass', async () => {
    startRenewal();
    startRenewal(); // StrictMode: the second call does nothing
    await vi.waitFor(() => expect(release).not.toBeNull());
    void kick();
    void kick();
    void kick();
    release!();
    await kick();
    await vi.waitFor(() => expect(queued.length).toBeGreaterThanOrEqual(2));
    // The first pass, and one more for the three kicks that came during it.
    expect(cardSyncs.length).toBe(2);
  });

  it('queues the 60 most recent rapid and blitz games not analysed, losses first', async () => {
    await kick();
    const ids = queued.at(-1)!;
    expect(ids).toHaveLength(59); // 60 minus the one analysed
    expect(ids).not.toContain('bullet');
    expect(ids).not.toContain('r60');
    expect(ids).not.toContain('r00');
    const firstWin = ids.findIndex((id) => Number(id.slice(1)) % 3 !== 0);
    expect(ids.slice(0, firstWin).every((id) => Number(id.slice(1)) % 3 === 0)).toBe(true);
    expect(ids.slice(firstWin).every((id) => Number(id.slice(1)) % 3 !== 0)).toBe(true);
  });

  it('the cut stays where it was: new games are added, old ones never come in', async () => {
    await db.games.put(makeGame({ id: 'fresh', endTime: NOW + 60_000, outcome: 'draw' }));
    await kick();
    const ids = queued.at(-1)!;
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('r60');
  });

  it("another account's data going stops the queue first", () => {
    listeners.switching!();
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});
