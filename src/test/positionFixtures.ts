// Small builders for games and analyses in tests. FENs come from replay(), so
// every position is legal; the engine numbers are whatever the test sets.
import { replay } from '../lib/chess/replay';
import type { EngineLine, GameAnalysis, MoveReview, StoredGame } from '../lib/types';

export const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Bd2', 'Bxd2+', 'Nbxd2', 'd5'];

export function makeGame(over: Partial<StoredGame> = {}): StoredGame {
  return {
    id: 'g1',
    url: '',
    archive: '2026/09',
    timeClass: 'rapid',
    timeControl: '600',
    rated: true,
    endTime: Date.UTC(2026, 8, 1),
    userColor: 'white',
    userRating: 1370,
    oppRating: 1380,
    oppName: 'rival',
    outcome: 'loss',
    userResult: 'resigned',
    oppResult: 'win',
    moves: ITALIAN,
    clocks: ITALIAN.map(() => 300),
    pgn: '',
    ...over,
  };
}

export function makeAnalysis(
  game: StoredGame,
  over: Record<number, Partial<MoveReview>> = {},
  lines: Record<number, EngineLine[]> = {},
  meta: Partial<Pick<GameAnalysis, 'version' | 'createdAt' | 'depth'>> = {},
): GameAnalysis {
  const plies = replay(game.moves, game.initialFen);
  const moves: MoveReview[] = plies.map((p, i) => ({
    ply: i + 1,
    color: i % 2 === 0 ? 'white' : 'black',
    san: p.san,
    uci: p.uci,
    fenBefore: p.fenBefore,
    fenAfter: p.fenAfter,
    classification: 'best',
    winBefore: 50,
    winAfter: 50,
    accuracy: 100,
    scoreAfter: { cp: 0 },
    loss: 0,
    timeSpent: 10,
    clock: 300,
    ...over[i + 1],
  }));
  const evals = Array.from({ length: plies.length + 1 }, (_, i) => ({
    fen: i === 0 ? plies[0]!.fenBefore : plies[i - 1]!.fenAfter,
    lines: lines[i] ?? [{ depth: 16, cp: 0, pv: plies[i] ? [plies[i]!.uci] : [] }],
  }));
  return { gameId: game.id, version: 3, depth: 16, createdAt: 1000, evals, moves, accuracy: { white: 80, black: 80 }, ...meta };
}
