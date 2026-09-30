// Real retention against the FSRS prediction, on long-term reviews only
// (the card was in Review state): same-day learning repeats say nothing
// about memory over days.
import { forgetting_curve, Rating, State } from 'ts-fsrs';
import type { ReviewLogRow } from './types.ts';

const DAY = 86_400_000;

export interface RetentionStats {
  reviews: number;
  longTerm: number;
  actual: number | null;
  predicted: number | null;
}

/** Long-term reviews (the card was in Review state): recalled share against the FSRS prediction at that moment. */
export function retentionStats(logs: ReviewLogRow[], w: readonly number[]): RetentionStats {
  const byCard = new Map<string, ReviewLogRow[]>();
  for (const l of logs) (byCard.get(l.cardId) ?? byCard.set(l.cardId, []).get(l.cardId)!).push(l);
  let n = 0;
  let recalled = 0;
  let predicted = 0;
  for (const list of byCard.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 1; i < list.length; i++) {
      const l = list[i]!;
      if (l.state !== State.Review || l.stability <= 0) continue;
      n++;
      if (l.rating > Rating.Again) recalled++;
      predicted += forgetting_curve(w as number[], Math.max(0, (l.at - list[i - 1]!.at) / DAY), l.stability);
    }
  }
  return { reviews: logs.length, longTerm: n, actual: n ? recalled / n : null, predicted: n ? predicted / n : null };
}

