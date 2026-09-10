// Local puzzle bank built by scripts/build-puzzles.mjs from the Lichess
// database: one JSON file per 50-point rating bucket, fetched on demand.
import type { Puzzle } from '../types.ts';

interface BankIndex {
  bucketSize: number;
  themes: string[];
  buckets: Array<{ rating: number; file: string; count: number; themes: Record<string, number> }>;
}

type Row = [string, string, string, number, number, number, number[]];

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
}

/**
 * Picks a puzzle near `target` with the theme, widening the window when the
 * nearby buckets run out. Among the closest candidates it prefers popular ones.
 */
export async function pickPuzzle({ target, theme, exclude }: PickOptions): Promise<Puzzle | null> {
  const index = await loadIndex();
  for (const window of [40, 90, 160, 260]) {
    const lo = target - window;
    const hi = target + window;
    const buckets = index.buckets.filter((b) => b.rating + index.bucketSize > lo && b.rating <= hi);
    const pools = await Promise.all(buckets.map((b) => loadBucket(b.rating)));
    const candidates = pools
      .flat()
      .filter((p) => p.rating >= lo && p.rating <= hi && !exclude.has(p.id) && (!theme || p.themes.includes(theme)));
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
