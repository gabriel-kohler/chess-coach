import { Chess } from 'chess.js';
import type { CompiledSide, RepertoireMove, RepertoirePosition, Side } from './compile.ts';
import { epdOf } from './compile.ts';
import { tryMove } from '../chess/replay.ts';

export interface CompiledRepertoire {
  builtAt: string;
  depth: number;
  sides: Record<Side, CompiledSide>;
}

let loading: Promise<CompiledRepertoire | null> | null = null;

export function loadRepertoire(): Promise<CompiledRepertoire | null> {
  loading ??= fetch('/repertoire.json')
    .then((r) => (r.ok ? (r.json() as Promise<CompiledRepertoire>) : null))
    .catch(() => null);
  return loading;
}

export const START_EPD = epdOf(new Chess().fen());

export function positionAt(side: CompiledSide, epd: string): RepertoirePosition | undefined {
  return side.positions[epd];
}

/** Shortest move path (SAN) from the start to a position, if reachable. */
export function pathTo(side: CompiledSide, target: string): RepertoireMove[] | null {
  const prev = new Map<string, { from: string; move: RepertoireMove } | null>([[START_EPD, null]]);
  const queue = [START_EPD];
  while (queue.length) {
    const epd = queue.shift()!;
    if (epd === target) break;
    for (const m of side.positions[epd]?.moves ?? []) {
      if (prev.has(m.to)) continue;
      prev.set(m.to, { from: epd, move: m });
      queue.push(m.to);
    }
  }
  if (!prev.has(target)) return null;
  const path: RepertoireMove[] = [];
  let cur = target;
  while (prev.get(cur)) {
    const p = prev.get(cur)!;
    path.unshift(p.move);
    cur = p.from;
  }
  return path;
}

/** Every position with our move that is reachable from `from`. */
export function ourPositionsBelow(side: CompiledSide, from: string): string[] {
  const seen = new Set<string>([from]);
  const out: string[] = [];
  const queue = [from];
  while (queue.length) {
    const epd = queue.shift()!;
    const pos = side.positions[epd];
    if (!pos) continue;
    if (pos.fen.split(' ')[1] === (side.side === 'white' ? 'w' : 'b') && pos.moves.length) out.push(epd);
    for (const m of pos.moves) {
      if (!seen.has(m.to)) {
        seen.add(m.to);
        queue.push(m.to);
      }
    }
  }
  return out;
}

/** Position of a chapter's entry (end of its shared trunk). */
export function chapterRoot(entry: string[]): string {
  const c = new Chess();
  for (const san of entry) if (!tryMove(c, san)) break;
  return epdOf(c.fen());
}
