import { Sun, Timer, Zap } from 'lucide-react';
import type { TimeClass } from '@/lib/types';

export const TIME_CLASS_LABEL: Record<TimeClass, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', daily: 'Diária' };

export function TimeClassIcon({ tc, size = 18 }: { tc: TimeClass; size?: number }) {
  if (tc === 'blitz') return <Zap size={size} className="text-[#fad541]" fill="currentColor" strokeWidth={1.5} aria-label="Blitz" />;
  if (tc === 'rapid') return <Timer size={size} className="text-[#81b64c]" strokeWidth={2.5} aria-label="Rápida" />;
  if (tc === 'daily') return <Sun size={size} className="text-[#f7c631]" strokeWidth={2.5} aria-label="Diária" />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Bullet" className="text-[#e3aa24]">
      <path fill="currentColor" d="M5 15.5 15.2 5.3c1.6-1.6 4.4-1.9 5.2-1.1.8.8.5 3.6-1.1 5.2L9.1 19.6 5 15.5Zm-1.4 1.4 4.1 4.1-1.4 1.4c-.6.6-1.5.6-2.1 0l-2-2c-.6-.6-.6-1.5 0-2.1l1.4-1.4Z" />
    </svg>
  );
}

export function ResultBadge({ outcome }: { outcome: 'win' | 'loss' | 'draw' }) {
  const map = {
    win: { bg: 'var(--color-win)', ch: '+', label: 'Vitória' },
    loss: { bg: 'var(--color-loss)', ch: '−', label: 'Derrota' },
    draw: { bg: 'var(--color-draw)', ch: '=', label: 'Empate' },
  }[outcome];
  return (
    <span title={map.label} className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[3px] text-[15px] font-black leading-none text-white" style={{ background: map.bg }}>
      {map.ch}
    </span>
  );
}
