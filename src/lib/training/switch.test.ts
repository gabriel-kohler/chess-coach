// @vitest-environment node
// Another account: its sessions go with its cards, and a change of the old
// account's session that was running is not written back.
import { beforeEach, expect, it, vi } from 'vitest';
import { db, getKV, setKV } from '../db';
import { TRAINING_KEYS } from './keys';

vi.mock('../chesscom/api.ts', () => ({
  getProfile: vi.fn(async (u: string) => ({ username: u })),
  getStats: vi.fn(async () => ({})),
  getArchives: vi.fn(async () => []),
  getArchive: vi.fn(async () => []),
}));
vi.mock('./sources.ts', () => ({ loadDaily: vi.fn(async () => ({ steps: [], leftover: 0, notes: [] })), loadWarmup: vi.fn(async () => ({ steps: [], notes: [] })) }));

const { syncAccount } = await import('../chesscom/sync');
const { openTraining, updateSession } = await import('./store');

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setKV('account', { username: 'me', profile: { username: 'me' }, stats: {}, syncedAt: 0 });
});

it('switching accounts clears the sessions, keeps your preference, and stops a write in flight', async () => {
  const s = await openTraining('daily');
  await openTraining('warmup');
  await setKV(TRAINING_KEYS.settings, { dailyMinutes: 45 });
  let letGo: (() => void) | null = null;
  const inFlight = updateSession('daily', async (x) => {
    await new Promise<void>((r) => (letGo = r));
    return { ...x, leftover: 99 };
  });
  // The change is under way (it read the session) when the switch starts.
  await vi.waitFor(() => expect(letGo).not.toBeNull());
  await syncAccount('other');
  letGo!();
  expect(await inFlight).toMatchObject({ id: s.id, leftover: 99 });
  expect(await getKV(TRAINING_KEYS.daily, null)).toBeNull();
  expect(await getKV(TRAINING_KEYS.warmup, null)).toBeNull();
  expect(await getKV(TRAINING_KEYS.settings, null)).toEqual({ dailyMinutes: 45 });
});
