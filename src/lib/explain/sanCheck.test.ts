import { describe, expect, it } from 'vitest';
import { extractMoves, unknownMoves } from './sanCheck';

describe('narration guard', () => {
  it('extracts moves in any SAN form', () => {
    expect(extractMoves('Depois de Nxf7+ o rei vai para g8 e Qh5# encerra. O-O era melhor, e exd5 também.')).toEqual(['Nxf7', 'Qh5', 'O-O', 'exd5']);
  });

  it('treats squares used as places as squares, not moves', () => {
    expect(extractMoves('O cavalo em f6 defende a casa e5 e vai para d4.')).toEqual([]);
  });

  it('flags an invented move', () => {
    expect(unknownMoves('O melhor era Bc4, seguido de Ng5.', ['Bc4', 'Nf6', 'd3'])).toEqual(['Ng5']);
    expect(unknownMoves('O melhor era Bc4+.', ['Bc4'])).toEqual([]);
  });

  it('flags a bare pawn move that is not in the lines', () => {
    expect(unknownMoves('Aqui d5 liberava o jogo.', ['e4', 'Nf3'])).toEqual(['d5']);
  });
});
