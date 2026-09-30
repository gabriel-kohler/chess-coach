// What runs by itself after each sync, so the training keeps up with your
// games without a script: the Posições cards and focuses, the level review,
// the automatic analysis of your new games and, when the queue is idle and
// you are not training, the Maia calibration and the repertoire gap
// suggestions. A stale sync (older than 10 minutes) runs on its own too.
import { getAccount, onSwitching, onSynced, syncAccount } from '../chesscom/sync.ts';
import { db, getKV, setKV } from '../db.ts';
import { syncPositionCards } from '../positions/store.ts';
import { ensureCalibration, ensureSequences } from '../positions/seqStore.ts';
import { loadPositionsSettings } from '../positions/settings.ts';
import { computeGaps } from '../repertoire/openingsData.ts';
import { loadMergedRepertoire } from '../repertoire/userChapters.ts';
import { clearQueue, getQueueState, setAutoQueue, whenIdle } from '../review/queue.ts';
import { gate } from './activity.ts';
import { ACCOUNT_KEYS, RENEWAL } from './config.ts';
import { calibrateNewBand, checkLevel } from './levelStore.ts';
import { backlogCut, selectAutoGames, type AutoCandidate } from './select.ts';
import { suggestGaps } from './suggest.ts';

let started = false;
let running: Promise<void> | null = null;
let dirty = false;
let idle: Promise<void> | null = null;

/**
 * Starts the renewal once per page load: Layout calls it, StrictMode may call
 * it twice. With the app open in several tabs only one runs it (a Web Lock
 * held while the tab lives), so the same games are never analysed twice; when
 * that tab closes, another takes over.
 */
export function startRenewal(): void {
  if (started) return;
  started = true;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) void locks.request('chess-coach:renewal', () => (run(), new Promise<void>(() => undefined)));
  else run();
}

function run(): void {
  onSynced(() => void kick());
  // Another account's data is about to go: nothing may keep writing it.
  onSwitching(() => clearQueue());
  void syncIfStale().finally(() => void kick());
  setInterval(() => void syncIfStale(), RENEWAL.syncEveryMs);
}

async function syncIfStale(): Promise<void> {
  const account = await getAccount();
  if (!account || Date.now() - account.syncedAt <= RENEWAL.syncEveryMs) return;
  await syncAccount(account.username).catch(() => undefined);
}

/** Runs the renewal; calls while it runs are merged into one more pass. */
export function kick(): Promise<void> {
  if (running) {
    dirty = true;
    return running;
  }
  running = (async () => {
    do {
      dirty = false;
      await renewOnce();
    } while (dirty);
  })().finally(() => {
    running = null;
    void whenQueueIdle();
  });
  return running;
}

async function renewOnce(now = Date.now()): Promise<void> {
  await syncPositionCards(undefined, now, { ifChanged: true }).catch((e) => console.warn('renewal cards:', e));
  await checkLevel(now).catch((e) => console.warn('renewal level:', e));
  const since = await backlogStart();
  if (since === null) return;
  const games = (await db.games.where('endTime').aboveOrEqual(since).toArray()) as AutoCandidate[];
  const analysed = new Set((await db.analyses.where('gameId').anyOf(games.map((g) => g.id)).primaryKeys()) as string[]);
  setAutoQueue(selectAutoGames(games, analysed, since));
}

/** Where the automatic analysis starts: your 60th most recent game that counts, fixed the first time. */
async function backlogStart(): Promise<number | null> {
  const kept = await getKV<number | null>(ACCOUNT_KEYS.backlogSince, null);
  if (kept !== null) return kept;
  const recent = (await db.games.orderBy('endTime').reverse().filter((g) => g.rated && (g.timeClass === 'rapid' || g.timeClass === 'blitz')).limit(RENEWAL.backlogGames).toArray()) as AutoCandidate[];
  const cut = backlogCut(recent);
  if (cut !== null) await setKV(ACCOUNT_KEYS.backlogSince, cut);
  return cut;
}

/** The lighter jobs wait for an idle queue and no training, then run once. */
function whenQueueIdle(): Promise<void> {
  idle ??= (async () => {
    do {
      await whenIdle();
      await gate();
    } while (getQueueState().running);
    await ensureCalibration().catch((e) => console.warn('renewal calibration:', e));
    await calibrateNewBand().catch((e) => console.warn('renewal band calibration:', e));
    // The day's new sequences, built ahead also for whoever only trains in Treinar.
    await ensureSequences(await loadPositionsSettings()).catch((e) => console.warn('renewal sequences:', e));
    const rep = await loadMergedRepertoire();
    if (rep) {
      const games = await db.games.where('endTime').aboveOrEqual(Date.now() - RENEWAL.gapsDays * 86_400_000).toArray();
      const gaps = await computeGaps(games, rep);
      await suggestGaps(gaps).catch((e) => console.warn('renewal gaps:', e));
    }
  })().finally(() => (idle = null));
  return idle;
}
