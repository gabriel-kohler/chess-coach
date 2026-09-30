// "Only my mistakes" by period: positions from games played in the last N
// days. It began as a tactics session with this filter (settings.minePeriod);
// your own-game positions now live in Posições, and the filter came along.
import type { SourceRef } from './types.ts';

const DAY = 86_400_000;

/** Periods offered, in days (0 = every game). */
export const MINE_PERIODS = [7, 14, 30, 0];

export const periodLabel = (days: number) => (days ? `${days} dias` : 'Todas');

/** Whether any game that reached the position was played in the period. */
export function inPeriod(card: { sources: SourceRef[] }, days: number, now: number): boolean {
  return !days || card.sources.some((s) => s.endTime >= now - days * DAY);
}
