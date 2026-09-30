import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { ALL_MOVES, boardToTensor, encodePosition, eloToCategory, mirrorFen, mirrorMove, moveIndex, policyFromLogits } from './encode';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const plane = (t: Float32Array, ch: number) => Array.from(t.subarray(ch * 64, ch * 64 + 64));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('Maia-2 encoding', () => {
  it('uses the model move list: 1880 moves, promotions last', () => {
    expect(ALL_MOVES).toHaveLength(1880);
    expect(moveIndex('a1h8')).toBe(0);
    expect(ALL_MOVES.at(-1)).toBe('h7g8n');
  });

  it('buckets ratings like Maia-2: below 1100, per 100, 2000 and up', () => {
    expect([900, 1100, 1199, 1400, 1650, 1999, 2400].map(eloToCategory)).toEqual([0, 1, 1, 4, 6, 9, 10]);
  });

  it('mirrors moves and positions for Black to move', () => {
    expect(mirrorMove('e2e4')).toBe('e7e5');
    expect(mirrorMove('a7a8q')).toBe('a2a1q');
    expect(mirrorFen(AFTER_E4)).toBe('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 1');
  });

  it('puts every piece on its plane, with turn and castling planes filled', () => {
    const t = boardToTensor(new Chess(START));
    expect(sum(plane(t, 0))).toBe(8); // white pawns
    expect(t[0 * 64 + 1 * 8 + 4]).toBe(1); // white pawn on e2: row = rank 2
    expect(sum(plane(t, 11))).toBe(1); // black king
    expect(sum(plane(t, 12))).toBe(64); // White to move
    for (const ch of [13, 14, 15, 16]) expect(sum(plane(t, ch))).toBe(64);
    expect(sum(plane(t, 17))).toBe(0);
  });

  it('a Black-to-move position is seen as White to move, its moves mapped back', () => {
    const e = encodePosition(AFTER_E4);
    expect(e.mirrored).toBe(true);
    expect(sum(plane(e.tensor, 12))).toBe(64);
    expect(e.legal).toHaveLength(20);
    const e5 = e.legal.find((l) => l.uci === 'e7e5')!;
    expect(e5.index).toBe(moveIndex('e2e4'));
  });

  it('marks en passant when the capture is possible (chess.js drops it otherwise, like maia2-js)', () => {
    // ...e4 and White just played f2-f4: exf3 is possible. Mirrored, f3 becomes f6.
    const e = encodePosition('4k3/8/8/8/4pP2/8/8/4K3 b - f3 0 1');
    expect(e.tensor[17 * 64 + 5 * 8 + 5]).toBe(1);
    expect(sum(plane(encodePosition(AFTER_E4).tensor, 17))).toBe(0);
  });

  it('turns logits into probabilities over legal moves only', () => {
    const e = encodePosition(START);
    const logits = new Float32Array(ALL_MOVES.length).fill(-5);
    logits[moveIndex('e2e4')!] = 3;
    logits[moveIndex('d2d4')!] = 2;
    logits[moveIndex('a1h8')!] = 50; // illegal here: must not count
    const p = policyFromLogits(logits, e.legal);
    expect(p[0]!.uci).toBe('e2e4');
    expect(p[1]!.uci).toBe('d2d4');
    expect(sum(p.map((x) => x.p))).toBeCloseTo(1);
    expect(p.some((x) => x.uci === 'a1h8')).toBe(false);
  });
});
