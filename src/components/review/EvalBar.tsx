import { formatScore, winPercent } from '@/lib/review/scoring';
import type { Color, Score } from '@/lib/types';

/** Vertical evaluation bar, White from the bottom when the board is not flipped. */
export function EvalBar({ score, orientation }: { score?: Score; orientation: Color }) {
  const white = score ? winPercent(score) : 50;
  const label = score ? formatScore(score).replace('+', '') : '0.0';
  const whiteAhead = white >= 50;
  const flipped = orientation === 'black';
  return (
    <div className="relative h-full w-[26px] shrink-0 overflow-hidden rounded-[3px] bg-[#403d39]" aria-label={`Avaliação ${label}`}>
      <div
        className="absolute left-0 right-0 bg-white transition-[height] duration-300 ease-out"
        style={{ height: `${white}%`, [flipped ? 'top' : 'bottom']: 0 }}
      />
      <span
        className="absolute left-0 right-0 text-center text-[10.5px] font-extrabold leading-none"
        style={{
          color: whiteAhead ? '#403d39' : '#fff',
          ...(whiteAhead !== flipped ? { bottom: 5 } : { top: 5 }),
        }}
      >
        {label}
      </span>
    </div>
  );
}
