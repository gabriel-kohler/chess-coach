import type { Record3 } from '@/lib/stats/compute';

/**
 * Horizontal win/draw/loss bars per category, labelled with the score so
 * color is never the only channel. Thin segments with a 2px surface gap.
 */
export function ScoreBars({ rows, minGames = 1 }: { rows: Array<{ label: string; rec: Record3 }>; minGames?: number }) {
  const shown = rows.filter((r) => r.rec.n >= minGames);
  if (!shown.length) return <p className="text-sm text-ink-4">Sem partidas suficientes.</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-xs text-ink-3">
        <Legend color="var(--color-win)" label="Vitórias" />
        <Legend color="var(--color-draw)" label="Empates" />
        <Legend color="var(--color-loss)" label="Derrotas" />
      </div>
      {shown.map(({ label, rec }) => (
        <div key={label} className="group grid grid-cols-[110px_1fr_92px] items-center gap-3 text-sm" title={`${rec.win} V · ${rec.draw} E · ${rec.loss} D`}>
          <span className="truncate font-semibold text-ink-2">{label}</span>
          <div className="flex h-[14px] gap-[2px] overflow-hidden">
            {rec.win > 0 && <span className="rounded-l-[3px]" style={{ width: `${(100 * rec.win) / rec.n}%`, background: 'var(--color-win)' }} />}
            {rec.draw > 0 && <span style={{ width: `${(100 * rec.draw) / rec.n}%`, background: 'var(--color-draw)' }} />}
            {rec.loss > 0 && <span className="rounded-r-[3px]" style={{ width: `${(100 * rec.loss) / rec.n}%`, background: 'var(--color-loss)' }} />}
          </div>
          <span className="text-right tabular-nums">
            <b className="text-ink">{Math.round(rec.score)}%</b>
            <span className="ml-1.5 text-ink-4">{rec.n}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="text-sm font-bold text-ink-3">{label}</div>
      <div className="mt-1 text-[30px] font-extrabold leading-none">{value}</div>
      {sub && <div className="mt-1.5 text-sm text-ink-3">{sub}</div>}
    </div>
  );
}
