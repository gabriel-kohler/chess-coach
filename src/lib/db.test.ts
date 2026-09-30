// @vitest-environment node
// Opens a database written by the v4 app and checks the v5 upgrade.
import Dexie from 'dexie';
import { State } from 'ts-fsrs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { LEGACY_MINE_KEY } from './srs/migrate';
import type { PuzzleCard, PuzzleSrsCard, RepCard, RepertoireCard } from './types';

const NOW = new Date(2026, 8, 10, 9, 0).getTime();
const DAY = 86_400_000;

async function writeV4(reps: RepertoireCard[], puzzles: PuzzleCard[]) {
  const old = new Dexie('chess-coach');
  old.version(3).stores({
    kv: 'key',
    games: 'id, endTime, timeClass, outcome, archive, userColor',
    archives: 'url, month',
    analyses: 'gameId, createdAt',
    attempts: '++id, puzzleId, at, source, mode',
    puzzleCards: 'id, due',
    repCards: 'key, side, due',
    narrations: 'key',
  });
  old.version(4).stores({
    srsCards: 'id, kind, note, due, state',
    reviewLogs: '++id, &attemptId, cardId, at, [kind+at]',
  });
  await old.open();
  await old.table('repCards').bulkPut(reps);
  await old.table('puzzleCards').bulkPut(puzzles);
  old.close();
}

const lichess: PuzzleCard = {
  id: 'Ab12',
  puzzle: { id: 'Ab12', source: 'lichess', fen: 'fen', moves: ['e2e4', 'e7e5', 'g1f3'], rating: 1520, themes: ['fork'] },
  due: NOW + DAY,
  interval: 1,
  reps: 0,
  lapses: 1,
  createdAt: NOW - DAY,
  lastAt: NOW,
  mastered: false,
};
const mine: PuzzleCard = { ...lichess, id: 'g:g1:9', puzzle: { ...lichess.puzzle, id: 'g:g1:9', source: 'mine', gameId: 'g1', ply: 9 }, reps: 1, lapses: 0, interval: 3, due: NOW + 3 * DAY };
const line: RepertoireCard = { key: 'black|epd1', side: 'black', epd: 'epd1', due: NOW + 7 * DAY, interval: 7, reps: 3, lapses: 0, lastAt: NOW };

beforeEach(async () => {
  await db.delete();
});

describe('database v5', () => {
  it('moves tactics and repertoire to FSRS with their progress, and keeps the old tables', async () => {
    await writeV4([line], [lichess, mine]);
    await db.open();
    expect(db.verno).toBe(7);
    const rep = (await db.srsCards.get('rep:black|epd1')) as RepCard;
    expect(rep).toMatchObject({ kind: 'rep', side: 'black', epd: 'epd1', state: State.Review, stability: 7, due: NOW + 7 * DAY });
    const puzzle = (await db.srsCards.get('puzzle:Ab12')) as PuzzleSrsCard;
    expect(puzzle).toMatchObject({ kind: 'puzzle', due: NOW + DAY, lapses: 1 });
    expect(puzzle.puzzle.moves).toEqual(['e2e4', 'e7e5', 'g1f3']);
    // Your own-game puzzle waits for its Posições card.
    expect(await db.srsCards.count()).toBe(2);
    expect(Object.keys(((await db.kv.get(LEGACY_MINE_KEY))?.value ?? {}) as object)).toEqual(['g1:9']);
    expect([await db.puzzleCards.count(), await db.repCards.count()]).toEqual([2, 1]);
  });

  it('v6 adds your chapters and leaves every card of v5 as it was', async () => {
    const old = new Dexie('chess-coach');
    old.version(3).stores({ kv: 'key', games: 'id, endTime, timeClass, outcome, archive, userColor', archives: 'url, month', analyses: 'gameId, createdAt', attempts: '++id, puzzleId, at, source, mode', puzzleCards: 'id, due', repCards: 'key, side, due', narrations: 'key' });
    old.version(4).stores({ srsCards: 'id, kind, note, due, state', reviewLogs: '++id, &attemptId, cardId, at, [kind+at]' });
    old.version(5).stores({});
    await old.open();
    await old.table('srsCards').put({ id: 'rep:white|x', kind: 'rep', note: 'rep:white|x', due: NOW, state: State.Review, stability: 9 });
    old.close();
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.srsCards.get('rep:white|x')).toMatchObject({ stability: 9, state: State.Review });
    expect(await db.userChapters.count()).toBe(0);
    await db.userChapters.put({ id: 'user:white:e', side: 'white', name: 'n', moves: ['e4'], createdAt: 1, source: { epd: 'a', san: 'e4', games: 2 } });
    expect(await db.userChapters.where('side').equals('white').count()).toBe(1);
  });

  it('v7 adds the decks built from any opening; your chapters and cards stay as they were', async () => {
    const old = new Dexie('chess-coach');
    old.version(3).stores({ kv: 'key', games: 'id, endTime, timeClass, outcome, archive, userColor', archives: 'url, month', analyses: 'gameId, createdAt', attempts: '++id, puzzleId, at, source, mode', puzzleCards: 'id, due', repCards: 'key, side, due', narrations: 'key' });
    old.version(4).stores({ srsCards: 'id, kind, note, due, state', reviewLogs: '++id, &attemptId, cardId, at, [kind+at]' });
    old.version(5).stores({});
    old.version(6).stores({ userChapters: 'id, side, createdAt' });
    await old.open();
    await old.table('srsCards').put({ id: 'rep:black|x', kind: 'rep', note: 'rep:black|x', due: NOW, state: State.Review, stability: 4 });
    await old.table('userChapters').put({ id: 'user:black:y', side: 'black', name: 'n', moves: ['e3', 'e5'], createdAt: 1, source: { epd: 'a', san: 'e3', games: 2 } });
    old.close();
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.srsCards.get('rep:black|x')).toMatchObject({ stability: 4 });
    expect(await db.userChapters.count()).toBe(1);
    expect(await db.decks.count()).toBe(0);
    await db.decks.put({ id: 's-vant', name: 'Van', side: 'black', opening: { eco: 'A00', name: 'Van', moves: ['e3'] }, positions: {}, sources: {}, differs: [], frontier: [], size: 30, limits: { minP: 0.02, maxDepth: 10 }, status: 'building', builtAt: null, createdAt: NOW });
    expect(await db.decks.where('side').equals('black').count()).toBe(1);
  });

  it('a fresh install opens with nothing to move', async () => {
    await db.open();
    expect(await db.srsCards.count()).toBe(0);
    expect(await db.kv.get(LEGACY_MINE_KEY)).toBeUndefined();
  });
});
