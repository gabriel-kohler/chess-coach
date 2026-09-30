// After an attempt: the grade, why your move was worse, what the best move
// does, and where the position came from. Every statement comes from the
// engine lines and the explanation module, never from free text.
import clsx from 'clsx';
import { Chess } from 'chess.js';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Rating, type Grade } from 'ts-fsrs';
import { CLASS_LABEL } from '@/components/board/ClassificationIcon';
import { RichText, San, SanLine } from '@/components/San';
import { tryUci } from '@/lib/chess/replay';
import { bestLineFacts, lineFacts, type LineFacts } from '@/lib/explain/facts';
import { dueLabel, plural } from '@/lib/format';
import type { FirstAttempt } from '@/lib/positions/attempt';
import { POSITIONS } from '@/lib/positions/config';
import { GRADE_LABEL, lossClass } from '@/lib/positions/grade';
import type { BestMoveCard, StoredLine } from '@/lib/positions/types';
import type { FsrsFields } from '@/lib/srs/types';
import type { EngineLine } from '@/lib/types';

export const GRADE_STYLE: Record<Grade, string> = {
  [Rating.Again]: 'bg-cls-blunder/20 text-cls-miss',
  [Rating.Hard]: 'bg-cls-inaccuracy/20 text-cls-inaccuracy',
  [Rating.Good]: 'bg-go/20 text-go-hover',
  [Rating.Easy]: 'bg-cls-brilliant/20 text-cls-brilliant',
};

const asLine = (l: StoredLine): EngineLine => ({ depth: l.depth, pv: l.pv, ...l.score });
const secs = (ms: number) => `${Math.max(1, Math.round(ms / 1000))} s`;
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function Facts({ title, tone, fen, facts }: { title: React.ReactNode; tone: 'bad' | 'good'; fen: string; facts: LineFacts }) {
  return (
    <div className="rounded-md bg-black/20 p-2.5 text-[13px] leading-relaxed">
      <div className={clsx('font-bold', tone === 'bad' ? 'text-cls-miss' : 'text-go-hover')}>{title}</div>
      <div className="text-ink-2"><SanLine fen={fen} san={facts.san.slice(0, 6)} /></div>
      {facts.payoff && <div className="text-ink-3"><RichText text={`Se concretiza ${facts.payoff.text}.`} /></div>}
      {facts.motifs.slice(0, 2).map((m) => <div key={m.theme} className="text-ink-3">{cap(m.text)}.</div>)}
    </div>
  );
}

export function VerdictPanel({ card, first, rating, expectedMs, next, onNext, saving, practice = false, children }: {
  card: BestMoveCard;
  first: FirstAttempt;
  rating: Grade;
  expectedMs: number;
  next: FsrsFields | null;
  onNext: () => void;
  saving: boolean;
  /** A redo in a training session: the grade is shown, nothing is saved. */
  practice?: boolean;
  /** Shown above "Próxima": the line's controls. */
  children?: React.ReactNode;
}) {
  const facts = useMemo(() => {
    const reply = first.score?.reply;
    let yours: { fen: string; facts: LineFacts } | null = null;
    if (first.uci && !first.exact && reply?.pv.length) {
      const chess = new Chess(card.fen);
      if (tryUci(chess, first.uci)) yours = { fen: chess.fen(), facts: lineFacts(chess.fen(), asLine(reply), card.fen) };
    }
    const best = first.score?.best ?? card.best;
    const bestFacts = best.uci !== first.uci ? bestLineFacts(card.fen, asLine(best), yours?.facts ?? null) : null;
    return { yours, bestFacts };
  }, [card, first]);

  const source = card.sources[0]!;
  const when = new Date(source.endTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const slow = first.loss !== null && first.loss <= POSITIONS.goodLoss && first.timeMs > POSITIONS.slowFactor * expectedMs;

  let headline: React.ReactNode;
  if (first.gaveUp || !first.uci) headline = 'Você pediu a resposta.';
  else if (first.exact) headline = <>Você achou <San san={card.best.san} className="font-bold text-ink" />, o lance do motor.</>;
  else {
    const cls = lossClass(first.loss ?? 0, false);
    headline = (
      <>
        <San san={first.san ?? ''} className="font-bold text-ink" />: {CLASS_LABEL[cls].toLowerCase()}
        {first.loss !== null && first.loss >= 0.5 && <>, perde {plural(Math.round(first.loss), 'ponto', 'pontos')} de chance</>}.
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="rounded-lg bg-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <span className={clsx('rounded px-2 py-0.5 text-[13px] font-extrabold uppercase tracking-wide', GRADE_STYLE[rating])}>{GRADE_LABEL[rating]}</span>
          {!first.gaveUp && <span className="font-mono text-sm tabular-nums text-ink-3">{secs(first.timeMs)}</span>}
        </div>
        <p className="mt-2 text-[15px] font-bold leading-snug text-ink">{headline}</p>
        {slow && <p className="mt-1 text-sm text-ink-3">Certo, mas levou {secs(first.timeMs)}. Seu tempo esperado nessas posições é {secs(expectedMs)}.</p>}
        {practice ? (
          <p className="mt-1 text-sm text-ink-3">Treino livre: não conta para a revisão.</p>
        ) : (
          rating === Rating.Again && first.uci && !first.gaveUp && <p className="mt-1 text-sm text-ink-3">A nota vale pelo primeiro lance: esta posição volta em poucos minutos.</p>
        )}
      </div>

      {facts.yours && <Facts title={<>Por que não <San san={first.san ?? ''} />?</>} tone="bad" fen={facts.yours.fen} facts={facts.yours.facts} />}
      {facts.bestFacts && <Facts title={<>O melhor era <San san={card.best.san} />:</>} tone="good" fen={card.fen} facts={facts.bestFacts} />}

      <div className="rounded-lg bg-panel p-4 text-sm text-ink-2">
        <p>
          Contra {source.oppName} ({when}) você jogou <San san={source.san} className="font-bold text-ink" />, que perdia {plural(Math.round(source.loss), 'ponto', 'pontos')}.
          {card.sources.length > 1 && <> Você chegou a esta posição em {card.sources.length} partidas.</>}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Link to={`/review/${source.gameId}?ply=${source.ply}`} className="font-medium text-ink underline decoration-ink-4 underline-offset-4 hover:decoration-ink">Ver na partida</Link>
          {next && <span className="text-ink-3">Volta {dueLabel(next.due)}</span>}
        </div>
      </div>

      {children}

      <button type="button" className="btn-go text-[17px]" onClick={onNext} disabled={saving} autoFocus>
        {saving ? 'Salvando...' : 'Próxima'}
      </button>
    </div>
  );
}
