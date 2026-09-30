// Stockfish's answers to your repertoire gaps: 3 lines at depth 18 from the
// position after the opponent's move, and only the moves the build would
// accept (less than 5 win-chance points below the best). They are worked out
// in the background when the analysis queue is idle, and cached by position.
import { Chess } from 'chess.js';
import { getKV, setKV } from '../db.ts';
import { Engine } from '../engine/stockfish.ts';
import { acceptable, moverScoreFromWhite, winDrop, winPct } from '../repertoire/accept.ts';
import type { RepertoireGap } from '../repertoire/gaps.ts';
import type { EngineLine } from '../types.ts';
import { gate } from './activity.ts';
import { ACCOUNT_KEYS, GAPS_VERSION, RENEWAL } from './config.ts';

export interface SuggestedMove {
  uci: string;
  san: string;
  /** The engine's line after the move, in SAN. */
  line: string[];
  /** Your win chance after the move (0-100). */
  win: number;
  /** Win-chance points below the best move. */
  drop: number;
  acceptable: boolean;
  score: { cp?: number; mate?: number };
}

export interface GapSuggestion {
  childEpd: string;
  version: number;
  depth: number;
  moves: SuggestedMove[];
  at: number;
}

export type SuggestionCache = Record<string, GapSuggestion>;

/** Turns engine lines (White's side) into the moves you could answer with. */
export function suggestionFrom(childFen: string, lines: EngineLine[], depth: number, now: number, childEpd: string): GapSuggestion {
  const whiteToMove = childFen.split(' ')[1] === 'w';
  const scored = lines.filter((l) => l.pv[0]).map((l) => ({ l, s: moverScoreFromWhite(l, whiteToMove) }));
  const best = scored[0]?.s ?? 0;
  const moves = scored.map(({ l, s }) => {
    const chess = new Chess(childFen);
    const san: string[] = [];
    for (const uci of l.pv.slice(0, 6)) {
      try {
        san.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
      } catch {
        break;
      }
    }
    return {
      uci: l.pv[0]!,
      san: san[0] ?? l.pv[0]!,
      line: san.slice(1),
      win: Math.round(winPct(s) * 10) / 10,
      drop: Math.round(winDrop(best, s) * 10) / 10,
      acceptable: acceptable(best, s),
      score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 },
    };
  });
  return { childEpd, version: GAPS_VERSION, depth, moves, at: now };
}

export async function loadSuggestions(): Promise<SuggestionCache> {
  const all = await getKV<SuggestionCache>(ACCOUNT_KEYS.gapSuggestions, {});
  return Object.fromEntries(Object.entries(all).filter(([, s]) => s.version === GAPS_VERSION));
}

/**
 * Suggestions for the gaps that have none yet, one position at a time,
 * waiting while you train. The hash is cleared before each position, so the
 * same position always gets the same lines.
 */
export async function suggestGaps(gaps: RepertoireGap[], limit: number = RENEWAL.gapsSuggested, now = Date.now()): Promise<number> {
  const cache = await loadSuggestions();
  const todo = gaps.filter((g) => !cache[g.childEpd]).slice(0, limit);
  if (!todo.length) return 0;
  const engine = new Engine(32);
  try {
    for (const gap of todo) {
      await gate();
      await engine.newGame();
      const lines = await engine.analyse(gap.childFen, { depth: RENEWAL.suggestDepth, multipv: RENEWAL.suggestMultipv });
      cache[gap.childEpd] = suggestionFrom(gap.childFen, lines, RENEWAL.suggestDepth, now, gap.childEpd);
      await setKV(ACCOUNT_KEYS.gapSuggestions, cache);
    }
  } finally {
    engine.terminate();
  }
  return todo.length;
}
