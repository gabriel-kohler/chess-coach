import { useState } from 'react';
import { CLASS_COLOR, CLASS_LABEL } from '@/components/board/ClassificationIcon';
import { formatScore, winPercent } from '@/lib/review/scoring';
import type { MoveReview, Score } from '@/lib/types';

const NOTABLE = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder']);

/**
 * chess.com-style evaluation graph: White's share filled from the bottom,
 * notable moves as dots, the current ply as a cursor. Click to jump.
 */
export function EvalGraph({
  scores,
  moves,
  ply,
  onSelect,
}: {
  scores: Score[]; // White POV, index = ply
  moves: MoveReview[];
  ply: number;
  onSelect: (ply: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 400;
  const H = 88;
  const n = Math.max(1, scores.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (s: Score) => H - (winPercent(s) / 100) * H;
  const pts = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`);
  const area = `M0,${H} L${pts.join(' L')} L${W},${H} Z`;

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round(((e.clientX - rect.left) / rect.width) * n)));
  };

  const hv = hover ?? null;
  const hoverMove = hv !== null && hv > 0 ? moves[hv - 1] : undefined;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[88px] w-full cursor-pointer rounded bg-[#3b3936]"
        onPointerMove={(e) => setHover(pick(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSelect(pick(e))}
        role="img"
        aria-label="Gráfico de avaliação da partida"
      >
        <path d={area} fill="#fff" />
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#7d7b78" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6} />
        <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} stroke="#81b64c" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {hv !== null && <line x1={x(hv)} x2={x(hv)} y1={0} y2={H} stroke="#989795" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* dots drawn in HTML so they stay round with preserveAspectRatio="none" */}
      {moves.map((m) =>
        NOTABLE.has(m.classification) ? (
          <span
            key={m.ply}
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${(m.ply / n) * 100}%`,
              top: `${(1 - winPercent(scores[m.ply]) / 100) * 100}%`,
              background: CLASS_COLOR[m.classification],
              boxShadow: '0 0 0 2px #3b3936',
            }}
          />
        ) : null,
      )}
      {hv !== null && (
        <div
          className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-2 py-1 text-xs font-bold text-white"
          style={{ left: `${(hv / n) * 100}%` }}
        >
          {hoverMove ? `${Math.ceil(hoverMove.ply / 2)}${hoverMove.color === 'white' ? '.' : '...'} ${hoverMove.san}  ` : 'Início  '}
          {formatScore(scores[hv])}
          {hoverMove && NOTABLE.has(hoverMove.classification) ? `  ${CLASS_LABEL[hoverMove.classification]}` : ''}
        </div>
      )}
    </div>
  );
}
