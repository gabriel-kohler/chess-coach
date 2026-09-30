// @vitest-environment node
import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
import { epdOf } from '../chess/replay';
import { ExplorerLimited } from '../openings/study';
import { PUNISH } from './find';
import { pending, scan, type ScanDeps, type ScanState, type ScanTarget } from './scan';

const fen = (m: string[]) => {
  const c = new Chess();
  for (const x of m) c.move(x);
  return c.fen();
};
const AFTER_E3 = fen(['e3']);
const target = (over: Partial<ScanTarget> = {}): ScanTarget => ({ side: 'white', epd: epdOf(AFTER_E3), fen: AFTER_E3, book: ['e7e5'], weight: 1, ...over });
const empty = (): ScanState => ({ scanned: {}, items: {} });
const NOW = 1_000 * 86_400_000;

/** Black after 1.e3 at your opponents' level: e5 (book), g5 in 10% (a mistake), d5 in 20% (fine). */
function world(over: Partial<ScanDeps> = {}): ScanDeps & { analyse: ReturnType<typeof vi.fn> } {
  const analyse = vi.fn(async (f: string, limits: { searchmoves?: string[] }) => {
    if (limits.searchmoves) return limits.searchmoves.map((m) => ({ depth: 16, cp: m === 'g7g5' ? 300 : 20, pv: [m] }));
    // After the mistake, White's best punishment; at the position itself, e5 holding.
    return f.split(' ')[1] === 'w' ? [{ depth: 16, cp: 300, pv: ['d2d4'] }] : [{ depth: 16, cp: 0, pv: ['e7e5'] }];
  });
  return {
    explorer: async () => [{ uci: 'e7e5', san: 'e5', n: 500 }, { uci: 'd7d5', san: 'd5', n: 200 }, { uci: 'g7g5', san: 'g5', n: 100 }, { uci: 'h7h6', san: 'h6', n: 10 }],
    analyse,
    wait: async () => undefined,
    ...over,
  } as ScanDeps & { analyse: ReturnType<typeof vi.fn> };
}

describe('the scan for mistakes to punish', () => {
  it('finds the common move that gives up 10 points, with the engine\'s punishment', async () => {
    const deps = world();
    const r = await scan([target()], empty(), '1400,1600', deps, NOW);
    expect(Object.values(r.state.items).map((i) => [i.mistake.san, i.best.san])).toEqual([['g5', 'd4']]);
    expect(r.state.scanned['white|' + epdOf(AFTER_E3)]).toEqual({ at: NOW, buckets: '1400,1600' });
    expect(r.status).toBe('done');
  });

  it('takes the stored best line when there is one, and never runs the engine without a candidate', async () => {
    const deps = world();
    await scan([target({ best: { depth: 16, cp: 0, pv: ['e7e5'] } })], empty(), 'b', deps, NOW);
    // The candidates' search and the punishment: no search for the best line.
    expect(deps.analyse).toHaveBeenCalledTimes(2);
    const quiet = world({ explorer: async () => [{ uci: 'e7e5', san: 'e5', n: 900 }] });
    await scan([target()], empty(), 'b', quiet, NOW);
    expect(quiet.analyse).not.toHaveBeenCalled();
  });

  it('goes on from what it scanned, and scans again after a month or in another rating range', async () => {
    const first = await scan([target()], empty(), 'b', world(), NOW);
    const again = world();
    await scan([target()], first.state, 'b', again, NOW + 86_400_000);
    expect(again.analyse).not.toHaveBeenCalled();
    expect(pending([target()], first.state, 'b', NOW + PUNISH.staleMs + 1)).toHaveLength(1);
    expect(pending([target()], first.state, 'other', NOW)).toHaveLength(1);
  });

  it('Lichess asking to wait does not skip the position; asked too often, the scan pauses', async () => {
    let calls = 0;
    const wait = vi.fn(async () => undefined);
    const base = world();
    const r = await scan([target()], empty(), 'b', { ...base, wait, explorer: async (f) => (calls++ === 0 ? Promise.reject(new ExplorerLimited()) : base.explorer(f)) }, NOW);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(Object.keys(r.state.items)).toHaveLength(1);
    const stuck = await scan([target()], empty(), 'b', world({ explorer: async () => Promise.reject(new ExplorerLimited()) }), NOW);
    expect(stuck.status).toBe('paused');
    expect(stuck.state.scanned).toEqual({});
  });

  it('a new answer replaces what the position had', async () => {
    const first = await scan([target()], empty(), 'b', world(), NOW);
    const later = await scan([target()], first.state, 'b', world({ explorer: async () => [{ uci: 'e7e5', san: 'e5', n: 900 }] }), NOW + PUNISH.staleMs + 1);
    expect(later.state.items).toEqual({});
  });

  it('the likeliest positions first, and it stops when asked', async () => {
    const seen: string[] = [];
    const a = target({ epd: 'a', weight: 1 });
    const b = target({ epd: 'b', weight: 9 });
    let n = 0;
    await scan([a, b], empty(), 'x', world({ explorer: async () => (seen.push(String(n++)), []), stopped: () => n >= 1 }), NOW);
    expect(seen).toEqual(['0']);
    const order: string[] = [];
    await scan([a, b], empty(), 'x', world({ explorer: async () => [], save: async (s) => void order.push(...Object.keys(s.scanned).filter((k) => !order.includes(k))) }), NOW);
    expect(order).toEqual(['white|b', 'white|a']);
  });
});
