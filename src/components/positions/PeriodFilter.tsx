// Game period for your own-game positions ("only my mistakes"): the last 7,
// 14 or 30 days, or every game. Shared by Posições and the Tactics shortcut.
import clsx from 'clsx';
import { Link } from 'react-router';
import { dueLabel, plural } from '@/lib/format';
import { MINE_PERIODS, periodLabel } from '@/lib/positions/period';
import type { TodayCounts } from '@/lib/positions/store';

export function PeriodFilter({ value, onChange, className }: { value: number; onChange: (days: number) => void; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-2 text-sm', className)} role="group" aria-label="Período das partidas">
      <span className="text-ink-3">Período das partidas:</span>
      {MINE_PERIODS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={clsx('rounded-md px-2.5 py-1 font-bold', value === days ? 'bg-raise-2 text-ink' : 'bg-panel-2 text-ink-3 hover:text-ink')}
        >
          {periodLabel(days)}
        </button>
      ))}
    </div>
  );
}

/** What the period leaves out, and when the period has something again. */
export function PeriodNote({ counts, period, className }: { counts: TodayCounts | undefined; period: number; className?: string }) {
  if (!counts || !period) return null;
  if (!counts.inPeriod) {
    return (
      <p className={clsx('text-sm text-ink-3', className)}>
        Nenhuma posição de partidas dos últimos {period} dias. <Link to="/games" className="font-medium text-ink underline decoration-ink-4 underline-offset-4 hover:decoration-ink">Analise as partidas recentes</Link> para gerar as posições.
      </p>
    );
  }
  if (counts.nextDue === null && !counts.outside) return null;
  return (
    <p className={clsx('text-sm text-ink-3', className)}>
      {counts.nextDue !== null && `Nada pendente desse período: a próxima posição volta ${dueLabel(counts.nextDue)}. `}
      {counts.outside > 0 && `${plural(counts.outside, 'revisão', 'revisões')} de partidas mais antigas ${counts.outside === 1 ? 'fica' : 'ficam'} de fora do filtro.`}
    </p>
  );
}
