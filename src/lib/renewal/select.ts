// Which games the automatic analysis takes, and in what order. It starts with
// your 60 most recent rated rapid and blitz games and then takes every new
// one: the cut is fixed the first time and kept.
import { countsForFocus } from '../positions/focus.ts';
import type { Outcome, TimeClass } from '../types.ts';
import { RENEWAL } from './config.ts';

export interface AutoCandidate {
  id: string;
  endTime: number;
  timeClass: TimeClass;
  rated: boolean;
  outcome: Outcome;
}

/** End time of your Nth most recent game that counts (or of the oldest): the backlog starts there. */
export function backlogCut(games: AutoCandidate[], n: number = RENEWAL.backlogGames): number | null {
  const eligible = games.filter(countsForFocus).sort((a, b) => b.endTime - a.endTime);
  if (!eligible.length) return null;
  return eligible[Math.min(n, eligible.length) - 1]!.endTime;
}

const RESULT_ORDER: Record<Outcome, number> = { loss: 0, draw: 1, win: 2 };

/** Games not analysed yet from the cut on: losses first, then draws, then wins, newest first in each. */
export function selectAutoGames(games: AutoCandidate[], analysed: Set<string>, since: number): string[] {
  return games
    .filter((g) => countsForFocus(g) && g.endTime >= since && !analysed.has(g.id))
    .sort((a, b) => RESULT_ORDER[a.outcome] - RESULT_ORDER[b.outcome] || b.endTime - a.endTime || a.id.localeCompare(b.id))
    .map((g) => g.id);
}
