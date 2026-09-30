// One sequence: your move at the position, the opponent's human answer, your
// continuation... Each of your moves is graded like the best-move mode (first
// attempt only); the sequence takes the grade of its worst move and is saved
// once, at the end.
import clsx from 'clsx';
import { Chess } from 'chess.js';
import { Eye, Lightbulb, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Rating, State, type Grade } from 'ts-fsrs';
import { playSound, soundForSan } from '@/components/board/assets';
import { Board } from '@/components/board/Board';
import { LineControls } from '@/components/board/LineControls';
import { lineFrom, useLineExplorer } from '@/components/board/useLineExplorer';
import { RichText, San } from '@/components/San';
import { tryUci } from '@/lib/chess/replay';
import { dueLabel, plural } from '@/lib/format';
import type { FirstAttempt } from '@/lib/positions/attempt';
import { POSITIONS } from '@/lib/positions/config';
import { bucketOf, GRADE_LABEL } from '@/lib/positions/grade';
import type { SeqEnd } from '@/lib/positions/sequence';
import { cacheEngineScore, recordReview } from '@/lib/positions/store';
import type { ScoreTarget, SequenceCard } from '@/lib/positions/types';
import { ruleFor } from '@/lib/srs/fsrs';
import type { Bucket, FsrsFields } from '@/lib/srs/types';
import { GRADE_STYLE } from './VerdictPanel';
import { useMoveAttempt } from './useMoveAttempt';

interface StepResult {
  rating: Grade;
  first: FirstAttempt;
  hint: boolean;
  tries: number;
  solved: boolean;
  /** The last move tried, on the board when the step ended. */
  lastUci: string | null;
}

const pct = (x: number) => `${Math.round(x)}%`;

export function endText(end: SeqEnd, lastSan: string): string {
  switch (end.kind) {
    case 'mate':
      return `Mate com ${lastSan}.`;
    case 'material':
      return `Ganho de material: você termina com ${plural(Math.round(end.points ?? 1), 'ponto', 'pontos')} a mais.`;
    case 'promotion':
      return 'O peão promove.';
    case 'perpetual':
      return 'Xeque perpétuo: empate garantido.';
    case 'advantage':
      return `Vantagem conquistada: de ${pct(end.winStart)} para ${pct(end.winEnd)}, e ela se mantém contra a melhor defesa.`;
    case 'kept':
      return end.winEnd >= 60 ? `Vantagem mantida (${pct(end.winEnd)}).` : `Posição mantida (${pct(end.winEnd)}).`;
  }
}

/** Your positions in the line: the card's own, then one after each human answer. */
export function stepsOf(card: SequenceCard): ScoreTarget[] {
  const { branch } = card;
  const root: ScoreTarget = { fen: card.fen, color: card.color, prevMove: card.prevMove, best: card.best, second: card.second, sources: card.sources, scored: card.scored };
  return [
    root,
    ...branch.nodes.map((n, i) => {
      const r = branch.replies[i]!;
      return { fen: n.fen, color: card.color, prevMove: { from: r.uci.slice(0, 2), to: r.uci.slice(2, 4) }, best: n.best, second: n.second };
    }),
  ];
}

const worst = (rs: StepResult[]): Grade => rs.reduce<Grade>((w, r) => (r.rating < w ? r.rating : w), Rating.Easy);

export function SequenceRound({ card, expected, header: sessionHeader, attemptId: fixedAttemptId, practice = false, done = 0, left = 0, from = 'queue', onSaved, onNext, onExit }: {
  card: SequenceCard;
  expected: Record<Bucket, number>;
  /** Replaces the Posições header (a training session has its own). */
  header?: React.ReactNode;
  /** Fixed by a training session, so saving the same step twice counts once. */
  attemptId?: string;
  /** Free practice: nothing is saved. */
  practice?: boolean;
  done?: number;
  left?: number;
  from?: 'learning' | 'queue' | 'ahead';
  onSaved?: (next: FsrsFields, rating: Grade, timeMs: number) => void;
  onNext: () => void;
  onExit?: () => void;
}) {
  const steps = useMemo(() => stepsOf(card), [card]);
  const [step, setStep] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  // Between your moves the board plays itself: the main move, then the answer.
  const [auto, setAuto] = useState<{ fen: string; lastMove: { from: string; to: string }; text: string | null } | null>(null);
  const [saved, setSaved] = useState<FsrsFields | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const alive = useRef(true);
  const attemptId = useRef(fixedAttemptId ?? `${card.id}|${Date.now()}|${Math.random().toString(36).slice(2)}`);
  // Set on every mount: React's development double-mount runs the cleanup once.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const finished = results.length === steps.length;

  const onStepDone = (r: StepResult) => {
    const target = steps[step]!;
    const all = [...results, r];
    setResults(all);
    const isLast = step === steps.length - 1;
    const afterBest = new Chess(target.fen);
    const mv = tryUci(afterBest, target.best.uci)!;
    const reply = card.branch.replies[step];
    // The main move is already on the board when you found it, first try or after a retry.
    const exact = (r.first.exact && !r.first.gaveUp) || (r.solved && r.lastUci === target.best.uci);
    const text = exact ? null : r.first.gaveUp ? `O lance era ${target.best.san}.` : `O treino segue com ${target.best.san}.`;
    // The last move decides the grade: save now, the animation is only for the eyes.
    if (isLast) save(all);
    // Show the main move (after a short pause when it was not yours), then the answer.
    const pause = exact ? 150 : 1400;
    setTimeout(() => {
      if (!alive.current) return;
      if (!exact) playSound(soundForSan(mv.san, !!mv.captured));
      setAuto({ fen: afterBest.fen(), lastMove: { from: mv.from, to: mv.to }, text });
      if (isLast || !reply) return;
      setTimeout(() => {
        if (!alive.current) return;
        const c = new Chess(afterBest.fen());
        const rm = tryUci(c, reply.uci);
        if (!rm) return;
        playSound(soundForSan(rm.san, !!rm.captured));
        setAuto({ fen: c.fen(), lastMove: { from: rm.from, to: rm.to }, text: null });
        setTimeout(() => {
          if (!alive.current) return;
          setAuto(null);
          setStep((s) => s + 1);
        }, 450);
      }, 550);
    }, pause);
  };

  const save = (all: StepResult[]) => {
    if (practice) return;
    const rating = worst(all);
    const firsts = all.map((r) => r.first);
    const losses = firsts.map((f) => f.loss);
    const known = losses.filter((l): l is number => l !== null);
    const timeMs = firsts.reduce((s, f) => s + f.timeMs, 0);
    const correct = firsts.every((f) => !f.gaveUp && f.loss !== null && f.loss <= POSITIONS.goodLoss);
    void recordReview({
      attemptId: attemptId.current,
      cardId: card.id,
      at: Date.now(),
      grade: rating,
      signals: {
        uci: firsts[0]?.uci ?? null,
        loss: known.length === losses.length ? Math.max(...known) : null,
        lossSource: firsts[0]?.score?.source ?? null,
        exact: firsts.every((f) => f.exact),
        correct,
        timeMs,
        hiddenMs: 0,
        expectedMs: steps.reduce((s, _t, i) => s + expected[i === 0 ? card.bucket : bucketOf((card.branch.nodes[i - 1]?.stableFrom) ?? null)], 0),
        bucket: card.bucket,
        gaveUp: firsts.some((f) => f.gaveUp),
      },
      steps: all.map((r) => ({ uci: r.first.uci, loss: r.first.loss, exact: r.first.exact, timeMs: r.first.timeMs, rating: r.rating })),
      outcome: { hintUsed: all.some((r) => r.hint), tries: all.reduce((s, r) => s + r.tries, 0), solved: all.every((r) => r.solved) },
    }).then((r) => {
      // The session hears it even after you moved on: the grade belongs to this step.
      onSaved?.(r.next, rating, timeMs);
      if (alive.current) setSaved(r.next);
    }, () => alive.current && setSaveFailed(true));
  };

  const target = steps[Math.min(step, steps.length - 1)]!;
  // Once the line is over: walk it back and forth, or try other moves anywhere in it.
  const played = useMemo(() => lineFrom(card.fen, card.branch.moves), [card]);
  const explorer = useLineExplorer({ start: card.fen, line: played, enabled: finished, initialPly: played.length, startLastMove: card.prevMove });
  const label = from === 'queue' ? (card.state === State.New ? 'Nova' : 'Revisão') : card.state === State.Relearning ? 'Reaprendendo' : 'Aprendendo';
  const header = sessionHeader ?? (
    <div className="flex items-center justify-between rounded-lg bg-panel px-4 py-3 text-sm">
      <span className="font-bold text-ink-3">{label} · {plural(done, 'feita', 'feitas')} · {plural(left, 'restante', 'restantes')}</span>
      <button type="button" onClick={onExit} className="text-ink-3 hover:text-ink">Sair</button>
    </div>
  );

  if (finished) {
    return (
      <Layout board={<Board fen={explorer.fen} orientation={card.color} lastMove={explorer.lastMove} movable="both" onMove={explorer.onMove} arrows={explorer.arrows} />}>
        {header}
        <SequenceVerdict card={card} results={results} next={saved} saveFailed={saveFailed} practice={practice} onNext={onNext}>
          {saveFailed && <p className="text-sm text-cls-blunder">Não deu para salvar a nota desta posição.</p>}
          <LineControls explorer={explorer} title="A linha" />
        </SequenceVerdict>
      </Layout>
    );
  }

  if (auto) {
    return (
      <Layout board={<Board fen={auto.fen} orientation={card.color} lastMove={auto.lastMove} movable={null} />}>
        {header}
        <Progress card={card} step={step} total={steps.length} results={results} />
        {auto.text && <div className="rounded-lg bg-panel p-4 text-[15px] font-bold text-ink"><RichText text={auto.text} /></div>}
      </Layout>
    );
  }

  return (
    <StepAttempt
      key={step}
      target={target}
      expectedMs={expected[step === 0 ? card.bucket : bucketOf(card.branch.nodes[step - 1]?.stableFrom ?? null)]}
      onScored={step === 0 ? (s) => void cacheEngineScore(card.id, s) : undefined}
      onDone={onStepDone}
    >
      {header}
      <Progress card={card} step={step} total={steps.length} results={results} />
    </StepAttempt>
  );
}

function Layout({ board, children }: { board: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 40px)' }}>{board}</div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]">{children}</aside>
    </div>
  );
}

function Progress({ card, step, total, results }: { card: SequenceCard; step: number; total: number; results: StepResult[] }) {
  const reply = step > 0 ? card.branch.replies[step - 1] : null;
  const first = card.branch.reply;
  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold text-ink">Lance {Math.min(step + 1, total)} de {total}</span>
        <span className="flex gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={clsx('h-2 w-6 rounded-full', results[i] ? (results[i]!.rating === Rating.Again ? 'bg-cls-blunder' : results[i]!.rating === Rating.Hard ? 'bg-cls-inaccuracy' : 'bg-go') : i === step ? 'bg-ink-3' : 'bg-raise')} />
          ))}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {step === 0 ? (
          <>Ache o melhor lance. Depois o adversário responde como alguém do seu nível: esta linha é a resposta <San san={first.san} className="font-bold text-ink" /> ({pct(first.p * 100)} dos jogadores).</>
        ) : reply ? (
          <>O adversário jogou <San san={reply.san} className="font-bold text-ink" /> ({pct(reply.p * 100)} dos jogadores). Ache a continuação.</>
        ) : null}
      </p>
    </div>
  );
}

function StepAttempt({ target, expectedMs, onScored, onDone, children }: {
  target: ScoreTarget;
  expectedMs: number;
  onScored?: (s: import('@/lib/positions/types').MoveScore) => void;
  onDone: (r: StepResult) => void;
  children: React.ReactNode;
}) {
  const { state, onMove, giveUp, hint, board } = useMoveAttempt(target, expectedMs, { onScored, rule: ruleFor('seq') });
  const reported = useRef(false);
  useEffect(() => {
    if (state.phase !== 'verdict' || !state.first || !state.rating || reported.current) return;
    reported.current = true;
    onDone({ rating: state.rating, first: state.first, hint: state.hint, tries: state.tries, solved: state.solved, lastUci: state.last?.uci ?? null });
  }, [state.phase]);

  const white = target.color === 'white';
  return (
    <Layout board={<Board fen={board.fen} orientation={target.color} lastMove={board.lastMove} movable={board.movable} onMove={onMove} tints={board.tints} arrows={board.arrows} badge={board.badge} />}>
      {children}
      <div className={clsx('rounded-lg p-4', state.phase === 'wrong' ? 'bg-bad-soft' : state.phase === 'verdict' ? 'bg-ok-soft' : 'bg-panel')}>
        <span className="flex items-center gap-2 text-[17px] font-extrabold">
          <span className={clsx('h-4 w-4 rounded-sm border border-ink-4', white ? 'bg-white' : 'bg-[#0a0a0a]')} />
          {white ? 'Brancas jogam' : 'Pretas jogam'}
        </span>
        <p className="mt-3 text-[15px] font-bold text-ink">
          {state.phase === 'checking' ? (
            <span className="flex items-center gap-2 text-ink-2"><Loader2 size={16} className="animate-spin" /> Conferindo com o motor...</span>
          ) : state.phase === 'wrong' && state.last ? (
            <span className="flex items-center gap-2 text-cls-miss"><X size={18} strokeWidth={3} /> <span><San san={state.last.san} /> não é o melhor aqui.</span></span>
          ) : state.phase === 'verdict' && state.first ? (
            state.first.exact ? (
              <span className="text-go-hover">Isso.</span>
            ) : state.first.gaveUp ? (
              'Resposta:'
            ) : state.rating === Rating.Again ? (
              <span className="text-go-hover">Agora sim. A nota fica pelo primeiro lance.</span>
            ) : (
              <span className={state.rating === Rating.Hard ? 'text-cls-inaccuracy' : 'text-go-hover'}>Serve.</span>
            )
          ) : state.first ? (
            'Tente de novo.'
          ) : (
            'Sua vez.'
          )}
        </p>
        {state.message && <p className="mt-2 text-sm text-ink-2">{state.message}</p>}
      </div>
      {state.phase !== 'verdict' && (
        <div className="flex gap-2">
          {state.first && (
            <button type="button" className="btn-flat flex flex-1 items-center justify-center gap-2" onClick={hint} disabled={state.hint || state.phase !== 'playing'}>
              <Lightbulb size={16} /> Dica
            </button>
          )}
          <button type="button" className="btn-flat flex flex-1 items-center justify-center gap-2" onClick={giveUp} disabled={state.phase !== 'playing' && state.phase !== 'wrong'}>
            <Eye size={16} /> {state.first ? 'Ver resposta' : 'Não sei'}
          </button>
        </div>
      )}
    </Layout>
  );
}

function SequenceVerdict({ card, results, next, saveFailed, practice, onNext, children }: { card: SequenceCard; results: StepResult[]; next: FsrsFields | null; saveFailed: boolean; practice: boolean; onNext: () => void; children?: React.ReactNode }) {
  const rating = worst(results);
  const lastSan = card.branch.nodes.at(-1)?.best.san ?? card.best.san;
  const ready = practice || !!next || saveFailed;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="rounded-lg bg-panel p-4">
        <span className={clsx('rounded px-2 py-0.5 text-[13px] font-extrabold uppercase tracking-wide', GRADE_STYLE[rating])}>{GRADE_LABEL[rating]}</span>
        <p className="mt-2 text-[15px] font-bold leading-snug text-ink"><RichText text={endText(card.branch.end, lastSan)} /></p>
        <p className="mt-1 text-sm text-ink-3">{practice ? 'Treino livre: não conta para a revisão.' : 'A sequência leva a nota do seu pior lance.'}</p>
      </div>
      {children}
      <div className="rounded-md bg-black/20 p-2.5 text-[13px] leading-relaxed">
        <div className="font-bold text-go-hover">Seus lances:</div>
        <ul className="mt-2 space-y-1">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-ink-3">
              <span className={clsx('w-16 rounded px-1.5 py-0.5 text-center text-[11px] font-extrabold uppercase', GRADE_STYLE[r.rating])}>{GRADE_LABEL[r.rating]}</span>
              Lance {i + 1}: {r.first.gaveUp ? 'pediu a resposta' : r.first.uci ? <San san={r.first.san ?? ''} className="font-bold text-ink" /> : null}
              {r.first.loss !== null && r.first.loss >= 0.5 && <span>({plural(Math.round(r.first.loss), 'ponto', 'pontos')})</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-panel px-4 py-3 text-sm text-ink-3">
        <span>{plural(card.branch.moves.length, 'lance', 'lances')} na linha</span>
        {next && <span>Volta {dueLabel(next.due)}</span>}
      </div>
      <button type="button" className="btn-go text-[17px]" onClick={onNext} disabled={!ready} autoFocus>
        {ready ? 'Próxima' : 'Salvando...'}
      </button>
    </div>
  );
}
