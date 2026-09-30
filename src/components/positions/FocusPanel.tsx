// Where the win-chance points you lose go, by dimension, with the margin of
// each number. The same shares set the order in which new positions reach you.
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel } from '@/components/Layout';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { FOCUS_LABEL } from '@/lib/positions/focus';
import { FOCUS_KEY } from '@/lib/positions/store';
import type { FocusCategory, FocusWeights } from '@/lib/positions/types';

const group = (title: string, keys: FocusCategory[]) => ({ title, items: keys.map((k): [FocusCategory, string] => [k, FOCUS_LABEL[k]]) });

export const FOCUS_GROUPS: Array<{ title: string; items: Array<[FocusCategory, string]> }> = [
  group('Fase', ['opening', 'middlegame', 'endgame']),
  group('Situação', ['convert', 'balanced', 'defend']),
  group('Relógio', ['fast', 'lowClock']),
  group('Gravidade', ['blunder', 'mistake', 'inaccuracy']),
  group('Oportunidade', ['miss']),
];

const pct = (x: number) => Math.round(x * 100);

export function FocusPanel() {
  const weights = useLiveQuery(async () => ((await db.kv.get(FOCUS_KEY))?.value as FocusWeights | undefined) ?? null, []);
  if (!weights || !weights.totalLoss) return null;
  const firm = !weights.provisional;
  const since = weights.change ? `1º de ${new Date(weights.change.since).toLocaleDateString('pt-BR', { month: 'long' })}` : null;
  return (
    <Panel title="Seus focos">
      <p className="mb-2 text-sm text-ink-3">
        Fatia dos pontos de chance de vitória que você perdeu em cada situação, com a margem de erro de cada número. As posições novas chegam nessa ordem de importância.
      </p>
      <p className={clsx('mb-4 text-sm', firm ? 'text-ink-3' : 'text-cls-inaccuracy')}>
        {firm
          ? `Suas últimas ${plural(weights.block, 'partida', 'partidas')} de rapid e blitz, todas analisadas, dos últimos ${weights.windowDays} dias.`
          : `Ainda pouco dado: ${weights.block} de 30 partidas recentes analisadas em sequência. Por enquanto os números vêm de ${plural(weights.games, 'partida analisada', 'partidas analisadas')} e são provisórios; a análise automática completa o resto.`}
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        {FOCUS_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-4">{g.title}</div>
            <ul className="space-y-2">
              {g.items.map(([key, label]) => {
                const s = weights.shares[key];
                const share = pct(s?.share ?? 0);
                const half = s ? Math.round(((s.hi - s.lo) / 2) * 100) : 0;
                const shift = weights.change?.shifts[key];
                return (
                  <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                    <span className="truncate text-ink">{label}</span>
                    <span className="text-right font-mono tabular-nums text-ink">
                      {share}% <span className="text-ink-4">± {half}%</span>
                    </span>
                    <span className="col-span-2 flex items-center gap-2">
                      <span className="relative h-2 flex-1 overflow-hidden rounded-sm bg-raise">
                        {/* The margin, then the share on top of it. */}
                        {s && <span className="absolute inset-y-0 bg-go/25" style={{ left: `${pct(s.lo)}%`, width: `${Math.max(0, pct(s.hi) - pct(s.lo))}%` }} />}
                        <span className="absolute inset-y-0 left-0 rounded-sm bg-go" style={{ width: `${share}%` }} />
                      </span>
                      <span className="w-20 text-right text-[12px] text-ink-4">{plural(s?.count ?? 0, 'lance')}</span>
                    </span>
                    {shift && since && (
                      <span className={clsx('col-span-2 text-[12px] font-bold', shift.to > shift.from ? 'text-cls-miss' : 'text-go-hover')}>
                        {shift.to > shift.from ? 'Subiu' : 'Caiu'} desde {since}: de {pct(shift.from)}% para {pct(shift.to)}%, além da margem.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
