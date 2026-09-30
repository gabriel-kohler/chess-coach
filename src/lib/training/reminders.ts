// What to take into the games, at the end of the warm-up: the rules your own
// data asks for (tilt, long sittings, the clock, rushing, thrown wins), and
// today's losing streak first, because no warm-up fixes that.
import type { Insight } from '../stats/insights.ts';
import type { StoredGame } from '../types.ts';

/** The diagnostics that are about how you play a session, in order of weight. */
const BEFORE_GAMES = ['tilt', 'tilt-soft', 'sittings', 'abandoned', 'time-trouble', 'decisive-fast', 'fast', 'thrown'];

/** Losses in a row at the end of today's rapid and blitz. */
export function lossStreakToday(games: Pick<StoredGame, 'endTime' | 'timeClass' | 'outcome'>[], now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = games.filter((g) => g.endTime >= start.getTime() && (g.timeClass === 'rapid' || g.timeClass === 'blitz')).sort((a, b) => a.endTime - b.endTime);
  let n = 0;
  for (let i = today.length - 1; i >= 0 && today[i]!.outcome === 'loss'; i--) n++;
  return n;
}

export interface Reminder {
  text: string;
  /** Today's rule says not to play rated games now. */
  stop: boolean;
}

export function gameReminders(insights: Insight[], games: Pick<StoredGame, 'endTime' | 'timeClass' | 'outcome'>[], now: number, max = 3): Reminder[] {
  const out: Reminder[] = [];
  const streak = lossStreakToday(games, now);
  if (streak >= 2) out.push({ text: `${streak} derrotas seguidas hoje. Pare de jogar valendo rating por hoje: jogue amanhã, descansado.`, stop: true });
  for (const id of BEFORE_GAMES) {
    if (out.length >= max) break;
    const i = insights.find((x) => x.id === id);
    if (i) out.push({ text: i.action, stop: false });
  }
  return out;
}
