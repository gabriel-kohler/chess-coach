import { epdOf } from '../chess/replay.ts';

type OpeningsMap = Record<string, 0 | [string, string]>;

let loading: Promise<OpeningsMap> | null = null;

export function loadOpenings(): Promise<OpeningsMap> {
  loading ??= import('../../data/openings.json').then((m) => m.default as unknown as OpeningsMap);
  return loading;
}

export interface OpeningName {
  eco: string;
  name: string;
  /** Ply at which the name was last matched. */
  ply: number;
}

/** Deepest named opening along a sequence of positions (FENs after each ply). */
export function nameOpening(openings: OpeningsMap, fensAfter: string[]): OpeningName | null {
  let found: OpeningName | null = null;
  let misses = 0;
  for (let i = 0; i < fensAfter.length && misses < 6; i++) {
    const hit = openings[epdOf(fensAfter[i]!)];
    if (hit === undefined) {
      misses++;
      continue;
    }
    misses = 0;
    if (hit) found = { eco: hit[0], name: hit[1], ply: i + 1 };
  }
  return found;
}

/** "Sicilian Defense: Taimanov Variation" -> "Sicilian Defense" */
export function openingFamily(name: string): string {
  return name.split(':')[0]!.trim();
}
