import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.ts';

/** All games (newest first) and a map of their analyses, kept live. */
export function useGamesAndAnalyses() {
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []);
  const analyses = useLiveQuery(async () => new Map((await db.analyses.toArray()).map((a) => [a.gameId, a] as const)), []);
  return { games, analyses };
}
