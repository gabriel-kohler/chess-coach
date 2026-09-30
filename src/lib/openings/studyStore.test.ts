// @vitest-environment node
import { Rating } from 'ts-fsrs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getKV } from '../db';
import { duePuzzles } from '../tactics/trainer';
import type { PuzzleSrsCard } from '../types';
import { STUDY_KEY } from './study';
import { recordOpeningMiss, saveStudyLine } from './studyStore';

const NOW = new Date(2026, 8, 11, 12, 0).getTime();
const DAY = 86_400_000;
// 1.e3 e5: you (White) had to answer after 1...e5.
const miss = { name: "Van't Kruijs Opening", fenBefore: 'rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1', oppUci: 'e7e5', bestUci: 'd2d4', epd: 'rnbqkbnr/pppp1ppp/8/4p3/8/4P3/PPPP1PPP/RNBQKBNR w KQkq e6', rating: 1370, timeMs: 8_000 };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('a move you missed studying an opening', () => {
  it('becomes a one-move exercise in your reviews, back tomorrow', async () => {
    await recordOpeningMiss(miss, NOW);
    const card = (await db.srsCards.get(`puzzle:opening:${miss.epd}`)) as PuzzleSrsCard;
    expect(card.puzzle).toMatchObject({ source: 'opening', fen: miss.fenBefore, moves: ['e7e5', 'd2d4'], note: "Van't Kruijs Opening", themes: ['opening'] });
    expect(card.due - NOW).toBeGreaterThanOrEqual(DAY);
    expect(await duePuzzles(NOW + 2 * DAY)).toHaveLength(1);
    expect((await db.reviewLogs.toArray()).map((l) => l.rating)).toEqual([Rating.Again]);
  });

  it('the same position missed again is a lapse of the same exercise, not a new one', async () => {
    await recordOpeningMiss(miss, NOW);
    await recordOpeningMiss(miss, NOW + 3 * DAY);
    expect(await db.srsCards.count()).toBe(1);
    expect(await db.reviewLogs.count()).toBe(2);
  });
});

it('each line trained adds to the opening record', async () => {
  await saveStudyLine("Van't Kruijs Opening|e3", 'black', 5, 3, NOW);
  await saveStudyLine("Van't Kruijs Opening|e3", 'black', 4, 4, NOW + 1);
  expect(await getKV(STUDY_KEY, {})).toEqual({ "Van't Kruijs Opening|e3": { side: 'black', drills: 2, asked: 9, good: 7, lastAt: NOW + 1 } });
});
