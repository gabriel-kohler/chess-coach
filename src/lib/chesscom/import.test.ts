import { describe, expect, it } from 'vitest';
import type { CCGame } from './api';
import { bookPliesFromEcoUrl, openingFromEcoUrl, outcomeOf, parseTimeControl, toStoredGame } from './import';

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

  it("reads chess.com's book depth from the ECO URL", () => {
    const url = (slug: string) => `https://www.chess.com/openings/${slug}`;
    expect(bookPliesFromEcoUrl(url('Van-t-Kruijs-Opening-1...c5'), ['e3', 'c5', 'd3'])).toBe(2);
    expect(bookPliesFromEcoUrl(url('Italian-Game-3...d6'), ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'c3'])).toBe(6);
    // Canonical order 2.Bf4 g6 3.Nc3 Bg7, reached as 2.Nc3 g6 3.Bf4 Bg7.
    expect(bookPliesFromEcoUrl(url('Indian-Game-2.Bf4-g6-3.Nc3-Bg7'), ['d4', 'Nf6', 'Nc3', 'g6', 'Bf4', 'Bg7', 'Qd2'])).toBe(6);
    expect(bookPliesFromEcoUrl(url('Kings-Indian-Defense-Orthodox-Variation-6...Nbd7-7.O-O'), ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'Nbd7', 'O-O'])).toBe(13);
    expect(bookPliesFromEcoUrl(url('Sicilian-Defense'), ['e4', 'c5'])).toBe(0);
    expect(bookPliesFromEcoUrl(url('Italian-Game-3...d6'), ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'])).toBe(0);
    expect(bookPliesFromEcoUrl(undefined, ['e4'])).toBe(0);
  });
});
