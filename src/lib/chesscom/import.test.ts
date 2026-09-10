import { describe, expect, it } from 'vitest';
import type { CCGame } from './api';
import { openingFromEcoUrl, outcomeOf, parseTimeControl, toStoredGame } from './import';

const game: CCGame = {
  url: 'https://www.chess.com/game/live/1',
  pgn: `[Event "Live Chess"]
[ECO "C50"]
[ECOUrl "https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-4.d3"]

1. e4 {[%clk 0:09:59]} 1... e5 {[%clk 0:09:58]} 2. Nf3 {[%clk 0:09:55]} 1-0`,
  time_control: '600+5',
  end_time: 1_700_000_000,
  rated: true,
  uuid: 'abc',
  time_class: 'rapid',
  rules: 'chess',
  white: { username: 'Opp', rating: 1400, result: 'win' },
  black: { username: 'snowww_99', rating: 1380, result: 'timeout' },
};

describe('chess.com import', () => {
  it('builds a stored game from the user point of view', () => {
    const g = toStoredGame(game, 'SNOWWW_99', '2026/09')!;
    expect(g.userColor).toBe('black');
    expect(g.outcome).toBe('loss');
    expect(g.userResult).toBe('timeout');
    expect(g.oppName).toBe('Opp');
    expect(g.moves).toEqual(['e4', 'e5', 'Nf3']);
    expect(g.clocks).toEqual([599, 598, 595]);
    expect(g.eco).toBe('C50');
    expect(g.opening).toBe('Italian Game Two Knights Defense');
    expect(g.endTime).toBe(1_700_000_000_000);
  });

  it('skips variants and games of other players', () => {
    expect(toStoredGame({ ...game, rules: 'chess960' }, 'snowww_99', 'x')).toBeNull();
    expect(toStoredGame(game, 'someone', 'x')).toBeNull();
  });

  it('maps result codes and time controls', () => {
    expect(outcomeOf('win')).toBe('win');
    expect(outcomeOf('repetition')).toBe('draw');
    expect(outcomeOf('abandoned')).toBe('loss');
    expect(parseTimeControl('180+2')).toEqual({ base: 180, increment: 2 });
    expect(parseTimeControl('1/86400')).toBeNull();
    expect(openingFromEcoUrl('https://www.chess.com/openings/Sicilian-Defense-Kan-Variation-5.Nc3')).toBe('Sicilian Defense Kan Variation');
  });
});
