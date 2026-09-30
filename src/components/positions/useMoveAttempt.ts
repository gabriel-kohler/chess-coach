// One attempt at one position: the board, the move check, the grade of the
// first move. It saves nothing: the best-move mode saves on the first move,
// a sequence saves once at its end. Mount it once per shown position (key the
// component), so every attempt starts from a fresh reducer.
import { Chess } from 'chess.js';
import { useEffect, useReducer, useRef } from 'react';
import { Rating, type Grade } from 'ts-fsrs';
import { playSound, soundForSan } from '@/components/board/assets';
import type { BoardMove } from '@/components/board/Board';
import type { Arrow } from '@/components/board/geometry';
import { tryMove } from '@/lib/chess/replay';
import { useTrainingActive } from '@/lib/renewal/activity';
import { attemptReducer, initAttempt, type AttemptState, type FirstAttempt } from '@/lib/positions/attempt';
import { POSITIONS } from '@/lib/positions/config';
import { lossClass, type GradingRule } from '@/lib/positions/grade';
import { engineScore, storedScore } from '@/lib/positions/score';
import type { MoveScore, ScoreTarget } from '@/lib/positions/types';
import type { Classification } from '@/lib/types';

const BEST_ARROW = 'rgb(150, 190, 70)';
const WRONG_ARROW = 'rgba(250, 65, 45, 0.85)';
const HARD_ARROW = 'rgba(247, 198, 49, 0.9)';

export interface FirstEvent {
  first: FirstAttempt;
  rating: Grade;
  startedAt: number;
  hiddenMs: number;
}

export interface AttemptOptions {
  /** Grading rule in use for this kind (picked by the optimizer). */
  rule?: GradingRule;
  /** Called once, when the first move (or giving up) decides the grade. */
  onFirst?: (e: FirstEvent) => void;
  /** Every engine verdict, to cache it. */
  onScored?: (s: MoveScore) => void;
}

function timeout<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

export function useMoveAttempt(target: ScoreTarget, expectedMs: number, options: AttemptOptions = {}) {
  useTrainingActive();
  const [state, dispatch] = useReducer(attemptReducer, { expectedMs, rule: options.rule ?? 'timed' }, (i) => initAttempt(i.expectedMs, i.rule));
  const gen = useRef(0);
  const opts = useRef(options);
  opts.current = options;
  const firstSent = useRef(false);
  const hidden = useRef({ total: 0, since: null as number | null });

  // Show the position, then start the clock.
  useEffect(() => {
    const myGen = ++gen.current;
    const t = setTimeout(() => {
      if (myGen === gen.current) dispatch({ type: 'ready', at: Date.now() });
    }, 350);
    return () => {
      clearTimeout(t);
      gen.current++;
    };
  }, []);

  // Time with the tab hidden does not count as thinking time.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) hidden.current.since = Date.now();
      else if (hidden.current.since !== null) {
        hidden.current.total += Date.now() - hidden.current.since;
        hidden.current.since = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const elapsed = () => (state.startedAt === null ? 0 : Math.max(0, Date.now() - state.startedAt - hidden.current.total));

  const onMove = (m: BoardMove): boolean => {
    if (state.phase !== 'playing') return false;
    const chess = new Chess(target.fen);
    const mv = tryMove(chess, m);
    if (!mv) return false;
    playSound(soundForSan(mv.san, !!mv.captured));
    const uci = mv.lan;
    dispatch({ type: 'move', uci, san: mv.san, fenAfter: chess.fen(), timeMs: elapsed() });
    const stored = storedScore(target, uci, chess.isCheckmate());
    if (stored) {
      queueMicrotask(() => dispatch({ type: 'scored', uci, score: stored }));
      return true;
    }
    const myGen = gen.current;
    void Promise.race([engineScore(target, uci), timeout<MoveScore>(POSITIONS.engineTimeoutMs)])
      .then((score) => {
        if (myGen !== gen.current) return;
        dispatch({ type: 'scored', uci, score });
        opts.current.onScored?.(score);
      })
      .catch(() => {
        if (myGen === gen.current) dispatch({ type: 'scoreFailed', uci });
      });
    return true;
  };

  // A wrong move stays on the board for a moment, then the position comes back.
  useEffect(() => {
    if (state.phase !== 'wrong') return;
    playSound('illegal');
    const myGen = gen.current;
    const t = setTimeout(() => {
      if (myGen === gen.current) dispatch({ type: 'revert' });
    }, 900);
    return () => clearTimeout(t);
  }, [state.phase, state.tries]);

  useEffect(() => {
    if (!state.first || !state.rating || firstSent.current) return;
    firstSent.current = true;
    opts.current.onFirst?.({ first: state.first, rating: state.rating, startedAt: state.startedAt ?? Date.now(), hiddenMs: hidden.current.total });
  }, [state.first, state.rating]);

  const giveUp = () => dispatch({ type: 'giveUp', timeMs: elapsed() });
  const hint = () => dispatch({ type: 'hint' });

  return { state, onMove, giveUp, hint, board: boardView(target, state) };
}

export function boardView(target: ScoreTarget, s: AttemptState) {
  const showingMove = (s.phase === 'checking' || s.phase === 'wrong') && s.pending;
  const tints: Record<string, string> = {};
  if (s.phase === 'wrong' && s.pending) tints[s.pending.uci.slice(2, 4)] = 'rgba(250, 65, 45, 0.55)';
  if (s.hint && s.phase === 'playing') tints[target.best.uci.slice(0, 2)] = 'rgba(92, 139, 176, 0.75)';
  const arrows: Arrow[] = [];
  let badge: { square: string; classification: Classification } | null = null;
  if (s.phase === 'verdict') {
    arrows.push({ from: target.best.uci.slice(0, 2), to: target.best.uci.slice(2, 4), color: BEST_ARROW });
    const f = s.first;
    if (f?.uci && f.uci !== target.best.uci && f.loss !== null) {
      arrows.push({ from: f.uci.slice(0, 2), to: f.uci.slice(2, 4), color: s.rating === Rating.Again ? WRONG_ARROW : HARD_ARROW });
      badge = { square: f.uci.slice(2, 4), classification: lossClass(f.loss, f.exact) };
    } else if (f?.uci) {
      badge = { square: f.uci.slice(2, 4), classification: lossClass(f.loss ?? 0, f.exact) };
    }
  }
  return {
    fen: showingMove ? s.pending!.fenAfter : target.fen,
    lastMove: showingMove ? { from: s.pending!.uci.slice(0, 2), to: s.pending!.uci.slice(2, 4) } : target.prevMove,
    movable: s.phase === 'playing' ? target.color : null,
    tints,
    arrows,
    badge,
  };
}
