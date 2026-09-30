// What happened on your last repertoire move: right (with its grade), wrong
// (with the book move), the line's end, or whose turn it is.
import clsx from 'clsx';
import { GRADE_STYLE } from '@/components/positions/VerdictPanel';
import { RichText } from '@/components/San';
import { GRADE_LABEL } from '@/lib/positions/grade';
import type { RepDrill } from './useRepDrill';

export function RepFeedbackPanel({ drill, footer }: { drill: RepDrill; footer?: string }) {
  const { feedback, waiting } = drill;
  return (
    <div className={clsx('rounded-lg p-4', feedback.kind === 'wrong' ? 'bg-[#4a2b27]' : feedback.kind === 'good' ? 'bg-[#2f3f25]' : 'bg-panel')}>
      <p className="flex flex-wrap items-center gap-2 font-bold">
        {feedback.kind === 'none' ? (waiting ? 'O adversário está jogando...' : `Sua vez: jogue o lance ${drill.book}.`) : <span><RichText text={feedback.text} /></span>}
        {feedback.kind === 'good' && feedback.rating && (
          <span className={clsx('rounded px-2 py-0.5 text-[12px] font-extrabold uppercase tracking-wide', GRADE_STYLE[feedback.rating])}>{GRADE_LABEL[feedback.rating]}</span>
        )}
      </p>
      {feedback.comment && <p className="mt-2 text-sm leading-relaxed text-ink-2"><RichText text={feedback.comment} /></p>}
      {drill.exploring && (
        <p className="mt-3 text-sm text-ink-3">
          Analisando: volte lances e mexa as peças, as do adversário também, para ver a linha do Stockfish. Numa posição do seu repertório, dá para treinar a partir dela. As posições que você vê aqui não valem nota nesta linha (você viu o motor).
        </p>
      )}
      {footer && <p className="mt-3 text-xs text-ink-4">{footer}</p>}
    </div>
  );
}
