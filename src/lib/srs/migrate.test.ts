import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { progress } from '../repertoire/drill';
import { isMastered } from '../tactics/trainer';
import type { Puzzle, PuzzleCard, RepCard, RepertoireCard } from '../types';
import { schedulerFor } from './fsrs';
import { carryMine, fromLadder, migrateLegacy } from './migrate';

const NOW = new Date(2026, 8, 10, 9, 0).getTime();
const DAY = 86_400_000;
const MIN = 60_000;

const rep = (epd: string, over: Partial<RepertoireCard>): RepertoireCard => ({ key: `white|${epd}`, side: 'white', epd, due: NOW, interval: 0, reps: 0, lapses: 0, lastAt: NOW - DAY, ...over });
const puzzle = (id: string, source: Puzzle['source'], over: Partial<PuzzleCard> = {}): PuzzleCard => ({
  id,
  puzzle: { id, source, fen: '', moves: [], rating: 1500, themes: [], ...(source === 'mine' ? { gameId: 'g1', ply: Number(id.split(':')[2] ?? 0) } : {}) },
  due: NOW,
  interval: 1,
  reps: 0,
  lapses: 1,
  createdAt: NOW - 10 * DAY,
  lastAt: NOW - DAY,
  mastered: false,
  ...over,
});

describe('from the old interval ladders to FSRS', () => {
  it('a right answer: the planned interval becomes the stability, the date stays', () => {
    const f = fromLadder({ due: NOW + 5 * DAY, interval: 7, reps: 3, lapses: 0, lastAt: NOW - 2 * DAY }, 'rep');
    expect(f).toMatchObject({ state: State.Review, stability: 7, due: NOW + 5 * DAY, last_review: NOW - 2 * DAY, scheduled_days: 7, reps: 3, lapses: 0 });
    expect(f.difficulty).toBeCloseTo(schedulerFor('rep').init_difficulty(Rating.Good), 6);
  });

  it('each lapse makes the card harder, as an Again would', () => {
    const d = (lapses: number) => fromLadder({ due: NOW, interval: 3, reps: 1, lapses, lastAt: NOW }, 'rep').difficulty;
    expect(d(1)).toBeCloseTo(schedulerFor('rep').init_difficulty(Rating.Again), 6);
    expect(d(2)).toBeGreaterThan(d(1));
    expect(d(1)).toBeGreaterThan(d(0));
  });

  it('a miss as the last answer: weak memory, back when it was due', () => {
    // Repertoire: the 10-minute retry becomes a relearning step.
    const r = fromLadder({ due: NOW + 10 * MIN, interval: 0, reps: 0, lapses: 2, lastAt: NOW }, 'rep');
    expect(r).toMatchObject({ state: State.Relearning, due: NOW + 10 * MIN, learning_steps: 0 });
    expect(r.stability).toBeCloseTo(schedulerFor('rep').init_stability(Rating.Again), 6);
    // Puzzles have no same-day steps, so the card stays in review, due tomorrow.
    expect(fromLadder({ due: NOW + DAY, interval: 1, reps: 0, lapses: 1, lastAt: NOW }, 'puzzle').state).toBe(State.Review);
  });

  it('never answered: a new card', () => {
    expect(fromLadder({ due: NOW, interval: 0, reps: 0, lapses: 0, createdAt: NOW - DAY, lastAt: NOW - DAY }, 'best')).toMatchObject({ state: State.New, reps: 0, due: NOW });
  });
});

describe('the v5 migration', () => {
  it('repertoire progress is the same before and after', () => {
    const old = [
      rep('a', { reps: 3, interval: 7, due: NOW + 4 * DAY }), // learned, not due
      rep('b', { reps: 1, interval: 1, due: NOW - DAY }), // learned, due
      rep('c', { reps: 0, lapses: 1, due: NOW - 5 * MIN }), // missed: due, not learned
      rep('d', { reps: 0, lapses: 3, due: NOW + 5 * MIN }), // missed, back in 5 minutes
    ];
    const ours = ['a', 'b', 'c', 'd', 'e'];
    const before = { total: ours.length, learned: old.filter((c) => c.reps > 0).length, due: old.filter((c) => c.due <= NOW).length };
    const cards = migrateLegacy(old, []).cards as RepCard[];
    expect(progress(new Map(cards.map((c) => [c.epd, c])), ours, NOW)).toEqual(before);
    expect(cards.map((c) => c.id)).toEqual(['rep:white|a', 'rep:white|b', 'rep:white|c', 'rep:white|d']);
  });

  it('tactics: the same puzzles are due and mastered; your own-game ones leave for Posições', () => {
    const old = [
      puzzle('l1', 'lichess', { due: NOW - DAY }),
      puzzle('l2', 'lichess', { reps: 2, lapses: 1, interval: 7, due: NOW + 3 * DAY }),
      puzzle('l3', 'lichess', { reps: 4, lapses: 1, interval: 35, due: NOW + 20 * DAY, mastered: true }),
      puzzle('g:g1:9', 'mine', { reps: 1, lapses: 0, interval: 3, due: NOW + 2 * DAY }),
      puzzle('g:g1:15', 'mine', { reps: 0, lapses: 0, interval: 0 }), // never played
    ];
    const { cards, mine } = migrateLegacy([], old);
    const lichess = old.filter((c) => c.puzzle.source === 'lichess');
    expect(cards.map((c) => c.id)).toEqual(['puzzle:l1', 'puzzle:l2', 'puzzle:l3']);
    expect(cards.filter((c) => c.due <= NOW).length).toBe(lichess.filter((c) => c.due <= NOW && !c.mastered).length);
    expect(cards.filter(isMastered).length).toBe(lichess.filter((c) => c.mastered).length);
    expect(Object.keys(mine)).toEqual(['g1:9']);
    expect(mine['g1:9']).toMatchObject({ state: State.Review, stability: 3, due: NOW + 2 * DAY });
  });

  it('a mastered puzzle stays retired, even with its old date long past', () => {
    const { cards } = migrateLegacy([], [puzzle('m1', 'lichess', { reps: 4, lapses: 0, interval: 35, due: NOW - 90 * DAY, mastered: true })]);
    expect(cards[0]).toMatchObject({ suspended: 1 });
    expect(isMastered(cards[0]!)).toBe(true);
  });

  it('own-game progress goes only to a Posições card never reviewed', () => {
    const fields = fromLadder({ due: NOW + 2 * DAY, interval: 3, reps: 1, lapses: 0, lastAt: NOW - DAY }, 'best');
    const older = { ...fields, last_review: NOW - 9 * DAY, stability: 1 };
    const card = (id: string, plies: number[], over = {}) => ({ id, sources: plies.map((ply) => ({ gameId: 'g1', ply })), state: State.New, reps: 0, ...over }) as never;
    const { put, used } = carryMine([card('fresh', [9, 21]), card('mine', [15], { state: State.Review, reps: 2 })], { 'g1:9': fields, 'g1:21': older, 'g1:15': fields, 'g1:40': fields });
    expect(put).toHaveLength(1);
    // Two games reached the position: the most recent progress wins.
    expect(put[0]).toMatchObject({ id: 'fresh', stability: 3, last_review: NOW - DAY });
    expect(used.sort()).toEqual(['g1:15', 'g1:21', 'g1:9']);
  });
});
