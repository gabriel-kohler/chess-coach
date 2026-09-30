// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ENDGAMES, type EndgameRecord } from '../endgames';
import type { FocusCategory, FocusShare, FocusWeights } from '../positions/types';
import { isFirm, pickEndgame } from './endgame';

const NOW = new Date(2026, 8, 11, 9, 0).getTime();
const DAY = 86_400_000;

function weights(shares: Partial<Record<FocusCategory, number>>): FocusWeights {
  const s = (share: number): FocusShare => ({ share, count: 1, lo: share, hi: share });
  const all = ['opening', 'middlegame', 'endgame', 'convert', 'balanced', 'defend', 'fast', 'lowClock', 'blunder', 'mistake', 'inaccuracy', 'miss'] as FocusCategory[];
  return { version: 1, computedAt: NOW, games: 40, windowDays: 90, totalLoss: 100, block: 40, provisional: false, shares: Object.fromEntries(all.map((k) => [k, s(shares[k] ?? 0)])) as FocusWeights['shares'] };
}
const rec = (attempts: number, successes: number, daysAgo = 10): EndgameRecord => ({ attempts, successes, lastAt: NOW - daysAgo * DAY });

describe('the daily endgame', () => {
  it('only when at least a fifth of the points you lose go in endgames', () => {
    expect(pickEndgame(ENDGAMES, {}, weights({ endgame: 0.19, convert: 0.5 }), NOW)).toBeNull();
    expect(pickEndgame(ENDGAMES, {}, null, NOW)).toBeNull();
    expect(pickEndgame(ENDGAMES, {}, weights({ endgame: 0.2, convert: 0.5 }), NOW)?.drill.id).toBe('kqk');
  });

  it('the first drill you do not hold yet, by level; one done in the last two days rests', () => {
    const w = weights({ endgame: 0.3, convert: 0.5 });
    expect(isFirm(rec(4, 3))).toBe(true);
    expect(isFirm(rec(6, 3))).toBe(false); // 3 successes, but half the tries
    expect(pickEndgame(ENDGAMES, { kqk: rec(4, 3) }, w, NOW)?.drill.id).toBe('krk');
    expect(pickEndgame(ENDGAMES, { kqk: rec(4, 3), krk: rec(1, 0, 1) }, w, NOW)?.drill.id).toBe('kpk-front');
  });

  it('defending costs you more than converting: the drawing drills first', () => {
    const out = pickEndgame(ENDGAMES, {}, weights({ endgame: 0.3, defend: 0.4, convert: 0.2 }), NOW);
    expect(out?.drill.goal).toBe('draw');
    expect(out?.drill.id).toBe('kpk-defend');
    expect(out?.reason).toBe('30% dos pontos que você perde saem em finais.');
  });

  it('with everything held, the one done longest ago', () => {
    const records = Object.fromEntries(ENDGAMES.map((d, i) => [d.id, rec(5, 5, 3 + i)]));
    expect(pickEndgame(ENDGAMES, records, weights({ endgame: 0.3 }), NOW)?.drill.id).toBe(ENDGAMES.at(-1)!.id);
  });
});
