import { Chess, type Square } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Classification, Color } from '@/lib/types';
import { pieceUrl, preloadPieces, type PieceCode } from './assets';
import { ARROW, TINT } from './colors';
import { ClassificationIcon } from './ClassificationIcon';
import { ALL_SQUARES, arrowPolygon, isLightSquare, squareToXY, xyToSquare, type Arrow } from './geometry';

export interface BoardMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export interface BoardProps {
  fen: string;
  orientation?: Color;
  lastMove?: { from: string; to: string } | null;
  /** Side allowed to move pieces. null = view only. */
  movable?: Color | 'both' | null;
  /** Return false to reject the move (the piece snaps back). */
  onMove?: (move: BoardMove) => boolean | void;
  arrows?: Arrow[];
  badge?: { square: string; classification: Classification } | null;
  /** Extra square tints, e.g. { e4: 'rgba(...)' }. */
  tints?: Record<string, string>;
  showCoordinates?: boolean;
  animationMs?: number;
}

const HIGHLIGHT = TINT.lastMove;
const MARK = TINT.mark;
const USER_ARROW = ARROW.user;
const HINT = TINT.moveHint;

interface PieceEl {
  id: number;
  code: PieceCode;
  square: string;
}

function piecesOf(fen: string): Array<{ code: PieceCode; square: string }> {
  const out: Array<{ code: PieceCode; square: string }> = [];
  const rows = fen.split(' ')[0]!.split('/');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      out.push({ code: `${color}${ch.toLowerCase()}` as PieceCode, square: `${'abcdefgh'[f]}${8 - r}` });
      f++;
    }
  });
  return out;
}

function dist(a: string, b: string) {
  return Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(Number(a[1]) - Number(b[1]));
}

/** Keeps piece identities across positions so moved pieces slide. */
function usePieceLayout(fen: string): PieceEl[] {
  const prev = useRef<PieceEl[]>([]);
  const nextId = useRef(1);
  return useMemo(() => {
    const next = piecesOf(fen);
    const pool = [...prev.current];
    const result: PieceEl[] = [];
    const pending: Array<{ code: PieceCode; square: string }> = [];
    for (const n of next) {
      const i = pool.findIndex((p) => p.code === n.code && p.square === n.square);
      if (i >= 0) result.push(pool.splice(i, 1)[0]!);
      else pending.push(n);
    }
    for (const n of pending) {
      let best = -1;
      let bestD = Infinity;
      pool.forEach((p, i) => {
        if (p.code !== n.code) return;
        const d = dist(p.square, n.square);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) result.push({ ...pool.splice(best, 1)[0]!, square: n.square });
      else result.push({ id: nextId.current++, code: n.code, square: n.square });
    }
    prev.current = result;
    return result;
  }, [fen]);
}

interface DragState {
  from: string;
  code: PieceCode;
  x: number;
  y: number;
  moved: boolean;
  wasSelected: boolean;
}

export function Board({
  fen,
  orientation = 'white',
  lastMove,
  movable = null,
  onMove,
  arrows = [],
  badge,
  tints,
  showCoordinates = true,
  animationMs = 110,
}: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pieces = usePieceLayout(fen);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: 'w' | 'b' } | null>(null);
  const [userArrows, setUserArrows] = useState<Arrow[]>([]);
  const [marks, setMarks] = useState<string[]>([]);
  const rightStart = useRef<{ square: string; color: string } | null>(null);

  useEffect(() => preloadPieces(), []);

  // New position: drop selection and annotations, like chess.com.
  useEffect(() => {
    setSelected(null);
    setDrag(null);
    setPromotion(null);
    setUserArrows([]);
    setMarks([]);
  }, [fen]);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const canMoveColor = (c: 'w' | 'b') => {
    if (!movable || !onMove) return false;
    const color = c === 'w' ? 'white' : 'black';
    if (color !== turn) return false;
    return movable === 'both' || movable === color;
  };

  const legalTargets = useMemo(() => {
    if (!selected || !chess) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    for (const m of chess.moves({ square: selected as Square, verbose: true })) {
      map.set(m.to, !!m.captured);
    }
    return map;
  }, [selected, chess]);

  const checkSquare = useMemo(() => {
    if (!chess || !chess.inCheck()) return null;
    const color = chess.turn();
    for (const p of piecesOf(fen)) if (p.code === `${color}k`) return p.square;
    return null;
  }, [chess, fen]);

  const pieceAt = useCallback((square: string) => pieces.find((p) => p.square === square), [pieces]);

  const squareFromEvent = (e: { clientX: number; clientY: number }) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    return xyToSquare(x, y, orientation);
  };

  const tryMove = (from: string, to: string) => {
    if (!chess || !legalTargets.has(to)) return false;
    const piece = chess.get(from as Square);
    if (piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      setPromotion({ from, to, color: piece.color });
      return true;
    }
    const accepted = onMove?.({ from, to });
    setSelected(null);
    return accepted !== false;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (promotion) return;
    const square = squareFromEvent(e);
    if (!square) return;
    if (e.button === 2) {
      rightStart.current = {
        square,
        color: e.shiftKey ? ARROW.userShift : e.ctrlKey || e.metaKey ? ARROW.userCtrl : e.altKey ? ARROW.userAlt : USER_ARROW,
      };
      return;
    }
    if (e.button !== 0) return;
    setUserArrows([]);
    setMarks([]);

    if (selected && selected !== square && legalTargets.has(square)) {
      tryMove(selected, square);
      return;
    }
    const piece = pieceAt(square);
    if (piece && canMoveColor(piece.code[0] as 'w' | 'b')) {
      setSelected(square);
      const rect = ref.current!.getBoundingClientRect();
      setDrag({ from: square, code: piece.code, x: e.clientX - rect.left, y: e.clientY - rect.top, moved: false, wasSelected: selected === square });
      ref.current!.setPointerCapture?.(e.pointerId);
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = ref.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const moved = drag.moved || Math.hypot(x - drag.x, y - drag.y) > 3;
    setDrag({ ...drag, x, y, moved });
    setHover(squareFromEvent(e));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button === 2 && rightStart.current) {
      const start = rightStart.current;
      rightStart.current = null;
      const end = squareFromEvent(e);
      if (!end) return;
      if (end === start.square) {
        setMarks((m) => (m.includes(end) ? m.filter((s) => s !== end) : [...m, end]));
      } else {
        setUserArrows((list) => {
          const exists = list.some((a) => a.from === start.square && a.to === end);
          return exists ? list.filter((a) => !(a.from === start.square && a.to === end)) : [...list, { from: start.square, to: end, color: start.color }];
        });
      }
      return;
    }
    if (!drag) return;
    const target = squareFromEvent(e);
    setDrag(null);
    setHover(null);
    if (drag.moved && target && target !== drag.from) {
      if (!tryMove(drag.from, target)) setSelected(null);
    } else if (!drag.moved && drag.wasSelected) {
      // Second click on the selected piece deselects it, like chess.com.
      setSelected(null);
    }
  };

  const choosePromotion = (piece: 'q' | 'r' | 'b' | 'n' | null) => {
    const p = promotion;
    setPromotion(null);
    setSelected(null);
    if (p && piece) onMove?.({ from: p.from, to: p.to, promotion: piece });
  };

  const allArrows = [...arrows, ...userArrows];
  const draggingFrom = drag?.moved ? drag.from : null;

  return (
    <div
      ref={ref}
      className="relative aspect-square w-full select-none touch-none overflow-visible"
      style={{ containerType: 'inline-size' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* squares */}
      <div className="absolute inset-0 overflow-hidden rounded-[4px]">
        {ALL_SQUARES.map((sq) => {
          const { x, y } = squareToXY(sq, orientation);
          const light = isLightSquare(sq);
          const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
          const overlay = marks.includes(sq) ? MARK : tints?.[sq] ?? (selected === sq || isLast ? HIGHLIGHT : undefined);
          return (
            <div
              key={sq}
              className="absolute"
              style={{
                left: `${x * 12.5}%`,
                top: `${y * 12.5}%`,
                width: '12.5%',
                height: '12.5%',
                background: light ? 'var(--color-sq-light)' : 'var(--color-sq-dark)',
              }}
            >
              {overlay && <div className="absolute inset-0" style={{ background: overlay }} />}
              {checkSquare === sq && (
                <div
                  className="absolute inset-0"
                  style={{ background: 'radial-gradient(ellipse at center, rgba(248,113,113,1) 0%, rgba(239,68,68,0.9) 30%, rgba(239,68,68,0) 88%)' }}
                />
              )}
              {drag?.moved && hover === sq && (
                <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 0 0.45cqw rgba(255,255,255,0.65)' }} />
              )}
              {showCoordinates && x === 0 && (
                <span
                  className="absolute font-bold leading-none"
                  style={{ left: '0.7cqw', top: '0.55cqw', fontSize: '2.9cqw', color: light ? 'var(--color-sq-dark)' : 'var(--color-sq-light)' }}
                >
                  {sq[1]}
                </span>
              )}
              {showCoordinates && y === 7 && (
                <span
                  className="absolute font-bold leading-none"
                  style={{ right: '0.75cqw', bottom: '0.45cqw', fontSize: '2.9cqw', color: light ? 'var(--color-sq-dark)' : 'var(--color-sq-light)' }}
                >
                  {sq[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* legal move hints */}
      {[...legalTargets.entries()].map(([sq, capture]) => {
        const { x, y } = squareToXY(sq, orientation);
        return (
          <div key={`h-${sq}`} className="pointer-events-none absolute flex items-center justify-center" style={{ left: `${x * 12.5}%`, top: `${y * 12.5}%`, width: '12.5%', height: '12.5%', zIndex: 3 }}>
            {capture ? (
              <div className="rounded-full" style={{ width: '90%', height: '90%', border: `0.95cqw solid ${HINT}` }} />
            ) : (
              <div className="rounded-full" style={{ width: '33%', height: '33%', background: HINT }} />
            )}
          </div>
        );
      })}

      {/* pieces */}
      {pieces.map((p) => {
        const { x, y } = squareToXY(p.square, orientation);
        const hidden = draggingFrom === p.square;
        return (
          <img
            key={p.id}
            src={pieceUrl(p.code)}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: '12.5%',
              height: '12.5%',
              transform: `translate(${x * 100}%, ${y * 100}%)`,
              transition: animationMs ? `transform ${animationMs}ms ease-out` : undefined,
              opacity: hidden ? 0 : 1,
              zIndex: 2,
            }}
          />
        );
      })}

      {/* dragged piece */}
      {drag?.moved && (
        <img
          src={pieceUrl(drag.code)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute"
          style={{ width: '12.5%', height: '12.5%', left: drag.x, top: drag.y, transform: 'translate(-50%, -50%)', zIndex: 20 }}
        />
      )}

      {/* arrows */}
      {allArrows.length > 0 && (
        <svg className="pointer-events-none absolute inset-0" viewBox="0 0 8 8" style={{ zIndex: 4 }}>
          {allArrows.map((a, i) => (
            <g key={`${a.from}-${a.to}-${i}`} opacity={0.82}>
              <polygon points={arrowPolygon(a.from, a.to, orientation)} fill={a.color ?? USER_ARROW} />
            </g>
          ))}
        </svg>
      )}

      {/* classification badge on the destination square */}
      {badge && (() => {
        const { x, y } = squareToXY(badge.square, orientation);
        const nearRight = x === 7;
        const nearTop = y === 0;
        return (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `calc(${(x + 1) * 12.5}% - ${nearRight ? '5.4cqw' : '3.2cqw'})`,
              top: `calc(${y * 12.5}% - ${nearTop ? '0.2cqw' : '2.2cqw'})`,
              zIndex: 6,
            }}
          >
            <ClassificationIcon cls={badge.classification} size="5.4cqw" />
          </div>
        );
      })()}

      {/* promotion picker */}
      {promotion && (() => {
        const { x, y } = squareToXY(promotion.to, orientation);
        const down = y === 0;
        const options: Array<'q' | 'n' | 'r' | 'b'> = ['q', 'n', 'r', 'b'];
        return (
          <div className="absolute inset-0" style={{ zIndex: 30, background: 'rgba(0,0,0,0.35)' }} onPointerDown={(e) => { e.stopPropagation(); choosePromotion(null); }}>
            <div
              className="absolute flex flex-col overflow-hidden rounded-lg bg-raise shadow-2xl ring-1 ring-line"
              style={{ left: `${x * 12.5}%`, top: down ? `${y * 12.5}%` : undefined, bottom: down ? undefined : `${(7 - y) * 12.5}%`, width: '12.5%', flexDirection: down ? 'column' : 'column-reverse' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {options.map((t) => (
                <button key={t} type="button" className="aspect-square w-full hover:bg-raise-2" onClick={() => choosePromotion(t)}>
                  <img src={pieceUrl(`${promotion.color}${t}` as PieceCode)} alt={t} className="h-full w-full" draggable={false} />
                </button>
              ))}
              <button type="button" className="py-[0.6cqw] text-[2.4cqw] font-bold text-ink-3 hover:bg-raise-2" onClick={() => choosePromotion(null)}>
                ✕
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
