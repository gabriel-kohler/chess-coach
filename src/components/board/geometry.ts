import type { Color } from '@/lib/types';

export const FILES = 'abcdefgh';

/** Board coordinates (0..7 from the top-left as displayed) for a square. */
export function squareToXY(square: string, orientation: Color): { x: number; y: number } {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  return orientation === 'white' ? { x: file, y: 7 - rank } : { x: 7 - file, y: rank };
}

export function xyToSquare(x: number, y: number, orientation: Color): string | null {
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  const file = orientation === 'white' ? x : 7 - x;
  const rank = orientation === 'white' ? 7 - y : y;
  return `${FILES[file]}${rank + 1}`;
}

export function isLightSquare(square: string): boolean {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  return (file + rank) % 2 === 1;
}

export const ALL_SQUARES: string[] = Array.from({ length: 64 }, (_, i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`);

export interface Arrow {
  from: string;
  to: string;
  color?: string;
}

/**
 * Polygon for a chess.com style arrow, in square units (0..8). Knight jumps
 * get an L-shaped arrow like on chess.com.
 */
export function arrowPolygon(from: string, to: string, orientation: Color): string {
  const a = squareToXY(from, orientation);
  const b = squareToXY(to, orientation);
  const start = { x: a.x + 0.5, y: a.y + 0.5 };
  const end = { x: b.x + 0.5, y: b.y + 0.5 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const shaft = 0.22;
  const headW = 0.54;
  const headL = 0.44;

  const isKnight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
  if (isKnight) {
    // Long leg first, then the short leg carries the head.
    const corner = Math.abs(dx) > Math.abs(dy) ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    const leg1 = norm(corner.x - start.x, corner.y - start.y);
    const leg2 = norm(end.x - corner.x, end.y - corner.y);
    const h = shaft / 2;
    const n1 = { x: -leg1.y, y: leg1.x };
    const n2 = { x: -leg2.y, y: leg2.x };
    const tipBase = { x: end.x - leg2.x * headL, y: end.y - leg2.y * headL };
    // Outer and inner corner points of the joint.
    const side = n1.x * leg2.x + n1.y * leg2.y > 0 ? 1 : -1;
    const outer = { x: corner.x - side * n1.x * h + leg1.x * h, y: corner.y - side * n1.y * h + leg1.y * h };
    const inner = { x: corner.x + side * n1.x * h - leg1.x * h, y: corner.y + side * n1.y * h - leg1.y * h };
    const pts = side > 0
      ? [
          add(start, n1, -h), outer, add(tipBase, n2, -h), add(tipBase, n2, -headW / 2), end,
          add(tipBase, n2, headW / 2), add(tipBase, n2, h), inner, add(start, n1, h),
        ]
      : [
          add(start, n1, h), outer, add(tipBase, n2, h), add(tipBase, n2, headW / 2), end,
          add(tipBase, n2, -headW / 2), add(tipBase, n2, -h), inner, add(start, n1, -h),
        ];
    return pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
  }

  const d = norm(dx, dy);
  const n = { x: -d.y, y: d.x };
  const tipBase = { x: end.x - d.x * headL, y: end.y - d.y * headL };
  const pts = [
    add(start, n, shaft / 2),
    add(tipBase, n, shaft / 2),
    add(tipBase, n, headW / 2),
    end,
    add(tipBase, n, -headW / 2),
    add(tipBase, n, -shaft / 2),
    add(start, n, -shaft / 2),
  ];
  return pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
}

function norm(x: number, y: number) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function add(p: { x: number; y: number }, v: { x: number; y: number }, k: number) {
  return { x: p.x + v.x * k, y: p.y + v.y * k };
}
