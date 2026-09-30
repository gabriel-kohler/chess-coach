// @vitest-environment jsdom
import { Chess } from 'chess.js';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Rating } from 'ts-fsrs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epdOf, type CompiledSide, type RepertoirePosition } from '@/lib/repertoire/compile';
import { START_FEN, useRepDrill, type RepDrill, type RepDrillOptions } from './useRepDrill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const grade = vi.fn(async (..._args: unknown[]) => Rating.Good);
vi.mock('@/lib/repertoire/drill', async (orig) => ({
  ...(await orig<typeof import('@/lib/repertoire/drill')>()),
  grade: (...args: unknown[]) => grade(...args),
  cardsFor: async () => new Map(),
  repertoireExpectedMs: async () => 10_000,
}));
vi.mock('@/components/board/assets', () => ({ playSound: vi.fn(), soundForSan: () => 'move' }));
vi.mock('@/lib/engine/stockfish', () => ({ sharedEngine: () => ({ live: vi.fn(async () => undefined), cancelLive: vi.fn() }) }));

function epd(moves: string[]): string {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return epdOf(c.fen());
}

// White: 1.e4, then 2.Nf3 after 1...e5 or 1...c5; 2...Nc6 and 2...d6 end the lines.
const lines = [['e4', 'e5', 'Nf3', 'Nc6'], ['e4', 'c5', 'Nf3', 'd6']];
const positions: Record<string, RepertoirePosition> = {};
for (const line of lines) {
  const c = new Chess();
  for (const san of line) {
    const from = epdOf(c.fen());
    const mv = c.move(san);
    const p = (positions[from] ??= { epd: from, fen: mv.before, ply: 0, moves: [] });
    if (!p.moves.some((m) => m.san === mv.san)) p.moves.push({ san: mv.san, uci: mv.lan, to: epdOf(mv.after), nags: [] });
  }
}
const rep: CompiledSide = { side: 'white', chapters: [], positions };
const C5 = epd(['e4', 'c5']);

let current: RepDrill;
function Probe(props: RepDrillOptions) {
  current = useRepDrill(props);
  return null;
}
const roots: Array<ReturnType<typeof createRoot>> = [];
async function mount(over: Partial<RepDrillOptions>) {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(createElement(Probe, { side: 'white', rep, index: null, lineKey: 'k', prefix: [], scope: null, ...over })));
}
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const play = (from: string, to: string) => act(async () => void current.onMove({ from, to }));

beforeEach(() => {
  vi.useFakeTimers();
  grade.mockClear();
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a repertoire line in a session', () => {
  it('plays a real game up to where you left the book by itself, and asks from there', async () => {
    await mount({ prefix: ['e4', 'c5'], attemptIdFor: (e) => `s|${e}` });
    await tick(0);
    expect(epdOf(current.fen)).toBe(C5);
    expect(current.drilled).toEqual(['e4', 'c5']);
    expect(grade).not.toHaveBeenCalled();
    await play('g1', 'f3');
    expect(grade).toHaveBeenCalledTimes(1);
    expect(grade.mock.calls[0]![1]).toBe(C5);
    expect(grade.mock.calls[0]![4]).toBe(`s|${C5}`);
  });

  it('as free practice nothing is graded, and a script replays the same line', async () => {
    // Left to chance, the reply after 1.e4 would be 1...e5 (the first one): the script says 1...c5.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ends: string[][] = [];
    await mount({ graded: false, script: ['e4', 'c5', 'Nf3', 'd6'], onEnd: (r) => ends.push(r.line) });
    await play('e2', 'e4');
    await tick(500);
    expect(current.drilled).toEqual(['e4', 'c5']);
    await play('g1', 'f3');
    await tick(500);
    await tick(0);
    expect(current.ended).toBe(true);
    expect(ends).toEqual([['e4', 'c5', 'Nf3', 'd6']]);
    expect(grade).not.toHaveBeenCalled();
  });

  it('leaving the line (skipping the step) cancels the reply on its way: no sound, no end reported', async () => {
    const { playSound } = await import('@/components/board/assets');
    const ends: string[][] = [];
    await mount({ graded: false, script: ['e4', 'c5', 'Nf3', 'd6'], onEnd: (r) => ends.push(r.line) });
    await play('e2', 'e4');
    await tick(500);
    await play('g1', 'f3');
    vi.mocked(playSound).mockClear();
    // Gone before the 420 ms reply lands.
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    await tick(1000);
    expect(playSound).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
  });

  it('a deck: the start comes from your cards at each line, and grades go to its own cards', async () => {
    const starts: number[] = [];
    await mount({ ns: 'd:vant-1', prefix: [], startFor: (cards) => (starts.push(cards.size), ['e4', 'c5']) });
    await tick(0);
    expect(epdOf(current.fen)).toBe(C5);
    await play('g1', 'f3');
    expect(grade.mock.calls[0]![0]).toBe('white');
    expect(grade.mock.calls[0]![5]).toBe('d:vant-1');
    await tick(500);
    await tick(0);
    await act(async () => current.newLine());
    expect(starts).toEqual([0, 0]);
  });

  it('analysing mid-line: the moves so far on the analysis board, and the position that waited for you goes ungraded', async () => {
    await mount({ prefix: ['e4', 'c5'] });
    await tick(0);
    expect(current.explorer.enabled).toBe(false);
    await act(async () => current.explore());
    expect(current.exploring).toBe(true);
    expect(current.explorer.enabled).toBe(true);
    expect(current.explorer.line.map((p) => p.san)).toEqual(['e4', 'c5']);
    // Step back and try another move there: it is only analysis.
    await act(async () => current.explorer.step(-1));
    expect(current.explorer.ply).toBe(1);
    await act(async () => current.resume());
    expect(current.exploring).toBe(false);
    await play('g1', 'f3');
    expect(grade).not.toHaveBeenCalled();
    expect(current.feedback.kind).toBe('good');
    // A new line grades again.
    await tick(500);
    await tick(0);
    await act(async () => current.newLine());
    await tick(0);
    await play('g1', 'f3');
    expect(grade).toHaveBeenCalledTimes(1);
  });

  it('analysing, the line can go on from the analysis board: another reply there, and what you looked at is not graded', async () => {
    await mount({ prefix: ['e4', 'c5'] });
    await tick(0);
    await act(async () => current.explore());
    // Where the line stopped there is nothing new to train from.
    expect(current.atStop).toBe(true);
    expect(current.canTrainHere).toBe(false);
    // Back to 1.e4: a move the repertoire does not know gives nothing to train.
    await act(async () => current.explorer.step(-1));
    await act(async () => void current.explorer.onMove({ from: 'd7', to: 'd5' }));
    expect(current.canTrainHere).toBe(false);
    // The other reply, 1...e5, which it answers.
    await act(async () => current.explorer.step(-1));
    await act(async () => void current.explorer.onMove({ from: 'e7', to: 'e5' }));
    expect(current.canTrainHere).toBe(true);
    await act(async () => current.trainHere());
    await tick(0);
    expect(current.exploring).toBe(false);
    expect(current.drilled).toEqual(['e4', 'e5']);
    expect(epdOf(current.fen)).toBe(epd(['e4', 'e5']));
    expect(current.waiting).toBe(false);
    // You saw this position on the analysis board: the right move goes on, ungraded.
    await play('g1', 'f3');
    expect(grade).not.toHaveBeenCalled();
    expect(current.feedback.kind).toBe('good');
    await tick(500);
    await tick(0);
    expect(current.ended).toBe(true);
    expect(current.drilled).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('training from the analysis drops the move the stopped line had on its way', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await mount({});
    await tick(0);
    await play('e2', 'e4');
    // The opponent's reply is on its way when you stop to analyse, then go back to move 1 and train from there.
    await act(async () => current.explore());
    await act(async () => current.explorer.step(-1));
    expect(current.canTrainHere).toBe(true);
    await act(async () => current.trainHere());
    await tick(500);
    await tick(0);
    expect(current.drilled).toEqual([]);
    expect(current.fen).toBe(START_FEN);
    expect(current.waiting).toBe(false);
  });

  it('a line that ends while you analyse closes the analysis of the line so far', async () => {
    await mount({ prefix: ['e4', 'c5'] });
    await tick(0);
    await play('g1', 'f3');
    // 2...d6 is on its way and ends the line.
    await act(async () => current.explore());
    expect(current.exploring).toBe(true);
    await tick(500);
    await tick(0);
    expect(current.ended).toBe(true);
    expect(current.exploring).toBe(false);
    expect(current.explorer.line.map((p) => p.san)).toEqual(['e4', 'c5', 'Nf3', 'd6']);
  });

  it('reports the line with its grades once they are saved', async () => {
    const ends: Array<{ asked: number; wrong: number; ratings: number[] }> = [];
    await mount({ script: ['e4', 'e5', 'Nf3', 'Nc6'], onEnd: (r) => ends.push({ asked: r.asked, wrong: r.wrong, ratings: r.ratings }) });
    await play('d2', 'd4'); // not the book move: a miss, graded once
    await play('e2', 'e4');
    await tick(500);
    await play('g1', 'f3');
    await tick(500);
    await tick(0);
    expect(ends).toEqual([{ asked: 2, wrong: 1, ratings: [Rating.Good, Rating.Good] }]);
    expect(grade.mock.calls.map((c) => (c[2] as { correct: boolean }).correct)).toEqual([false, true]);
  });
});
