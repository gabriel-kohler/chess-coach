// Treinar and Aquecer: one session, every exercise in a row, from one button.
// The session is stored as you go, so leaving and coming back picks it up
// where you stopped; a step already done opens again as free practice.
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { StepView } from '@/components/training/StepView';
import { TrainingHeader } from '@/components/training/TrainingHeader';
import { TrainingSummary } from '@/components/training/TrainingSummary';
import { POSITIONS } from '@/lib/positions/config';
import type { CompiledRepertoire } from '@/lib/repertoire/data';
import type { GamesIndex } from '@/lib/repertoire/games';
import { loadOpeningsData } from '@/lib/repertoire/openingsData';
import type { Times } from '@/lib/training/compose';
import { goTo, nextStep, recordResult, skipStep } from '@/lib/training/session';
import type { DeckView } from '@/lib/decks/views';
import { loadStudyDecks, loadTimes } from '@/lib/training/sources';
import { extendDaily, openTraining, reconcileSession, updateSession } from '@/lib/training/store';
import type { StepResult, TrainingMode, TrainingSession } from '@/lib/training/types';
import type { Color } from '@/lib/types';
import type { State } from 'ts-fsrs';

interface Visit {
  n: number;
  /** The step was done before this visit: free practice, nothing saved. */
  practice: boolean;
  since: number;
}

const visitOf = (s: TrainingSession, n: number): Visit => {
  const step = s.steps[s.at];
  return { n, practice: !!step && (step.status === 'done' || !!step.practice), since: Date.now() };
};

export default function Training({ mode }: { mode: TrainingMode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visit, setVisit] = useState<Visit>({ n: 0, practice: false, since: Date.now() });
  const [times, setTimes] = useState<Times | null>(null);
  const [openings, setOpenings] = useState<{ rep: CompiledRepertoire; index: Record<Color, GamesIndex>; study: DeckView[] } | null | undefined>(undefined);
  const [extending, setExtending] = useState(false);

  useEffect(() => {
    let alive = true;
    setSession(null);
    setError(null);
    openTraining(mode).then(
      (s) => {
        if (!alive) return;
        setSession(s);
        setVisit((v) => visitOf(s, v.n + 1));
      },
      (e: Error) => alive && setError(e.message),
    );
    loadTimes().then(
      (t) => alive && setTimes(t),
      (e: Error) => alive && setError(e.message),
    );
    Promise.all([loadOpeningsData(), loadStudyDecks().catch(() => [])]).then(
      ([d, study]) => alive && setOpenings(d ? { rep: d.rep, index: d.data.index, study } : null),
      () => alive && setOpenings(null),
    );
    return () => {
      alive = false;
    };
  }, [mode]);

  /** A change that moves you to another step: the new step is checked against the database first. */
  const move = useCallback((change: (s: TrainingSession) => TrainingSession) => {
    void updateSession(mode, async (s) => {
      const moved = change(s);
      const step = moved.steps[moved.at];
      return step ? reconcileSession(moved, step.id) : moved;
    }).then((s) => {
      if (!s) return;
      setSession(s);
      setVisit((v) => visitOf(s, v.n + 1));
    });
  }, [mode]);

  const onGraded = useCallback((stepId: string, result: StepResult, next?: { state: State; due: number } | null) => {
    void updateSession(mode, (s) => recordResult(s, stepId, result, next ?? null)).then((s) => s && setSession(s));
  }, [mode]);
  const onGone = useCallback((stepId: string, note: string) => {
    void updateSession(mode, (s) => skipStep(s, stepId, note)).then((s) => s && setSession(s));
  }, [mode]);
  const since = useRef(visit.since);
  since.current = visit.since;
  const onNext = useCallback(() => move((s) => {
    const now = Date.now();
    // A step planned as free practice (a reminder not due) has no grade to wait for: seen is done.
    const cur = s.steps[s.at];
    const seen = cur && cur.status === 'pending' && cur.practice ? recordResult(s, cur.id, { at: now, ms: now - since.current, outcome: 'good', label: 'Visto em treino livre' }) : s;
    return nextStep(seen, now, POSITIONS.learnAheadMs);
  }), [move]);
  const onGo = useCallback((index: number) => move((s) => goTo(s, index)), [move]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <p className="text-cls-blunder">Não consegui montar a sessão: {error}</p>
        <Link to="/" className="mt-4 inline-block font-medium text-ink underline decoration-ink-4 underline-offset-4 hover:decoration-ink">Voltar para a Início</Link>
      </div>
    );
  }
  if (!session || !times) {
    return (
      <div className="flex items-center gap-3 p-8 text-ink-3">
        <Loader2 className="animate-spin" size={20} /> {mode === 'daily' ? 'Montando o treino do dia...' : 'Montando o aquecimento...'}
      </div>
    );
  }

  const step = session.steps[session.at];
  if (!step) {
    return (
      <TrainingSummary
        session={session}
        onGo={onGo}
        extending={extending}
        {...(mode === 'daily'
          ? {
              onMore: () => {
                setExtending(true);
                void extendDaily()
                  .then((s) => {
                    if (!s) return;
                    setSession(s);
                    setVisit((v) => visitOf(s, v.n + 1));
                  })
                  .finally(() => setExtending(false));
              },
            }
          : {})}
      />
    );
  }

  // Skipping is for a step still to do; one with a grade already stays done.
  const canSkip = step.status === 'pending' && !visit.practice;
  const header = (
    <TrainingHeader
      session={session}
      practice={visit.practice}
      onGo={onGo}
      onExit={() => navigate('/')}
      {...(canSkip ? { onSkip: () => move((s) => nextStep(skipStep(s, step.id), Date.now(), POSITIONS.learnAheadMs)) } : {})}
    />
  );
  return (
    <StepView
      key={`${step.id}:${visit.n}`}
      session={session}
      step={step}
      practice={visit.practice}
      header={header}
      times={times}
      openings={openings}
      since={visit.since}
      onGraded={onGraded}
      onGone={onGone}
      onNext={onNext}
    />
  );
}
