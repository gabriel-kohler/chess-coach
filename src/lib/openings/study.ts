// Any opening, not only the ones in your repertoire: find it by name (in
// Portuguese or English), see what the engine plays from it and what people
// at your level play, and train it against them. The names and moves are the
// lichess-org/chess-openings catalog (CC0), built by scripts/build-openings.mjs.
import { Chess } from 'chess.js';
import { epdOf, tryUci, uciToSan } from '../chess/replay.ts';
import { REPLIES, type ReplyContext } from '../positions/replies.ts';
import type { ExplorerMove } from './explorer.ts';
import { moverScoreFromWhite, winDrop } from '../repertoire/accept.ts';
import { statsAt, type GamesIndex, type OpeningTree } from '../repertoire/games.ts';
import { openingFamilyFromName, record } from '../stats/compute.ts';
import type { Color, EngineLine, StoredGame } from '../types.ts';
import { openingFamily } from './book.ts';

export interface OpeningLine {
  eco: string;
  name: string;
  family: string;
  /** SAN from the start. */
  moves: string[];
  /** The name as the search sees it. */
  key: string;
}

let loading: Promise<OpeningLine[]> | null = null;

/** One catalog line: the same name can go with different moves ("Modern Defense" three times). */
export const lineId = (l: Pick<OpeningLine, 'name' | 'moves'>) => `${l.name}|${l.moves.join(' ')}`;

/** The catalog, loaded when first needed (about 70 KB compressed). */
export function loadOpeningLines(): Promise<OpeningLine[]> {
  loading ??= import('../../data/opening-lines.json').then((m) =>
    (m.default as Array<[string, string, string]>).map(([eco, name, moves]) => ({ eco, name, family: openingFamily(name), moves: moves.split(' '), key: normalize(name) })),
  );
  return loading;
}

/** Lower case, no accents, no apostrophes: "King's Indian" and "kings indian" are the same. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Portuguese names to the catalog's English words (the longer ones first). */
const ALIASES: Array<[string, string]> = [
  // Defesa Índia do Rei, Ataque Índio do Rei: the gender says which.
  ['india do rei', 'kings indian defense'],
  ['indiana do rei', 'kings indian defense'],
  ['indio do rei', 'kings indian attack'],
  ['india da dama', 'queens indian defense'],
  ['nimzo india', 'nimzo indian defense'],
  ['gambito da dama', 'queens gambit'],
  ['gambito do rei', 'kings gambit'],
  ['peao do rei', 'kings pawn'],
  ['peao da dama', 'queens pawn'],
  ['dois cavalos', 'two knights'],
  ['quatro cavalos', 'four knights'],
  ['tres cavalos', 'three knights'],
  ['semi eslava', 'semi slav'],
  ['siciliana', 'sicilian'],
  ['francesa', 'french'],
  ['italiana', 'italian'],
  ['moderna', 'modern'],
  ['escandinava', 'scandinavian'],
  ['inglesa', 'english'],
  ['holandesa', 'dutch'],
  ['eslava', 'slav'],
  ['espanhola', 'ruy lopez'],
  ['escocesa', 'scotch'],
  ['vienense', 'vienna'],
  ['russa', 'russian'],
  ['catala', 'catalan'],
  ['londres', 'london'],
  ['budapeste', 'budapest'],
  ['portuguesa', 'portuguese'],
  ['elefante', 'elephant'],
  ['dragao', 'dragon'],
  ['defesa', 'defense'],
  ['abertura', 'opening'],
  ['gambito', 'gambit'],
  ['variante', 'variation'],
  ['ataque', 'attack'],
  ['sistema', 'system'],
  ['aceito', 'accepted'],
  ['recusado', 'declined'],
];

export function translateQuery(query: string): string {
  let q = ` ${normalize(query)} `;
  for (const [pt, en] of ALIASES) q = q.split(` ${pt} `).join(` ${en} `);
  return q.trim();
}

/**
 * Lines whose name has every word you typed (a word may be the start of a
 * longer one: "van" finds Van't Kruijs and Van Geet). The opening itself
 * comes before its variations.
 */
export function searchOpenings(all: OpeningLine[], query: string, limit = 12): OpeningLine[] {
  const q = translateQuery(query);
  const tokens = q.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const words = (key: string) => key.split(' ');
  const hits = all.filter((l) => tokens.every((t) => words(l.key).some((w) => w.startsWith(t))));
  const base = (l: OpeningLine) => (l.name === l.family ? 0 : 1);
  return hits.sort((a, b) => base(a) - base(b) || a.moves.length - b.moves.length || a.name.length - b.name.length).slice(0, limit);
}

const GENERIC = new Set(['opening', 'defense', 'defence', 'game', 'attack', 'system', 'variation']);

/** The catalog line for a name as chess.com writes it ("Vant Kruijs Opening", "Kings Pawn Opening"). */
export function lineForName(all: OpeningLine[], name: string): OpeningLine | null {
  const exact = searchOpenings(all, name, 1)[0];
  if (exact) return exact;
  const core = normalize(name).split(' ').filter((w) => !GENERIC.has(w)).join(' ');
  return core ? (searchOpenings(all, core, 1)[0] ?? null) : null;
}

export interface FacedOpening {
  family: string;
  color: Color;
  n: number;
  /** Your score, 0-100. */
  score: number;
  line: OpeningLine;
}

/**
 * The catalog line for a group of your games: among the lines named like
 * them, the one most of the games start with. chess.com's names and the
 * catalog's do not always agree ("King's Pawn Opening" is 1.e4 there, 1.e4 e5
 * 2.b3 here): the moves decide.
 */
export function lineForGames(all: OpeningLine[], name: string, games: string[][]): OpeningLine | null {
  const core = normalize(name).split(' ').filter((w) => !GENERIC.has(w)).join(' ');
  const candidates = new Map<string, OpeningLine>();
  for (const l of [...searchOpenings(all, name, 30), ...(core ? searchOpenings(all, core, 30) : [])]) candidates.set(l.name + l.moves.join(' '), l);
  const starts = (l: OpeningLine, moves: string[]) => l.moves.every((m, i) => moves[i] === m);
  let best: { line: OpeningLine; n: number } | null = null;
  for (const l of candidates.values()) {
    const n = games.filter((m) => starts(l, m)).length;
    if (n && (!best || n > best.n || (n === best.n && l.moves.length < best.line.moves.length))) best = { line: l, n };
  }
  return best?.line ?? lineForName(all, name);
}

/** The openings you actually meet in rapid and blitz, the most frequent first, with how you do in them. */
export function facedOpenings(games: Pick<StoredGame, 'opening' | 'userColor' | 'outcome' | 'timeClass' | 'endTime' | 'moves'>[], all: OpeningLine[], now: number, sinceDays = 365, limit = 8): FacedOpening[] {
  const since = now - sinceDays * 86_400_000;
  const groups = new Map<string, { color: Color; family: string; games: Array<{ outcome: StoredGame['outcome']; moves: string[] }> }>();
  for (const g of games) {
    if (g.endTime < since || !g.opening || (g.timeClass !== 'rapid' && g.timeClass !== 'blitz')) continue;
    const family = openingFamilyFromName(g.opening);
    const key = `${g.userColor}|${family}`;
    const e = groups.get(key) ?? { color: g.userColor, family, games: [] };
    e.games.push(g);
    groups.set(key, e);
  }
  const out: FacedOpening[] = [];
  for (const e of [...groups.values()].sort((a, b) => b.games.length - a.games.length)) {
    const line = lineForGames(all, e.family, e.games.map((g) => g.moves));
    if (!line) continue;
    const rec = record(e.games);
    out.push({ family: line.family, color: e.color, n: rec.n, score: Math.round(rec.score), line });
    if (out.length >= limit) break;
  }
  return out;
}

/** The side you usually have when your games reach the opening; a "Defense" otherwise means Black. */
export function defaultSide(line: OpeningLine, index: Record<Color, GamesIndex> | null): Color {
  const epd = epdAfter(line.moves);
  const n = (c: Color) => (index ? statsAt(index[c].tree, epd).reduce((s, x) => s + x.n, 0) : 0);
  const white = n('white');
  const black = n('black');
  if (white !== black) return white > black ? 'white' : 'black';
  return /defen[cs]e|countergambit/i.test(line.name) ? 'black' : 'white';
}

export function fenAfter(moves: string[]): string {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c.fen();
}
export const epdAfter = (moves: string[]) => epdOf(fenAfter(moves));

/**
 * Where "people at your level" comes from. explorer: the Lichess explorer in
 * your rating range. games: your own opponents, from your games. maia: Maia at
 * your rating, only past the opening (in the opening its guesses are not
 * credible: 1.e4 at 5% from the start, a knight back to g8 at 76%).
 */
export type LevelSource = 'explorer' | 'games' | 'maia';

export interface LevelMove {
  uci: string;
  san: string;
  /** Share of people at your level who play it (0-1). */
  p: number;
  source: LevelSource;
  /** Games behind it, when counted. */
  n?: number;
}

/** Lichess asked to wait (a 429): not the same as "nobody plays this here". */
export class ExplorerLimited extends Error {
  constructor() {
    super('The Lichess explorer asked to wait');
    this.name = 'ExplorerLimited';
  }
}

export interface LevelContext {
  /** Your games as the color you play: your opponents' moves where they reached the position. */
  tree: OpeningTree | null;
  userColor: Color;
  /** Ratings on the Lichess / Maia scale (already offset). */
  userElo: number;
  oppElo: number;
  /** Maia, when installed. */
  policy: ReplyContext['policy'] | null;
  /** The Lichess explorer, when the server has a token. An ExplorerLimited it throws goes up. */
  explorer: ((fen: string, elo: number) => Promise<ExplorerMove[] | null>) | null;
}

export const LEVEL = {
  /** Up to move 10: games, not Maia. */
  openingPly: 20,
  /** Your own opponents first when they played the position this often. */
  ownFirst: 20,
  explorerMinGames: 20,
} as const;

const plyOf = (fen: string) => {
  const [, turn, , , , full] = fen.split(' ');
  return (Number(full) - 1) * 2 + (turn === 'b' ? 1 : 0);
};
const colorOf = (fen: string): Color => (fen.split(' ')[1] === 'w' ? 'white' : 'black');

const fromGames = (fen: string, moves: Array<{ uci: string; san: string; n: number }>, source: LevelSource): LevelMove[] => {
  const total = moves.reduce((s, m) => s + m.n, 0);
  return total ? moves.filter((m) => m.n > 0).map((m) => ({ uci: m.uci, san: uciToSan(fen, m.uci) ?? m.san, p: m.n / total, n: m.n, source })) : [];
};

/**
 * What people at your level play at a position, the likeliest first. In the
 * opening: your own opponents when they reached it often, else the explorer in
 * your rating range, else your opponents from fewer games; nothing when there
 * is no data. Later: Maia at your rating.
 */
export async function levelMoves(fen: string, ctx: LevelContext): Promise<LevelMove[]> {
  const mine = colorOf(fen) === ctx.userColor;
  // At your turn your games hold your own habits: a fallback, never ahead of the explorer.
  const own = ctx.tree ? statsAt(ctx.tree, epdOf(fen)) : [];
  const ownTotal = own.reduce((s, x) => s + x.n, 0);
  const opponentsOften = !mine && ownTotal >= LEVEL.ownFirst;
  if (plyOf(fen) <= LEVEL.openingPly) {
    if (opponentsOften) return fromGames(fen, own, 'games');
    if (ctx.explorer) {
      // A wait is not an answer: whoever asked decides (the deck builder waits, the screens never see one).
      const moves = await ctx.explorer(fen, mine ? ctx.userElo : ctx.oppElo).catch((e: unknown) => {
        if (e instanceof ExplorerLimited) throw e;
        return null;
      });
      if (moves && moves.reduce((s, m) => s + m.n, 0) >= LEVEL.explorerMinGames) return fromGames(fen, moves, 'explorer');
    }
    return ownTotal >= REPLIES.minGames ? fromGames(fen, own, 'games') : [];
  }
  if (opponentsOften) return fromGames(fen, own, 'games');
  if (!ctx.policy) return [];
  const policy = await ctx.policy(fen, mine ? ctx.userElo : ctx.oppElo, mine ? ctx.oppElo : ctx.userElo).catch(() => []);
  return policy.map((m) => ({ uci: m.uci, san: uciToSan(fen, m.uci) ?? m.uci, p: m.p, source: 'maia' as const }));
}

export interface LineMove {
  san: string;
  uci: string;
  /** Share of people at your level who play it (0-1). */
  p?: number;
  source?: LevelSource;
  /** Games of yours through the position, and your score there (0-100). */
  n?: number;
  score?: number;
}

/** The likeliest move each time, both sides, while there is data for your level. */
export async function humanLine(startFen: string, ctx: LevelContext, plies = 12): Promise<LineMove[]> {
  const chess = new Chess(startFen);
  const out: LineMove[] = [];
  for (let i = 0; i < plies && !chess.isGameOver(); i++) {
    const top = (await levelMoves(chess.fen(), ctx))[0];
    const mv = top ? tryUci(chess, top.uci) : null;
    if (!top || !mv) break;
    out.push({ san: mv.san, uci: top.uci, p: top.p, source: top.source, ...(top.n !== undefined ? { n: top.n } : {}) });
  }
  return out;
}

/** The moves most played in your games from a position, while there are games (both sides). */
export function gamesLine(startFen: string, tree: OpeningTree | null, plies = 12): LineMove[] {
  if (!tree) return [];
  const chess = new Chess(startFen);
  const out: LineMove[] = [];
  for (let i = 0; i < plies; i++) {
    const stats = statsAt(tree, epdOf(chess.fen()));
    const top = stats[0];
    if (!top) break;
    const total = stats.reduce((s, x) => s + x.n, 0);
    let mv;
    try {
      mv = chess.move(top.san);
    } catch {
      break;
    }
    out.push({ san: mv.san, uci: top.uci, p: top.n / total, n: top.n, score: Math.round((100 * top.points) / top.n) });
  }
  return out;
}

/**
 * Win-chance points a move gives up against the engine's best, from your side.
 * `lines` are the engine's lines at the position (White's view); when your
 * move is not among them, `after` is the engine's line after it.
 */
export function moveLoss(lines: EngineLine[], uci: string, whiteToMove: boolean, after?: EngineLine): number | null {
  const best = lines[0];
  if (!best) return null;
  const bestScore = moverScoreFromWhite(best, whiteToMove);
  const mine = lines.find((l) => l.pv[0] === uci) ?? after;
  if (!mine) return null;
  return Math.max(0, winDrop(bestScore, moverScoreFromWhite(mine, whiteToMove)));
}

/** A reply drawn the way people at your level choose: in proportion to how often they play it. */
export function drawReply<T extends { p: number }>(moves: T[], random = Math.random): T | null {
  const total = moves.reduce((s, m) => s + m.p, 0);
  if (!moves.length || total <= 0) return null;
  let r = random() * total;
  for (const m of moves) {
    r -= m.p;
    if (r <= 0) return m;
  }
  return moves[moves.length - 1]!;
}

/** The engine's best lines as replies, when Maia is not installed and your games say nothing. */
export function engineReplies(fen: string, lines: EngineLine[]): Array<{ uci: string; san: string; p: number }> {
  return lines
    .filter((l) => l.pv[0])
    .map((l, i) => ({ uci: l.pv[0]!, san: uciToSan(fen, l.pv[0]!) ?? l.pv[0]!, p: 1 / (i + 1) }));
}

export const STUDY_KEY = 'openings:study';

/** Your record per opening line studied (by lineId): kept across accounts, like your tactics. */
export interface StudyRecord {
  side: Color;
  drills: number;
  asked: number;
  good: number;
  lastAt: number;
}
