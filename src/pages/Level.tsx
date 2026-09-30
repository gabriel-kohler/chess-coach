// The level review: your games of the new rapid band next to the ones before
// it. Focuses with their margins, the Maia calibration, the repertoire gaps.
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { TrendingUp } from 'lucide-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { PageHeader, Panel } from '@/components/Layout';
import { FOCUS_GROUPS } from '@/components/positions/FocusPanel';
import { San } from '@/components/San';
import { plural } from '@/lib/format';
import { useGames } from '@/lib/hooks';
import type { FocusShare, FocusWeights } from '@/lib/positions/types';
import { RENEWAL } from '@/lib/renewal/config';
import { compareFocus, type CalibrationSummary, type LevelReport } from '@/lib/renewal/level';
import { focusSince, loadLevelState, markLevelSeen } from '@/lib/renewal/levelStore';
import type { RepertoireGap } from '@/lib/repertoire/gaps';
import { computeGaps, openingsSignature } from '@/lib/repertoire/openingsData';
import { useMergedRepertoire } from '@/lib/repertoire/userChapters';

const date = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const pct = (x: number) => Math.round(x * 100);
const withMargin = (s: FocusShare) => `${pct(s.share)}% ± ${Math.round(((s.hi - s.lo) / 2) * 100)}%`;

export default function Level() {
  const state = useLiveQuery(loadLevelState, []);
  const report = state?.reports.at(-1);

  useEffect(() => {
    if (report) void markLevelSeen(report.band);
  }, [report?.band]);

  if (state === undefined) return <div className="p-8 text-ink-3">Carregando...</div>;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <PageHeader title="Revisão de nível" icon={TrendingUp} />
      {!report ? (
        <Panel>
          <p className="text-sm text-ink-2">
            {state
              ? `Ainda não há relatório. O app acompanha o seu rapid desde a faixa de ${state.highestBand} e monta o relatório quando você chegar a ${state.highestBand + 100}: seus focos antes e depois, com a margem de cada número.`
              : 'Ainda não há relatório: ele aparece depois da primeira sincronização com o chess.com, quando o seu rapid chegar a uma faixa nova de 100.'}
          </p>
        </Panel>
      ) : (
        <Report report={report} older={state?.reports.slice(0, -1) ?? []} />
      )}
    </div>
  );
}

function Report({ report, older }: { report: LevelReport; older: LevelReport[] }) {
  // Your focuses since the band started, as they stand now: they fill in as the games get analysed.
  const after = useLiveQuery(() => focusSince(report.bandStart), [report.bandStart]);
  return (
    <div className="grid gap-4">
      <Panel>
        <p className="text-[17px] font-extrabold text-ink">{report.band} no rapid</p>
        <p className="mt-1 text-sm text-ink-2">
          Você chegou a {report.band} em {date(report.bandStart)} (rapid na sincronização: {report.rating}). Os focos de antes são os daquele dia; os de depois vêm só das partidas desde então, e se completam conforme elas são analisadas.
        </p>
        {older.length > 0 && <p className="mt-2 text-xs text-ink-4">Faixas anteriores: {older.map((r) => `${r.band} em ${date(r.bandStart)}`).join(', ')}.</p>}
      </Panel>
      <FocusCompare before={report.before} after={after ?? null} />
      <div className="grid gap-4 md:grid-cols-2">
        <CalibrationPanel before={report.calibrationBefore} after={report.calibrationAfter} />
        <BandGaps since={report.bandStart} />
      </div>
    </div>
  );
}

function scopeOf(w: FocusWeights, label: string): string {
  return w.provisional ? `${label}: ainda pouco dado (${w.block} de ${RENEWAL.focusMinBlock} partidas analisadas em sequência).` : `${label}: ${plural(w.block, 'partida', 'partidas')} de rapid e blitz, todas analisadas.`;
}

function FocusCompare({ before, after }: { before: FocusWeights; after: FocusWeights | null }) {
  const cmp = after ? new Map(compareFocus(before, after).map((c) => [c.category, c])) : null;
  return (
    <Panel title="Seus focos, antes e depois">
      <p className="mb-1 text-sm text-ink-3">{scopeOf(before, 'Antes')}</p>
      <p className="mb-3 text-sm text-ink-3">{after ? scopeOf(after, 'Depois') : 'Depois: calculando...'}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-4">
              <th className="pb-2 font-bold">Foco</th>
              <th className="pb-2 text-right font-bold">Antes</th>
              <th className="pb-2 text-right font-bold">Depois</th>
              <th className="pb-2 pl-4 font-bold" />
            </tr>
          </thead>
          <tbody>
            {FOCUS_GROUPS.flatMap((g) =>
              g.items.map(([key, label]) => {
                const c = cmp?.get(key);
                return (
                  <tr key={key} className="border-t border-line/50">
                    <td className="py-1.5 text-ink">{label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-ink-2">{withMargin(before.shares[key])}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-ink">{after ? withMargin(after.shares[key]) : '-'}</td>
                    <td className={clsx('py-1.5 pl-4 text-xs font-bold', c?.changed ? (c.after > c.before ? 'text-cls-miss' : 'text-go-hover') : 'text-ink-4')}>
                      {c?.changed ? (c.after > c.before ? 'subiu, além da margem' : 'caiu, além da margem') : ''}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-4">Uma mudança só é marcada quando passa da soma das margens dos dois períodos. Com pouco dado de um dos lados, nada é marcado.</p>
    </Panel>
  );
}

const calibrationText = (c: CalibrationSummary) =>
  `ajuste de rating ${c.offset >= 0 ? '+' : ''}${c.offset}; o lance real do adversário fica entre os 3 do Maia em ${c.top3 === null ? '-' : `${Math.round(c.top3 * 100)}%`} das vezes (${plural(c.n, 'lance')}, ${date(c.at)}).`;

function CalibrationPanel({ before, after }: { before: CalibrationSummary | null; after?: CalibrationSummary }) {
  return (
    <Panel title="Maia, o adversário das Sequências">
      <p className="text-sm text-ink-2">Antes: {before ? calibrationText(before) : 'ainda sem calibração.'}</p>
      <p className="mt-2 text-sm text-ink-2">
        Depois: {after ? calibrationText(after) : `espera ${RENEWAL.calibrationMinSamples} lances de adversários da faixa nova para calibrar de novo.`}
      </p>
      <p className="mt-2 text-xs text-ink-4">As sequências já montadas ficam como estão, para não perder o seu progresso nelas.</p>
    </Panel>
  );
}

function BandGaps({ since }: { since: number }) {
  const { rep, signature } = useMergedRepertoire();
  const games = useGames();
  const key = openingsSignature(games, rep, signature);
  const gaps: RepertoireGap[] | null =
    useQuery({
      queryKey: ['bandGaps', since, key],
      queryFn: () => computeGaps(games!, rep!, since),
      enabled: key !== null,
      structuralSharing: false,
      placeholderData: keepPreviousData,
    }).data ?? null;
  return (
    <Panel title="Lacunas do repertório na faixa nova">
      {gaps === null ? (
        <p className="text-sm text-ink-4">Procurando nas suas partidas...</p>
      ) : gaps.length === 0 ? (
        <p className="text-sm text-ink-3">Nenhum adversário da faixa nova saiu do repertório pelo menos {RENEWAL.gapsMinGames} vezes.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {gaps.slice(0, 5).map((g) => (
            <li key={`${g.epd}|${g.uci}`} className="flex justify-between gap-2">
              <span className="text-ink">
                {Math.ceil(g.path.length / 2)}
                {g.path.length % 2 ? '.' : '...'}
                <San san={g.san} /> <span className="text-ink-4">({g.side === 'white' ? 'de brancas' : 'de pretas'})</span>
              </span>
              <span className="tabular-nums text-ink-4">{plural(g.games.length, 'partida')}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/openings" className="mt-3 inline-block text-sm font-bold text-go hover:text-go-hover">Responder em Aberturas</Link>
    </Panel>
  );
}
