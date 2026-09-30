import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { Brain, Check, ChevronRight, RotateCcw, Target, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LineChart } from '@/components/charts/LineChart';
import { PageHeader, Panel } from '@/components/Layout';
import { PeriodFilter, PeriodNote } from '@/components/positions/PeriodFilter';
import { MemoryPanel } from '@/components/positions/MemoryPanel';
import { PuzzleExercise } from '@/components/tactics/PuzzleExercise';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { usePositionsSettings } from '@/lib/positions/settings';
import { positionsTodayCounts } from '@/lib/positions/store';
import { saveSettings, useSettings } from '@/lib/settings';
import { GAME_MOTIFS_KEY } from '@/lib/tactics/gameMotifs';
import { themeLabel } from '@/lib/tactics/themes';
import {
  buildCalcSession,
  buildSession,
  calcOf,
  countsAsDailyTactics,
  duePuzzles,
  isMastered,
  levelProgress,
  loadTactics,
  recordAttempt,
  themeRating,
  themeWeights,
  TRAINER,
  type AttemptOutcome,
  type SessionItem,
} from '@/lib/tactics/trainer';
import { MOTIFS } from '@/lib/tactics/themes';
import type { PuzzleAttempt, TacticsState } from '@/lib/types';

interface Played {
  item: SessionItem;
  solved: boolean;
  delta: number;
  review: AttemptOutcome['review'];
}

/** daily: the session of the day. calc: Tática > Cálculo, on its own rating. */
type SessionKind = 'daily' | 'calc';

/** Cálculo: half the daily session, each puzzle being a calculation. */
const calcSize = (sessionSize: number) => Math.max(5, Math.round(sessionSize / 2));

export default function Tactics() {
  const settings = useSettings();
  const [state, setState] = useState<TacticsState | null>(null);
  const [session, setSession] = useState<SessionItem[] | null>(null);
  const [kind, setKind] = useState<SessionKind>('daily');
  const [sessionId, setSessionId] = useState(0);
  const [index, setIndex] = useState(0);
  const [played, setPlayed] = useState<Played[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTactics().then(setState);
  }, []);

  const start = async (which: SessionKind = 'daily') => {
    if (!state) return;
    setLoading(true);
    setError(null);
    try {
      const items = which === 'calc' ? await buildCalcSession(state, calcSize(settings.sessionSize)) : await buildSession(state, settings.sessionSize);
      if (!items.length) {
        setSession(null);
        setError(which === 'calc' ? 'Não achei puzzles de cálculo perto do seu rating. Rode npm run build:puzzles para um banco com eles.' : 'Não consegui montar a sessão.');
      } else {
        setSession(items);
        setKind(which);
        setSessionId((n) => n + 1);
        setIndex(0);
        setPlayed([]);
      }
    } catch (e) {
      setSession(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!state) return <div className="p-8 text-ink-3">Carregando...</div>;

  if (session) {
    return (
      <SessionView
        key={sessionId}
        items={session}
        index={index}
        played={played}
        rating={kind === 'calc' ? calcOf(state).rating.rating : state.rating.rating}
        onResult={async (item, solved, timeMs) => {
          const out = await recordAttempt(item, { solved, timeMs });
          setState(out.state);
          setPlayed((p) => [...p, { item, solved, delta: out.after - out.before, review: out.review }]);
        }}
        onNext={() => setIndex((i) => i + 1)}
        onExit={() => {
          setSession(null);
          void loadTactics().then(setState);
        }}
        onContinue={() => start(kind)}
        loading={loading}
      />
    );
  }

  return (
    <Overview
      state={state}
      loading={loading}
      error={error}
      onStart={() => start('daily')}
      onStartCalc={() => start('calc')}
      sessionSize={settings.sessionSize}
      minePeriod={settings.minePeriod}
      onPeriod={(days) => void saveSettings({ minePeriod: days }, settings)}
    />
  );
}

// ---------------------------------------------------------------- overview

function Overview({ state, loading, error, onStart, onStartCalc, sessionSize, minePeriod, onPeriod }: {
  state: TacticsState;
  loading: boolean;
  error: string | null;
  onStart: () => void;
  onStartCalc: () => void;
  sessionSize: number;
  minePeriod: number;
  onPeriod: (days: number) => void;
}) {
  const due = useLiveQuery(() => duePuzzles().then((c) => c.length), []);
  const mastered = useLiveQuery(() => db.srsCards.where('kind').equals('puzzle').filter(isMastered).count(), []);
  // Your own-game mistakes are Posições cards: the shortcut shows what is pending there for the period.
  const positionLimits = usePositionsSettings();
  const mine = useLiveQuery(() => positionsTodayCounts('best', positionLimits, Date.now(), minePeriod), [positionLimits.newPerDay, positionLimits.maxReviewsPerDay, minePeriod]);
  const attempts = useLiveQuery(() => db.attempts.orderBy('at').reverse().limit(200).toArray(), []);
  const gameMotifs = useLiveQuery(async () => ((await db.kv.get(GAME_MOTIFS_KEY))?.value as Record<string, number>) ?? {}, []);
  const level = levelProgress(state);
  const weights = useMemo(() => themeWeights(state, gameMotifs ?? {}), [state, gameMotifs]);
  const focus = useMemo(() => Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t), [weights]);
  const R = Math.round(state.rating.rating);
  const last7 = attempts?.filter((a) => a.at > Date.now() - 7 * 86400000 && (a.mode === 'new' || a.mode === 'placement')) ?? [];
  const solvedPct = last7.length ? Math.round((100 * last7.filter((a) => a.solved).length) / last7.length) : null;
  // Neither the old "only my mistakes" session, a warm-up before games, punishing opening mistakes nor Cálculo is the day's session.
  const trainedToday = attempts?.some((a) => a.at >= new Date().setHours(0, 0, 0, 0) && countsAsDailyTactics(a));
  const minePending = mine ? mine.reviews + mine.news : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader title="Tática" />
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-ink-3">Seu rating tático</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[52px] font-extrabold leading-none">{R}</span>
                <span className="text-sm text-ink-3">± {Math.round(state.rating.rd)}</span>
              </div>
              {!state.placementDone && <div className="mt-1 text-sm text-cls-inaccuracy">Provisório: faça a calibração ({TRAINER.placementCount} puzzles).</div>}
            </div>
            <div className="text-right text-sm text-ink-3">
              {solvedPct !== null && <div>Últimos 7 dias: <b className="text-ink">{solvedPct}%</b> de acerto em {last7.length} novos</div>}
              <div>{plural(due ?? 0, 'revisão para hoje', 'revisões para hoje')}</div>
              <div title="A memória do puzzle passa de um mês, pelo FSRS">{plural(mastered ?? 0, 'puzzle dominado', 'puzzles dominados')}</div>
            </div>
          </div>
          <div className="mt-4">
            <LineChart
              height={170}
              series={[{ key: 'r', label: 'Rating tático', color: '#7dd3fc', points: state.history.map((h) => ({ x: new Date(h.day).getTime(), y: h.rating })) }]}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="btn-go flex items-center gap-2 text-[17px]" disabled={loading} onClick={onStart}>
              <Target size={20} /> {loading ? 'Montando sessão...' : !state.placementDone ? 'Começar calibração' : `${trainedToday ? 'Mais uma sessão' : 'Sessão de hoje'} (${sessionSize})`}
            </button>
            {!!mine?.total && (
              <Link to="/positions?mode=best" className={clsx('btn-flat flex items-center gap-2', !minePending && 'opacity-60')}>
                <RotateCcw size={16} /> Só os meus erros ({minePending}) <ChevronRight size={16} />
              </Link>
            )}
          </div>
          {!!mine?.total && (
            <>
              <PeriodFilter value={minePeriod} onChange={onPeriod} className="mt-3" />
              <p className="mt-2 text-sm text-ink-3">Os erros das suas partidas ficam em Posições, com a revisão espaçada de cada posição. O atalho abre lá, com este período.</p>
              {!minePending && <PeriodNote counts={mine} period={minePeriod} className="mt-1" />}
            </>
          )}
          {error && <p className="mt-2 text-sm text-cls-blunder">{error}</p>}
        </Panel>

        <Panel title={`Próximo nível: ${level.next}`}>
          <div className="mb-1 flex justify-between text-sm text-ink-3">
            <span>{level.current}</span>
            <span>{level.next}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-ink" style={{ width: `${level.pct * 100}%` }} />
          </div>
          <p className="mt-3 text-sm text-ink-2">
            Para subir de nível o rating precisa passar de {level.next} com a margem de erro abaixo de 90, e os temas centrais desse nível precisam acompanhar:
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {level.checklist.map((c) => (
              <li key={c.theme} className="flex items-center gap-2">
                {c.ok ? <Check size={16} className="text-go" strokeWidth={3} /> : <X size={16} className="text-cls-miss" strokeWidth={3} />}
                <span className={c.ok ? 'text-ink-2' : 'text-ink'}>{themeLabel(c.theme)}</span>
                <span className="ml-auto tabular-nums text-ink-4">{Math.round(c.rating)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-md bg-panel-2 p-3 text-sm">
            <div className="mb-1 font-bold text-ink-2">Foco desta semana</div>
            <div className="flex flex-wrap gap-2">
              {focus.map((t) => <span key={t} className="rounded bg-raise px-2 py-1 font-bold">{themeLabel(t)}</span>)}
            </div>
            <p className="mt-2 text-ink-3">Escolhidos pelo peso: importância no seu nível, fraqueza no tema, tempo sem treinar e frequência nos erros das suas partidas.</p>
          </div>
        </Panel>
      </div>

      <CalcPanel state={state} attempts={attempts ?? []} loading={loading} size={calcSize(sessionSize)} onStart={onStartCalc} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Panel title="Temas">
          <ThemeTable state={state} weights={weights} />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Como o treino escolhe os puzzles">
            <HowItWorks />
          </Panel>
          <MemoryPanel kind="puzzle" />
        </div>
      </div>
    </div>
  );
}

/** Tática > Cálculo: its rating and its session, with what makes it different from the day's session. */
function CalcPanel({ state, attempts, loading, size, onStart }: { state: TacticsState; attempts: PuzzleAttempt[]; loading: boolean; size: number; onStart: () => void }) {
  const calc = calcOf(state);
  const last7 = attempts.filter((a) => a.mode === 'calc' && a.at > Date.now() - 7 * 86400000);
  const solvedPct = last7.length ? Math.round((100 * last7.filter((a) => a.solved).length) / last7.length) : null;
  const fresh = !attempts.some((a) => a.mode === 'calc');
  return (
    <Panel title="Cálculo" className="mt-4">
      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <div className="min-w-[220px]">
          <div className="text-sm font-bold text-ink-3">Seu rating de cálculo</div>
          <div className="flex items-baseline gap-2">
            <span className="text-[40px] font-extrabold leading-none">{Math.round(calc.rating.rating)}</span>
            <span className="text-sm text-ink-3">± {Math.round(calc.rating.rd)}</span>
          </div>
          {fresh && <div className="mt-1 text-sm text-ink-3">Começa no seu rating tático e se acerta em uma dezena de puzzles.</div>}
          {solvedPct !== null && <div className="mt-1 text-sm text-ink-3">Últimos 7 dias: <b className="text-ink">{solvedPct}%</b> de acerto em {last7.length}</div>}
          <button type="button" className="btn-go mt-3 flex items-center gap-2" disabled={loading} onClick={onStart}>
            <Brain size={18} /> {loading ? 'Montando sessão...' : `Sessão de cálculo (${size})`}
          </button>
        </div>
        <div className="space-y-2 text-sm leading-relaxed text-ink-2">
          <p><b className="text-ink">Partidas de mestre, linhas longas.</b> Puzzles de partidas com um jogador titulado e três lances seus ou mais, como os problemas do ChessTempo, tirados da base do Lichess.</p>
          <p><b className="text-ink">Nenhuma pista.</b> Sem tema, sem relógio, e o rating do puzzle só no fim. Vale o cálculo até o último lance: um lance que também ganha é aceito, um que ganha menos, não.</p>
          <p><b className="text-ink">Rating próprio.</b> Separado do tático, porque é outro tipo de puzzle. O que você erra volta na revisão, aqui ou na sessão de hoje, o que abrir primeiro.</p>
        </div>
      </div>
      {calc.history.length > 1 && (
        <div className="mt-3">
          <LineChart height={120} series={[{ key: 'c', label: 'Rating de cálculo', color: '#c4b5fd', points: calc.history.map((h) => ({ x: new Date(h.day).getTime(), y: h.rating })) }]} />
        </div>
      )}
    </Panel>
  );
}

function ThemeTable({ state, weights }: { state: TacticsState; weights: Record<string, number> }) {
  const R = state.rating.rating;
  const rows = MOTIFS.map((t) => ({ t, r: themeRating(state, t), s: state.themes[t], w: weights[t] ?? 0 }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 18);
  const maxDiff = 300;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left text-ink-4">
            <th className="pb-2 font-bold">Tema</th>
            <th className="pb-2 font-bold">Rating no tema vs. o seu</th>
            <th className="pb-2 text-right font-bold">Acertos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, r, s }) => {
            const diff = Math.max(-maxDiff, Math.min(maxDiff, r - R));
            const pct = (Math.abs(diff) / maxDiff) * 50;
            return (
              <tr key={t} className="border-t border-line/50">
                <td className="py-1.5 pr-2 font-semibold text-ink-2">{themeLabel(t)}</td>
                <td className="py-1.5 pr-2">
                  <div className="relative h-3 w-full min-w-[140px]" title={`${Math.round(r)} (${diff >= 0 ? '+' : ''}${Math.round(r - R)})`}>
                    <div className="absolute inset-y-0 left-1/2 w-px bg-ink-4" />
                    <div
                      className="absolute inset-y-0.5 rounded-sm"
                      style={diff >= 0
                        ? { left: '50%', width: `${pct}%`, background: 'var(--color-go)' }
                        : { right: '50%', width: `${pct}%`, background: 'var(--color-cls-miss)' }}
                    />
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink-3">{s ? `${s.solved}/${s.attempts}` : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-4">Verde: acima do seu rating geral. Vermelho: abaixo. Ordenado pelo peso que o algoritmo dá a cada tema agora.</p>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-ink-2">
      <p><b className="text-ink">Nunca abaixo do seu nível.</b> Puzzles novos vêm {Math.round(TRAINER.bands[0]!.weight * 100)}% no seu nível, {Math.round(TRAINER.bands[1]!.weight * 100)}% acima (+75 a +200) e {Math.round(TRAINER.bands[2]!.weight * 100)}% bem acima (+200 a +350). A exceção é o Aquecer, antes de jogar: puzzles curtos, uns {-TRAINER.warmup.offset} pontos abaixo, que não mexem no rating.</p>
      <p><b className="text-ink">O que você erra volta.</b> Cada puzzle errado entra na revisão espaçada (FSRS, o mesmo das Posições): volta no dia seguinte, e cada acerto de primeira aumenta o intervalo na medida da sua memória. Acerto rápido pesa mais que acerto lento.</p>
      <p><b className="text-ink">Seus erros viram treino.</b> Toda partida analisada gera as posições em que você errou, em <Link to="/positions" className="font-medium text-ink underline decoration-ink-4 underline-offset-4 hover:decoration-ink">Posições</Link>, e os temas desses erros puxam os puzzles daqui.</p>
      <p><b className="text-ink">O tema é escolhido por peso</b>: importância para o seu rating (garfo e peça pendurada pesam mais até ~1600; desvio, lance intermediário e defesa depois), sua fraqueza no tema, tempo sem treinar e frequência nos erros das suas partidas.</p>
      <p><b className="text-ink">A dificuldade se ajusta.</b> Se o acerto nos novos passar de {Math.round(TRAINER.successWindow[1] * 100)}%, tudo sobe {TRAINER.stretchStep} pontos; abaixo de {Math.round(TRAINER.successWindow[0] * 100)}%, desce.</p>
      <p><b className="text-ink">A sessão termina bem.</b> Começa e acaba com puzzles do seu nível, e os temas vêm intercalados (a mistura fixa melhor que blocos do mesmo tema).</p>
    </div>
  );
}

// ---------------------------------------------------------------- session

function SessionView({ items, index, played, rating, onResult, onNext, onExit, onContinue, loading }: {
  items: SessionItem[];
  index: number;
  played: Played[];
  rating: number;
  onResult: (item: SessionItem, solved: boolean, timeMs: number) => Promise<void>;
  onNext: () => void;
  onExit: () => void;
  onContinue: () => void;
  loading: boolean;
}) {
  const item = items[index];
  const handleResult = useCallback((solved: boolean, timeMs: number) => {
    if (item) void onResult(item, solved, timeMs);
  }, [item, onResult]);

  if (!item) {
    return <SessionSummary played={played} rating={rating} onExit={onExit} onContinue={onContinue} loading={loading} />;
  }

  const current = played.find((p) => p.item === item);
  const header = (
    <div className="rounded-lg bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold text-ink-3">Puzzle {index + 1} de {items.length}</span>
        <button type="button" onClick={onExit} className="text-sm text-ink-3 hover:text-ink">Sair</button>
      </div>
      <div className="flex gap-1">
        {items.map((it, i) => {
          const p = played.find((x) => x.item === it);
          return <span key={i} className={clsx('h-2 flex-1 rounded-full', p ? (p.solved ? 'bg-go' : 'bg-cls-blunder') : i === index ? 'bg-ink-3' : 'bg-raise')} />;
        })}
      </div>
    </div>
  );

  return (
    <PuzzleExercise
      key={index}
      item={item}
      header={header}
      outcome={current ? { delta: current.delta, rating, review: current.review } : null}
      onResult={handleResult}
      onNext={onNext}
      nextLabel={index + 1 < items.length ? 'Próximo' : 'Ver resumo'}
    />
  );
}

function SessionSummary({ played, rating, onExit, onContinue, loading }: {
  played: Played[];
  rating: number;
  onExit: () => void;
  onContinue: () => void;
  loading: boolean;
}) {
  const solved = played.filter((p) => p.solved).length;
  const delta = played.reduce((s, p) => s + p.delta, 0);
  const failedThemes = new Map<string, number>();
  for (const p of played) if (!p.solved && p.item.theme) failedThemes.set(p.item.theme, (failedThemes.get(p.item.theme) ?? 0) + 1);
  // Cálculo names no theme: just how many come back.
  const failed = played.length - solved;
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Panel>
        <h2 className="text-2xl font-extrabold">Sessão concluída</h2>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md bg-panel-2 p-3"><div className="text-3xl font-extrabold">{solved}/{played.length}</div><div className="text-sm text-ink-3">resolvidos</div></div>
          <div className="rounded-md bg-panel-2 p-3"><div className={clsx('text-3xl font-extrabold', delta >= 0 ? 'text-go' : 'text-cls-miss')}>{delta >= 0 ? '+' : ''}{Math.round(delta)}</div><div className="text-sm text-ink-3">rating</div></div>
          <div className="rounded-md bg-panel-2 p-3"><div className="text-3xl font-extrabold">{Math.round(rating)}</div><div className="text-sm text-ink-3">agora</div></div>
        </div>
        {failedThemes.size > 0 && (
          <p className="mt-4 text-sm text-ink-2">Voltam na revisão: {[...failedThemes.entries()].map(([t, n]) => `${themeLabel(t)}${n > 1 ? ` (${n})` : ''}`).join(', ')}.</p>
        )}
        {failedThemes.size === 0 && failed > 0 && <p className="mt-4 text-sm text-ink-2">{failed === 1 ? 'O puzzle errado volta' : `Os ${failed} puzzles errados voltam`} na revisão.</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" className="btn-go flex flex-1 items-center justify-center gap-2" disabled={loading} onClick={onContinue} autoFocus>
            {loading ? 'Montando sessão...' : 'Mais uma sessão'}
            {!loading && <ChevronRight size={20} />}
          </button>
          <button type="button" className="btn-flat" onClick={onExit}>Voltar</button>
        </div>
      </Panel>
    </div>
  );
}
