// Repertoire gaps: moves your opponents played outside your repertoire, in a
// position where you do have one, over the last 6 months of rated rapid and
// blitz. A reply that transposes back into the repertoire is no gap, the same
// as in the build: its answer is already there.
import { Chess } from 'chess.js';
import { countsForFocus } from '../positions/focus.ts';
import { RENEWAL } from '../renewal/config.ts';
import type { Color, StoredGame } from '../types.ts';
import { epdOf, turnOf, type CompiledSide } from './compile.ts';

export interface RepertoireGap {
  side: Color;
  /** Where the opponent left the repertoire, with their move to play. */
  epd: string;
  fen: string;
  san: string;
  uci: string;
  /** After their move: your turn, where the answer goes. */
  childEpd: string;
  childFen: string;
  /** Moves from the start to the child position (SAN), the gap move last. */
  path: string[];
  games: string[];
  lastPlayed: number;
}

const DAY = 86_400_000;
const MAX_PLY = 40;

/** The fields the gaps read: a game without its PGN is enough. */
export type GapGame = Pick<StoredGame, 'id' | 'userColor' | 'initialFen' | 'moves' | 'timeClass' | 'rated' | 'endTime'>;

/** Where one game left the repertoire, if the opponent did it. */
function gapOf(game: GapGame, rep: CompiledSide): Omit<RepertoireGap, 'games' | 'lastPlayed'> | null {
  const chess = new Chess();
  const path: string[] = [];
  for (const san of game.moves.slice(0, MAX_PLY)) {
    const fen = chess.fen();
    const epd = epdOf(fen);
    const pos = rep.positions[epd];
    // Out of the repertoire, or at the end of one of its lines: no gap here.
    if (!pos?.moves.length) return null;
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      return null;
    }
    path.push(mv.san);
    if (pos.moves.some((m) => m.uci === mv.lan)) continue;
    // You left the line yourself: that is a deviation, not a gap.
    if (turnOf(fen) === rep.side) return null;
    const childEpd = epdOf(mv.after);
    if (rep.positions[childEpd]?.moves.length) continue; // transposes: the answer is there
    return { side: rep.side, epd, fen, san: mv.san, uci: mv.lan, childEpd, childFen: mv.after, path };
  }
  return null;
}

/**
 * Gaps by how often they came up, most frequent first. Yields to the page
 * every so often: six months can be a thousand games.
 */
export async function repertoireGaps(
  games: GapGame[],
  sides: Partial<Record<Color, CompiledSide | null>>,
  now: number,
  opts: { sinceDays?: number; minGames?: number; since?: number } = {},
): Promise<RepertoireGap[]> {
  const since = opts.since ?? now - (opts.sinceDays ?? RENEWAL.gapsDays) * DAY;
  const minGames = opts.minGames ?? RENEWAL.gapsMinGames;
  const byKey = new Map<string, RepertoireGap>();
  let k = 0;
  for (const g of games) {
    if (++k % 250 === 0) await new Promise((r) => setTimeout(r, 0));
    if (!countsForFocus(g) || g.endTime < since || g.endTime > now || g.initialFen) continue;
    const rep = sides[g.userColor];
    if (!rep) continue;
    const gap = gapOf(g, rep);
    if (!gap) continue;
    const key = `${gap.side}|${gap.epd}|${gap.uci}`;
    const found = byKey.get(key);
    if (found) {
      found.games.push(g.id);
      found.lastPlayed = Math.max(found.lastPlayed, g.endTime);
    } else byKey.set(key, { ...gap, games: [g.id], lastPlayed: g.endTime });
  }
  return [...byKey.values()]
    .filter((x) => x.games.length >= minGames)
    .sort((a, b) => b.games.length - a.games.length || b.lastPlayed - a.lastPlayed || a.childEpd.localeCompare(b.childEpd));
}
