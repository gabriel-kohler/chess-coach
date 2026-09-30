// Browser side of the Lichess explorer proxy (server/explorer.ts): the moves
// played by people in your rating range from a position, blitz and rapid.
// Answers are kept in the database for a month: a position asked once is not
// asked again.
import { epdOf } from '../chess/replay.ts';
import { getKV, setKV } from '../db.ts';
import { ExplorerLimited } from './study.ts';

export interface ExplorerMove {
  uci: string;
  san: string;
  /** Games with the move. */
  n: number;
}

interface ExplorerAnswer {
  moves?: Array<{ uci: string; san: string; white: number; draws: number; black: number }>;
  /** Lichess asked to wait (or failed): nothing kept, asked again next time. */
  unavailable?: string;
}

const BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
const MONTH = 30 * 86_400_000;

/** The Lichess rating bucket you are in, and the next one toward you: 1670 is 1400 and 1600 (1400 to 1799). */
export function ratingBuckets(elo: number): number[] {
  let i = BUCKETS.length - 1;
  while (i > 0 && BUCKETS[i]! > elo) i--;
  const low = BUCKETS[i]!;
  const next = BUCKETS[i + 1];
  const neighbour = next !== undefined && elo - low >= (next - low) / 2 ? next : BUCKETS[i - 1];
  return [low, ...(neighbour !== undefined ? [neighbour] : [])].sort((a, b) => a - b);
}

let status: Promise<boolean> | null = null;

/** Whether the server has a Lichess token. Only a yes is remembered. */
export function explorerAvailable(): Promise<boolean> {
  status ??= fetch('/api/explorer/status', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean }>) : { available: false }))
    .then((s) => !!s.available)
    .catch(() => false)
    .then((ok) => {
      if (!ok) status = null;
      return ok;
    });
  return status;
}

/** Whether the answer for a position is kept already: no request to Lichess then. */
export async function explorerCached(fen: string, elo: number, now = Date.now()): Promise<boolean> {
  const kept = await getKV<{ at: number } | null>(`explorer:${ratingBuckets(elo).join(',')}|${epdOf(fen)}`, null);
  return !!kept && now - kept.at < MONTH;
}

/** The explorer's moves, or `limited` when Lichess asked to wait, or null when it has nothing (or is off). */
export async function explorerAnswer(fen: string, elo: number, now = Date.now()): Promise<{ moves: ExplorerMove[] } | 'limited' | null> {
  const buckets = ratingBuckets(elo);
  const key = `explorer:${buckets.join(',')}|${epdOf(fen)}`;
  const kept = await getKV<{ at: number; moves: ExplorerMove[] } | null>(key, null);
  if (kept && now - kept.at < MONTH) return { moves: kept.moves };
  const r = await fetch(`/api/explorer?fen=${encodeURIComponent(fen)}&ratings=${buckets.join(',')}&speeds=blitz,rapid`);
  if (!r.ok) return null;
  const body = (await r.json()) as ExplorerAnswer;
  if (!body.moves) return body.unavailable === 'limited' ? 'limited' : null;
  const moves = body.moves.map((m) => ({ uci: m.uci, san: m.san, n: m.white + m.draws + m.black }));
  await setKV(key, { at: now, moves });
  return { moves };
}

/** For the screens: a wait is the same as no data (they fall back to your games). */
export async function explorerMoves(fen: string, elo: number, now = Date.now()): Promise<ExplorerMove[] | null> {
  const a = await explorerAnswer(fen, elo, now);
  return a && a !== 'limited' ? a.moves : null;
}

/** For background work: a wait throws ExplorerLimited, so a real line is never cut for want of an answer. */
export async function explorerMovesOrWait(fen: string, elo: number): Promise<ExplorerMove[] | null> {
  const a = await explorerAnswer(fen, elo);
  if (a === 'limited') throw new ExplorerLimited();
  return a?.moves ?? null;
}
