// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineFrom, useLineExplorer, type LineExplorer, type LinePly } from './useLineExplorer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const live = vi.fn(async () => undefined);
vi.mock('@/lib/engine/stockfish', () => ({ sharedEngine: () => ({ live, cancelLive: vi.fn() }) }));
vi.mock('./assets', () => ({ playSound: vi.fn(), soundForSan: () => 'move' }));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LINE = lineFrom(START, ['e4', 'e7e5', 'Nf3', 'b8c6']);

let current: LineExplorer;
function Probe(props: { line: LinePly[]; enabled: boolean; initialPly?: number }) {
  current = useLineExplorer({ start: START, ...props });
  return null;
}

const roots: Array<ReturnType<typeof createRoot>> = [];
async function mount(props: { line: LinePly[]; enabled: boolean; initialPly?: number }) {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(createElement(Probe, props)));
  return { rerender: (p: typeof props) => act(async () => root.render(createElement(Probe, p))) };
}
const run = (f: () => void) => act(async () => f());
const key = (k: string) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })));

beforeEach(() => live.mockClear());
// Each test's explorer stops listening to the keyboard when it ends.
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
});

describe('lines', () => {
  it('takes UCI and SAN alike, and stops at the first illegal move', () => {
    expect(LINE.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(lineFrom(START, ['e4', 'e4', 'Nf3']).map((p) => p.san)).toEqual(['e4']);
  });
});

describe('walking a line after an exercise', () => {
  it('opens where asked, and the keys and buttons walk the line', async () => {
    await mount({ line: LINE, enabled: true, initialPly: 4 });
    expect(current.ply).toBe(4);
    expect(current.fen).toBe(LINE[3]!.fenAfter);
    await key('ArrowLeft');
    await key('ArrowLeft');
    expect(current.ply).toBe(2);
    expect(current.lastMove).toEqual({ from: 'e7', to: 'e5' });
    await key('Home');
    expect([current.ply, current.fen]).toEqual([0, START]);
    await run(() => current.go(3));
    expect(current.fen).toBe(LINE[2]!.fenAfter);
  });

  it("playing the line's own move walks it; another move opens a variation with the engine", async () => {
    await mount({ line: LINE, enabled: true, initialPly: 0 });
    await run(() => void current.onMove({ from: 'e2', to: 'e4' }));
    expect([current.ply, current.variation]).toEqual([1, null]);
    await run(() => void current.onMove({ from: 'c7', to: 'c5' }));
    expect(current.variation).toMatchObject({ base: 1, index: 1 });
    expect(current.variation!.moves[0]!.san).toBe('c5');
    expect(live).toHaveBeenCalled();
    await run(() => void current.onMove({ from: 'g1', to: 'f3' }));
    expect(current.variation!.index).toBe(2);
    // Back one, then a different move replaces the rest of the variation.
    await key('ArrowLeft');
    await run(() => void current.onMove({ from: 'b1', to: 'c3' }));
    expect(current.variation!.moves.map((m) => m.san)).toEqual(['c5', 'Nc3']);
    await key('Escape');
    expect([current.ply, current.variation]).toEqual([1, null]);
  });

  it('stepping back past the start of a variation returns to the line', async () => {
    await mount({ line: LINE, enabled: true, initialPly: 2 });
    await run(() => void current.onMove({ from: 'f1', to: 'c4' }));
    await run(() => current.step(-1));
    expect(current.variation!.index).toBe(0);
    await run(() => current.step(-1));
    expect([current.ply, current.variation]).toEqual([2, null]);
  });

  it('does nothing before the exercise is decided, and a new exercise starts over', async () => {
    const view = await mount({ line: LINE, enabled: false, initialPly: 4 });
    // A legal move there (3.Bb5): still refused while the exercise is running.
    expect(current.onMove({ from: 'f1', to: 'b5' })).toBe(false);
    await key('ArrowLeft');
    expect(current.ply).toBe(4);
    await view.rerender({ line: LINE, enabled: true, initialPly: 4 });
    await run(() => current.go(1));
    const other = lineFrom(START, ['d4', 'd5']);
    await view.rerender({ line: other, enabled: true, initialPly: 2 });
    expect([current.ply, current.fen]).toEqual([2, other[1]!.fenAfter]);
  });

  it('a line that changes only past where you are (the engine deepening) keeps your place and your variation', async () => {
    const view = await mount({ line: LINE, enabled: true, initialPly: 0 });
    await run(() => current.go(2));
    await run(() => void current.onMove({ from: 'f1', to: 'c4' }));
    const deeper = lineFrom(START, ['e4', 'e7e5', 'Nc3', 'g8f6']);
    await view.rerender({ line: deeper, enabled: true, initialPly: 0 });
    expect(current.variation).toMatchObject({ base: 2, index: 1 });
    await key('Escape');
    // A change before where you are is a different line: back to the start.
    await view.rerender({ line: lineFrom(START, ['d4', 'd5', 'c4']), enabled: true, initialPly: 0 });
    expect([current.ply, current.variation]).toEqual([0, null]);
  });
});
