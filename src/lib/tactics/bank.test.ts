// @vitest-environment node
import { expect, it, vi } from 'vitest';

// A bank of one bucket: a one-move, a two-move and a three-move puzzle.
const index = { bucketSize: 50, themes: ['fork'], buckets: [{ rating: 1500, file: 'b1500.json', count: 3, themes: {} }] };
const rows = [
  ['one', 'fen', 'a1a2 a2a3', 1510, 90, 100, [0]],
  ['two', 'fen', 'a1a2 a2a3 a3a4 a4a5', 1500, 80, 100, [0]],
  ['three', 'fen', 'a1a2 a2a3 a3a4 a4a5 a5a6 a6a7', 1505, 95, 100, [0]],
];
vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => (url.endsWith('index.json') ? index : rows) })));
const { pickPuzzle } = await import('./bank');

it('keeps to the solution length asked for (the warm-up: two moves of yours at most)', async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) seen.add((await pickPuzzle({ target: 1500, theme: 'fork', exclude: new Set(), maxMoves: 2 }))!.id);
  expect([...seen].sort()).toEqual(['one', 'two']);
  expect(await pickPuzzle({ target: 1500, theme: 'fork', exclude: new Set(['one', 'two']), maxMoves: 2 })).toBeNull();
  expect((await pickPuzzle({ target: 1500, theme: 'fork', exclude: new Set(['one', 'two']) }))!.id).toBe('three');
});

it('keeps to the puzzles that pass the filter (Cálculo: three moves or more)', async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) seen.add((await pickPuzzle({ target: 1500, exclude: new Set(), where: (p) => p.moves.length >= 6 }))!.id);
  expect([...seen]).toEqual(['three']);
  expect(await pickPuzzle({ target: 1500, exclude: new Set(), where: () => false })).toBeNull();
});
