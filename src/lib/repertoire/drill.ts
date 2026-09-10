// Repertoire training in the Chessable style: the app plays the opponent, you
// play your repertoire moves; each of your positions is a spaced-repetition
// card. Lines are chosen so the positions that are due (or new) come up.
import { db } from '../db.ts';
import type { Color, RepertoireCard } from '../types.ts';
import type { CompiledSide, RepertoireMove } from './compile.ts';
import type { OpeningTree } from './games.ts';

const DAY = 86400000;
export const REP_DAYS = [1, 3, 7, 14, 30, 60, 120];
export const NEW_PER_SESSION = 12;

export const cardKey = (side: Color, epd: string) => `${side}|${epd}`;

export async function cardsFor(side: Color): Promise<Map<string, RepertoireCard>> {
  const cards = await db.repCards.where('side').equals(side).toArray();
  return new Map(cards.map((c) => [c.epd, c]));
}

export async function grade(side: Color, epd: string, correct: boolean) {
  const key = cardKey(side, epd);
  const now = Date.now();
  const card = (await db.repCards.get(key)) ?? { key, side, epd, due: now, interval: 0, reps: 0, lapses: 0, lastAt: now };
  if (correct) {
    const reps = card.reps + 1;
    const interval = REP_DAYS[Math.min(reps - 1, REP_DAYS.length - 1)]!;
    await db.repCards.put({ ...card, reps, interval, due: now + interval * DAY, lastAt: now });
  } else {
    await db.repCards.put({ ...card, reps: 0, lapses: card.lapses + 1, interval: 0, due: now + 10 * 60 * 1000, lastAt: now });
  }
}

/**
 * Picks the opponent's reply at a position: toward due or unseen positions of
 * ours first, then by how often your opponents actually play it. Frequency
 * counts as n^0.75: with snowww_99's games 1.e4 and 1.d4 get 75% of Black
 * drills (89% of real games) and rare first moves still come up once the main
 * lines are learned. A log gave them 22%: nineteen replies nobody plays
 * against you outweighed the two everyone plays.
 */
export function pickReply(
  rep: CompiledSide,
  epd: string,
  cards: Map<string, RepertoireCard>,
  tree: OpeningTree | null,
  scope: Set<string> | null,
): RepertoireMove | null {
  const pos = rep.positions[epd];
  if (!pos?.moves.length) return null;
  const now = Date.now();
  const candidates = pos.moves.filter((m) => !scope || scope.has(m.to));
  if (!candidates.length) return null;
  const weight = (m: RepertoireMove) => {
    const next = rep.positions[m.to];
    const card = cards.get(m.to);
    const urgency = !next?.moves.length ? 0.2 : !card ? 3 : card.due <= now ? 4 : 0.6;
    const freq = tree?.get(epd)?.get(m.uci)?.n ?? 0;
    return urgency * (1 + freq) ** 0.75;
  };
  const total = candidates.reduce((s, m) => s + weight(m), 0);
  let r = Math.random() * total;
  for (const m of candidates) {
    r -= weight(m);
    if (r <= 0) return m;
  }
  return candidates[0]!;
}

export interface RepertoireProgress {
  total: number;
  learned: number;
  due: number;
}

export function progress(cards: Map<string, RepertoireCard>, ours: string[]): RepertoireProgress {
  const now = Date.now();
  let learned = 0;
  let due = 0;
  for (const epd of ours) {
    const c = cards.get(epd);
    if (c && c.reps > 0) learned++;
    if (c && c.due <= now) due++;
  }
  return { total: ours.length, learned, due };
}
