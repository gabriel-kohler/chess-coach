import { describe, expect, it } from 'vitest';
import { parsePgn } from '../chess/pgn';
import { compileChapter, mergeSides } from './compile';

const chapter = (id: string, body: string, side = 'white') =>
  compileChapter(parsePgn(`[Id "${id}"]\n[Side "${side}"]\n[Name "${id}"]\n\n${body}`)[0]!);

describe('compileChapter', () => {
  it('builds positions and the shared trunk', () => {
    const r = chapter('a', '1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bc4');
    expect(r.errors).toEqual([]);
    expect(r.chapter.entry).toEqual(['e4', 'e5', 'Nf3']);
    expect(Object.keys(r.positions).length).toBe(6);
  });

  it('reports illegal moves with the path', () => {
    const r = chapter('b', '1. e4 e5 2. Ke3');
    expect(r.errors[0]).toMatch(/illegal move "Ke3" after: e4 e5/);
  });

  it('reports two answers for our side, including via transposition', () => {
    const r = chapter('c', '1. e4 e5 2. Nf3 Nc6 3. Bc4 (3. Bb5)');
    expect(r.errors.some((e) => e.includes('two answers'))).toBe(true);
    const x = chapter('d', '1. Nf3 Nf6 2. e4 (2. d4 d5 3. c4)');
    expect(x.errors.some((e) => e.includes('two answers'))).toBe(true);
  });

  it('merges chapters and catches cross-chapter conflicts', () => {
    const a = chapter('a', '1. e4 e5 2. Nf3');
    const b = chapter('b', '1. e4 c5 2. c3');
    const c = chapter('c', '1. e4 e5 2. Bc4');
    expect(mergeSides([a, b]).errors).toEqual([]);
    expect(mergeSides([a, c]).errors.length).toBeGreaterThan(0);
  });
});
