import { queryOptions, useQuery } from '@tanstack/react-query';
import type { TableMeta } from './data/live.ts';
import { db } from './db.ts';
import type { GameAnalysis, StoredGame } from './types.ts';

export const dataKeys = {
  games: () => ['games'] as const,
  analyses: () => ['analyses'] as const,
  openings: (signature: string) => ['openings', signature] as const,
};

// Big lists: no structural sharing (it would walk 20 MB to keep references), and one copy for every screen.
export const gamesQuery = queryOptions({
  queryKey: dataKeys.games(),
  queryFn: (): Promise<StoredGame[]> => db.games.orderBy('endTime').reverse().toArray(),
  structuralSharing: false,
  meta: { tables: ['games'] } satisfies TableMeta,
});

export const analysesQuery = queryOptions({
  queryKey: dataKeys.analyses(),
  queryFn: async (): Promise<Map<string, GameAnalysis>> => new Map((await db.analyses.toArray()).map((a) => [a.gameId, a] as const)),
  structuralSharing: false,
  meta: { tables: ['analyses'] } satisfies TableMeta,
});

export function useGames(): StoredGame[] | undefined {
  return useQuery(gamesQuery).data;
}

export function useAnalyses(): Map<string, GameAnalysis> | undefined {
  return useQuery(analysesQuery).data;
}

/** All games (newest first) and a map of their analyses, cached across screens and kept in step with the database. */
export function useGamesAndAnalyses() {
  return { games: useGames(), analyses: useAnalyses() };
}
