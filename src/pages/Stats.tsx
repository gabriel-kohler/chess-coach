import clsx from 'clsx';

import { useMemo, useState } from 'react';
import { dailyLast, LineChart } from '@/components/charts/LineChart';
import { ScoreBars, StatTile } from '@/components/charts/ScoreBars';
import { PageHeader, Panel } from '@/components/Layout';
import { TIME_CLASS_LABEL } from '@/components/TimeClassIcon';
import {
  analysisStats,
  byHour,
  byRatingGap,
  byWeekday,
  clockStats,
  filterGames,
  howGamesEnd,
  openingTable,
  ratingSeries,
  record,
  RESULT_LABEL,
  tilt,
  type StatsFilter,
} from '@/lib/stats/compute';
import { plural } from '@/lib/format';
import type { TimeClass } from '@/lib/types';
import { useGamesAndAnalyses } from '@/lib/hooks';

const SERIES_COLOR: Record<TimeClass, string> = { rapid: '#7dd3fc', blitz: '#facc15', bullet: '#6ee7b7', daily: '#c4b5fd' };
const PERIODS: Array<[number | null, string]> = [[30, '30 dias'], [90, '90 dias'], [365, '1 ano'], [null, 'Tudo']];

export default function Stats() {
  const { games, analyses } = useGamesAndAnalyses();
  const [filter, setFilter] = useState<StatsFilter>({ timeClasses: ['rapid'], sinceDays: 90, ratedOnly: true });

  const list = useMemo(() => (games ? filterGames(games, filter) : []), [games, filter]);
  const rec = record(list);
  const white = record(list.filter((g) => g.userColor === 'white'));
  const black = record(list.filter((g) => g.userColor === 'black'));
  const t = useMemo(() => tilt(list), [list]);
  const clock = useMemo(() => clockStats(list), [list]);
  const ends = useMemo(() => howGamesEnd(list), [list]);
  const openings = useMemo(() => openingTable(list).slice(0, 12), [list]);
  const engine = useMemo(() => (analyses ? analysisStats(list, analyses) : null), [list, analyses]);

  const series = useMemo(() => {
    if (!games) return [];
    const since = filter.sinceDays ? Date.now() - filter.sinceDays * 86400000 : 0;
    return (['rapid', 'blitz', 'bullet'] as const)
      .filter((tc) => filter.timeClasses.includes(tc))
      .map((tc) => ({
        key: tc,
        label: TIME_CLASS_LABEL[tc],
        color: SERIES_COLOR[tc],
        points: dailyLast(ratingSeries(games, tc).filter((p) => p.t >= since).map((p) => ({ x: p.t, y: p.rating }))),
      }));
  }, [games, filter]);

  const toggleTc = (tc: TimeClass) => {
    const has = filter.timeClasses.includes(tc);
    const next = has ? filter.timeClasses.filter((x) => x !== tc) : [...filter.timeClasses, tc];
    if (next.length) setFilter({ ...filter, timeClasses: next });
  };

  if (!games) return <div className="p-8 text-ink-3">Carregando...</div>;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader title="Estatísticas" />

      {/* one filter row scopes every chart below */}
      <div className="sticky top-0 z-10 -mx-4 mb-5 flex flex-wrap items-center gap-2 bg-page/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8">
        {(['rapid', 'blitz', 'bullet', 'daily'] as const).map((tc) => (
          <button key={tc} type="button" onClick={() => toggleTc(tc)} className={clsx('rounded-md px-3 py-1.5 text-sm font-bold', filter.timeClasses.includes(tc) ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            {TIME_CLASS_LABEL[tc]}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        {PERIODS.map(([d, label]) => (
          <button key={label} type="button" onClick={() => setFilter({ ...filter, sinceDays: d })} className={clsx('rounded-md px-3 py-1.5 text-sm font-bold', filter.sinceDays === d ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            {label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-3">
          <input type="checkbox" checked={filter.ratedOnly} onChange={(e) => setFilter({ ...filter, ratedOnly: e.target.checked })} className="accent-[var(--color-go)]" />
          Só valendo rating
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Partidas" value={String(rec.n)} sub={`${rec.win} V · ${rec.draw} E · ${rec.loss} D`} />
        <StatTile label="Aproveitamento" value={`${Math.round(rec.score)}%`} sub={`Brancas ${Math.round(white.score)}% · Pretas ${Math.round(black.score)}%`} />
        <StatTile label="Precisão média" value={engine ? engine.accuracy.toFixed(1) : '-'} sub={engine ? `em ${plural(engine.games, 'partida analisada', 'partidas analisadas')}` : 'analise partidas para ver'} />
        <StatTile
          label="Capivaradas por partida"
          value={engine ? engine.blundersPerGame.toFixed(2) : '-'}
          sub={engine ? `${engine.mistakesPerGame.toFixed(2)} erros e chances perdidas` : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Evolução do rating" className="lg:col-span-2">
          <LineChart series={series} height={240} />
        </Panel>

        <Panel title="Depois de derrotas seguidas (mesma sessão)">
          <ScoreBars rows={t.afterLosses.map((x) => ({ label: x.label === '0' ? 'Sem derrota' : `Após ${x.label}`, rec: x.rec }))} minGames={10} />
          <p className="mt-3 text-sm text-ink-3">Depois de vencer: {Math.round(t.afterWin.score)}% · depois de perder: {Math.round(t.afterLoss.score)}%. Sessão = partidas com menos de 45 minutos entre uma e outra.</p>
        </Panel>

        <Panel title="Posição da partida na sessão">
          <ScoreBars rows={t.byGameInSitting.map((x) => ({ label: `${x.label}ª partida`, rec: x.rec }))} minGames={10} />
        </Panel>

        <Panel title="Horário">
          <ScoreBars rows={byHour(list)} minGames={10} />
        </Panel>

        <Panel title="Dia da semana">
          <ScoreBars rows={byWeekday(list)} minGames={10} />
        </Panel>

        <Panel title="Contra quem">
          <ScoreBars rows={byRatingGap(list)} minGames={5} />
          <p className="mt-3 text-sm text-ink-3">Diferença de rating do adversário para o seu na hora da partida.</p>
        </Panel>

        <Panel title="Como as partidas terminam">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="mb-2 font-bold text-go">Vitórias</div>
              {ends.wins.slice(0, 6).map(([code, n]) => <Row key={code} label={RESULT_LABEL[code] ?? code} n={n} total={rec.win} />)}
            </div>
            <div>
              <div className="mb-2 font-bold text-cls-miss">Derrotas</div>
              {ends.losses.slice(0, 6).map(([code, n]) => <Row key={code} label={RESULT_LABEL[code] ?? code} n={n} total={rec.loss} />)}
            </div>
          </div>
        </Panel>

        <Panel title="Relógio">
          {clock ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Partidas com aperto de tempo" value={`${Math.round(clock.timeTroubleShare * 100)}%`} hint="menos de 10% do relógio" />
              <Fact label="Aproveitamento com aperto" value={`${Math.round(clock.scoreInTrouble)}%`} hint={`sem aperto: ${Math.round(clock.scoreOutOfTrouble)}%`} />
              <Fact label="Derrotas por tempo" value={String(clock.lossesOnTime)} />
              <Fact label="Lances instantâneos no meio-jogo" value={`${Math.round(clock.fastMoveShare * 100)}%`} hint="depois do lance 8" />
              <Fact label="Tempo gasto nos 10 primeiros lances" value={`${Math.round(clock.avgOpeningSeconds)}s`} />
            </dl>
          ) : (
            <p className="text-sm text-ink-4">Sem dados de relógio.</p>
          )}
        </Panel>

        <Panel title="Onde se decidem as derrotas">
          {engine && engine.lossesAnalysed > 0 ? (
            <div className="space-y-3 text-sm">
              <div className="flex gap-2">
                {(['opening', 'middlegame', 'endgame'] as const).map((p) => {
                  const total = engine.decisivePhase.opening + engine.decisivePhase.middlegame + engine.decisivePhase.endgame || 1;
                  return (
                    <div key={p} className="flex-1 rounded-md bg-panel-2 p-3 text-center">
                      <div className="text-2xl font-extrabold">{Math.round((100 * engine.decisivePhase[p]) / total)}%</div>
                      <div className="text-ink-3">{p === 'opening' ? 'Abertura' : p === 'middlegame' ? 'Meio-jogo' : 'Final'}</div>
                    </div>
                  );
                })}
              </div>
              <p className="text-ink-2">
                Em {engine.lostToWorse} de {plural(engine.lossesAnalysed, 'derrota analisada', 'derrotas analisadas')} o adversário teve precisão menor que a sua.
                {engine.decisiveWithClock > 0 && ` ${engine.decisiveFast} de ${engine.decisiveWithClock} erros decisivos saíram rápido demais.`}
                {` ${plural(engine.thrown.length, 'partida ganha escapou', 'partidas ganhas escaparam')}.`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-4">Analise suas derrotas em Partidas para ver onde elas se decidem.</p>
          )}
        </Panel>

        <Panel title="Aberturas" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-ink-4">
                  <th className="pb-2 font-bold">Abertura</th>
                  <th className="pb-2 font-bold">Cor</th>
                  <th className="pb-2 text-right font-bold">Partidas</th>
                  <th className="pb-2 text-right font-bold">Aproveitamento</th>
                  <th className="pb-2 text-right font-bold">Adversário médio</th>
                </tr>
              </thead>
              <tbody>
                {openings.map((o) => (
                  <tr key={`${o.color}-${o.name}`} className="border-t border-line/50">
                    <td className="py-1.5 font-semibold text-ink-2">{o.name}</td>
                    <td className="py-1.5 text-ink-3">{o.color === 'white' ? 'Brancas' : 'Pretas'}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-3">{o.rec.n}</td>
                    <td className={clsx('py-1.5 text-right font-bold tabular-nums', o.rec.score >= rec.score + 5 ? 'text-go' : o.rec.score <= rec.score - 5 ? 'text-cls-miss' : 'text-ink')}>{Math.round(o.rec.score)}%</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-3">{Math.round(o.avgOpp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, n, total }: { label: string; n: number; total: number }) {
  return (
    <div className="flex justify-between border-t border-line/40 py-1">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums text-ink-3">{n} <span className="text-ink-4">({Math.round((100 * n) / Math.max(1, total))}%)</span></span>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-panel-2 p-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-xl font-extrabold">{value}</dd>
      {hint && <dd className="text-xs text-ink-4">{hint}</dd>}
    </div>
  );
}
