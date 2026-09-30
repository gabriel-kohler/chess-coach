// What studying an opening leaves behind: every move you missed becomes a
// one-move exercise in your reviews (the FSRS puzzle queue: back tomorrow, in
// Treinar and in Tática), and a record per opening of how you did.
import { Rating } from 'ts-fsrs';
import { db, getKV, setKV } from '../db.ts';
import { recordReview } from '../positions/store.ts';
import { attemptIdFor, newPuzzleCard, puzzleCardId } from '../srs/cards.ts';
import type { Color, Puzzle } from '../types.ts';
import { STUDY_KEY, type StudyRecord } from './study.ts';

export interface OpeningMiss {
  /** The opening, shown with the review. */
  name: string;
  /** The position before the opponent's last move, and that move: the review shows it being played. */
  fenBefore: string;
  oppUci: string;
  /** The engine's best answer: the exercise's solution (any move within 5 points is accepted). */
  bestUci: string;
  /** The position you had to answer, one exercise per position. */
  epd: string;
  /** Your rating, for the exercise's level. */
  rating: number;
  timeMs: number;
}

export function openingPuzzle(m: OpeningMiss): Puzzle {
  return { id: `opening:${m.epd}`, source: 'opening', fen: m.fenBefore, moves: [m.oppUci, m.bestUci], rating: Math.round(m.rating), themes: ['opening'], note: m.name };
}

/** A miss is an Again: a new exercise comes back tomorrow; one you already had lapses. */
export async function recordOpeningMiss(m: OpeningMiss, now = Date.now()): Promise<void> {
  const puzzle = openingPuzzle(m);
  const cardId = puzzleCardId(puzzle.id);
  await recordReview({
    attemptId: attemptIdFor(cardId),
    cardId,
    at: now,
    grade: Rating.Again,
    signals: { uci: null, loss: null, lossSource: null, exact: false, correct: false, timeMs: m.timeMs, hiddenMs: 0, expectedMs: 10_000, bucket: 'easy', gaveUp: false },
    create: newPuzzleCard(puzzle, now),
  });
}

/** One line trained: added to the opening's record (by lineId). */
export async function saveStudyLine(id: string, side: Color, asked: number, good: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const all = await getKV<Record<string, StudyRecord>>(STUDY_KEY, {});
    const prev = all[id];
    await setKV(STUDY_KEY, { ...all, [id]: { side, drills: (prev?.drills ?? 0) + 1, asked: (prev?.asked ?? 0) + asked, good: (prev?.good ?? 0) + good, lastAt: now } satisfies StudyRecord });
  });
}
