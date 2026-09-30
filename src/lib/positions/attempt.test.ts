import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { attemptReducer, initAttempt, type AttemptEvent, type AttemptState } from './attempt';
import type { MoveScore } from './types';

const E = 20_000;
const score = (uci: string, loss: number, exact = false): MoveScore => ({ uci, loss, exact, source: 'engine', best: { uci: 'c4b5', pv: ['c4b5'], score: { cp: 60 }, depth: 16 }, reply: null });
const run = (events: AttemptEvent[], s: AttemptState = initAttempt(E)) => events.reduce(attemptReducer, s);
const ready: AttemptEvent = { type: 'ready', at: 0 };
const move = (uci: string, timeMs = 8000): AttemptEvent => ({ type: 'move', uci, san: uci, fenAfter: 'x', timeMs });

describe('one attempt', () => {
  it('ignores moves while the position is loading', () => {
    expect(run([move('c4b5')]).phase).toBe('loading');
  });

  it('the exact move played fast ends in a verdict graded Easy', () => {
    const s = run([ready, move('c4b5', 0.4 * E), { type: 'scored', uci: 'c4b5', score: score('c4b5', 0, true) }]);
    expect(s.phase).toBe('verdict');
    expect(s.rating).toBe(Rating.Easy);
    expect(s.solved).toBe(true);
  });

  it('a first move losing 3 points is acceptable and graded Hard', () => {
    const s = run([ready, move('d2d3'), { type: 'scored', uci: 'd2d3', score: score('d2d3', 3) }]);
    expect(s.phase).toBe('verdict');
    expect(s.rating).toBe(Rating.Hard);
  });

  it('a mistake, a hint and a right retry stay graded Again', () => {
    let s = run([ready, move('h2h3'), { type: 'scored', uci: 'h2h3', score: score('h2h3', 12) }]);
    expect(s.phase).toBe('wrong');
    s = run([{ type: 'revert' }, { type: 'hint' }], s);
    expect(s.hint).toBe(true);
    s = run([move('c4b5'), { type: 'scored', uci: 'c4b5', score: score('c4b5', 0, true) }], s);
    expect(s.phase).toBe('verdict');
    expect(s.rating).toBe(Rating.Again);
    expect(s.solved).toBe(true);
    expect(s.tries).toBe(2);
    expect(s.first?.uci).toBe('h2h3');
  });

  it('a hint before any move is ignored', () => {
    expect(run([ready, { type: 'hint' }]).hint).toBe(false);
  });

  it('after a mistake, a merely acceptable retry is not enough', () => {
    const s = run([ready, move('h2h3'), { type: 'scored', uci: 'h2h3', score: score('h2h3', 12) }, { type: 'revert' }, move('d2d3'), { type: 'scored', uci: 'd2d3', score: score('d2d3', 3) }]);
    expect(s.phase).toBe('wrong');
    expect(s.message).toContain('serve');
  });

  it('giving up before moving is Again with no move', () => {
    const s = run([ready, { type: 'giveUp', timeMs: 30_000 }]);
    expect(s.phase).toBe('verdict');
    expect(s.rating).toBe(Rating.Again);
    expect(s.first).toMatchObject({ uci: null, gaveUp: true });
  });

  it('ignores a late score for a move that is no longer pending', () => {
    const s = run([ready, move('c4b5'), { type: 'scored', uci: 'h2h3', score: score('h2h3', 0) }]);
    expect(s.phase).toBe('checking');
  });

  it('an engine failure lets you play again without counting a try', () => {
    const s = run([ready, move('c4b5'), { type: 'scoreFailed', uci: 'c4b5' }]);
    expect(s.phase).toBe('playing');
    expect(s.tries).toBe(0);
    expect(s.message).toContain('conferir');
  });
});
