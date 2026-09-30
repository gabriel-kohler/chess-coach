// Building sequences takes the engine a few seconds per position, so it runs
// ahead of need, for the positions that matter most to you, with its own
// Stockfish worker (the one that checks your moves stays free).
import { db, getKV, setKV } from '../db.ts';
import { Engine } from '../engine/stockfish.ts';
import { calibrate, calibrationSamples, CALIBRATION_KEY, DEFAULT_OFFSET, type Calibration } from '../maia/calibrate.ts';
import { maiaAvailable, maiaPolicies, maiaPolicy } from '../maia/client.ts';
import { gate } from '../renewal/activity.ts';
import { indexGames, type OpeningTree } from '../repertoire/games.ts';
import type { StoredGame } from '../types.ts';
import { POSITIONS } from './config.ts';
import { priorityOf } from './focus.ts';
import { humanReplies, likeliestReply, REPLIES } from './replies.ts';
import { cardsToWrite, seqCardsFor, staleReason } from './seqPlan.ts';
import { buildBranches, type SeqDeps } from './sequence.ts';
import type { PositionsSettings } from './settings.ts';
import { FOCUS_KEY } from './store.ts';
import type { BestMoveCard, FocusWeights, SequenceCard } from './types.ts';

/** Positions with no sequence (one-move lessons), by card id, with the signature checked. */
const SKIPPED_KEY = 'positions:seqSkipped';
const DAY = 86_400_000;

export async function maiaOffset(): Promise<number> {
  return (await getKV<Calibration | null>(CALIBRATION_KEY, null))?.offset ?? DEFAULT_OFFSET;
}

/**
 * One job at a time, shared by every caller: a second call (another tab
 * view, React's double effect) joins the running job and hears its progress.
 */
function shared<P, R>(start: (emit: (p: P) => void) => Promise<R>) {
  let job: Promise<R> | null = null;
  let last: P | null = null;
  const listeners = new Set<(p: P) => void>();
  return (onProgress?: (p: P) => void): Promise<R> => {
    if (onProgress) {
      listeners.add(onProgress);
      if (last) onProgress(last);
    }
    job ??= start((p) => {
      last = p;
      for (const l of listeners) l(p);
    }).finally(() => {
      job = null;
      last = null;
      listeners.clear();
    });
    return job;
  };
}

const calibrationJob = shared<{ done: number; total: number }, Calibration | null>(async (emit) => {
  const current = await getKV<Calibration | null>(CALIBRATION_KEY, null);
  if (current && Date.now() - current.at < 30 * DAY) return current;
  if (!(await maiaAvailable())) return current;
  const recent = await db.games.orderBy('endTime').reverse().filter((g) => g.timeClass === 'rapid' || g.timeClass === 'blitz').limit(120).toArray();
  const samples = calibrationSamples(recent, 300);
  if (samples.length < 50) return current;
  const c = await calibrate(samples, maiaPolicies, (done, total) => emit({ done, total }));
  await setKV(CALIBRATION_KEY, c);
  return c;
});

/**
 * Measures the rating offset on your recent games, once and then monthly.
 * About 45 seconds; returns the stored calibration when it is recent.
 */
export function ensureCalibration(onProgress?: (done: number, total: number) => void): Promise<Calibration | null> {
  return calibrationJob(onProgress ? (p) => onProgress(p.done, p.total) : undefined);
}

export interface BuildProgress {
  done: number;
  total: number;
}

let buildSettings: PositionsSettings | null = null;
const buildJob = shared<BuildProgress, { built: number; skipped: number }>((emit) => run(buildSettings!, emit, Date.now()));

/**
 * Makes sure the next positions in your queue have their sequences: enough
 * for the day's new sequences plus a few spare. One build at a time.
 */
export function ensureSequences(settings: PositionsSettings, onProgress?: (p: BuildProgress) => void): Promise<{ built: number; skipped: number }> {
  buildSettings = settings;
  return buildJob(onProgress);
}

async function run(settings: PositionsSettings, onProgress: ((p: BuildProgress) => void) | undefined, now: number) {
  if (!(await maiaAvailable())) return { built: 0, skipped: 0 };
  const [roots, seqs, weights, skipped] = await Promise.all([
    db.srsCards.where('kind').equals('best').filter((c) => !c.suspended).toArray() as Promise<BestMoveCard[]>,
    db.srsCards.where('kind').equals('seq').toArray() as Promise<SequenceCard[]>,
    getKV<FocusWeights | null>(FOCUS_KEY, null),
    getKV<Record<string, string>>(SKIPPED_KEY, {}),
  ]);
  const byRoot = new Map(roots.map((r) => [r.id, r]));
  const covered = new Set(seqs.filter((s) => !staleReason(s, byRoot.get(s.rootId))).map((s) => s.rootId));
  // Positions whose sequences you have not started yet: the spare supply.
  const unseen = new Set(seqs.filter((s) => s.reps === 0 && !s.suspended).map((s) => s.rootId));
  const want = settings.seqNewPerDay + 3;
  const need = Math.max(0, want - unseen.size);
  const todo = roots
    .filter((r) => !covered.has(r.id) && skipped[r.id] !== r.sig)
    .sort((a, b) => priorityOf(b, weights) - priorityOf(a, weights))
    .slice(0, need);
  if (!todo.length) return { built: 0, skipped: 0 };

  const offset = await maiaOffset();
  const engine = new Engine(32);
  let opening: Map<string, OpeningTree> | null = null;
  const treeFor = async (color: 'white' | 'black'): Promise<OpeningTree> => {
    opening ??= new Map();
    if (!opening.has(color)) {
      const games = (await db.games.toArray()) as StoredGame[];
      // The index cache lives for the page, so the key names the games: a sync
      // or another account builds a new tree instead of reusing the old one.
      const lastEnd = games.reduce((m, g) => Math.max(m, g.endTime), 0);
      const key = `sequences|${games.length}|${lastEnd}|${games[0]?.id ?? ''}`;
      opening.set(color, (await indexGames(games, color, null, key)).tree);
    }
    return opening.get(color)!;
  };
  let built = 0;
  let skip = 0;
  try {
    for (const [i, root] of todo.entries()) {
      onProgress?.({ done: i, total: todo.length });
      // A position at a time: while you train, your move checks get the CPU.
      await gate();
      const source = root.sources[0]!;
      const game = await db.games.get(source.gameId);
      const oppElo = (game?.oppRating ?? 1400) + offset;
      const userElo = (game?.userRating ?? 1400) + offset;
      const ply = source.ply - 1;
      // Your games as this color hold what opponents play in the opening.
      const tree = ply + 1 <= REPLIES.openingMaxPly ? await treeFor(root.color) : null;
      const ctx = (fen: string, p: number) => ({ fen, ply: p, tree, oppElo, userElo, policy: maiaPolicy });
      const deps: SeqDeps = {
        analyse: (fen) => engine.analyse(fen, { depth: POSITIONS.scoreDepth, multipv: 2 }),
        replies: (fen, p) => humanReplies(ctx(fen, p)),
        likeliest: (fen, p) => likeliestReply(ctx(fen, p)),
      };
      const branches = await buildBranches({ fen: root.fen, ply, color: root.color, best: root.best }, deps);
      if (!branches?.length) {
        skipped[root.id] = root.sig;
        skip++;
        continue;
      }
      const cards = seqCardsFor(root, branches, offset, now);
      await db.transaction('rw', db.srsCards, async () => {
        // The position may have changed while the engine worked.
        const fresh = (await db.srsCards.get(root.id)) as BestMoveCard | undefined;
        if (!fresh || fresh.suspended || fresh.best.uci !== root.best.uci) return;
        const current = (await db.srsCards.bulkGet(cards.map((c) => c.id))) as Array<SequenceCard | undefined>;
        await db.srsCards.bulkPut(cardsToWrite(cards, current, fresh));
      });
      built++;
    }
  } finally {
    engine.terminate();
    await setKV(SKIPPED_KEY, skipped);
    onProgress?.({ done: todo.length, total: todo.length });
  }
  return { built, skipped: skip };
}
