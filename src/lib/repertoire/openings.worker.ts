/// <reference lib="webworker" />
// Replaying thousands of games for the opening tree and the repertoire gaps
// takes over a second: here it runs off the page's thread.
import type { OpeningsRequest, OpeningsResponse } from './openingsData.ts';
import { forgetIndexes, indexGames } from './games.ts';
import { repertoireGaps } from './gaps.ts';

self.onmessage = async (e: MessageEvent<OpeningsRequest>) => {
  const r = e.data;
  try {
    const serious = r.games.filter((g) => g.timeClass === 'rapid' || g.timeClass === 'blitz');
    const index =
      r.kind === 'all'
        ? { white: await indexGames(serious, 'white', r.sides.white, 'w', r.recentSince), black: await indexGames(serious, 'black', r.sides.black, 'b', r.recentSince) }
        : null;
    forgetIndexes();
    const gaps = await repertoireGaps(r.games, r.sides, r.now, r.since !== undefined ? { since: r.since } : {});
    self.postMessage({ id: r.id, index, gaps } satisfies OpeningsResponse);
  } catch (err) {
    self.postMessage({ id: r.id, error: (err as Error).message } satisfies OpeningsResponse);
  }
};
