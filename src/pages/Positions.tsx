// Position trainer: positions from your analysed games where your move lost
// 5+ win-chance points. Two modes, scheduled with FSRS: the best move, and
// the sequence against the answers people at your level really play.
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListChecks, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { State, type Grade } from 'ts-fsrs';
import { PageHeader, Panel } from '@/components/Layout';
import { FocusPanel } from '@/components/positions/FocusPanel';
import { MemoryPanel } from '@/components/positions/MemoryPanel';
import { Round } from '@/components/positions/Round';
import { SequenceRound } from '@/components/positions/SequenceRound';
import { GRADE_STYLE } from '@/components/positions/VerdictPanel';
import { db } from '@/lib/db';
import { factsEngine } from '@/lib/engine/stockfish';
import { plural } from '@/lib/format';
import { CALIBRATION_KEY, type Calibration } from '@/lib/maia/calibrate';
import { maiaAvailable } from '@/lib/maia/client';
import { POSITIONS } from '@/lib/positions/config';
import { GRADE_LABEL } from '@/lib/positions/grade';
import { ensureCalibration, ensureSequences } from '@/lib/positions/seqStore';
import { usePositionsSettings, type PositionsSettings } from '@/lib/positions/settings';
import { loadDailyQueue, loadExpectedTimes, positionsTodayCounts } from '@/lib/positions/store';
import type { BestMoveCard, PositionKind, SequenceCard } from '@/lib/positions/types';
import { saveSettings, useSettings } from '@/lib/settings';
import { pickNext } from '@/lib/srs/queue';
import type { Bucket, FsrsFields } from '@/lib/srs/types';
import { PeriodFilter, PeriodNote } from '@/components/positions/PeriodFilter';

type PositionCard = BestMoveCard | SequenceCard;

interface Session {
  mode: PositionKind;
  queue: PositionCard[];
  learning: Map<string, PositionCard>;
  lastId: string | null;
  current: { card: PositionCard; from: 'learning' | 'queue' | 'ahead'; nonce: number } | null;
  results: Array<{ cardId: string; rating: Grade }>;
  times: Record<Bucket, number>;
  over: boolean;
}

function advance(s: Session): Session {
  const pick = pickNext({ queue: s.queue, learning: s.learning, lastId: s.lastId }, Date.now(), POSITIONS.learnAheadMs);
  if (!pick) return { ...s, current: null, over: true };
  return {
    ...s,
    queue: pick.from === 'queue' ? s.queue.slice(1) : s.queue,
    current: { card: pick.card, from: pick.from, nonce: (s.current?.nonce ?? 0) + 1 },
  };
}

const MODE_KEY = 'positions:mode';

export default function Positions() {
  const limits = usePositionsSettings();
  const settings = useSettings();
  const period = settings.minePeriod;
  const [params] = useSearchParams();
  const [mode, setModeState] = useState<PositionKind>(() => {
    // The "only my mistakes" shortcut from Tactics opens the best-move mode.
    const asked = params.get('mode');
    if (asked === 'best' || asked === 'seq') return asked;
    try {
      return localStorage.getItem(MODE_KEY) === 'seq' ? 'seq' : 'best';
    } catch {
      return 'best';
    }
  });
  const setMode = (m: PositionKind) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode: the tab just resets */
    }
  };
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(false);

  // The cards follow the analyses without this page: the queue syncs them after each game, the renewal pipeline after each sync.
  const start = async (kind: PositionKind) => {
    setStarting(true);
    factsEngine(); // warm the engine while the queue loads
    const [q, times] = await Promise.all([loadDailyQueue(kind, limits, Date.now(), period), loadExpectedTimes('best')]);
    setStarting(false);
    const queue: PositionCard[] = [...q.reviews, ...q.news];
    setSession(advance({ mode: kind, queue, learning: new Map(q.learning.map((c) => [c.id, c as PositionCard])), lastId: null, current: null, results: [], times, over: false }));
  };

  const onSaved = useCallback((card: PositionCard, next: FsrsFields, rating: Grade) => {
    setSession((s) => {
      if (!s) return s;
      const learning = new Map(s.learning);
      if (next.state === State.Learning || next.state === State.Relearning) learning.set(card.id, { ...card, ...next });
      else learning.delete(card.id);
      return { ...s, learning, lastId: card.id, results: [...s.results, { cardId: card.id, rating }] };
    });
  }, []);

  if (session && !session.over && session.current) {
    const { card, nonce, from } = session.current;
    const common = {
      done: session.results.length,
      left: session.queue.length + session.learning.size,
      from,
      onNext: () => setSession((s) => (s ? advance(s) : s)),
      onExit: () => setSession((s) => (s ? { ...s, over: true } : s)),
    };
    if (card.kind === 'seq') {
      return <SequenceRound key={`${card.id}:${nonce}`} card={card} expected={session.times} onSaved={(next, rating) => onSaved(card, next, rating)} {...common} />;
    }
    return <Round key={`${card.id}:${nonce}`} card={card} expectedMs={session.times[card.bucket]} onSaved={(r, rating) => onSaved(card, r.next, rating)} {...common} />;
  }

  if (session?.over) return <Summary results={session.results} onBack={() => setSession(null)} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader title="Posições" icon={ListChecks}>
        <div className="flex rounded-lg bg-panel p-1 text-sm font-bold" role="tablist" aria-label="Modo de treino">
          {(['best', 'seq'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={clsx('rounded-md px-4 py-1.5', mode === m ? 'bg-raise text-ink' : 'text-ink-3 hover:text-ink')}
            >
              {m === 'best' ? 'Melhor lance' : 'Sequência'}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <div className="flex flex-col gap-4">
          {mode === 'best' ? (
            <BestPanel limits={limits} period={period} onPeriod={(d) => void saveSettings({ minePeriod: d }, settings)} starting={starting} onStart={() => void start('best')} />
          ) : (
            <SequencePanel limits={limits} period={period} onPeriod={(d) => void saveSettings({ minePeriod: d }, settings)} starting={starting} onStart={() => void start('seq')} />
          )}
          <GradesPanel mode={mode} />
          <MemoryPanel kind={mode} />
        </div>
        <FocusPanel />
      </div>
    </div>
  );
}

function TodayTiles({ reviews, news }: { reviews: number | undefined; news: number | undefined }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 text-center">
      <div className="rounded-md bg-panel-2 p-3"><div className="text-3xl font-extrabold tabular-nums">{reviews ?? '-'}</div><div className="text-sm text-ink-3">para revisar</div></div>
      <div className="rounded-md bg-panel-2 p-3"><div className="text-3xl font-extrabold tabular-nums">{news ?? '-'}</div><div className="text-sm text-ink-3">novas hoje</div></div>
    </div>
  );
}

interface ModePanelProps {
  limits: PositionsSettings;
  period: number;
  onPeriod: (days: number) => void;
  starting: boolean;
  onStart: () => void;
}

function BestPanel({ limits, period, onPeriod, starting, onStart }: ModePanelProps) {
  const counts = useLiveQuery(() => positionsTodayCounts('best', limits, Date.now(), period), [limits.newPerDay, limits.maxReviewsPerDay, period]);
  const base = useLiveQuery(async () => {
    const cards = await db.srsCards.where('kind').equals('best').filter((c) => !c.suspended).toArray();
    return { total: cards.length, learned: cards.filter((c) => c.state === State.Review).length, fresh: cards.filter((c) => c.state === State.New).length };
  }, []);
  const nothing = !counts || counts.reviews + counts.news === 0;
  return (
    <Panel title="Melhor lance">
      {base && base.total === 0 ? (
        <p className="text-sm text-ink-2">
          Cada partida analisada vira posições dos lances em que você perdeu 5 pontos ou mais de chance de vitória.{' '}
          <Link to="/games" className="font-bold text-go hover:text-go-hover">Analisar partidas</Link>
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-2">Posições das suas partidas em que você errou. Ache o lance que faltou; a nota vale pelo primeiro lance.</p>
          <PeriodFilter value={period} onChange={onPeriod} className="mt-3" />
          <TodayTiles reviews={counts?.reviews} news={counts?.news} />
          <PeriodNote counts={counts} period={period} className="mt-3" />
          <button type="button" className="btn-go mt-4 w-full text-[17px]" disabled={starting || nothing} onClick={onStart}>
            {starting ? 'Preparando...' : counts && nothing ? 'Tudo feito por hoje' : 'Começar'}
          </button>
          {base && (
            <p className="mt-3 text-xs text-ink-4">
              {plural(base.total, 'posição', 'posições')} na sua base · {plural(base.learned, 'aprendida')} · {plural(base.fresh, 'ainda nova', 'ainda novas')} · {plural(counts?.doneToday ?? 0, 'tentativa hoje', 'tentativas hoje')}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

type Prep = { phase: 'checking' | 'missing' | 'calibrating' | 'building' | 'ready'; done: number; total: number };

function SequencePanel({ limits, period, onPeriod, starting, onStart }: ModePanelProps) {
  const counts = useLiveQuery(() => positionsTodayCounts('seq', limits, Date.now(), period), [limits.seqNewPerDay, limits.seqMaxReviewsPerDay, period]);
  const calibration = useLiveQuery(async () => ((await db.kv.get(CALIBRATION_KEY))?.value as Calibration | undefined) ?? null, []);
  const [prep, setPrep] = useState<Prep>({ phase: 'checking', done: 0, total: 0 });

  // Calibrate Maia once, then build sequences ahead for the positions that matter most.
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await maiaAvailable())) return alive && setPrep({ phase: 'missing', done: 0, total: 0 });
      if (alive) setPrep({ phase: 'calibrating', done: 0, total: 1 });
      await ensureCalibration((done, total) => alive && setPrep({ phase: 'calibrating', done, total })).catch(() => null);
      if (alive) setPrep({ phase: 'building', done: 0, total: 0 });
      await ensureSequences(limits, (p) => alive && setPrep({ phase: 'building', ...p })).catch(() => null);
      if (alive) setPrep({ phase: 'ready', done: 0, total: 0 });
    })();
    return () => {
      alive = false;
    };
  }, [limits.seqNewPerDay]);

  const nothing = !counts || counts.reviews + counts.news === 0;
  const top3 = calibration ? calibration.results.find((r) => r.offset === calibration.offset)?.top3 : undefined;
  return (
    <Panel title="Sequência">
      {prep.phase === 'missing' ? (
        <p className="text-sm text-ink-2">
          O modo Sequência usa o Maia-2, que prevê o lance de um humano do seu nível. Instale o modelo uma vez (85 MB) com <code className="rounded bg-raise px-1.5 py-0.5 text-ink">npm run setup:maia</code> e recarregue a página.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-2">Você acha o melhor lance e o adversário responde com um dos lances que jogadores do seu nível mais jogam. Cada resposta é uma linha própria, até a vantagem se concretizar.</p>
          <PeriodFilter value={period} onChange={onPeriod} className="mt-3" />
          <TodayTiles reviews={counts?.reviews} news={counts?.news} />
          <PeriodNote counts={counts} period={period} className="mt-3" />
          <button type="button" className="btn-go mt-4 w-full text-[17px]" disabled={starting || nothing} onClick={onStart}>
            {starting ? 'Preparando...' : counts && nothing ? (prep.phase === 'ready' ? 'Tudo feito por hoje' : 'Preparando sequências...') : 'Começar'}
          </button>
          <p className="mt-3 flex items-center gap-2 text-xs text-ink-4">
            {(prep.phase === 'calibrating' || prep.phase === 'building' || prep.phase === 'checking') && <Loader2 size={12} className="animate-spin" />}
            {prep.phase === 'calibrating' && `Calibrando o Maia com as suas partidas: ${prep.total ? Math.round((prep.done / prep.total) * 100) : 0}%`}
            {prep.phase === 'building' && (prep.total ? `Montando sequências: ${prep.done} de ${plural(prep.total, 'posição', 'posições')}` : 'Procurando posições para montar sequências...')}
            {prep.phase === 'ready' && top3 !== undefined && `Nas suas partidas, o lance real do adversário está entre os 3 que o Maia prevê em ${Math.round(top3 * 100)}% das vezes.`}
          </p>
        </>
      )}
    </Panel>
  );
}

function GradesPanel({ mode }: { mode: PositionKind }) {
  return (
    <Panel title="Como a nota funciona">
      <ul className="space-y-2 text-sm text-ink-2">
        <li><b className="text-cls-brilliant">Fácil</b>: o lance exato do motor, em menos da metade do seu tempo normal.</li>
        <li><b className="text-go-hover">Bom</b>: perdeu até 2 pontos de chance, no seu tempo normal.</li>
        <li><b className="text-cls-inaccuracy">Difícil</b>: um lance que serve (2 a 5 pontos), ou certo mas com mais que o dobro do tempo.</li>
        <li><b className="text-cls-miss">Errei</b>: o primeiro lance perdeu mais de 5 pontos. A posição volta em poucos minutos.</li>
      </ul>
      <p className="mt-3 text-xs text-ink-4">
        {mode === 'seq' ? 'Na sequência cada lance seu tem nota, e a linha leva a nota do pior. ' : ''}
        O tempo esperado é o seu: a mediana dos seus acertos em posições de dificuldade parecida. O relógio não aparece durante a tentativa.
      </p>
    </Panel>
  );
}

function Summary({ results, onBack }: { results: Array<{ cardId: string; rating: Grade }>; onBack: () => void }) {
  const by = (g: Grade) => results.filter((r) => r.rating === g).length;
  const grades = [4, 3, 2, 1] as Grade[];
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Panel>
        <h2 className="text-2xl font-extrabold">Sessão concluída</h2>
        <p className="mt-1 text-sm text-ink-3">{plural(results.length, 'tentativa', 'tentativas')}. As posições voltam no dia em que você estiver perto de esquecê-las.</p>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {grades.map((g) => (
            <div key={g} className="rounded-md bg-panel-2 p-3">
              <div className="text-2xl font-extrabold tabular-nums">{by(g)}</div>
              <div className={clsx('mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase', GRADE_STYLE[g])}>{GRADE_LABEL[g]}</div>
            </div>
          ))}
        </div>
        <button type="button" className="btn-go mt-5 w-full" onClick={onBack} autoFocus>Voltar</button>
      </Panel>
    </div>
  );
}
