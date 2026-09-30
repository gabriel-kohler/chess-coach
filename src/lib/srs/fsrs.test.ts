import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { newFsrsFields, reviewCard } from './fsrs';

const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;

describe('FSRS adapter', () => {
  it('starts a card as New and due now', () => {
    const f = newFsrsFields(NOW);
    expect(f.state).toBe(State.New);
    expect(f.due).toBe(NOW);
    expect(f.last_review).toBeNull();
  });

  it('a missed new position comes back in 1 minute, a right one in 10', () => {
    const again = reviewCard(newFsrsFields(NOW), Rating.Again, NOW).next;
    expect(again.state).toBe(State.Learning);
    expect(again.due - NOW).toBe(MIN);
    const good = reviewCard(newFsrsFields(NOW), Rating.Good, NOW).next;
    expect(good.state).toBe(State.Learning);
    expect(good.due - NOW).toBe(10 * MIN);
  });

  it('a second Good graduates to days, Easy graduates at once', () => {
    const first = reviewCard(newFsrsFields(NOW), Rating.Good, NOW).next;
    const second = reviewCard(first, Rating.Good, NOW + 10 * MIN).next;
    expect(second.state).toBe(State.Review);
    expect(second.due - (NOW + 10 * MIN)).toBeGreaterThanOrEqual(DAY);
    expect(reviewCard(newFsrsFields(NOW), Rating.Easy, NOW).next.state).toBe(State.Review);
  });

  it('a lapse on a review card relearns in 10 minutes', () => {
    const learned = reviewCard(newFsrsFields(NOW), Rating.Easy, NOW).next;
    const at = learned.due;
    const lapse = reviewCard(learned, Rating.Again, at).next;
    expect(lapse.state).toBe(State.Relearning);
    expect(lapse.due - at).toBe(10 * MIN);
    expect(lapse.lapses).toBe(1);
  });

  it('stores plain numbers only, so Dexie indexes stay ordered', () => {
    const r = reviewCard(newFsrsFields(NOW), Rating.Good, NOW);
    for (const v of Object.values(r.next)) expect(['number', 'object']).toContain(typeof v);
    expect(typeof r.next.due).toBe('number');
    expect(typeof r.next.last_review).toBe('number');
    expect(r.log.state).toBe(State.New);
  });
});
