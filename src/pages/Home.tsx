import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, BookOpen, CheckCircle2, ChevronRight, Cpu, Crown, Dumbbell, Flame, ListChecks, Puzzle, ShieldCheck, Swords, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Panel } from '@/components/Layout';
import { TIME_CLASS_LABEL, TimeClassIcon } from '@/components/TimeClassIcon';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { usePositionsSettings } from '@/lib/positions/settings';
import { positionsTodayCounts } from '@/lib/positions/store';
import { loadLevelState } from '@/lib/renewal/levelStore';
import { useAnalysisQueue } from '@/lib/review/queue';
import { buildInsights } from '@/lib/stats/insights';
import { useAccount, useSettings } from '@/lib/settings';
import { localDay } from '@/lib/srs/queue';
import { activeMs } from '@/lib/training/session';
import { useTrainingSettings } from '@/lib/training/settings';
import { readSession } from '@/lib/training/store';
import { countsAsDailyTactics } from '@/lib/tactics/trainer';
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
  // Every mode is on the same FSRS calendar: one table of cards, one log of reviews.
  const dueOf = (kind: 'puzzle' | 'rep') => db.srsCards.where('kind').equals(kind).filter((c) => !c.suspended && c.due <= Date.now()).count();
  const due = useLiveQuery(() => dueOf('puzzle'), []);
  const repDue = useLiveQuery(() => dueOf('rep'), []);
  const repToday = useLiveQuery(() => {
    const day = localDay(Date.now());
    return db.reviewLogs.where('[kind+at]').between(['rep', day.start], ['rep', day.end], true, false).count();
  }, []);
  const puzzlesToday = useLiveQuery(() => db.attempts.where('at').above(new Date().setHours(0, 0, 0, 0)).filter(countsAsDailyTactics).count(), []);
  const today = useLiveQuery(() => readSession('daily'), []);
  const trainingSettings = useTrainingSettings();
  const positionLimits = usePositionsSettings();
  const period = useSettings().minePeriod;
  const positions = useLiveQuery(() => positionsTodayCounts('best', positionLimits, Date.now(), period), [positionLimits.newPerDay, positionLimits.maxReviewsPerDay, period]);
  const sequences = useLiveQuery(() => positionsTodayCounts('seq', positionLimits, Date.now(), period), [positionLimits.seqNewPerDay, positionLimits.seqMaxReviewsPerDay, period]);
  // Syncing, the Posições cards and the automatic analysis run in the renewal pipeline (Layout).
  const queue = useAnalysisQueue();
  const level = useLiveQuery(loadLevelState, []);
  const newBand = level?.reports.at(-1);

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

      {newBand && level?.seen !== newBand.band && (
        <Link to="/level" className="mb-4 flex items-center gap-3 rounded-lg bg-[#2f3f25] px-4 py-3 text-sm hover:brightness-110">
          <TrendingUp className="text-go" size={22} />
          <span className="flex-1">
            <b className="text-ink">Você chegou a {newBand.band} no rapid.</b> <span className="text-ink-2">Veja o que mudou nos seus focos desde a faixa anterior.</span>
          </span>
          <ChevronRight size={18} className="text-ink-3" />
        </Link>
      )}

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

      <TrainButtons
        today={today}
        minutes={trainingSettings.dailyMinutes}
        reviews={[due, positions?.reviews, sequences?.reviews, repDue].every((n) => n !== undefined) ? (due ?? 0) + (positions?.reviews ?? 0) + (sequences?.reviews ?? 0) + (repDue ?? 0) : null}
      />

      {/* Columns of minmax(0, 1fr): a line that does not wrap (the plan's details) never widens its column past the screen. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Plano de hoje">
          <TodayReviews parts={[['tática', due], ['posições', positions?.reviews], ['sequências', sequences?.reviews], ['repertório', repDue]]} />
          {(queue.currentAuto || queue.autoPending > 0) && (
            <p className="mb-3 flex items-center gap-2 text-xs text-ink-4">
              <Cpu size={14} />
              {queue.autoSuspended && !queue.currentAuto
                ? `Análise automática pausada: ${plural(queue.autoPending, 'partida', 'partidas')} na fila.`
                : `Análise automática em segundo plano: ${plural(queue.autoPending + (queue.currentAuto ? 1 : 0), 'partida', 'partidas')} para analisar, derrotas primeiro.`}
            </p>
          )}
          <ol className="space-y-2">
            <PlanItem
              icon={Puzzle}
              to="/tactics"
              done={(puzzlesToday ?? 0) >= 15}
              title="Tática: sessão diária"
              detail={`${plural(due ?? 0, 'revisão pendente', 'revisões pendentes')}. ${plural(puzzlesToday ?? 0, 'puzzle hoje', 'puzzles hoje')}.`}
            />
            {positions && positions.total > 0 && (
              <PlanItem
                icon={ListChecks}
                to="/positions"
                done={positions.reviews + positions.news === 0 && positions.doneToday > 0}
                title="Posições das suas partidas"
                detail={
                  (positions.reviews + positions.news > 0
                    ? `${plural(positions.reviews, 'revisão', 'revisões')} e ${plural(positions.news, 'nova', 'novas')}.`
                    : `Tudo feito por hoje. ${plural(positions.doneToday, 'tentativa', 'tentativas')}.`) +
                  (sequences && sequences.reviews + sequences.news > 0 ? ` Sequências: ${sequences.reviews + sequences.news}.` : '')
                }
              />
            )}
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

const BUTTON_BOX: React.CSSProperties = { padding: '0.9rem 1.25rem 1.05rem' };

/** The two ways in: the day's training, once a day, and the warm-up before games. */
function TrainButtons({ today, minutes, reviews }: { today: Awaited<ReturnType<typeof readSession>> | undefined; minutes: number; reviews: number | null }) {
  let detail: string;
  if (today?.finishedAt) detail = `Feito hoje (${plural(Math.max(1, Math.round(activeMs(today) / 60_000)), 'minuto')}). Rever ou treinar mais 10 minutos.`;
  else if (today) detail = `Continuar: ${today.steps.filter((s) => s.status !== 'pending').length} de ${plural(today.steps.length, 'exercício', 'exercícios')}.`;
  else detail = `Cerca de ${minutes} min: ${reviews ? `${plural(reviews, 'revisão', 'revisões')}, ` : ''}seus erros, tática e aberturas.`;
  // Half and half, the same columns as the panels below, so the edges line up: Treinar over the
  // day's plan, Aquecer over what costs you games. Both buttons get one inner box (the button classes set their own).
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Link to="/train" style={BUTTON_BOX} className="btn-go flex items-center gap-4 text-left">
        <Dumbbell size={28} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-extrabold">{today?.finishedAt ? 'Treino do dia feito' : 'Treinar'}</span>
          <span className="block text-sm font-bold opacity-90">{detail}</span>
        </span>
        <ChevronRight size={22} className="shrink-0" />
      </Link>
      <Link to="/warmup" style={BUTTON_BOX} className="btn-flat flex items-center gap-4 text-left">
        <Flame size={28} className="shrink-0 text-cls-inaccuracy" />
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-extrabold text-ink">Aquecer</span>
          <span className="block text-sm text-ink-3">5 minutos antes de jogar: puzzles rápidos, seu erro mais caro e uma linha de cada cor.</span>
        </span>
        <ChevronRight size={22} className="shrink-0 text-ink-4" />
      </Link>
    </div>
  );
}

/** The day's reviews across every mode, from the one FSRS calendar. */
function TodayReviews({ parts }: { parts: Array<[string, number | undefined]> }) {
  if (parts.some(([, n]) => n === undefined)) return null;
  const total = parts.reduce((s, [, n]) => s + (n ?? 0), 0);
  const nonzero = parts.filter(([, n]) => n);
  return (
    <p className="mb-3 text-sm text-ink-3">
      {total ? (
        <>
          <b className="text-ink">{plural(total, 'revisão hoje', 'revisões hoje')}</b>: {nonzero.map(([label, n]) => `${n} de ${label}`).join(', ')}.
        </>
      ) : (
        'Nenhuma revisão pendente hoje.'
      )}
    </p>
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
