import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, BookOpen, CheckCircle2, ChevronRight, Crown, Puzzle, ShieldCheck, Swords } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { Panel } from '@/components/Layout';
import { TIME_CLASS_LABEL, TimeClassIcon } from '@/components/TimeClassIcon';
import { syncAccount } from '@/lib/chesscom/sync';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { buildInsights } from '@/lib/stats/insights';
import { useAccount } from '@/lib/settings';
import type { StoredGame } from '@/lib/types';
import { useGamesAndAnalyses } from '@/lib/hooks';
import { ConnectAccount } from './Settings';

function todayStreak(games: StoredGame[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = games.filter((g) => g.endTime >= start.getTime() && (g.timeClass === 'rapid' || g.timeClass === 'blitz')).sort((a, b) => a.endTime - b.endTime);
  let lossStreak = 0;
  for (let i = today.length - 1; i >= 0 && today[i]!.outcome === 'loss'; i--) lossStreak++;
  const w = today.filter((g) => g.outcome === 'win').length;
  const l = today.filter((g) => g.outcome === 'loss').length;
  const first = today[0]?.userRating;
  const last = today[today.length - 1]?.userRating;
  return { today, lossStreak, w, l, d: today.length - w - l, delta: first !== undefined && last !== undefined ? last - first : 0 };
}

export default function Home() {
  const account = useAccount();
  const { games, analyses } = useGamesAndAnalyses();
  const due = useLiveQuery(() => db.puzzleCards.where('due').belowOrEqual(Date.now()).filter((c) => !c.mastered).count(), []);
  const repDue = useLiveQuery(() => db.repCards.where('due').belowOrEqual(Date.now()).count(), []);
  const repToday = useLiveQuery(() => db.repCards.filter((c) => c.lastAt >= new Date().setHours(0, 0, 0, 0)).count(), []);
  const puzzlesToday = useLiveQuery(() => db.attempts.where('at').above(new Date().setHours(0, 0, 0, 0)).count(), []);

  // Keep games fresh when the dashboard opens.
  useEffect(() => {
    if (account && Date.now() - account.syncedAt > 10 * 60 * 1000) void syncAccount(account.username).catch(() => undefined);
  }, [account]);

  const insights = useMemo(() => (games && analyses ? buildInsights(games, analyses, account ?? null) : []), [games, analyses, account]);
  const streak = useMemo(() => (games ? todayStreak(games) : null), [games]);
  const lastLoss = useMemo(() => games?.find((g) => g.outcome === 'loss' && (g.timeClass === 'rapid' || g.timeClass === 'blitz')), [games]);

  if (account === undefined) return <div className="p-8 text-ink-3">Carregando...</div>;
  if (account === null) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="mb-2 text-3xl font-extrabold">Seu treinador de xadrez</h1>
        <p className="mb-6 text-ink-2">Conecte sua conta do chess.com para importar as partidas, revisar com o Stockfish e montar seu treino.</p>
        <div className="rounded-lg bg-panel p-5"><ConnectAccount /></div>
      </div>
    );
  }

  const stats = account.stats;
  const ratings = (['rapid', 'blitz', 'bullet'] as const).map((tc) => ({ tc, block: stats[`chess_${tc}`] })).filter((r) => r.block?.last);
  const stop = streak && streak.lossStreak >= 2;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        {account.profile.avatar && <img src={account.profile.avatar} alt="" className="h-14 w-14 rounded-md" />}
        <div className="flex-1">
          <h1 className="text-[26px] font-extrabold leading-tight">Olá, {account.username}</h1>
          <p className="text-sm text-ink-3">{plural(games?.length ?? 0, 'partida importada', 'partidas importadas')} · {plural(analyses?.size ?? 0, 'analisada')}</p>
        </div>
        <div className="flex gap-2">
          {ratings.map(({ tc, block }) => (
            <div key={tc} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2">
              <TimeClassIcon tc={tc} size={20} />
              <div className="leading-tight">
                <div className="text-lg font-extrabold">{block!.last!.rating}</div>
                <div className="text-[11px] text-ink-4">{TIME_CLASS_LABEL[tc]}{block!.best ? ` · pico ${block!.best.rating}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {streak && streak.today.length > 0 && (
        <div className={clsx('mb-4 flex flex-wrap items-center gap-3 rounded-lg px-4 py-3', stop ? 'bg-[#4a2b27]' : 'bg-panel')}>
          {stop ? <AlertTriangle className="text-cls-miss" size={22} /> : <ShieldCheck className="text-go" size={22} />}
          <div className="flex-1 text-sm">
            <b className="text-ink">
              {stop ? `${streak.lossStreak} derrotas seguidas. Pare de jogar valendo rating por hoje.` : 'Sessão sob controle.'}
            </b>{' '}
            <span className="text-ink-2">
              Hoje em rapid e blitz: {streak.w}V {streak.d}E {streak.l}D, {streak.delta >= 0 ? '+' : ''}{streak.delta} de rating.
              {stop && ' Faça a sessão de tática ou revise a última derrota. Voltar agora é jogar contra o próprio cansaço.'}
            </span>
          </div>
          {stop && lastLoss && <Link to={`/review/${lastLoss.id}`} className="btn-flat text-sm">Revisar a última derrota</Link>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <Panel title="Plano de hoje">
          <ol className="space-y-2">
            <PlanItem
              icon={Puzzle}
              to="/tactics"
              done={(puzzlesToday ?? 0) >= 15}
              title="Tática: sessão diária"
              detail={`${plural(due ?? 0, 'revisão pendente', 'revisões pendentes')}. ${plural(puzzlesToday ?? 0, 'puzzle hoje', 'puzzles hoje')}.`}
            />
            {lastLoss && (
              <PlanItem
                icon={Swords}
                to={`/review/${lastLoss.id}`}
                done={!!analyses?.has(lastLoss.id)}
                title="Revisar a última derrota"
                detail={`Contra ${lastLoss.oppName}, ${new Date(lastLoss.endTime).toLocaleDateString('pt-BR')}. Ache o lance que decidiu.`}
              />
            )}
            <PlanItem icon={BookOpen} to="/openings" done={(repToday ?? 0) >= 8 && (repDue ?? 0) === 0} title="Repertório" detail={(repDue ?? 0) > 0 ? `${plural(repDue ?? 0, 'posição para revisar', 'posições para revisar')}.` : 'Treine uma linha nova do seu repertório.'} />
            <PlanItem icon={Crown} to="/endgames" done={false} title="Um final essencial" detail="10 minutos convertendo ou segurando posições-chave contra o motor." />
          </ol>
          <div className="mt-4 rounded-md bg-panel-2 p-3 text-sm">
            <div className="mb-1.5 font-bold text-ink">Antes de cada partida séria</div>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              <li>Rapid de 15|10 ou mais. Bullet não conta como treino.</li>
              <li>Duas derrotas seguidas encerram a sessão.</li>
              <li>A cada lance do adversário: quais xeques, capturas e ameaças ele criou?</li>
              <li>Antes do seu lance: o que fica sem defesa depois dele?</li>
              <li>Ganhando, troque peças e corte o contra-jogo antes de atacar.</li>
            </ul>
          </div>
        </Panel>

        <Panel title="O que está custando partidas">
          {insights.length === 0 ? (
            <p className="text-sm text-ink-3">Importe mais partidas para os diagnósticos aparecerem.</p>
          ) : (
            <ul className="space-y-3">
              {insights.map((i) => (
                <li key={i.id} className="rounded-md bg-panel-2 p-3">
                  <div className="flex items-start gap-2">
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', i.severity === 'high' ? 'bg-cls-blunder' : i.severity === 'medium' ? 'bg-cls-mistake' : 'bg-cls-inaccuracy')} />
                    <div>
                      <div className="font-bold text-ink">{i.title}</div>
                      <p className="mt-0.5 text-sm text-ink-3">{i.evidence}</p>
                      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-go" /> {i.action}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(analyses?.size ?? 0) < 10 && (
            <Link to="/games" className="mt-3 flex items-center gap-1 text-sm font-bold text-go hover:text-go-hover">
              Analise pelo menos 10 derrotas para liberar os diagnósticos do motor <ChevronRight size={16} />
            </Link>
          )}
        </Panel>
      </div>
    </div>
  );
}

function PlanItem({ icon: Icon, to, done, title, detail }: { icon: typeof Puzzle; to: string; done: boolean; title: string; detail: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-md bg-panel-2 p-3 hover:bg-raise">
        <Icon size={22} className={done ? 'text-go' : 'text-ink-3'} />
        <div className="min-w-0 flex-1">
          <div className={clsx('font-bold', done ? 'text-ink-3 line-through' : 'text-ink')}>{title}</div>
          <div className="truncate text-sm text-ink-3">{detail}</div>
        </div>
        <ChevronRight size={18} className="text-ink-4" />
      </Link>
    </li>
  );
}
