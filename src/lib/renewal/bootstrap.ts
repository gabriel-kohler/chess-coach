// Margins by resampling games (bootstrap). Each game is a vector of the points
// lost per category, with the game's total last; a share is a ratio of sums,
// so resampling whole games keeps each game's moves together.

/** Nearest-rank percentile of an ascending array. */
export function nearestRank(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

export interface Interval {
  lo: number[];
  hi: number[];
}

/** 90% interval (5th to 95th percentile) of every category's share. */
export function shareIntervals(vectors: Float64Array[], rng: () => number, resamples: number): Interval {
  const K = (vectors[0]?.length ?? 1) - 1;
  const samples: number[][] = Array.from({ length: K }, () => []);
  const n = vectors.length;
  const sum = new Float64Array(K + 1);
  for (let b = 0; b < resamples && n; b++) {
    sum.fill(0);
    for (let i = 0; i < n; i++) {
      const v = vectors[Math.floor(rng() * n)]!;
      for (let k = 0; k <= K; k++) sum[k]! += v[k]!;
    }
    // A resample with no points lost has no shares: skipped.
    if (sum[K]! <= 0) continue;
    for (let k = 0; k < K; k++) samples[k]!.push(sum[k]! / sum[K]!);
  }
  return interval(samples);
}

/**
 * 90% interval of the difference B - A of every share, when A and B are two
 * sets of games that may share games (two overlapping windows): resample the
 * union and measure both on the same resample.
 */
export function pairedDifference(vectors: Float64Array[], inA: boolean[], inB: boolean[], rng: () => number, resamples: number): Interval {
  const K = (vectors[0]?.length ?? 1) - 1;
  const samples: number[][] = Array.from({ length: K }, () => []);
  const n = vectors.length;
  const a = new Float64Array(K + 1);
  const b = new Float64Array(K + 1);
  for (let r = 0; r < resamples && n; r++) {
    a.fill(0);
    b.fill(0);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      const v = vectors[j]!;
      if (inA[j]) for (let k = 0; k <= K; k++) a[k]! += v[k]!;
      if (inB[j]) for (let k = 0; k <= K; k++) b[k]! += v[k]!;
    }
    if (a[K]! <= 0 || b[K]! <= 0) continue;
    for (let k = 0; k < K; k++) samples[k]!.push(b[k]! / b[K]! - a[k]! / a[K]!);
  }
  return interval(samples);
}

function interval(samples: number[][]): Interval {
  const lo: number[] = [];
  const hi: number[] = [];
  for (const s of samples) {
    s.sort((x, y) => x - y);
    lo.push(nearestRank(s, 0.05));
    hi.push(nearestRank(s, 0.95));
  }
  return { lo, hi };
}
