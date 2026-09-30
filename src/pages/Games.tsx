import clsx from 'clsx';
import { Cpu } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/Layout';
import { SyncButton } from '@/components/SyncButton';
import { ResultBadge, TIME_CLASS_LABEL, TimeClassIcon } from '@/components/TimeClassIcon';
import { plural } from '@/lib/format';
import { useGamesAndAnalyses } from '@/lib/hooks';
import { cancelQueue, enqueueAnalysis, resumeAuto, useAnalysisQueue } from '@/lib/review/queue';
import { useAccount, useSettings } from '@/lib/settings';
import type { GameAnalysis, StoredGame, TimeClass } from '@/lib/types';
import { ConnectAccount } from './Settings';

type ResultFilter = 'all' | 'win' | 'loss' | 'draw' | 'thrown' | 'unanalysed';

const PAGE = 50;

function thrownGame(g: StoredGame, a?: GameAnalysis) {
  if (!a || g.outcome === 'win') return false;
  return a.moves.some((m) => m.color === g.userColor && m.winBefore >= 80);
}

export default function Games() {
  const account = useAccount();
  const settings = useSettings();
  const queue = useAnalysisQueue();
  const { games, analyses } = useGamesAndAnalyses();
  const [tc, setTc] = useState<TimeClass | 'all'>('rapid');
  const [result, setResult] = useState<ResultFilter>('all');
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    if (!games) return [];
    return games.filter((g) => {
      if (tc !== 'all' && g.timeClass !== tc) return false;
      const a = analyses?.get(g.id);
      if (result === 'thrown') return thrownGame(g, a);
      if (result === 'unanalysed') return !a;
      return result === 'all' || g.outcome === result;
    });
  }, [games, analyses, tc, result]);

  if (account === null) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <PageHeader title="Partidas" />
        <div className="rounded-lg bg-panel p-5"><ConnectAccount /></div>
      </div>
    );
  }

  const manualPending = queue.pending.length - queue.autoPending;
  const analyseRecentLosses = () => {
    const ids = (games ?? [])
      .filter((g) => (g.timeClass === 'rapid' || g.timeClass === 'blitz') && g.outcome === 'loss' && !analyses?.has(g.id))
      .slice(0, 20)
      .map((g) => g.id);
    enqueueAnalysis(ids, settings);
  };
  const analyseVisible = () => {
    enqueueAnalysis(filtered.slice(0, limit).filter((g) => !analyses?.has(g.id)).slice(0, 30).map((g) => g.id), settings);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader title="Partidas">
        {account && <SyncButton username={account.username} />}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'rapid', 'blitz', 'bullet', 'daily'] as const).map((k) => (
          <button key={k} type="button" onClick={() => { setTc(k); setLimit(PAGE); }} className={clsx('rounded-md px-3 py-1.5 text-sm font-bold', tc === k ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            {k === 'all' ? 'Todas' : TIME_CLASS_LABEL[k]}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        {([
          ['all', 'Todos'],
          ['win', 'Vitórias'],
          ['loss', 'Derrotas'],
          ['draw', 'Empates'],
          ['thrown', 'Ganhas que escaparam'],
          ['unanalysed', 'Não analisadas'],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setResult(k); setLimit(PAGE); }} className={clsx('rounded-md px-3 py-1.5 text-sm font-bold', result === k ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-panel px-4 py-3 text-sm">
        <Cpu size={18} className="text-ink-3" />
        <span className="text-ink-3">{plural(analyses?.size ?? 0, 'partida analisada', 'partidas analisadas')}.</span>
        {queue.running && (
          <>
            <span className="text-ink-2">
              {queue.currentAuto ? 'Análise automática' : 'Analisando'}: {queue.plyTotal ? `${queue.plyDone}/${queue.plyTotal} posições` : '...'}
              {manualPending ? `, ${plural(manualPending, 'pedida sua', 'pedidas suas')} na fila` : ''}
              {queue.autoPending ? `, ${queue.autoPending} automáticas na fila` : ''}
            </span>
            <div className="h-1.5 w-40 overflow-hidden rounded bg-panel-2">
              <div className="h-full bg-ink" style={{ width: `${(100 * queue.plyDone) / Math.max(1, queue.plyTotal)}%` }} />
            </div>
            <button type="button" className="text-ink-3 hover:text-ink" onClick={cancelQueue}>Parar</button>
          </>
        )}
        {!queue.running && queue.autoSuspended && queue.autoPending > 0 && (
          <>
            <span className="text-ink-3">Análise automática pausada: {plural(queue.autoPending, 'partida', 'partidas')} na fila.</span>
            <button type="button" className="font-medium text-ink underline decoration-ink-4 underline-offset-4 hover:decoration-ink" onClick={resumeAuto}>Retomar</button>
          </>
        )}
        <button type="button" className="btn-flat" onClick={analyseRecentLosses}>Analisar as 20 derrotas mais recentes</button>
        <button type="button" className="btn-flat" onClick={analyseVisible}>Analisar as visíveis</button>
        {queue.error && <span className="text-cls-blunder">{queue.error}</span>}
      </div>

      <div className="overflow-x-auto rounded-lg bg-panel">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="w-10 px-3 py-2.5" />
              <th className="px-3 py-2.5 font-bold">Jogadores</th>
              <th className="px-3 py-2.5 text-center font-bold">Resultado</th>
              <th className="px-3 py-2.5 text-center font-bold">Precisão</th>
              <th className="px-3 py-2.5 text-center font-bold">Lances</th>
              <th className="px-3 py-2.5 text-right font-bold">Data</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((g) => (
              <GameRow key={g.id} game={g} analysis={analyses?.get(g.id)} />
            ))}
          </tbody>
        </table>
        {!games && <p className="p-6 text-ink-3">Carregando...</p>}
        {games && filtered.length === 0 && (
          <p className="p-6 text-ink-3">{result === 'thrown' ? 'Nenhuma partida analisada se encaixa. Analise algumas derrotas primeiro.' : 'Nenhuma partida com esse filtro.'}</p>
        )}
      </div>
      {filtered.length > limit && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn-flat" onClick={() => setLimit((l) => l + PAGE)}>Mostrar mais ({filtered.length - limit} restantes)</button>
        </div>
      )}
    </div>
  );
}

function GameRow({ game: g, analysis }: { game: StoredGame; analysis?: GameAnalysis }) {
  const acc = analysis?.accuracy ?? g.ccAccuracy;
  const me = g.userColor;
  const players = me === 'white'
    ? [{ name: 'Você', rating: g.userRating, color: 'white', me: true }, { name: g.oppName, rating: g.oppRating, color: 'black', me: false }]
    : [{ name: g.oppName, rating: g.oppRating, color: 'white', me: false }, { name: 'Você', rating: g.userRating, color: 'black', me: true }];
  return (
    <tr className="group border-b border-line/60 last:border-0 hover:bg-raise/40">
      <td className="px-3 py-2">
        <Link to={`/review/${g.id}`} className="flex justify-center"><TimeClassIcon tc={g.timeClass} /></Link>
      </td>
      <td className="px-3 py-2">
        <Link to={`/review/${g.id}`} className="flex flex-col gap-0.5">
          {players.map((p) => (
            <span key={p.color} className="flex items-center gap-2">
              <span className={clsx('h-3 w-3 rounded-[2px]', p.color === 'white' ? 'bg-white' : 'border border-ink-4 bg-[#0a0a0a]')} />
              <span className={clsx(p.me ? 'font-bold text-ink' : 'text-ink-2')}>{p.name}</span>
              <span className="text-ink-4">({p.rating})</span>
            </span>
          ))}
        </Link>
      </td>
      <td className="px-3 py-2 text-center"><ResultBadge outcome={g.outcome} /></td>
      <td className="px-3 py-2 text-center tabular-nums">
        {acc ? (
          <span className="inline-flex flex-col leading-tight">
            <span className={me === 'white' ? 'font-bold text-ink' : 'text-ink-3'}>{acc.white.toFixed(1)}</span>
            <span className={me === 'black' ? 'font-bold text-ink' : 'text-ink-3'}>{acc.black.toFixed(1)}</span>
          </span>
        ) : (
          <Link to={`/review/${g.id}`} className="font-medium text-ink underline decoration-ink-4 underline-offset-4 hover:decoration-ink">Revisar</Link>
        )}
      </td>
      <td className="px-3 py-2 text-center tabular-nums text-ink-2">{Math.ceil(g.moves.length / 2)}</td>
      <td className="px-3 py-2 text-right text-ink-3">{new Date(g.endTime).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
    </tr>
  );
}
