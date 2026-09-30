// After an exercise, as on chess.com: step back and forth through the line
// (buttons or the arrow keys), or move the pieces to try another move, with
// the engine answering live. Built on the game review's explorer: a main line
// plus one variation that starts wherever you leave it.
import { Chess, type Move } from 'chess.js';
import { useEffect, useState } from 'react';
import { sharedEngine } from '@/lib/engine/stockfish';
import type { EngineLine } from '@/lib/types';
import { playSound, soundForSan } from './assets';
import type { BoardMove } from './Board';
import type { Arrow } from './geometry';

export interface LinePly {
  san: string;
  uci: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  captured: boolean;
}

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const plyOf = (mv: Move): LinePly => ({ san: mv.san, uci: mv.lan, from: mv.from, to: mv.to, fenBefore: mv.before, fenAfter: mv.after, captured: !!mv.captured });

/** The plies of a line of moves (UCI or SAN) from a position, up to the first illegal one. */
export function lineFrom(start: string, moves: string[]): LinePly[] {
  const chess = new Chess(start);
  const out: LinePly[] = [];
  for (const m of moves) {
    try {
      out.push(plyOf(UCI.test(m) ? chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }) : chess.move(m)));
    } catch {
      break;
    }
  }
  return out;
}

export interface Variation {
  /** Plies of the main line before it. */
  base: number;
  moves: LinePly[];
  /** Moves of the variation on the board. */
  index: number;
}

export interface LiveLines {
  fen: string;
  lines: EngineLine[];
  depth: number;
}

export interface LineExplorer {
  enabled: boolean;
  start: string;
  line: LinePly[];
  ply: number;
  variation: Variation | null;
  fen: string;
  /** The plies from the start to the position on the board, a variation's included. */
  path: LinePly[];
  lastMove: { from: string; to: string } | null;
  /** The engine's best move while you try moves. */
  arrows: Arrow[];
  live: LiveLines | null;
  onMove: (m: BoardMove) => boolean;
  go: (ply: number) => void;
  step: (delta: number) => void;
  backToLine: () => void;
}

const ENGINE_ARROW = 'rgba(92, 139, 176, 0.85)';

export function useLineExplorer({ start, line, enabled, initialPly = 0, startLastMove = null, engineAlways = false }: {
  start: string;
  line: LinePly[];
  /** Only once the exercise is decided: navigating never touches a grade. */
  enabled: boolean;
  /** Where it opens: 0 is the exercise's position, line.length its end. */
  initialPly?: number;
  /** The move that led to the start position, to highlight it there. */
  startLastMove?: { from: string; to: string } | null;
  /** The engine on the line's own positions too, not only on moves you try (analysing a repertoire line). */
  engineAlways?: boolean;
}): LineExplorer {
  const [ply, setPly] = useState(initialPly);
  const [variation, setVariation] = useState<Variation | null>(null);
  const [live, setLive] = useState<LiveLines | null>(null);

  // A new line, or the exercise just decided: back to where the caller wants it.
  const key = `${start}|${line.map((p) => p.uci).join(' ')}|${enabled}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setPly(Math.min(initialPly, line.length));
    setVariation(null);
  }

  const fenAt = (k: number) => (k <= 0 ? start : line[k - 1]?.fenAfter ?? start);
  const fen = variation ? (variation.index === 0 ? fenAt(variation.base) : variation.moves[variation.index - 1]!.fenAfter) : fenAt(ply);
  const path = variation ? [...line.slice(0, variation.base), ...variation.moves.slice(0, variation.index)] : line.slice(0, ply);
  const shown = variation ? (variation.index > 0 ? variation.moves[variation.index - 1] : line[variation.base - 1]) : line[ply - 1];
  const lastMove = shown ? { from: shown.from, to: shown.to } : startLastMove;

  const go = (next: number) => {
    const n = Math.max(0, Math.min(line.length, next));
    if (!variation && n === ply + 1 && line[ply]) playSound(soundForSan(line[ply]!.san, line[ply]!.captured));
    setVariation(null);
    setPly(n);
  };

  const step = (delta: number) => {
    if (!variation) return go(ply + delta);
    const index = variation.index + delta;
    if (index < 0) {
      setVariation(null);
      setPly(variation.base);
      return;
    }
    if (index > variation.moves.length) return;
    if (delta > 0) playSound(soundForSan(variation.moves[index - 1]!.san, variation.moves[index - 1]!.captured));
    setVariation({ ...variation, index });
  };

  const backToLine = () => {
    if (!variation) return;
    setPly(variation.base);
    setVariation(null);
  };

  const onMove = (m: BoardMove): boolean => {
    if (!enabled) return false;
    const chess = new Chess(fen);
    let mv: Move;
    try {
      mv = chess.move(m);
    } catch {
      return false;
    }
    playSound(soundForSan(mv.san, !!mv.captured));
    const p = plyOf(mv);
    if (!variation) {
      // The line's own next move just walks the line.
      if (line[ply]?.uci === p.uci) setPly(ply + 1);
      else setVariation({ base: ply, moves: [p], index: 1 });
    } else if (variation.moves[variation.index]?.uci === p.uci) {
      setVariation({ ...variation, index: variation.index + 1 });
    } else {
      setVariation({ ...variation, moves: [...variation.moves.slice(0, variation.index), p], index: variation.index + 1 });
    }
    return true;
  };

  // The engine follows the board while you try moves (and on the line itself, when asked).
  const engineOn = enabled && (!!variation || engineAlways);
  useEffect(() => {
    if (!engineOn) {
      setLive(null);
      return;
    }
    const engine = sharedEngine();
    let cancelled = false;
    void engine.live(fen, { depth: 20, multipv: 3 }, (u) => {
      if (!cancelled) setLive({ fen, lines: u.lines, depth: u.depth });
    });
    return () => {
      cancelled = true;
      engine.cancelLive();
    };
  }, [fen, engineOn]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(line.length);
      else if (e.key === 'Escape') backToLine();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const best = engineOn && live?.fen === fen ? live.lines[0]?.pv[0] : undefined;
  const arrows: Arrow[] = best ? [{ from: best.slice(0, 2), to: best.slice(2, 4), color: ENGINE_ARROW }] : [];

  return { enabled, start, line, ply, variation, fen, path, lastMove, arrows, live: engineOn ? live : null, onMove, go, step, backToLine };
}
