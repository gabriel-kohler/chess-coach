// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Insight } from '../stats/insights';
import { gameReminders, lossStreakToday } from './reminders';

const NOW = new Date(2026, 8, 11, 20, 0).getTime();
const HOUR = 3_600_000;
const g = (hoursAgo: number, outcome: 'win' | 'loss' | 'draw', timeClass: 'rapid' | 'blitz' | 'bullet' = 'rapid') => ({ endTime: NOW - hoursAgo * HOUR, timeClass, outcome });
const insight = (id: string): Insight => ({ id, severity: 'high', title: id, evidence: '', action: `ação ${id}` });

describe('before the games', () => {
  it("counts today's losses in a row at the end, rapid and blitz only", () => {
    expect(lossStreakToday([g(5, 'loss'), g(3, 'win'), g(2, 'loss'), g(1, 'loss', 'blitz')], NOW)).toBe(2);
    expect(lossStreakToday([g(2, 'loss'), g(1, 'loss', 'bullet')], NOW)).toBe(1);
    expect(lossStreakToday([g(30, 'loss'), g(25, 'loss')], NOW)).toBe(0); // yesterday
  });

  it('the stop rule comes first; then your diagnostics about how you play a session, three at most', () => {
    const insights = ['opening-white-x', 'fast', 'tilt', 'thrown', 'sittings'].map(insight);
    const out = gameReminders(insights, [g(2, 'loss'), g(1, 'loss')], NOW);
    expect(out.map((r) => r.stop)).toEqual([true, false, false]);
    expect(out.slice(1).map((r) => r.text)).toEqual(['ação tilt', 'ação sittings']);
    expect(gameReminders(insights, [], NOW).map((r) => r.text)).toEqual(['ação tilt', 'ação sittings', 'ação fast']);
  });
});
