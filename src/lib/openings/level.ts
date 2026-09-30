// Your level on the Lichess and Maia scale, for "people at your level": your
// chess.com rapid rating plus the offset measured on your games (Maia's
// calibration; the default until it runs), and which sources can answer.
import { getAccount } from '../chesscom/sync.ts';
import { DEFAULT_OFFSET } from '../maia/calibrate.ts';
import { maiaAvailable } from '../maia/client.ts';
import { maiaOffset } from '../positions/seqStore.ts';
import { explorerAvailable } from './explorer.ts';

export interface Level {
  /** Your chess.com rapid rating. */
  rating: number;
  /** On the Lichess / Maia scale. */
  userElo: number;
  oppElo: number;
  maia: boolean;
  /** The server has a Lichess token. */
  explorer: boolean;
}

export const NO_RATING = 1400;

export async function loadLevel(): Promise<Level> {
  const [account, offset, maia, explorer] = await Promise.all([getAccount(), maiaOffset().catch(() => DEFAULT_OFFSET), maiaAvailable(), explorerAvailable()]);
  const rating = account?.stats.chess_rapid?.last?.rating ?? NO_RATING;
  const elo = rating + offset;
  return { rating, userElo: elo, oppElo: elo, maia, explorer };
}
