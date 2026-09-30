// The controls under an exercise once it is decided: the line's moves (click
// one to go there), back and forward, and while you try your own moves, what
// the engine thinks of them.
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Fragment } from 'react';
import { San, SanLine } from '@/components/San';
import { lineLabels, lineToSan } from '@/lib/chess/replay';
import { formatScore } from '@/lib/review/scoring';
import type { LineExplorer } from './useLineExplorer';

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="rounded-md bg-panel-2 p-1.5 text-ink-2 hover:bg-raise hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}

const numberOf = (fen: string) => `${fen.split(' ')[5]}${fen.split(' ')[1] === 'w' ? '.' : '...'}`;

export function LineControls({ explorer, title, engineFrom }: {
  explorer: LineExplorer;
  title: string;
  /** Where Stockfish's continuation starts in the line: its moves are told apart from the exercise's. */
  engineFrom?: number;
}) {
  if (!explorer.enabled) return null;
  const { line, ply, variation, live, fen } = explorer;
  const labels = lineLabels(explorer.start, line.length);
  const atStart = !variation && ply === 0;
  const atEnd = variation ? variation.index === variation.moves.length : ply === line.length;
  const lines = live && live.fen === fen ? live.lines : [];
  const tried = variation ? variation.moves.slice(0, variation.index) : [];
  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-ink-2">{title}</span>
        <span className="flex gap-1">
          <NavButton label="Início da linha" onClick={() => explorer.go(0)} disabled={atStart}><ChevronsLeft size={18} /></NavButton>
          <NavButton label="Lance anterior" onClick={() => explorer.step(-1)} disabled={atStart}><ChevronLeft size={18} /></NavButton>
          <NavButton label="Próximo lance" onClick={() => explorer.step(1)} disabled={atEnd}><ChevronRight size={18} /></NavButton>
          <NavButton label="Fim da linha" onClick={() => explorer.go(line.length)} disabled={!variation && ply === line.length}><ChevronsRight size={18} /></NavButton>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[14px]">
        {line.map((p, i) => {
          const engine = engineFrom !== undefined && i >= engineFrom;
          // After the "Stockfish" mark a Black move needs its number too.
          const label = labels[i] ?? (i === engineFrom ? numberOf(p.fenBefore) : null);
          return (
            <Fragment key={i}>
              {i === engineFrom && <span className="mx-1 text-[11px] font-bold uppercase tracking-wide text-ink-4">Stockfish</span>}
              <button
                type="button"
                onClick={() => explorer.go(i + 1)}
                className={clsx('rounded px-1 py-0.5 hover:bg-raise', !variation && ply === i + 1 ? 'bg-raise-2 font-bold text-ink' : variation && variation.base === i + 1 ? 'text-ink underline decoration-dotted' : engine ? 'text-ink-3' : 'text-ink-2')}
              >
                {label && <span className="mr-0.5 text-ink-4">{label}</span>}
                <San san={p.san} />
              </button>
            </Fragment>
          );
        })}
      </div>
      {variation ? (
        <div className="mt-2 rounded-md bg-black/20 p-2.5 text-[13px]">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-bold text-ink-2">
              Testando <SanLine fen={variation.base === 0 ? explorer.start : line[variation.base - 1]!.fenAfter} san={tried.map((m) => m.san)} />
            </span>
            <button type="button" className="shrink-0 font-bold text-go hover:text-go-hover" onClick={explorer.backToLine}>Voltar à linha</button>
          </div>
          {lines.length ? (
            <ul className="space-y-1">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-12 shrink-0 rounded bg-raise px-1 text-center font-bold tabular-nums">{formatScore(l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 })}</span>
                  <span className="truncate text-ink-3"><SanLine fen={fen} san={lineToSan(fen, l.pv, 8)} /></span>
                </li>
              ))}
              <li className="text-xs text-ink-4">Motor, profundidade {live?.depth}</li>
            </ul>
          ) : (
            <p className="text-ink-3">O motor está calculando...</p>
          )}
        </div>
      ) : (
        <>
          {/* The engine on the line's own position, when the explorer runs it there (analysing a repertoire line). */}
          {lines.length > 0 && (
            <div className="mt-2 rounded-md bg-black/20 p-2.5 text-[13px]">
              <div className="mb-1.5 font-bold text-ink-2">Stockfish nesta posição</div>
              <ul className="space-y-1">
                {lines.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-12 shrink-0 rounded bg-raise px-1 text-center font-bold tabular-nums">{formatScore(l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 })}</span>
                    <span className="truncate text-ink-3"><SanLine fen={fen} san={lineToSan(fen, l.pv, 8)} /></span>
                  </li>
                ))}
                <li className="text-xs text-ink-4">Motor, profundidade {live?.depth}</li>
              </ul>
            </div>
          )}
          <p className="mt-2 text-xs text-ink-4">Setas do teclado andam na linha. Mexa as peças para testar outro lance: o motor responde.</p>
        </>
      )}
    </div>
  );
}
