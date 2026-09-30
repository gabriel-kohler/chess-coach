// The daily endgame: only when a real share of the points you lose goes in
// endgames, and then the first drill you do not hold yet.
import type { EndgameDrill, EndgameRecord } from '../endgames.ts';
import type { FocusWeights } from '../positions/types.ts';
import { TRAINING } from './config.ts';

const DAY = 86_400_000;

/** Held: enough successes, most of the tries. */
export function isFirm(r: EndgameRecord | undefined): boolean {
  const { firmSuccesses, firmRate } = TRAINING.endgame;
  return !!r && r.successes >= firmSuccesses && r.successes / Math.max(1, r.attempts) >= firmRate;
}

export function pickEndgame(
  drills: EndgameDrill[],
  records: Record<string, EndgameRecord>,
  weights: FocusWeights | null,
  now: number,
): { drill: EndgameDrill; reason: string } | null {
  const share = weights?.shares.endgame?.share ?? 0;
  if (!weights || share < TRAINING.endgameMinShare) return null;
  const resting = (d: EndgameDrill) => {
    const r = records[d.id];
    return !!r && now - r.lastAt < TRAINING.endgame.restDays * DAY;
  };
  // Defending costs you more than converting: the drawing drills first.
  const defendFirst = (weights.shares.defend?.share ?? 0) > (weights.shares.convert?.share ?? 0);
  const preferred = (d: EndgameDrill) => ((d.goal === 'draw') === defendFirst ? 0 : 1);
  const open = drills.filter((d) => !resting(d));
  const todo = open.filter((d) => !isFirm(records[d.id])).sort((a, b) => preferred(a) - preferred(b) || a.level - b.level);
  // Everything held: the one you did longest ago keeps it held.
  const drill = todo[0] ?? [...open].sort((a, b) => (records[a.id]?.lastAt ?? 0) - (records[b.id]?.lastAt ?? 0))[0];
  if (!drill) return null;
  return { drill, reason: `${Math.round(share * 100)}% dos pontos que você perde saem em finais.` };
}
