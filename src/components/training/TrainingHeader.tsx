// The top of a session's side panel: where you are (the part and the step),
// every step as a segment you can click to go back to it, the time, and the
// way out. A step already done opens as free practice.
import clsx from 'clsx';
import { RotateCcw, SkipForward } from 'lucide-react';
import { activeMs, BLOCK_LABEL, frontier } from '@/lib/training/session';
import type { TrainingSession, TrainingStep } from '@/lib/training/types';

const SEGMENT: Record<string, string> = { good: 'bg-go', hard: 'bg-cls-inaccuracy', fail: 'bg-cls-blunder' };

function segmentClass(step: TrainingStep, current: boolean): string {
  if (step.status === 'done') return SEGMENT[step.result?.outcome ?? 'good'] ?? 'bg-go';
  if (step.status === 'skipped') return 'bg-ink-4/50';
  return current ? 'bg-ink-3' : 'bg-raise';
}

const STATUS_TITLE = { pending: 'a fazer', done: 'feito', skipped: 'pulado' } as const;

/** Consecutive steps of the same part, drawn together. */
function runs(steps: TrainingStep[]): Array<{ block: TrainingStep['block']; items: Array<{ step: TrainingStep; index: number }> }> {
  const out: ReturnType<typeof runs> = [];
  steps.forEach((step, index) => {
    const last = out[out.length - 1];
    if (last && last.block === step.block) last.items.push({ step, index });
    else out.push({ block: step.block, items: [{ step, index }] });
  });
  return out;
}

export function TrainingHeader({ session, practice, onGo, onSkip, onExit }: {
  session: TrainingSession;
  /** This visit is free practice (the step was done before). */
  practice: boolean;
  onGo: (index: number) => void;
  onSkip?: () => void;
  onExit: () => void;
}) {
  const step = session.steps[session.at]!;
  const inBlock = session.steps.filter((s) => s.block === step.block);
  const place = inBlock.indexOf(step) + 1;
  const f = frontier(session);
  const minutes = Math.round(activeMs(session) / 60_000);
  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-extrabold">{session.mode === 'daily' ? 'Treino do dia' : 'Aquecimento'}</span>
        <span className="flex items-center gap-3 text-sm text-ink-3">
          <span className="tabular-nums">{minutes} de {Math.round(session.budgetMs / 60_000)} min</span>
          <button type="button" onClick={onExit} className="hover:text-ink">Sair</button>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold text-ink-2">{BLOCK_LABEL[step.block]} · {place} de {inBlock.length}</span>
        {step.reshow && <span className="rounded bg-raise px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-ink-2">Volta para fixar</span>}
        {practice && <span className="rounded bg-raise px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-cls-inaccuracy">Treino livre</span>}
      </div>
      {/* Every step fits the width, however many: segments shrink to 2 px, never overflow. */}
      <div className="mt-3 flex min-w-0 gap-1" role="list" aria-label="Passos da sessão">
        {runs(session.steps).map((r, k) => (
          <div key={k} className="flex min-w-0 flex-1 gap-px" style={{ flexGrow: r.items.length }}>
            {r.items.map(({ step: s, index }) => (
              <button
                key={s.id}
                type="button"
                role="listitem"
                onClick={() => onGo(index)}
                title={`${BLOCK_LABEL[s.block]} ${r.items.findIndex((x) => x.index === index) + 1}: ${STATUS_TITLE[s.status]}${s.result ? ` (${s.result.label})` : ''}`}
                aria-label={`Ir para ${BLOCK_LABEL[s.block]}, passo ${index + 1}, ${STATUS_TITLE[s.status]}`}
                aria-current={index === session.at ? 'step' : undefined}
                className={clsx('h-2 min-w-[2px] flex-1 rounded-[2px] hover:brightness-125', segmentClass(s, index === session.at), index === session.at && 'ring-2 ring-ink ring-offset-1 ring-offset-panel')}
              />
            ))}
          </div>
        ))}
      </div>
      {/* A puzzle says why it is here in its own panel. */}
      {step.item.kind !== 'puzzle' && step.reason && <p className="mt-3 text-sm text-ink-3">{step.reason}</p>}
      {practice && step.result && <p className="mt-1 text-sm text-ink-3">Da primeira vez: <b className="text-ink-2">{step.result.label}</b>{step.result.outside ? ' (em outra tela)' : ''}. Agora nada é gravado.</p>}
      {step.note && <p className="mt-1 text-sm text-cls-inaccuracy">{step.note}</p>}
      {(onSkip || session.at !== f) && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {session.at !== f && f < session.steps.length && (
            <button type="button" className="btn-flat flex items-center gap-1.5 px-3 py-1.5" onClick={() => onGo(f)}>
              <RotateCcw size={15} /> Voltar para onde parei
            </button>
          )}
          {onSkip && (
            <button type="button" className="flex items-center gap-1.5 px-2 py-1.5 text-ink-3 hover:text-ink" onClick={onSkip}>
              <SkipForward size={15} /> Pular
            </button>
          )}
        </div>
      )}
    </div>
  );
}
