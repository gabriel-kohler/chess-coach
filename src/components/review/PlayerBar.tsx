import clsx from 'clsx';
import { User } from 'lucide-react';

const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const GLYPH: Record<string, string> = { p: '♟︎', n: '♞', b: '♝', r: '♜', q: '♛' };

/** Pieces the given side has captured, and its material lead. */
export function capturedBy(fen: string, side: 'w' | 'b'): { pieces: string[]; lead: number } {
  const board = fen.split(' ')[0]!;
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number>, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number> };
  for (const ch of board) {
    const t = ch.toLowerCase();
    if (!(t in VALUE)) continue;
    count[ch === t ? 'b' : 'w'][t]!++;
  }
  const opp = side === 'w' ? 'b' : 'w';
  const pieces: string[] = [];
  for (const t of ['p', 'n', 'b', 'r', 'q']) {
    for (let i = count[opp][t]!; i < START_COUNT[t]!; i++) pieces.push(t);
  }
  const mat = (s: 'w' | 'b') => Object.entries(count[s]).reduce((sum, [t, n]) => sum + VALUE[t]! * n, 0);
  return { pieces, lead: mat(side) - mat(opp) };
}

function formatClock(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  if (sec < 20) return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}.${Math.floor((sec % 1) * 10)}`;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

export function PlayerBar({
  name,
  rating,
  color,
  fen,
  clock,
  active,
  accuracy,
  avatar,
}: {
  name: string;
  rating?: number;
  color: 'white' | 'black';
  fen: string;
  clock?: number | null;
  active?: boolean;
  accuracy?: number;
  avatar?: string;
}) {
  const side = color === 'white' ? 'w' : 'b';
  const { pieces, lead } = capturedBy(fen, side);
  return (
    <div className="flex h-[46px] items-center justify-between gap-3 px-0.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-raise">
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <User size={22} className="text-ink-4" />}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[14px] font-bold text-ink">{name}</span>
            {rating !== undefined && <span className="text-[13px] text-ink-3">({rating})</span>}
            {accuracy !== undefined && <span className="ml-1 rounded bg-raise px-1.5 text-[12px] font-bold text-ink-2">{accuracy.toFixed(1)}</span>}
          </div>
          <div className="flex h-[16px] items-center text-[14px] leading-none text-ink-3">
            <span className="tracking-[-0.18em]">{pieces.map((p) => GLYPH[p]).join('')}</span>
            {lead > 0 && <span className="ml-2 text-[12px] font-bold tracking-normal">+{lead}</span>}
          </div>
        </div>
      </div>
      {clock !== undefined && clock !== null && (
        <div
          className={clsx(
            'min-w-[96px] rounded-[4px] px-3 py-1.5 text-right font-mono text-[20px] font-bold tabular-nums',
            color === 'white' ? 'bg-ink text-page' : 'bg-[#0a0a0a] text-ink-3 ring-1 ring-line',
            active && (color === 'white' ? 'bg-white' : 'text-white'),
          )}
        >
          {formatClock(clock)}
        </div>
      )}
    </div>
  );
}
