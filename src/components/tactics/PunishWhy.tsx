// After a punishment, only when asked: the line to its end and why it punishes
// (lib/punish/why.ts). Hidden by default: first work it out yourself, then
// check it against the line.
import { Chess } from 'chess.js';
import { Eye, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LineExplorer } from '@/components/board/useLineExplorer';
import { San } from '@/components/San';
import { tryUci } from '@/lib/chess/replay';
import { factsEngine } from '@/lib/engine/stockfish';
import { punishWhy, WHY, type PunishWhy, type WhyMove } from '@/lib/punish/why';
import { formatScore } from '@/lib/review/scoring';
import type { Puzzle } from '@/lib/types';

/**
 * Stockfish's line after the exercise, looked for as soon as it is over so it
 * is there when asked. undefined while it runs, null when it failed.
 */
export function usePunishWhy(puzzle: Puzzle, enabled: boolean): PunishWhy | null | undefined {
  const [why, setWhy] = useState<PunishWhy | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const chess = new Chess(puzzle.fen);
    for (const m of puzzle.moves) if (!tryUci(chess, m)) break;
    // The facts engine: never behind the live analysis of the moves you try on the board.
    factsEngine()
      .analyse(chess.fen(), { depth: WHY.depth })
      .then(([line]) => alive && setWhy(line ? punishWhy(puzzle, line) : null))
      .catch(() => alive && setWhy(null));
    return () => {
      alive = false;
    };
  }, [puzzle, enabled]);
  return why;
}

function MoveLink({ move, explorer }: { move: WhyMove; explorer: LineExplorer }) {
  return (
    <button type="button" onClick={() => explorer.go(move.ply)} className="rounded font-bold text-ink hover:text-go-hover" title="Ver no tabuleiro">
      {move.label}
      <San san={move.san} />
    </button>
  );
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function PunishWhyPanel({ why, shown, onShow, explorer }: { why: PunishWhy | null | undefined; shown: boolean; onShow: () => void; explorer: LineExplorer }) {
  if (!shown) {
    return (
      <div className="rounded-lg bg-panel p-3 text-sm">
        <p className="text-ink-3"><b className="text-ink">Por que pune?</b> Pense no que ela ameaça e no que ganha no fim; depois confira na linha.</p>
        <button type="button" className="btn-flat mt-2 flex w-full items-center justify-center gap-2" onClick={onShow}>
          <Eye size={16} /> Ver a linha até o fim
        </button>
      </div>
    );
  }
  if (why === undefined) {
    return <p className="flex items-center gap-2 rounded-lg bg-panel p-4 text-sm text-ink-3"><Loader2 size={14} className="animate-spin" /> O Stockfish está calculando a linha...</p>;
  }
  if (why === null) return <p className="rounded-lg bg-panel p-4 text-sm text-ink-3">Não consegui calcular a linha agora.</p>;
  const { payoff, idea } = why;
  return (
    <div className="rounded-lg bg-panel p-4 text-sm">
      <h3 className="font-extrabold">Por que pune</h3>
      <p className="mt-1 text-ink-2">
        {payoff ? <>{cap(payoff.what)} em <MoveLink move={payoff} explorer={explorer} />.</> : 'O Stockfish não ganha material na linha: a vantagem é de posição.'}
      </p>
      {idea && (
        <p className="mt-1.5 text-ink-3">
          <MoveLink move={idea} explorer={explorer} />: {idea.motifs.join('; ')}.
        </p>
      )}
      {payoff?.kind !== 'mate' && (
        <p className="mt-2 text-xs text-ink-4">
          Stockfish no fim da linha: <b className="text-ink-2">{formatScore(why.score)}</b> (profundidade {why.depth}).
        </p>
      )}
    </div>
  );
}
