// What your repertoire says at a position you are analysing: your answer, or
// the opponent moves it covers (the parallel lines) with your answer to each.
// A move played from here goes onto the board, where Stockfish answers live.
import { BookOpen } from 'lucide-react';
import type { BoardMove } from '@/components/board/Board';
import type { Arrow } from '@/components/board/geometry';
import { RichText, San } from '@/components/San';
import { epdOf, type CompiledSide } from '@/lib/repertoire/compile';
import type { Color } from '@/lib/types';

const BOOK_ARROW = 'rgb(150, 190, 70)';
const ourTurn = (fen: string, side: Color) => fen.split(' ')[1] === (side === 'white' ? 'w' : 'b');

/** The repertoire's answer as an arrow, when it is your move here. */
export function bookArrows(rep: CompiledSide, fen: string, side: Color): Arrow[] {
  const m = ourTurn(fen, side) ? rep.positions[epdOf(fen)]?.moves[0] : undefined;
  return m ? [{ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: BOOK_ARROW }] : [];
}

export function BookHere({ rep, fen, side, onPlay }: { rep: CompiledSide; fen: string; side: Color; onPlay: (m: BoardMove) => void }) {
  const pos = rep.positions[epdOf(fen)];
  const play = (uci: string) => onPlay({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] as BoardMove['promotion'] } : {}) });
  return (
    <div className="rounded-lg bg-panel p-3 text-sm">
      <h3 className="mb-1.5 flex items-center gap-1.5 font-bold text-ink-2"><BookOpen size={14} /> No repertório</h3>
      {!pos?.moves.length ? (
        <p className="text-ink-3">Fora do repertório. Mexa uma peça para ver a linha do Stockfish.</p>
      ) : ourTurn(fen, side) ? (
        <div>
          <button type="button" onClick={() => play(pos.moves[0]!.uci)} className="rounded px-1.5 py-0.5 font-bold text-go hover:bg-raise">
            <San san={pos.moves[0]!.san} />
          </button>
          {pos.moves[0]!.comment && <p className="mt-1 leading-relaxed text-ink-3"><RichText text={pos.moves[0]!.comment} /></p>}
        </div>
      ) : (
        <>
          <p className="mb-1 text-xs text-ink-4">O adversário pode jogar (toque para testar):</p>
          <ul className="space-y-1">
            {pos.moves.map((m) => {
              const answer = rep.positions[m.to]?.moves[0];
              return (
                <li key={m.uci} className="flex items-baseline gap-2">
                  <button type="button" onClick={() => play(m.uci)} className="shrink-0 rounded px-1.5 py-0.5 font-bold text-ink hover:bg-raise">
                    <San san={m.san} />
                  </button>
                  {answer ? (
                    <span className="min-w-0 text-ink-3">
                      você responde <San san={answer.san} className="font-bold text-go" />
                      {answer.comment && <span className="line-clamp-2 text-xs text-ink-4"><RichText text={answer.comment} /></span>}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-4">fim da linha do repertório</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
