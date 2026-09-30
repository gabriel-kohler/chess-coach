// The opening tree of your games and the repertoire gaps, worked out in a Web
// Worker and cached like any other data (keyed by the games and the
// repertoire they come from), so the Openings page never blocks and opens at
// once the second time.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryClient } from '../data/queryClient.ts';
import { db } from '../db.ts';
import { dataKeys, gamesQuery } from '../hooks.ts';
import type { Color, StoredGame } from '../types.ts';
import type { CompiledSide } from './compile.ts';
import { loadRepertoire, type CompiledRepertoire } from './data.ts';
import type { RepertoireGap } from './gaps.ts';
import { RECENT_DAYS, type GamesIndex } from './games.ts';
import { userChaptersSignature, withUserChapters } from './user.ts';

/** What the worker needs of a game: the first plies and a few fields, not the PGN. */
export type LightGame = Pick<StoredGame, 'id' | 'userColor' | 'initialFen' | 'outcome' | 'timeClass' | 'rated' | 'endTime' | 'moves'>;

const PLIES = 40;

export const lighten = (games: StoredGame[]): LightGame[] =>
  games.map((g) => ({ id: g.id, userColor: g.userColor, initialFen: g.initialFen, outcome: g.outcome, timeClass: g.timeClass, rated: g.rated, endTime: g.endTime, moves: g.moves.slice(0, PLIES) }));

export interface OpeningsRequest {
  id: number;
  kind: 'all' | 'gaps';
  games: LightGame[];
  sides: Record<Color, CompiledSide | null>;
  now: number;
  since?: number;
  /** The index also counts, per position, the games since this date. */
  recentSince?: number;
}

export type OpeningsResponse = { id: number; index: Record<Color, GamesIndex> | null; gaps: RepertoireGap[] } | { id: number; error: string };

export interface OpeningsData {
  index: Record<Color, GamesIndex>;
  gaps: RepertoireGap[];
}

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (r: OpeningsResponse) => void }>();

function ask(req: Omit<OpeningsRequest, 'id'>): Promise<OpeningsResponse> {
  worker ??= (() => {
    const w = new Worker(new URL('./openings.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<OpeningsResponse>) => {
      waiting.get(e.data.id)?.resolve(e.data);
      waiting.delete(e.data.id);
    };
    return w;
  })();
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, { resolve });
    worker!.postMessage({ ...req, id });
  });
}

async function run(req: Omit<OpeningsRequest, 'id'>): Promise<{ index: Record<Color, GamesIndex> | null; gaps: RepertoireGap[] }> {
  const r = await ask(req);
  if ('error' in r) throw new Error(r.error);
  return r;
}

export async function computeOpenings(games: StoredGame[], rep: CompiledRepertoire, now = Date.now()): Promise<OpeningsData> {
  const r = await run({ kind: 'all', games: lighten(games), sides: rep.sides, now, recentSince: now - RECENT_DAYS * 86_400_000 });
  return { index: r.index!, gaps: r.gaps };
}

/** Gaps only (from a date: the level review's band), off the page's thread. */
export async function computeGaps(games: StoredGame[], rep: CompiledRepertoire, since?: number, now = Date.now()): Promise<RepertoireGap[]> {
  return (await run({ kind: 'gaps', games: lighten(games), sides: rep.sides, now, since })).gaps;
}

/** Changes when new games arrive or the repertoire (file or your chapters) changes. */
export function openingsSignature(games: StoredGame[] | undefined, rep: CompiledRepertoire | null | undefined, chapters: string): string | null {
  if (!games || !rep) return null;
  return `${games.length}|${games[0]?.endTime ?? 0}|${rep.builtAt}|${chapters}`;
}

const openingsQuery = (signature: string, games: StoredGame[], rep: CompiledRepertoire) => ({
  queryKey: dataKeys.openings(signature),
  queryFn: () => computeOpenings(games, rep),
  structuralSharing: false,
  // Recomputed only when the games or the repertoire change: kept for the whole visit.
  gcTime: Infinity,
});

export function useOpeningsData(games: StoredGame[] | undefined, rep: CompiledRepertoire | null | undefined, chapters: string): OpeningsData | undefined {
  const signature = openingsSignature(games, rep, chapters);
  return useQuery({
    ...openingsQuery(signature ?? '', games ?? [], rep!),
    enabled: signature !== null,
    // New games: the previous tree stays on screen until the new one is ready.
    placeholderData: keepPreviousData,
  }).data;
}

/**
 * Works the openings out ahead, while the app is idle and after new games
 * arrive, so the Openings page finds them ready. Nothing runs twice for the
 * same games and repertoire.
 */
export async function prefetchOpenings(): Promise<void> {
  const loaded = await loadOpeningsData();
  if (!loaded) return;
  // Kept without a time limit, so older games' trees are let go here instead.
  queryClient.removeQueries({ queryKey: ['openings'], predicate: (q) => q.queryKey[1] !== loaded.signature && !q.getObserversCount() });
}

/**
 * The merged repertoire (file plus your chapters) and the openings of your
 * games, from the same cache as the Openings page: worked out once.
 */
export async function loadOpeningsData(): Promise<{ rep: CompiledRepertoire; data: OpeningsData; games: StoredGame[]; signature: string } | null> {
  const [games, base, chapters] = await Promise.all([queryClient.fetchQuery(gamesQuery), loadRepertoire(), db.userChapters.toArray()]);
  if (!base) return null;
  const rep = withUserChapters(base, chapters).rep;
  const signature = openingsSignature(games, rep, userChaptersSignature(chapters));
  if (!signature) return null;
  const data = await queryClient.fetchQuery(openingsQuery(signature, games, rep));
  return { rep, data, games, signature };
}
