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
  exits: Array<{ gameId: string; ply: number; kind: 'you' | 'hole' | 'end'; epd: string; san: string; outcome: Outcome }>;
}

const pts = (o: Outcome) => (o === 'win' ? 1 : o === 'draw' ? 0.5 : 0);

/** Replays the first plies of every game of one color, yielding to the UI. */
export function indexGames(games: StoredGame[], color: Color, rep: CompiledSide | null, key: string): Promise<GamesIndex> {
  const cacheKey = `${color}|${key}`;
  let p = cache.get(cacheKey);
  if (p) return p;
  p = (async () => {
    const tree: OpeningTree = new Map();
    const exits: GamesIndex['exits'] = [];
    const mine = games.filter((g) => g.userColor === color && !g.initialFen);
    const ourTurn = color === 'white' ? 'w' : 'b';
    for (let i = 0; i < mine.length; i++) {
      if (i % 250 === 0) await new Promise((r) => setTimeout(r, 0));
      const g = mine[i]!;
      const chess = new Chess();
      let exit: GamesIndex['exits'][number] | null = null;
      for (let ply = 0; ply < Math.min(MAX_PLY, g.moves.length); ply++) {
        const epd = epdOf(chess.fen());
        let mv;
        try {
          mv = chess.move(g.moves[ply]!);
        } catch {
          break;
        }
        const node = tree.get(epd) ?? tree.set(epd, new Map()).get(epd)!;
        const stat = node.get(mv.lan) ?? { san: mv.san, uci: mv.lan, n: 0, points: 0 };
        stat.n++;
        stat.points += pts(g.outcome);
        node.set(mv.lan, stat);

        if (rep && !exit) {
          const pos = rep.positions[epd];
          const known = pos?.moves.find((m) => m.uci === mv.lan);
          if (!pos || pos.moves.length === 0) exit = { gameId: g.id, ply, kind: 'end', epd, san: mv.san, outcome: g.outcome };
          else if (!known) exit = { gameId: g.id, ply, kind: epd.split(' ')[1] === ourTurn ? 'you' : 'hole', epd, san: mv.san, outcome: g.outcome };
        }
      }
      if (rep && exit) exits.push(exit);
    }
    return { tree, games: mine.length, exits };
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
