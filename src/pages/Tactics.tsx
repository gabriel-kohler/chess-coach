import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronRight, Eye, Lightbulb, Puzzle as PuzzleIcon, RotateCcw, Target, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LineChart } from '@/components/charts/LineChart';
import { PageHeader, Panel } from '@/components/Layout';
import { PuzzlePlayer, type PuzzleFeedback } from '@/components/tactics/PuzzlePlayer';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { themeLabel } from '@/lib/tactics/themes';
import {
  buildSession,
  levelProgress,
  loadTactics,
  recordAttempt,
  themeRating,
  themeWeights,
  TRAINER,
  type SessionItem,
} from '@/lib/tactics/trainer';
import { MOTIFS } from '@/lib/tactics/themes';
import type { TacticsState } from '@/lib/types';

interface Played {
  item: SessionItem;
  solved: boolean;
  delta: number;
}

export default function Tactics() {
  const settings = useSettings();
  const [state, setState] = useState<TacticsState | null>(null);
  const [session, setSession] = useState<SessionItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [played, setPlayed] = useState<Played[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  useEffect(() => {
    void loadTactics().then(setState);
  }, []);

  const start = async (mode: 'normal' | 'mine' = 'normal') => {
    if (!state) return;
    setLoading(true);
    setError(null);
    try {
      let items: SessionItem[];
      if (mode === 'mine') {
        const cards = await db.puzzleCards.filter((c) => c.puzzle.source === 'mine' && !c.mastered).toArray();
        items = cards.sort((a, b) => a.due - b.due).slice(0, settings.sessionSize).map((c) => ({ puzzle: c.puzzle, mode: 'mine' as const, reason: c.puzzle.note ?? 'Erro seu' }));
      } else {
        items = await buildSession(state, settings.sessionSize);
      }
      if (!items.length) setError(mode === 'mine' ? 'Nenhum erro seu na fila. Analise algumas partidas primeiro.' : 'Não consegui montar a sessão.');
      else {
        setSession(items);
        setIndex(0);
        setPlayed([]);
        setOnlyMine(mode === 'mine');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!state) return <div className="p-8 text-ink-3">Carregando...</div>;

  if (session) {
    return (
      <SessionView
        items={session}
        index={index}
        played={played}
        rating={state.rating.rating}
        onResult={async (item, solved, timeMs) => {
          const out = await recordAttempt(item, { solved, timeMs });
          setState(out.state);
          setPlayed((p) => [...p, { item, solved, delta: out.after - out.before }]);
        }}
        onNext={() => setIndex((i) => i + 1)}
        onExit={() => {
          setSession(null);
          void loadTactics().then(setState);
        }}
        onlyMine={onlyMine}
      />
    );
  }

  return <Overview state={state} loading={loading} error={error} onStart={start} sessionSize={settings.sessionSize} />;
}

// ---------------------------------------------------------------- overview

function Overview({ state, loading, error, onStart, sessionSize }: {
  state: TacticsState;
  loading: boolean;
  error: string | null;
  onStart: (mode?: 'normal' | 'mine') => void;
  sessionSize: number;
}) {
  const due = useLiveQuery(() => db.puzzleCards.where('due').belowOrEqual(Date.now()).filter((c) => !c.mastered).count(), []);
  const mine = useLiveQuery(() => db.puzzleCards.filter((c) => c.puzzle.source === 'mine' && !c.mastered).count(), []);
  // Booleans are not indexable in IndexedDB, so filter instead of where().
  const mastered = useLiveQuery(() => db.puzzleCards.filter((c) => c.mastered).count(), []);
  const attempts = useLiveQuery(() => db.attempts.orderBy('at').reverse().limit(200).toArray(), []);
  const gameMotifs = useLiveQuery(async () => ((await db.kv.get('gameMotifs'))?.value as Record<string, number>) ?? {}, []);
  const level = levelProgress(state);
  const weights = useMemo(() => themeWeights(state, gameMotifs ?? {}), [state, gameMotifs]);
  const focus = useMemo(() => Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t), [weights]);
  const R = Math.round(state.rating.rating);
  const last7 = attempts?.filter((a) => a.at > Date.now() - 7 * 86400000 && (a.mode === 'new' || a.mode === 'placement')) ?? [];
  const solvedPct = last7.length ? Math.round((100 * last7.filter((a) => a.solved).length) / last7.length) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader title="Tática" icon={PuzzleIcon} />
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
              <div>{plural(due ?? 0, 'revisão para hoje', 'revisões para hoje')} · {plural(mine ?? 0, 'erro seu na fila', 'erros seus na fila')}</div>
              <div>{plural(mastered ?? 0, 'puzzle dominado', 'puzzles dominados')}</div>
            </div>
          </div>
          <div className="mt-4">
            <LineChart
              height={170}
              series={[{ key: 'r', label: 'Rating tático', color: '#3987e5', points: state.history.map((h) => ({ x: new Date(h.day).getTime(), y: h.rating })) }]}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="btn-go flex items-center gap-2 text-[17px]" disabled={loading} onClick={() => onStart('normal')}>
              <Target size={20} /> {loading ? 'Montando sessão...' : state.placementDone ? `Sessão de hoje (${sessionSize})` : 'Começar calibração'}
            </button>
            {(mine ?? 0) > 0 && (
              <button type="button" className="btn-flat flex items-center gap-2" disabled={loading} onClick={() => onStart('mine')}>
                <RotateCcw size={16} /> Só os meus erros ({mine})
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-cls-blunder">{error}</p>}
        </Panel>

        <Panel title={`Próximo nível: ${level.next}`}>
          <div className="mb-1 flex justify-between text-sm text-ink-3">
            <span>{level.current}</span>
            <span>{level.next}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-go" style={{ width: `${level.pct * 100}%` }} />
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Panel title="Temas">
          <ThemeTable state={state} weights={weights} />
        </Panel>
        <Panel title="Como o treino escolhe os puzzles">
          <HowItWorks />
        </Panel>
      </div>
    </div>
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
      <p><b className="text-ink">Nunca abaixo do seu nível.</b> Puzzles novos vêm {Math.round(TRAINER.bands[0]!.weight * 100)}% no seu nível, {Math.round(TRAINER.bands[1]!.weight * 100)}% acima (+75 a +200) e {Math.round(TRAINER.bands[2]!.weight * 100)}% bem acima (+200 a +350).</p>
      <p><b className="text-ink">O que você erra volta.</b> Cada puzzle errado entra numa fila de revisão em 1, 3, 7, 16 e 35 dias, até você acertar de primeira quatro vezes seguidas. É o que o Chess Tempo cobra no plano pago.</p>
      <p><b className="text-ink">Seus erros viram treino.</b> Toda partida analisada gera puzzles das posições em que você errou ou deixou passar uma chance.</p>
      <p><b className="text-ink">O tema é escolhido por peso</b>: importância para o seu rating (garfo e peça pendurada pesam mais até ~1600; desvio, lance intermediário e defesa depois), sua fraqueza no tema, tempo sem treinar e frequência nos erros das suas partidas.</p>
      <p><b className="text-ink">A dificuldade se ajusta.</b> Se o acerto nos novos passar de {Math.round(TRAINER.successWindow[1] * 100)}%, tudo sobe {TRAINER.stretchStep} pontos; abaixo de {Math.round(TRAINER.successWindow[0] * 100)}%, desce.</p>
      <p><b className="text-ink">A sessão termina bem.</b> Começa e acaba com puzzles do seu nível, e os temas vêm intercalados (a mistura fixa melhor que blocos do mesmo tema).</p>
    </div>
  );
}

// ---------------------------------------------------------------- session

function SessionView({ items, index, played, rating, onResult, onNext, onExit, onlyMine }: {
  items: SessionItem[];
  index: number;
  played: Played[];
  rating: number;
  onResult: (item: SessionItem, solved: boolean, timeMs: number) => Promise<void>;
  onNext: () => void;
  onExit: () => void;
  onlyMine: boolean;
}) {
  const [feedback, setFeedback] = useState<PuzzleFeedback>({ kind: 'none', text: '' });
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState(0);
  const [solution, setSolution] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const item = items[index];

  useEffect(() => {
    setDone(false);
    setHint(0);
    setSolution(0);
    setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [index]);

  const handleResult = useCallback((solved: boolean, timeMs: number) => {
    if (item) void onResult(item, solved, timeMs);
  }, [item, onResult]);
  const handleFinished = useCallback(() => setDone(true), []);

  if (!item) return <SessionSummary played={played} rating={rating} onExit={onExit} />;

  const current = played.find((p) => p.item === item);
  const turnWhite = item.puzzle.fen.split(' ')[1] === 'b'; // after the setup move
  const header = item.mode === 'placement' ? 'Calibração' : item.mode === 'review' ? 'Revisão' : item.mode === 'mine' ? 'Seu erro' : item.theme ? themeLabel(item.theme) : 'Puzzle';

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      <div className="flex min-w-0 flex-1 justify-center">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 40px)' }}>
          <PuzzlePlayer
            puzzle={item.puzzle}
            onResult={handleResult}
            onFinished={handleFinished}
            onFeedback={setFeedback}
            hintToken={hint}
            solutionToken={solution}
          />
        </div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]">
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

        <div className={clsx('rounded-lg p-4', feedback.kind === 'wrong' || feedback.kind === 'failed' ? 'bg-[#4a2b27]' : feedback.kind === 'solved' || feedback.kind === 'good' ? 'bg-[#2f3f25]' : 'bg-panel')}>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[17px] font-extrabold">
              <span className={clsx('h-4 w-4 rounded-sm border border-ink-4', turnWhite ? 'bg-white' : 'bg-[#2b2927]')} />
              {turnWhite ? 'Brancas jogam' : 'Pretas jogam'}
            </span>
            <span className="font-mono text-sm tabular-nums text-ink-3">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
          </div>
          <div className="mt-1 text-sm text-ink-3">
            {header}
            {item.mode !== 'mine' && item.mode !== 'review' && <> · {item.puzzle.rating} · {item.reason}</>}
          </div>
          {item.mode === 'mine' && <p className="mt-2 text-sm text-ink-2">{item.reason}. Encontre o lance que você não viu.</p>}
          {item.mode === 'review' && <p className="mt-2 text-sm text-ink-2">{item.reason}</p>}
          {feedback.text && (
            <p className={clsx('mt-3 flex items-center gap-2 text-[15px] font-bold', feedback.kind === 'wrong' || feedback.kind === 'failed' ? 'text-cls-miss' : feedback.kind === 'alternative' ? 'text-cls-inaccuracy' : 'text-go-hover')}>
              {feedback.kind === 'wrong' || feedback.kind === 'failed' ? <X size={18} strokeWidth={3} /> : feedback.kind === 'alternative' ? <Lightbulb size={18} /> : <Check size={18} strokeWidth={3} />}
              {feedback.text}
            </p>
          )}
          {current && (item.mode === 'new' || item.mode === 'placement') && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-bold">
              {current.delta >= 0 ? <TrendingUp size={16} className="text-go" /> : <TrendingDown size={16} className="text-cls-miss" />}
              <span className={current.delta >= 0 ? 'text-go' : 'text-cls-miss'}>{current.delta >= 0 ? '+' : ''}{Math.round(current.delta)}</span>
              <span className="text-ink-3">rating {Math.round(rating)}</span>
            </p>
          )}
          {done && item.puzzle.themes.length > 0 && item.mode !== 'mine' && (
            <p className="mt-2 text-xs text-ink-4">Temas: {item.puzzle.themes.filter((t) => !['short', 'long', 'veryLong', 'oneMove', 'middlegame', 'endgame', 'opening', 'crushing', 'advantage'].includes(t)).map(themeLabel).join(', ')}</p>
          )}
          {done && item.puzzle.gameId && (
            <Link to={`/review/${item.puzzle.gameId}`} className="mt-2 inline-block text-sm font-bold text-go hover:text-go-hover">Ver na partida</Link>
          )}
        </div>

        <div className="flex gap-2">
          {done ? (
            <button type="button" className="btn-go flex flex-1 items-center justify-center gap-2 text-[17px]" onClick={onNext} autoFocus>
              {index + 1 < items.length ? 'Próximo' : 'Ver resumo'} <ChevronRight size={20} />
            </button>
          ) : (
            <>
              <button type="button" className="btn-flat flex flex-1 items-center justify-center gap-2" onClick={() => setHint((h) => h + 1)}>
                <Lightbulb size={16} /> Dica
              </button>
              <button type="button" className="btn-flat flex flex-1 items-center justify-center gap-2" onClick={() => setSolution((s) => s + 1)}>
                <Eye size={16} /> Solução
              </button>
            </>
          )}
        </div>
        {onlyMine && <p className="text-xs text-ink-4">Modo "só os meus erros": não altera o rating.</p>}
      </aside>
    </div>
  );
}

function SessionSummary({ played, rating, onExit }: { played: Played[]; rating: number; onExit: () => void }) {
  const solved = played.filter((p) => p.solved).length;
  const delta = played.reduce((s, p) => s + p.delta, 0);
  const failedThemes = new Map<string, number>();
  for (const p of played) if (!p.solved && p.item.theme) failedThemes.set(p.item.theme, (failedThemes.get(p.item.theme) ?? 0) + 1);
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
        <button type="button" className="btn-go mt-5 w-full" onClick={onExit}>Voltar</button>
      </Panel>
    </div>
  );
}
