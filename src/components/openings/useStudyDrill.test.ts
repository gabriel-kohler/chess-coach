// @vitest-environment jsdom
import { Chess } from 'chess.js';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epdOf } from '@/lib/chess/replay';
import { db, getKV } from '@/lib/db';
import { STUDY_MOVES_KEY, type StudyMoves } from '@/lib/decks/store';
import type { OpeningLine } from '@/lib/openings/study';
import type { EngineLine } from '@/lib/types';
import { STUDY_MOVES, useStudyDrill, type StudyDrill, type StudySetup } from './useStudyDrill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The engine: in every position, its first legal move is best (+30 for the side to move), the second is -300.
const analyse = vi.fn(async (fen: string): Promise<EngineLine[]> => {
  const c = new Chess(fen);
  const [a, b] = c.moves({ verbose: true });
  const sign = c.turn() === 'w' ? 1 : -1;
  return [a && { depth: 16, cp: 30 * sign, pv: [a.lan] }, b && { depth: 16, cp: -300 * sign, pv: [b.lan] }].filter(Boolean) as EngineLine[];
});
vi.mock('@/lib/engine/stockfish', () => ({ sharedEngine: () => ({ analyse, live: vi.fn(async () => undefined), cancelLive: vi.fn() }) }));
vi.mock('@/components/board/assets', () => ({ playSound: vi.fn(), soundForSan: () => 'move' }));
// People at your level: always the first legal move, 70% of them, from the explorer.
vi.mock('@/lib/openings/study', async (orig) => ({
  ...(await orig<typeof import('@/lib/openings/study')>()),
  levelMoves: vi.fn(async (fen: string) => {
    const m = new Chess(fen).moves({ verbose: true })[0]!;
    return [{ uci: m.lan, san: m.san, p: 0.7, source: 'explorer' }];
  }),
}));
const recordOpeningMiss = vi.fn(async (_miss: Record<string, unknown>) => undefined);
const saveStudyLine = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/openings/studyStore', () => ({ recordOpeningMiss: (m: Record<string, unknown>) => recordOpeningMiss(m), saveStudyLine: (...a: unknown[]) => saveStudyLine(...a) }));

const line: OpeningLine = { eco: 'A00', name: "Van't Kruijs Opening", family: "Van't Kruijs Opening", moves: ['e3'], key: 'vant kruijs opening' };
const setup: StudySetup = { line, side: 'black', tree: null, userElo: 1670, oppElo: 1670, rating: 1370, maia: true, explorer: true };

let current: StudyDrill;
function Probe(props: StudySetup) {
  current = useStudyDrill(props);
  return null;
}
const roots: Array<ReturnType<typeof createRoot>> = [];
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
/** Plays the n-th legal move of the position on the board. */
async function play(n: number) {
  const m = new Chess(current.fen).moves({ verbose: true })[n]!;
  await act(async () => void current.onMove({ from: m.from, to: m.to }));
  await flush();
}

beforeEach(() => {
  // The replies' delays are faked; the database (fake-indexeddb, on setImmediate) runs for real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
  recordOpeningMiss.mockClear();
  saveStudyLine.mockClear();
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('training any opening', () => {
  it('plays the opening, then waits for you; a good move goes on, a bad one is a miss you retry', async () => {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    await act(async () => root.render(createElement(Probe, setup)));
    await flush();
    expect(current.played).toEqual(['e3']);
    expect(current.phase).toBe('yours');

    await play(1); // the engine's second choice: 300 centipawns worse
    expect(current.feedback.kind).toBe('wrong');
    expect(current.played).toEqual(['e3']);
    expect(recordOpeningMiss).toHaveBeenCalledTimes(1);
    expect(recordOpeningMiss.mock.calls[0]![0]).toMatchObject({ name: "Van't Kruijs Opening", oppUci: 'e2e3', rating: 1370 });

    await play(1); // the same mistake again: still one exercise
    expect(recordOpeningMiss).toHaveBeenCalledTimes(1);

    await play(0); // the best move
    expect(current.feedback.kind).toBe('good');
    expect(current.played.length).toBe(3); // your move and their answer
    expect(current.reply).toMatchObject({ p: 0.7, source: 'explorer' });
    expect(current.count).toMatchObject({ yours: 1, asked: 1, good: 0 });
  });

  it(`ends after ${STUDY_MOVES} of your moves and keeps the record`, async () => {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    await act(async () => root.render(createElement(Probe, setup)));
    await flush();
    for (let i = 0; i < STUDY_MOVES; i++) await play(0);
    expect(current.phase).toBe('end');
    expect(current.count).toMatchObject({ yours: STUDY_MOVES, asked: STUDY_MOVES, good: STUDY_MOVES, lines: 1 });
    expect(saveStudyLine).toHaveBeenCalledWith("Van't Kruijs Opening|e3", 'black', STUDY_MOVES, STUDY_MOVES);
    expect(current.explorer.enabled).toBe(true);
  });

  it('with the opening saved as a deck, its positions are graded on the deck\'s cards instead of becoming puzzles', async () => {
    const afterE3 = new Chess();
    afterE3.move('e3');
    const epd = epdOf(afterE3.fen());
    const best = afterE3.moves({ verbose: true })[0]!.lan;
    const deck = { id: 'vant-1', positions: { [epd]: { epd, fen: afterE3.fen(), ply: 1, moves: [{ san: '?', uci: best, to: '', nags: [] }] } } };
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    await act(async () => root.render(createElement(Probe, { ...setup, deck })));
    await flush();
    await play(1); // a miss at the deck's position: its card, Again
    expect(recordOpeningMiss).not.toHaveBeenCalled();
    await flush();
    expect(await db.srsCards.get(`rep:d:vant-1|${epd}`)).toMatchObject({ kind: 'rep', deck: 'vant-1', reps: 1, lapses: 0 });
    await play(0); // then the right move: kept for the decks you build later
    expect((await getKV<StudyMoves>(STUDY_MOVES_KEY, { white: {}, black: {} })).black[epd]).toBe(best);
  });

  it('"Mostrar o melhor" plays it for you and counts the position as missed', async () => {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    await act(async () => root.render(createElement(Probe, setup)));
    await flush();
    await act(async () => current.showBest());
    await flush();
    expect(recordOpeningMiss).toHaveBeenCalledTimes(1);
    expect(current.count).toMatchObject({ yours: 1, asked: 1, good: 0 });
  });

  it('"Mostrar o melhor" right after a wrong move is not undone by the retry', async () => {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    await act(async () => root.render(createElement(Probe, setup)));
    await flush();
    const m = new Chess(current.fen).moves({ verbose: true })[1]!;
    await act(async () => void current.onMove({ from: m.from, to: m.to }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    expect(current.phase).toBe('wrong');
    await act(async () => current.showBest());
    await flush();
    await flush();
    // The board shows the line as played: the best move and the answer to it.
    const board = new Chess();
    for (const san of current.played) board.move(san);
    expect(current.played.length).toBe(3);
    expect(current.fen).toBe(board.fen());
  });
});
