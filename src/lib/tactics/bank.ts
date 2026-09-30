// Local puzzle bank built by scripts/build-puzzles.mjs from the Lichess
// database: one JSON file per 50-point rating bucket, fetched on demand.
import { yourMoves } from '../srs/cards.ts';
import type { Puzzle } from '../types.ts';

interface BankIndex {
  bucketSize: number;
  themes: string[];
  /** calc: how many are for Cálculo (titled players' games, three moves or more); missing in a bank built before it. */
  buckets: Array<{ rating: number; file: string; count: number; calc?: number; themes: Record<string, number> }>;
  /** Opening puzzles by opening family (Lichess tag): missing in a bank built before them. */
  openings?: Record<string, { file: string; count: number }>;
}

type Row = [string, string, string, number, number, number, number[]];
type OpeningRow = [string, string, string, number, string, number[]];

/** A Lichess opening puzzle with its opening's tags. */
export interface OpeningPuzzle extends Puzzle {
  family: string;
  variation: string;
}

let indexPromise: Promise<BankIndex> | null = null;
const bucketCache = new Map<number, Promise<Puzzle[]>>();

export function loadIndex(): Promise<BankIndex> {
  indexPromise ??= fetch('/puzzles/index.json').then((r) => {
    if (!r.ok) throw new Error('Banco de puzzles não encontrado. Rode npm run build:puzzles.');
    return r.json() as Promise<BankIndex>;
  });
  return indexPromise;
}

async function loadBucket(rating: number): Promise<Puzzle[]> {
  const index = await loadIndex();
  const b = Math.floor(rating / index.bucketSize) * index.bucketSize;
  const entry = index.buckets.find((x) => x.rating === b);
  if (!entry) return [];
  let p = bucketCache.get(b);
  if (!p) {
    p = fetch(`/puzzles/${entry.file}`)
      .then((r) => r.json() as Promise<Row[]>)
      .then((rows) =>
        rows.map(([id, fen, moves, rating, popularity, plays, themes]) => ({
          id,
          source: 'lichess' as const,
          fen,
          moves: moves.split(' '),
          rating,
          popularity,
          plays,
          themes: themes.map((t) => index.themes[t]!),
        })),
      );
    bucketCache.set(b, p);
  }
  return p;
}

export interface PickOptions {
  target: number;
  theme?: string;
  exclude: Set<string>;
  /** At most this many moves of yours in the solution. */
  maxMoves?: number;
  /** Only puzzles that pass (Cálculo: from titled players' games, three moves or more). */
  where?: (p: Puzzle) => boolean;
}

/**
 * Picks a puzzle near `target` with the theme, widening the window when the
 * nearby buckets run out. Among the closest candidates it prefers popular ones.
 */
export async function pickPuzzle({ target, theme, exclude, maxMoves, where }: PickOptions): Promise<Puzzle | null> {
  const index = await loadIndex();
  for (const window of [40, 90, 160, 260]) {
    const lo = target - window;
    const hi = target + window;
    const buckets = index.buckets.filter((b) => b.rating + index.bucketSize > lo && b.rating <= hi);
    const pools = await Promise.all(buckets.map((b) => loadBucket(b.rating)));
    const candidates = pools
      .flat()
      .filter((p) => p.rating >= lo && p.rating <= hi && !exclude.has(p.id) && (!theme || p.themes.includes(theme)) && (maxMoves === undefined || yourMoves(p) <= maxMoves) && (!where || where(p)));
    if (candidates.length >= 3 || (window === 260 && candidates.length)) {
      candidates.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target));
      const near = candidates.slice(0, 40).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 20);
      return near[Math.floor(Math.random() * near.length)]!;
    }
  }
  return null;
}

export async function availableThemes(): Promise<string[]> {
  return (await loadIndex()).themes;
}

const openingCache = new Map<string, Promise<OpeningPuzzle[]>>();

/** The bank's opening families (Lichess tags such as Sicilian_Defense). */
export async function openingFamilies(): Promise<string[]> {
  return Object.keys((await loadIndex()).openings ?? {});
}

/** One opening family's puzzles; none when the bank has no opening files (built before them) or the file is missing. */
export async function loadOpeningPuzzles(family: string): Promise<OpeningPuzzle[]> {
  const index = await loadIndex();
  const entry = index.openings?.[family];
  if (!entry) return [];
  let p = openingCache.get(family);
  if (!p) {
    p = fetch(`/puzzles/${entry.file}`)
      .then((r) => (r.ok ? (r.json() as Promise<OpeningRow[]>) : []))
      .then((rows) =>
        rows.map(([id, fen, moves, rating, variation, themes]) => ({ id, source: 'lichess' as const, fen, moves: moves.split(' '), rating, themes: themes.map((t) => index.themes[t]!), family, variation })),
      )
      .catch(() => []);
    openingCache.set(family, p);
  }
  return p;
}
