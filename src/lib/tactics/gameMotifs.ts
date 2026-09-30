// How often each tactical motif is the answer in the positions you got wrong
// in your games (the Posições cards). The tactics trainer leans its choice of
// theme toward them.
import { motifThemes } from '../explain/motifs.ts';
import type { BestMoveCard } from '../positions/types.ts';

export const GAME_MOTIFS_KEY = 'gameMotifs';

export function countMotifs(cards: BestMoveCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of cards) {
    if (c.suspended) continue;
    // Scores are from White's side: only a mate for you is a mating motif.
    const sign = c.color === 'white' ? 1 : -1;
    const mate = c.best.score.mate !== undefined && sign * c.best.score.mate > 0 ? c.best.score.mate : undefined;
    for (const t of motifThemes(c.fen, c.best.uci, mate)) counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}
