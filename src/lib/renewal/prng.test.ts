import { describe, expect, it } from 'vitest';
import { fnv1a, mulberry32 } from './prng';

describe('seeded generator', () => {
  it('gives the same sequence for the same seed, and another for another seed', () => {
    const a = mulberry32(fnv1a('g1,g2,g3|1'));
    const b = mulberry32(fnv1a('g1,g2,g3|1'));
    const c = mulberry32(fnv1a('g1,g2,g4|1'));
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('is stable across versions of the code: pinned values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    const r = mulberry32(42);
    expect([r(), r(), r()].map((x) => x.toFixed(8))).toEqual(['0.60110375', '0.44829056', '0.85246579']);
  });
});
