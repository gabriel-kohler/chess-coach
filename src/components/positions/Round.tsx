// One best-move position: find the move, get the grade on the first try,
// then walk the engine's line or try your own moves. Used by Posições and by
// the training sessions (with their own header, a fixed attempt id, and free
// practice when you redo a position already done).
import clsx from 'clsx';
import { Eye, Lightbulb, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { State, type Grade } from 'ts-fsrs';
import { Board } from '@/components/board/Board';
import { LineControls } from '@/components/board/LineControls';
import { lineFrom, useLineExplorer } from '@/components/board/useLineExplorer';
import { San } from '@/components/San';
import { plural } from '@/lib/format';
import { POSITIONS } from '@/lib/positions/config';
import { cacheEngineScore, patchReview, recordReview } from '@/lib/positions/store';
import type { BestMoveCard } from '@/lib/positions/types';
import { ruleFor } from '@/lib/srs/fsrs';
import type { FsrsFields } from '@/lib/srs/types';
import { useMoveAttempt } from './useMoveAttempt';
import { VerdictPanel } from './VerdictPanel';

export interface SavedReview {
  next: FsrsFields;
  logId: number;
}

export function Round({ card, expectedMs, header, attemptId, practice = false, done = 0, left = 0, from = 'queue', onSaved, onNext, onExit }: {
  card: BestMoveCard;
  expectedMs: number;
  /** Replaces the Posições header (a training session has its own). */
  header?: React.ReactNode;
  /** Fixed by a training session, so saving the same step twice counts once. */
  attemptId?: string;
  /** Free practice: nothing is saved. */
  practice?: boolean;
  done?: number;
  left?: number;
  from?: 'learning' | 'queue' | 'ahead';
  onSaved?: (r: SavedReview, rating: Grade, timeMs: number) => void;
  onNext: () => void;
  onExit?: () => void;
}) {
  const [savedReview, setSavedReview] = useState<SavedReview | null>(null);
  const attempt = useRef(attemptId ?? `${card.id}|${Date.now()}|${Math.random().toString(36).slice(2)}`);
  const { state, onMove, giveUp, hint, board } = useMoveAttempt(card, expectedMs, {
    rule: ruleFor('best'),
    onScored: (s) => void cacheEngineScore(card.id, s),
    // Saved as soon as the first move decides the grade: a reload mid-retry keeps it.
    onFirst: ({ first, rating, startedAt, hiddenMs }) => {
      if (practice) return;
      const correct = !first.gaveUp && first.loss !== null && first.loss <= POSITIONS.goodLoss;
      void recordReview({
        attemptId: attempt.current,
        cardId: card.id,
        at: startedAt + first.timeMs + hiddenMs,
        grade: rating,
        signals: { uci: first.uci, loss: first.loss, lossSource: first.score?.source ?? null, exact: first.exact, correct, timeMs: first.timeMs, hiddenMs, expectedMs, bucket: card.bucket, gaveUp: first.gaveUp },
      }).then((r) => {
        setSavedReview({ next: r.next, logId: r.logId });
        onSaved?.({ next: r.next, logId: r.logId }, rating, first.timeMs);
      });
    },
  });
  // Retries and the hint are recorded once the attempt is over.
  useEffect(() => {
    if (state.phase === 'verdict' && savedReview) void patchReview(savedReview.logId, { hintUsed: state.hint, tries: state.tries, solved: state.solved });
  }, [state.phase, savedReview]);

  const white = card.color === 'white';
  const source = card.sources[0]!;
  const when = new Date(source.endTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const label = from === 'queue' ? (card.state === State.New ? 'Nova' : 'Revisão') : card.state === State.Relearning ? 'Reaprendendo' : 'Aprendendo';

  // Once graded: walk the engine's line, or try your own moves with the engine answering.
  const decided = state.phase === 'verdict';
  const bestPv = (state.first?.score?.best ?? card.best).pv;
  const bestLine = useMemo(() => lineFrom(card.fen, bestPv.slice(0, 10)), [card.fen, bestPv]);
  const explorer = useLineExplorer({ start: card.fen, line: bestLine, enabled: decided, startLastMove: card.prevMove });
  // At the position itself the verdict's arrows stay; anywhere else the explorer draws.
  const atVerdict = decided && explorer.ply === 0 && !explorer.variation;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 40px)' }}>
          {!decided || atVerdict ? (
            <Board fen={board.fen} orientation={card.color} lastMove={board.lastMove} movable={decided ? 'both' : board.movable} onMove={decided ? explorer.onMove : onMove} tints={board.tints} arrows={board.arrows} badge={board.badge} />
          ) : (
            <Board fen={explorer.fen} orientation={card.color} lastMove={explorer.lastMove} movable="both" onMove={explorer.onMove} arrows={explorer.arrows} />
          )}
        </div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]">
        {header ?? (
          <div className="flex items-center justify-between rounded-lg bg-panel px-4 py-3 text-sm">
            <span className="font-bold text-ink-3">{label} · {plural(done, 'feita', 'feitas')} · {plural(left, 'restante', 'restantes')}</span>
            <button type="button" onClick={onExit} className="text-ink-3 hover:text-ink">Sair</button>
          </div>
        )}

        {state.phase === 'verdict' && state.first && state.rating ? (
          <VerdictPanel card={card} first={state.first} rating={state.rating} expectedMs={expectedMs} next={savedReview?.next ?? null} saving={!practice && !savedReview} practice={practice} onNext={onNext}>
            <LineControls explorer={explorer} title="Linha do motor" />
          </VerdictPanel>
        ) : (
          <>
            <div className={clsx('rounded-lg p-4', state.phase === 'wrong' ? 'bg-[#4a2b27]' : 'bg-panel')}>
              <span className="flex items-center gap-2 text-[17px] font-extrabold">
                <span className={clsx('h-4 w-4 rounded-sm border border-ink-4', white ? 'bg-white' : 'bg-[#2b2927]')} />
                {white ? 'Brancas jogam' : 'Pretas jogam'}
              </span>
              <p className="mt-1 text-sm text-ink-3">Da sua partida contra {source.oppName} ({when}).</p>
              <p className="mt-3 text-[15px] font-bold text-ink">
                {state.phase === 'checking' ? (
                  <span className="flex items-center gap-2 text-ink-2"><Loader2 size={16} className="animate-spin" /> Conferindo com o motor...</span>
                ) : state.phase === 'wrong' && state.last ? (
                  <span className="flex items-center gap-2 text-cls-miss"><X size={18} strokeWidth={3} /> <span><San san={state.last.san} /> não é o melhor aqui.</span></span>
                ) : state.first ? (
                  'Tente de novo.'
                ) : (
                  'Ache o melhor lance.'
                )}
              </p>
              {state.message && <p className="mt-2 text-sm text-ink-2">{state.message}</p>}
              {state.first && state.phase !== 'checking' && <p className="mt-2 text-xs text-ink-4">{practice ? 'Treino livre: nada é gravado.' : 'A nota já vale pelo primeiro lance. Agora é para aprender.'}</p>}
            </div>
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
          </>
        )}
      </aside>
    </div>
  );
}
