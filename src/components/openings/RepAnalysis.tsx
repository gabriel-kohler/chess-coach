// The pieces every repertoire drill shares (a deck, the whole color, a
// training step): its board, which turns into the analysis board when you stop
// to analyse or the line ends, the button to do so, and the analysis itself:
// the line to walk back and forth, the moves your repertoire covers there, and
// Stockfish live on any move you try.
import { Play, Search } from 'lucide-react';
import { Board } from '@/components/board/Board';
import { LineControls } from '@/components/board/LineControls';
import { useBookBadge } from '@/components/board/useBookBadge';
import type { CompiledSide } from '@/lib/repertoire/compile';
import type { Color } from '@/lib/types';
import { BookHere, bookArrows } from './BookHere';
import type { RepDrill } from './useRepDrill';

export function RepDrillBoard({ drill, side, rep }: { drill: RepDrill; side: Color; rep: CompiledSide }) {
  const { explorer, ended, exploring, waiting } = drill;
  const analysing = ended || exploring;
  const badge = useBookBadge(analysing ? explorer.fen : drill.fen, analysing ? explorer.lastMove : drill.lastMove);
  if (analysing) {
    return <Board fen={explorer.fen} orientation={side} lastMove={explorer.lastMove} movable="both" onMove={explorer.onMove} arrows={[...explorer.arrows, ...bookArrows(rep, explorer.fen, side)]} badge={badge} />;
  }
  return <Board fen={drill.fen} orientation={side} lastMove={drill.lastMove} movable={waiting ? null : side} onMove={drill.onMove} arrows={drill.arrows} badge={badge} />;
}

/**
 * "Analisar" while the line runs. While you analyse: train from the board's
 * position when your repertoire goes on from it, or back to where the line
 * stopped. Nothing once it ended (the analysis is open then).
 */
export function AnalyseButton({ drill }: { drill: RepDrill }) {
  if (drill.ended) return null;
  if (drill.exploring) {
    return drill.canTrainHere ? (
      <div className="flex flex-col gap-2">
        <button type="button" className="btn-go flex items-center justify-center gap-2" onClick={drill.trainHere}>
          <Play size={16} /> Treinar a partir daqui
        </button>
        <button type="button" className="btn-flat" onClick={drill.resume}>
          Voltar para onde a linha parou
        </button>
      </div>
    ) : (
      <button type="button" className="btn-go" onClick={drill.resume} autoFocus>
        {drill.atStop ? 'Voltar ao treino' : 'Voltar para onde a linha parou'}
      </button>
    );
  }
  return (
    <button type="button" className="btn-flat flex items-center justify-center gap-2" onClick={drill.explore}>
      <Search size={16} /> Analisar: voltar lances e testar outros
    </button>
  );
}

export function RepAnalysis({ drill, side, rep }: { drill: RepDrill; side: Color; rep: CompiledSide }) {
  const { explorer, ended, exploring } = drill;
  if (!ended && !exploring) return null;
  return (
    <>
      <LineControls explorer={explorer} title={exploring ? 'A linha até aqui' : 'A linha treinada'} />
      <BookHere rep={rep} fen={explorer.fen} side={side} onPlay={explorer.onMove} />
    </>
  );
}
