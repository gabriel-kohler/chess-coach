import { parseClockedMainLine } from '../chess/pgn.ts';
import { START_FEN } from '../chess/replay.ts';
import type { Outcome, StoredGame, TimeClass } from '../types.ts';
import type { CCGame } from './api.ts';

const DRAW_CODES = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function outcomeOf(code: string): Outcome {
  if (code === 'win') return 'win';
  return DRAW_CODES.has(code) ? 'draw' : 'loss';
}

export function pgnHeader(pgn: string, name: string): string | undefined {
  return new RegExp(`\\[${name} "([^"]*)"\\]`).exec(pgn)?.[1];
}

/** Game start from the PGN's UTCDate/UTCTime headers. */
export function startTimeOf(pgn: string): number | undefined {
  const d = pgnHeader(pgn, 'UTCDate');
  const t = pgnHeader(pgn, 'UTCTime');
  if (!d || !t) return undefined;
  const ms = Date.parse(`${d.replace(/\./g, '-')}T${t}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/** "Italian-Game-Two-Knights-Defense-4.d3" -> "Italian Game Two Knights Defense" */
export function openingFromEcoUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const slug = url.split('/openings/')[1];
  if (!slug) return undefined;
  const words: string[] = [];
  for (const w of decodeURIComponent(slug).split('-')) {
    if (/^\d/.test(w)) break;
    words.push(w);
  }
  return words.join(' ') || undefined;
}

/**
 * How many plies of a game chess.com counts as book. Its ECOUrl ends with the
 * moves that reach the named position ("...-Old-Sicilian-Variation-3.Bc4-e6"
 * is book through ply 6). The slug gives the opening's canonical order and
 * games often transpose, so each listed move only has to appear among that
 * side's moves up to there. 0 when the slug has no moves or they don't fit.
 */
export function bookPliesFromEcoUrl(url: string | undefined, sans: string[]): number {
  const slug = url?.split('/openings/')[1];
  if (!slug) return 0;
  // Castling has hyphens of its own.
  const text = decodeURIComponent(slug).replace(/O-O-O/g, 'O_O_O').replace(/O-O/g, 'O_O');
  const m = /(\d+)\.(\.\.)?([A-Za-z][^-]*(?:-(?:\d+\.+)?[A-Za-z][^-]*)*)$/.exec(text);
  if (!m) return 0;
  const first = (Number(m[1]) - 1) * 2 + (m[2] ? 1 : 0);
  const listed = m[3]!.split('-').map((t) => t.replace(/^\d+\.+/, '').replace(/_/g, '-'));
  const plies = first + listed.length;
  if (sans.length < plies) return 0;
  const clean = (san: string) => san.replace(/[+#]/g, '');
  const played = [0, 1].map((side) => new Set(sans.slice(0, plies).filter((_, i) => i % 2 === side).map(clean)));
  return listed.every((san, j) => played[(first + j) % 2]!.has(clean(san))) ? plies : 0;
}

export function parseTimeControl(tc: string): { base: number; increment: number } | null {
  if (tc.includes('/')) return null; // daily
  const [base, inc] = tc.split('+');
  const b = Number(base);
  if (!Number.isFinite(b)) return null;
  return { base: b, increment: Number(inc ?? 0) || 0 };
}

export function toStoredGame(g: CCGame, username: string, archive: string): StoredGame | null {
  if (g.rules !== 'chess' || !g.pgn) return null;
  const me = username.toLowerCase();
  const isWhite = g.white.username.toLowerCase() === me;
  if (!isWhite && g.black.username.toLowerCase() !== me) return null;
  const mine = isWhite ? g.white : g.black;
  const opp = isWhite ? g.black : g.white;
  const { moves, clocks } = parseClockedMainLine(g.pgn);
  const initial = g.initial_setup && g.initial_setup !== START_FEN ? g.initial_setup : undefined;
  return {
    id: g.uuid,
    url: g.url,
    archive,
    timeClass: (['bullet', 'blitz', 'rapid', 'daily'].includes(g.time_class) ? g.time_class : 'rapid') as TimeClass,
    timeControl: g.time_control,
    rated: g.rated,
    endTime: g.end_time * 1000,
    startTime: startTimeOf(g.pgn),
    userColor: isWhite ? 'white' : 'black',
    userRating: mine.rating,
    oppRating: opp.rating,
    oppName: opp.username,
    outcome: outcomeOf(mine.result),
    userResult: mine.result,
    oppResult: opp.result,
    eco: pgnHeader(g.pgn, 'ECO'),
    opening: openingFromEcoUrl(g.eco ?? pgnHeader(g.pgn, 'ECOUrl')),
    moves,
    clocks,
    ccAccuracy: g.accuracies,
    initialFen: initial,
    pgn: g.pgn,
  };
}
