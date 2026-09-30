// One puzzle with its side panel: the board, what happened, hint and
// solution, and once it is over, the solution to walk and your own moves to
// try; a punishment also its line to the end, on request. Mount it once per
// puzzle shown (key it): the Tactics session, the training sessions and a
// deck's Punir use it, each with its own header.
import clsx from 'clsx';
import { Check, ChevronRight, Eye, Lightbulb, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LineControls } from '@/components/board/LineControls';
import { lineFrom, useLineExplorer } from '@/components/board/useLineExplorer';
import { GRADE_STYLE } from '@/components/positions/VerdictPanel';
import { dueLabel } from '@/lib/format';
import { GRADE_LABEL } from '@/lib/positions/grade';
import { themeLabel } from '@/lib/tactics/themes';
import type { AttemptOutcome, SessionItem } from '@/lib/tactics/trainer';
import { PunishWhyPanel, usePunishWhy } from './PunishWhy';
import { PuzzlePlayer, type PuzzleFeedback } from './PuzzlePlayer';

const NOT_MOTIFS = ['short', 'long', 'veryLong', 'oneMove', 'middlegame', 'endgame', 'opening', 'crushing', 'advantage'];

export interface PuzzleOutcome {
  delta: number;
  rating: number;
  review: AttemptOutcome['review'];
}

/** A page of its own: the board as tall as the window. */
function PageFrame(board: React.ReactNode, panel: React.ReactNode) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 40px)' }}>{board}</div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]">{panel}</aside>
    </div>
  );
}

export function PuzzleExercise({ item, header, frame = PageFrame, practice = false, outcome, onResult, onNext, nextLabel = 'Próximo' }: {
  item: SessionItem;
  header: React.ReactNode;
  /** Where the board and the panel go: a deck's Punir sits in the deck's frame, under the page's header. */
  frame?: (board: React.ReactNode, panel: React.ReactNode) => React.ReactNode;
  /** Free practice: the result is not reported. */
  practice?: boolean;
  /** What the first result did to the rating and the review, once saved. */
  outcome?: PuzzleOutcome | null;
  /** Called once with the rated result: first failure, or a clean solve. */
  onResult?: (solved: boolean, timeMs: number) => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  const [feedback, setFeedback] = useState<PuzzleFeedback>({ kind: 'none', text: '' });
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState(0);
  const [solution, setSolution] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const handleResult = useCallback((solved: boolean, timeMs: number) => {
    if (!practice) onResult?.(solved, timeMs);
  }, [practice, onResult]);
  const handleFinished = useCallback(() => setDone(true), []);

  // A punishment (a deck's mistake, or a Lichess puzzle in its session) can go on to where it pays off, when you ask.
  const punish = item.mode === 'punish' || item.puzzle.source === 'punish';
  const why = usePunishWhy(item.puzzle, done && punish);
  const [whyShown, setWhyShown] = useState(false);
  const extended = whyShown && why ? why : null;

  // Once the puzzle is over: walk the solution back and forth, or try other moves.
  const solutionLine = useMemo(() => lineFrom(item.puzzle.fen, extended?.moves ?? item.puzzle.moves), [item, extended]);
  // It opens after the solution, and stays there when the line grows: from there you walk on.
  const explorer = useLineExplorer({ start: item.puzzle.fen, line: solutionLine, enabled: done, initialPly: Math.min(item.puzzle.moves.length, solutionLine.length) });

  const turnWhite = item.puzzle.fen.split(' ')[1] === 'b'; // after the setup move
  const title =
    item.mode === 'placement' ? 'Calibração' : item.mode === 'review' ? 'Revisão' : item.mode === 'warmup' ? 'Aquecimento' : item.mode === 'punish' ? 'Punir' : item.mode === 'calc' ? 'Cálculo' : item.theme ? themeLabel(item.theme) : 'Puzzle';
  const rated = item.mode === 'new' || item.mode === 'placement' || item.mode === 'calc';
  // A review and a mistake to punish say why they are here in a sentence; no puzzle rating (an opening mistake has none).
  const told = item.mode === 'review' || item.mode === 'punish';
  // Cálculo gives nothing away until it is over: the puzzle's rating and its band only then.
  const hidden = item.mode === 'calc' && !done;
  // Only real motifs: an opening exercise has none of its own.
  const motifs = item.puzzle.themes.filter((t) => !NOT_MOTIFS.includes(t));

  return frame(
    <PuzzlePlayer
      puzzle={item.puzzle}
      onResult={handleResult}
      onFinished={handleFinished}
      onFeedback={setFeedback}
      hintToken={hint}
      solutionToken={solution}
      review={done ? explorer : undefined}
    />,
    <>
      {header}

      <div className={clsx('rounded-lg p-4', feedback.kind === 'wrong' || feedback.kind === 'failed' ? 'bg-[#4a2b27]' : feedback.kind === 'solved' || feedback.kind === 'good' ? 'bg-[#2f3f25]' : 'bg-panel')}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[17px] font-extrabold">
            <span className={clsx('h-4 w-4 rounded-sm border border-ink-4', turnWhite ? 'bg-white' : 'bg-[#2b2927]')} />
            {turnWhite ? 'Brancas jogam' : 'Pretas jogam'}
          </span>
          <span className="font-mono text-sm tabular-nums text-ink-3">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
        </div>
        <div className="mt-1 text-sm text-ink-3">
          {title}
          {!told && !hidden && <> · {item.puzzle.rating} · {item.reason}</>}
        </div>
        {told && <p className="mt-2 text-sm text-ink-2">{item.reason}</p>}
        {feedback.text && (
          <p className={clsx('mt-3 flex items-center gap-2 text-[15px] font-bold', feedback.kind === 'wrong' || feedback.kind === 'failed' ? 'text-cls-miss' : feedback.kind === 'alternative' ? 'text-cls-inaccuracy' : 'text-go-hover')}>
            {feedback.kind === 'wrong' || feedback.kind === 'failed' ? <X size={18} strokeWidth={3} /> : feedback.kind === 'alternative' ? <Lightbulb size={18} /> : <Check size={18} strokeWidth={3} />}
            {feedback.text}
          </p>
        )}
        {practice && <p className="mt-2 text-xs text-ink-4">Treino livre: nada é gravado.</p>}
        {outcome && rated && (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-bold">
            {outcome.delta >= 0 ? <TrendingUp size={16} className="text-go" /> : <TrendingDown size={16} className="text-cls-miss" />}
            <span className={outcome.delta >= 0 ? 'text-go' : 'text-cls-miss'}>{outcome.delta >= 0 ? '+' : ''}{Math.round(outcome.delta)}</span>
            <span className="text-ink-3">rating {Math.round(outcome.rating)}</span>
          </p>
        )}
        {outcome?.review && (
          <p className="mt-2 flex items-center gap-2 text-sm">
            <span className={clsx('rounded px-2 py-0.5 text-[12px] font-extrabold uppercase tracking-wide', GRADE_STYLE[outcome.review.rating])}>{GRADE_LABEL[outcome.review.rating]}</span>
            <span className="text-ink-3">Volta na revisão {dueLabel(outcome.review.due)}.</span>
          </p>
        )}
        {done && motifs.length > 0 && <p className="mt-2 text-xs text-ink-4">Temas: {motifs.map(themeLabel).join(', ')}</p>}
      </div>

      {done && <LineControls explorer={explorer} title={extended ? 'A linha até o fim' : 'A solução'} engineFrom={extended?.solved} />}
      {done && punish && <PunishWhyPanel why={why} shown={whyShown} onShow={() => setWhyShown(true)} explorer={explorer} />}

      <div className="flex gap-2">
        {done ? (
          <button type="button" className="btn-go flex flex-1 items-center justify-center gap-2 text-[17px]" onClick={onNext} autoFocus>
            {nextLabel} <ChevronRight size={20} />
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
    </>,
  );
}
