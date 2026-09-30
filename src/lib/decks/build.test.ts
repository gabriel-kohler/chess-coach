// @vitest-environment node
import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
import { epdOf, tryUci } from '../chess/replay';
import { ExplorerLimited } from '../openings/study';
import { turnOf } from '../repertoire/compile';
import { BUILD, grow, moveLabel, oursIn, pickAnswer, seed, type BuildDeps, type BuildState } from './build';

const AFTER_E3 = new Chess('rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1').fen();
const legal = (fen: string) => new Chess(fen).moves({ verbose: true }).sort((a, b) => a.lan.localeCompare(b.lan));

/** A made-up level: at every opponent position the same two moves by name order, 60% and 40%. */
function world(over: Partial<BuildDeps> = {}): BuildDeps {
  return {
    replies: async (fen) => legal(fen).slice(0, 2).map((m, i) => ({ uci: m.lan, san: m.san, p: i === 0 ? 0.6 : 0.4 })),
    answer: async (fen) => ({ uci: legal(fen)[0]!.lan, source: 'engine' }),
    wait: async () => undefined,
    ...over,
  };
}
const start = (size: number, limits: BuildState['limits'] = { minP: BUILD.minP, maxDepth: BUILD.maxDepth }): BuildState => ({ ...seed(AFTER_E3), size, limits });

describe('growing a deck from an opening', () => {
  it('stops at its size, answering every opponent move it keeps', async () => {
    const r = await grow(start(6), 'black', world());
    expect(r.status).toBe('done');
    const ours = oursIn(r.state.positions, 'black');
    // An opponent position is opened whole: up to one answer per reply past the size.
    expect(ours).toBeGreaterThanOrEqual(6);
    expect(ours).toBeLessThanOrEqual(7);
    // No line ends on the opponent's move: every reply kept leads to an answer.
    for (const p of Object.values(r.state.positions)) {
      if (turnOf(p.epd) === 'black') continue;
      for (const m of p.moves) expect(r.state.positions[m.to]?.moves).toHaveLength(1);
    }
  });

  it('lines rarer than the limit are answered but not followed', async () => {
    const r = await grow(start(100, { minP: 0.3, maxDepth: 10 }), 'black', world());
    // Opened: the lines at 1, 0.6, 0.4 and 0.6 x 0.6 = 0.36; at 0.24 and below they stop. 1 + 4 x 2 of your positions.
    expect(Object.values(r.state.positions).filter((p) => turnOf(p.epd) === 'white')).toHaveLength(4);
    expect(oursIn(r.state.positions, 'black')).toBe(9);
    expect(r.status).toBe('done');
  });

  it('shares count among the replies kept: people spread over many moves do not cut the likely line', async () => {
    // 30% and 20% of people, the rest spread thin: kept, they are 60% and 40%, as above.
    const spread = world({ replies: async (fen) => legal(fen).slice(0, 2).map((m, i) => ({ uci: m.lan, san: m.san, p: i === 0 ? 0.3 : 0.2 })) });
    const r = await grow(start(100, { minP: 0.3, maxDepth: 10 }), 'black', spread);
    expect(oursIn(r.state.positions, 'black')).toBe(9);
  });

  it('the likeliest line first: a rare reply waits while the likely line goes on', async () => {
    const deps = world({ replies: async (fen) => legal(fen).slice(0, 2).map((m, i) => ({ uci: m.lan, san: m.san, p: i === 0 ? 0.9 : 0.1 })) });
    const r = await grow(start(7, { minP: 0, maxDepth: 10 }), 'black', deps);
    // Your answer to 1.e3, the rare reply, your answer: that position is still waiting.
    const c = new Chess(AFTER_E3);
    tryUci(c, legal(c.fen())[0]!.lan);
    tryUci(c, legal(c.fen())[1]!.lan);
    tryUci(c, legal(c.fen())[0]!.lan);
    expect(r.state.positions[epdOf(c.fen())]).toBeUndefined();
    expect(r.state.frontier.some((n) => epdOf(n.fen) === epdOf(c.fen()))).toBe(true);
  });

  it('no deeper than its moves limit', async () => {
    const r = await grow(start(1000, { minP: 0, maxDepth: 2 }), 'black', world());
    const deepest = Math.max(...Object.values(r.state.positions).map((p) => p.ply));
    // After 1.e3 (ply 1) your two moves are at ply 1 and 3.
    expect(deepest).toBeLessThanOrEqual(3);
  });

  it('where nobody at your level has data, the line ends after your move', async () => {
    const r = await grow(start(10), 'black', world({ replies: async () => [] }));
    expect(oursIn(r.state.positions, 'black')).toBe(1);
    expect(r.status).toBe('done');
  });

  it('a reply you have no answer to stays out', async () => {
    let n = 0;
    const r = await grow(start(3), 'black', world({ answer: async (fen) => (n++ === 1 ? null : { uci: legal(fen)[0]!.lan, source: 'engine' }) }));
    const opp = Object.values(r.state.positions).find((p) => turnOf(p.epd) === 'white')!;
    expect(opp.moves).toHaveLength(1);
  });

  it('the same sources build the same deck', async () => {
    const a = await grow(start(12), 'black', world());
    const b = await grow(start(12), 'black', world());
    expect(Object.keys(b.state.positions)).toEqual(Object.keys(a.state.positions));
  });

  it('stopped anywhere, it goes on from its saved state to the same deck', async () => {
    const whole = await grow(start(12), 'black', world());
    let saved: BuildState | null = null;
    let steps = 0;
    const first = await grow(start(12), 'black', world({ save: async (s) => void (saved = s), stopped: () => ++steps > 3 }));
    expect(first.status).toBe('paused');
    const rest = await grow(saved!, 'black', world());
    expect(Object.keys(rest.state.positions).sort()).toEqual(Object.keys(whole.state.positions).sort());
  });

  it('Lichess asking to wait is not "no data": the line is asked again after the wait', async () => {
    const wait = vi.fn(async () => undefined);
    let calls = 0;
    const base = world();
    const r = await grow(start(4), 'black', { ...base, wait, replies: async (fen) => (calls++ === 0 ? Promise.reject(new ExplorerLimited()) : base.replies(fen)) });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(oursIn(r.state.positions, 'black')).toBeGreaterThanOrEqual(4);
  });

  it('when it keeps asking to wait, the build pauses with the line still open', async () => {
    const r = await grow(start(4), 'black', world({ replies: async () => Promise.reject(new ExplorerLimited()) }));
    expect(r.status).toBe('paused');
    expect(r.note).toMatch(/Lichess/);
    expect(r.state.frontier.length).toBe(1);
  });
});

describe('your answer in a deck', () => {
  const e5 = { uci: 'e7e5', san: 'e5' };
  const nf6 = { uci: 'g8f6', san: 'Nf6' };
  it('your study move first, then your repertoire, then the engine', () => {
    expect(pickAnswer(AFTER_E3, 'd7d5', nf6)).toEqual({ uci: 'd7d5', source: 'study', repertoire: 'Nf6' });
    expect(pickAnswer(AFTER_E3, undefined, nf6)).toEqual({ uci: 'g8f6', source: 'repertoire' });
    expect(pickAnswer(AFTER_E3, undefined, undefined)).toBe('engine');
    // A study move that does not play here is ignored.
    expect(pickAnswer(AFTER_E3, 'e2e4', e5)).toEqual({ uci: 'e7e5', source: 'repertoire' });
  });

  it('where the deck answers differently from your repertoire, it says so', async () => {
    const r = await grow(start(1), 'black', world({ answer: async (fen) => (epdOf(fen) === epdOf(AFTER_E3) ? { uci: 'e7e5', source: 'study', repertoire: 'Nf6' } : null) }));
    expect(r.state.differs).toEqual([{ epd: epdOf(AFTER_E3), deck: '1...e5', repertoire: '1...Nf6' }]);
    expect(moveLabel(new Chess().fen(), 'e4')).toBe('1.e4');
  });
});
