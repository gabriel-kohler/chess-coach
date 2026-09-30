// What you actually face: an opening tree built from your own games, and the
// point where each game left the repertoire.
import { Chess } from 'chess.js';
import type { Color, Outcome, StoredGame } from '../types.ts';
import type { CompiledSide } from './compile.ts';
import { epdOf } from './compile.ts';

export interface TreeStat {
  san: string;
  uci: string;
  n: number;
  points: number;
}

export type OpeningTree = Map<string, Map<string, TreeStat>>;

const MAX_PLY = 24;
/** Where a game can still leave the repertoire: its lines go this deep. */
const EXIT_PLY = 40;
/** "Recently": the openings you play now, not years ago under another repertoire. */
export const RECENT_DAYS = 180;
const cache = new Map<string, Promise<GamesIndex>>();

export interface Deviation {
  epd: string;
  fen: string;
  kind: 'you' | 'hole';
  san: string;
  expected?: string;
  n: number;
  games: string[];
}

export interface GamesIndex {
  tree: OpeningTree;
  games: number;
  /** Per game: the ply where it left the repertoire and why. */
  exits: Array<{ gameId: string; ply: number; kind: 'you' | 'hole' | 'end'; epd: string; san: string; outcome: Outcome; endTime: number }>;
  /** Games since `recentSince` through each position (first 24 plies), with your points. */
  recent: Map<string, { n: number; points: number }>;
}

const pts = (o: Outcome) => (o === 'win' ? 1 : o === 'draw' ? 0.5 : 0);

/** Drops the cached indexes (the openings worker keeps its results in the page's cache instead). */
export function forgetIndexes(): void {
  cache.clear();
}

/** The fields the index reads: a game without its PGN is enough. */
export type IndexedGame = Pick<StoredGame, 'id' | 'userColor' | 'initialFen' | 'moves' | 'outcome' | 'endTime'>;

/** Replays the first plies of every game of one color, yielding to the UI. */
export function indexGames(games: IndexedGame[], color: Color, rep: CompiledSide | null, key: string, recentSince?: number): Promise<GamesIndex> {
  const cacheKey = `${color}|${key}`;
  let p = cache.get(cacheKey);
  if (p) return p;
  p = (async () => {
    const tree: OpeningTree = new Map();
    const exits: GamesIndex['exits'] = [];
    const recent: GamesIndex['recent'] = new Map();
    const mine = games.filter((g) => g.userColor === color && !g.initialFen);
    const ourTurn = color === 'white' ? 'w' : 'b';
    for (let i = 0; i < mine.length; i++) {
      if (i % 250 === 0) await new Promise((r) => setTimeout(r, 0));
      const g = mine[i]!;
      const isRecent = recentSince !== undefined && g.endTime >= recentSince;
      const seen = new Set<string>();
      const chess = new Chess();
      let exit: GamesIndex['exits'][number] | null = null;
      for (let ply = 0; ply < Math.min(EXIT_PLY, g.moves.length); ply++) {
        // Past the tree's depth, the replay only goes on to find where the game left the repertoire.
        if (ply >= MAX_PLY && (exit || !rep)) break;
        const epd = epdOf(chess.fen());
        let mv;
        try {
          mv = chess.move(g.moves[ply]!);
        } catch {
          break;
        }
        if (ply < MAX_PLY) {
          const node = tree.get(epd) ?? tree.set(epd, new Map()).get(epd)!;
          const stat = node.get(mv.lan) ?? { san: mv.san, uci: mv.lan, n: 0, points: 0 };
          stat.n++;
          stat.points += pts(g.outcome);
          node.set(mv.lan, stat);
          if (isRecent && !seen.has(epd)) {
            seen.add(epd);
            const r = recent.get(epd) ?? recent.set(epd, { n: 0, points: 0 }).get(epd)!;
            r.n++;
            r.points += pts(g.outcome);
          }
        }

        if (rep && !exit) {
          const pos = rep.positions[epd];
          const known = pos?.moves.find((m) => m.uci === mv.lan);
          if (!pos || pos.moves.length === 0) exit = { gameId: g.id, ply, kind: 'end', epd, san: mv.san, outcome: g.outcome, endTime: g.endTime };
          else if (!known) exit = { gameId: g.id, ply, kind: epd.split(' ')[1] === ourTurn ? 'you' : 'hole', epd, san: mv.san, outcome: g.outcome, endTime: g.endTime };
        }
      }
      if (rep && exit) exits.push(exit);
    }
    return { tree, games: mine.length, exits, recent };
  })();
  cache.set(cacheKey, p);
  return p;
}

/** The most frequent places where games leave the repertoire. */
export function topDeviations(index: GamesIndex, rep: CompiledSide, kind: 'you' | 'hole', limit = 8): Deviation[] {
  const map = new Map<string, Deviation>();
  for (const e of index.exits) {
    if (e.kind !== kind) continue;
    const key = `${e.epd}|${e.san}`;
    const pos = rep.positions[e.epd];
    const d = map.get(key) ?? { epd: e.epd, fen: pos?.fen ?? `${e.epd} 0 1`, kind, san: e.san, expected: kind === 'you' ? pos?.moves[0]?.san : undefined, n: 0, games: [] };
    d.n++;
    d.games.push(e.gameId);
    map.set(key, d);
  }
  return [...map.values()].sort((a, b) => b.n - a.n).slice(0, limit);
}

export function statsAt(tree: OpeningTree, epd: string): TreeStat[] {
  return [...(tree.get(epd)?.values() ?? [])].sort((a, b) => b.n - a.n);
}
