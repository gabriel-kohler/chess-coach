import { db, getKV, setKV } from '../db.ts';
import type { ArchiveMeta } from '../types.ts';
import { getArchive, getArchives, getProfile, getStats, type CCProfile, type CCStats } from './api.ts';
import { toStoredGame } from './import.ts';

export interface SyncProgress {
  phase: 'profile' | 'archives' | 'games' | 'done';
  month?: string;
  done: number;
  total: number;
  added: number;
}

export interface Account {
  username: string;
  profile: CCProfile;
  stats: CCStats;
  syncedAt: number;
}

export const getAccount = () => getKV<Account | null>('account', null);

/** A month is final once we fetched it after the month ended. */
function isComplete(month: string, fetchedAt: number): boolean {
  const [y, m] = month.split('/').map(Number) as [number, number];
  const monthEnd = Date.UTC(y, m, 1); // first instant of the next month
  return fetchedAt > monthEnd + 60 * 60 * 1000;
}

// One sync at a time: two overlapping runs (a Sync button and the Home
// auto-sync, or an account switch) would interleave writes from both.
let running: Promise<unknown> = Promise.resolve();

export function syncAccount(username: string, onProgress?: (p: SyncProgress) => void): Promise<number> {
  const job = running.then(() => runSync(username, onProgress));
  running = job.catch(() => undefined);
  return job;
}

async function runSync(username: string, onProgress?: (p: SyncProgress) => void): Promise<number> {
  onProgress?.({ phase: 'profile', done: 0, total: 1, added: 0 });
  // Validate the account before touching local data: a typo or a network
  // error must not wipe the reviews of the current account.
  const [profile, stats] = await Promise.all([getProfile(username), getStats(username)]);
  const archives = await getArchives(username);

  const current = await getAccount();
  if (current && current.username.toLowerCase() !== profile.username.toLowerCase()) {
    // A different account: its games, reviews and own-game puzzles go.
    await db.transaction('rw', [db.games, db.archives, db.analyses, db.puzzleCards, db.kv], async () => {
      await Promise.all([db.games.clear(), db.archives.clear(), db.analyses.clear()]);
      await db.puzzleCards.filter((c) => c.puzzle.source === 'mine').delete();
      await db.kv.delete('gameMotifs');
      await db.kv.put({ key: 'account', value: { username: profile.username, profile, stats, syncedAt: 0 } satisfies Account });
    });
  }

  const known = new Map((await db.archives.toArray()).map((a) => [a.url, a]));
  const pending = archives.filter((url) => !known.get(url)?.complete).reverse(); // newest first
  let added = 0;
  let done = 0;
  for (const url of pending) {
    const month = url.split('/games/')[1] ?? url;
    onProgress?.({ phase: 'games', month, done, total: pending.length, added });
    const games = await getArchive(url);
    const stored = games.map((g) => toStoredGame(g, profile.username, month)).filter((g) => g !== null);
    const before = await db.games.where('archive').equals(month).count();
    await db.games.bulkPut(stored);
    added += Math.max(0, stored.length - before);
    const now = Date.now();
    const meta: ArchiveMeta = { url, month, fetchedAt: now, complete: isComplete(month, now), count: stored.length };
    await db.archives.put(meta);
    done++;
  }

  await setKV<Account>('account', { username: profile.username, profile, stats, syncedAt: Date.now() });
  onProgress?.({ phase: 'done', done, total: pending.length, added });
  return added;
}
