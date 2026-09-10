import { BookOpen, Check, Star, ThumbsUp, X } from 'lucide-react';
import type { Classification } from '@/lib/types';

export const CLASS_LABEL: Record<Classification, string> = {
  brilliant: 'Brilhante',
  great: 'Ótimo',
  best: 'Melhor',
  excellent: 'Excelente',
  good: 'Bom',
  book: 'Teoria',
  inaccuracy: 'Imprecisão',
  mistake: 'Erro',
  miss: 'Chance perdida',
  blunder: 'Capivarada',
};

export const CLASS_COLOR: Record<Classification, string> = {
  brilliant: 'var(--color-cls-brilliant)',
  great: 'var(--color-cls-great)',
  best: 'var(--color-cls-best)',
  excellent: 'var(--color-cls-excellent)',
  good: 'var(--color-cls-good)',
  book: 'var(--color-cls-book)',
  inaccuracy: 'var(--color-cls-inaccuracy)',
  mistake: 'var(--color-cls-mistake)',
  miss: 'var(--color-cls-miss)',
  blunder: 'var(--color-cls-blunder)',
};

const GLYPH: Partial<Record<Classification, string>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

/** Round badge with the classification glyph, sized by the parent font-size or `size`. */
export function ClassificationIcon({ cls, size = 20, className }: { cls: Classification; size?: number | string; className?: string }) {
  const glyph = GLYPH[cls];
  const iconSize = '62%';
  return (
    <span
      className={className}
      title={CLASS_LABEL[cls]}
      style={{
        width: size,
        height: size,
        background: CLASS_COLOR[cls],
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
        flexShrink: 0,
      }}
    >
      {glyph ? (
        <svg viewBox="0 0 20 20" width="100%" height="100%" aria-hidden>
          <text
            x="10"
            y="14.6"
            textAnchor="middle"
            fontSize={glyph.length > 1 ? 11 : 13}
            fontWeight={900}
            fill="#fff"
            fontFamily="Arial, sans-serif"
            letterSpacing={glyph.length > 1 ? -0.6 : 0}
          >
            {glyph}
          </text>
        </svg>
      ) : cls === 'best' ? (
        <Star width={iconSize} height={iconSize} fill="#fff" strokeWidth={0} />
      ) : cls === 'excellent' ? (
        <ThumbsUp width={iconSize} height={iconSize} fill="#fff" strokeWidth={1.5} />
      ) : cls === 'good' ? (
        <Check width={iconSize} height={iconSize} strokeWidth={4} />
      ) : cls === 'book' ? (
        <BookOpen width={iconSize} height={iconSize} strokeWidth={2.6} />
      ) : (
        <X width={iconSize} height={iconSize} strokeWidth={4} />
      )}
    </span>
  );
}
