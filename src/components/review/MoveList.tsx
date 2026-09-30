import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { ClassificationIcon } from '@/components/board/ClassificationIcon';
import { San } from '@/components/San';
import type { Classification } from '@/lib/types';

const SHOWN = new Set<Classification>(['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']);

export interface ListMove {
  ply: number;
  san: string;
  classification?: Classification;
  timeSpent?: number | null;
}

/** Two-column move list (White | Black) with classification icons and time spent. */
export function MoveList({ moves, ply, onSelect }: { moves: ListMove[]; ply: number; onSelect: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the list itself, never the panels around it.
    const container = ref.current;
    const el = container?.querySelector<HTMLElement>(`[data-ply="${ply}"]`);
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < c.top) container.scrollTop -= c.top - r.top + 4;
    else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom + 4;
  }, [ply]);

  const rows: Array<[ListMove | undefined, ListMove | undefined]> = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  const maxTime = Math.max(1, ...moves.map((m) => m.timeSpent ?? 0));

  const cell = (m: ListMove | undefined) =>
    m ? (
      <button
        type="button"
        data-ply={m.ply}
        onClick={() => onSelect(m.ply)}
        className={clsx(
          'group flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[3px] px-1.5 text-left text-[14px] font-semibold',
          ply === m.ply ? 'bg-raise-2 text-ink' : 'text-ink-2 hover:bg-raise',
        )}
      >
        {m.classification && SHOWN.has(m.classification) && ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder', 'book'].includes(m.classification) ? (
          <ClassificationIcon cls={m.classification} size={15} />
        ) : (
          <span className="w-[15px]" />
        )}
        <San san={m.san} className="truncate" />
      </button>
    ) : (
      <span className="flex-1" />
    );

  const time = (m: ListMove | undefined, side: 'w' | 'b') =>
    m?.timeSpent !== undefined && m.timeSpent !== null ? (
      <div className="flex w-12 items-center justify-end gap-1" title={`${m.timeSpent.toFixed(1)}s`}>
        <span className="text-[10px] tabular-nums text-ink-4">{m.timeSpent < 10 ? m.timeSpent.toFixed(1) : Math.round(m.timeSpent)}s</span>
        <span className={clsx('h-2.5 rounded-[1px]', side === 'w' ? 'bg-ink-2' : 'bg-ink-4')} style={{ width: `${Math.max(2, (m.timeSpent / maxTime) * 22)}px` }} />
      </div>
    ) : null;

  return (
    <div ref={ref} className="scroll-thin h-full overflow-y-auto">
      {rows.map(([w, b], i) => (
        <div key={i} className={clsx('flex items-center gap-1 px-2', i % 2 === 1 && 'bg-white/[0.025]')}>
          <span className="w-7 shrink-0 text-[13px] text-ink-4">{i + 1}.</span>
          {cell(w)}
          {cell(b)}
          <div className="hidden shrink-0 flex-col py-0.5 sm:flex">
            {time(w, 'w')}
            {time(b, 'b')}
          </div>
        </div>
      ))}
    </div>
  );
}
