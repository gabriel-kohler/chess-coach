import { Chess } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playSound, soundForSan } from '@/components/board/assets';
import { Board, type BoardMove } from '@/components/board/Board';
import { tryUci } from '@/lib/chess/replay';
import { sharedEngine } from '@/lib/engine/stockfish';
import { winPercent } from '@/lib/review/scoring';
import type { Color, Puzzle } from '@/lib/types';

export type PuzzleStatus = 'setup' | 'playing' | 'checking' | 'solved' | 'failed' | 'shown';

export interface PuzzleFeedback {
  kind: 'none' | 'good' | 'wrong' | 'alternative' | 'solved' | 'failed';
  text: string;
}

interface Props {
  puzzle: Puzzle;
  /** Called once with the rated result: first failure, or a clean solve. */
  onResult: (solved: boolean, timeMs: number) => void;
  onFinished: () => void;
  onFeedback: (f: PuzzleFeedback) => void;
  /** Bumped by the parent to request a hint or the full solution. */
  hintToken: number;
  solutionToken: number;
}


export function PuzzlePlayer({ puzzle, onResult, onFinished, onFeedback, hintToken, solutionToken }: Props) {
  const [fen, setFen] = useState(puzzle.fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  // How many moves of the stored line are on the board. The board itself can
  // briefly show a wrong attempt, so this, not the displayed FEN, is the truth.
  const applied = useRef(0);
  const [status, setStatus] = useState<PuzzleStatus>('setup');
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [wrongSquare, setWrongSquare] = useState<string | null>(null);
  const failed = useRef(false);
  const reported = useRef(false);
  const started = useRef(Date.now());
  // Timers and engine checks belong to one puzzle (and one attempt); any
  // callback from an older generation is ignored.
  const gen = useRef(0);
  const [orientation, setOrientation] = useState<Color>('white');

  const report = useCallback(
    (solved: boolean) => {
      if (reported.current) return;
      reported.current = true;
      onResult(solved, Date.now() - started.current);
    },
    [onResult],
  );

  // Play the setup move (the opponent's last move) after a short pause.
  useEffect(() => {
    const myGen = ++gen.current;
    failed.current = false;
    reported.current = false;
    setFen(puzzle.fen);
    setLastMove(null);
    applied.current = 0;
    setStatus('setup');
    setHintSquare(null);
    setWrongSquare(null);
    onFeedback({ kind: 'none', text: '' });
    const chess = new Chess(puzzle.fen);
    const setupColor = chess.turn() === 'w' ? 'white' : 'black';
    setOrientation(setupColor === 'white' ? 'black' : 'white');
    const t = setTimeout(() => {
      if (myGen !== gen.current) return;
      const mv = tryUci(chess, puzzle.moves[0] ?? '');
      if (!mv) {
        onFeedback({ kind: 'failed', text: 'Este puzzle tem um lance inválido. Pule para o próximo.' });
        setStatus('shown');
        onFinished();
        return;
      }
      playSound(soundForSan(mv.san, !!mv.captured));
      setFen(chess.fen());
      setLastMove({ from: mv.from, to: mv.to });
      applied.current = 1;
      setStatus('playing');
      started.current = Date.now();
    }, 650);
    return () => clearTimeout(t);
  }, [puzzle]);

  const finishSolved = useCallback(() => {
    setStatus('solved');
    if (!failed.current) {
      report(true);
      onFeedback({ kind: 'solved', text: 'Resolvido!' });
    } else onFeedback({ kind: 'solved', text: 'Completo. Este conta como erro e volta na revisão.' });
    playSound('notify');
    onFinished();
  }, [onFeedback, onFinished, report]);

  const opponentReply = useCallback((chess: Chess, nextStep: number) => {
    const myGen = gen.current;
    setTimeout(() => {
      if (myGen !== gen.current) return;
      const uci = puzzle.moves[nextStep];
      const mv = uci ? tryUci(chess, uci) : null;
      if (!mv) return;
      playSound(soundForSan(mv.san, !!mv.captured));
      setFen(chess.fen());
      setLastMove({ from: mv.from, to: mv.to });
      applied.current = nextStep + 1;
      setStatus('playing');
    }, 380);
  }, [puzzle]);

  const accept = useCallback((chess: Chess, nextStep: number) => {
    if (nextStep >= puzzle.moves.length) finishSolved();
    else opponentReply(chess, nextStep);
  }, [finishSolved, opponentReply, puzzle.moves.length]);

  const onMove = (m: BoardMove): boolean => {
    if (status !== 'playing') return false;
    const step = applied.current;
    const expected = puzzle.moves[step]!;
    const chess = new Chess(fen);
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      return false;
    }
    const uci = mv.lan;
    playSound(soundForSan(mv.san, !!mv.captured));
    setHintSquare(null);
    setWrongSquare(null);

    if (uci === expected || chess.isCheckmate()) {
      setFen(chess.fen());
      setLastMove({ from: mv.from, to: mv.to });
      onFeedback({ kind: 'good', text: `${mv.san} é o lance!` });
      applied.current = step + 1;
      // Not the user's turn until the reply lands: no hint, no solution race.
      if (step + 1 < puzzle.moves.length) setStatus('setup');
      accept(chess, step + 1);
      return true;
    }

    // Not the stored move: ask the engine whether it wins just as well.
    setFen(chess.fen());
    setLastMove({ from: mv.from, to: mv.to });
    setStatus('checking');
    const before = fen;
    const isLast = step === puzzle.moves.length - 1;
    const expectedChess = new Chess(before);
    tryUci(expectedChess, expected);
    const engine = sharedEngine();
    const myGen = gen.current;
    void Promise.all([engine.analyse(chess.fen(), { depth: 14 }), engine.analyse(expectedChess.fen(), { depth: 14 })]).then(([mine, theirs]) => {
      if (myGen !== gen.current) return;
      const sign = new Chess(before).turn() === 'w' ? 1 : -1;
      const win = (lines: typeof mine) => {
        const w = winPercent(lines[0]?.mate !== undefined ? { mate: lines[0].mate } : { cp: lines[0]?.cp ?? 0 });
        return sign === 1 ? w : 100 - w;
      };
      const mineWin = win(mine);
      const bestWin = win(theirs);
      const alsoWins = puzzle.source === 'mine' ? bestWin - mineWin <= 5 : mineWin >= 85 && bestWin - mineWin <= 6;
      if (alsoWins && (isLast || puzzle.source === 'mine')) {
        onFeedback({ kind: 'good', text: `${mv.san} também funciona.` });
        setStatus('playing');
        finishSolved();
        return;
      }
      if (alsoWins) {
        onFeedback({ kind: 'alternative', text: `${mv.san} também ganha, mas existe um lance mais forte. Tente de novo (sem penalidade).` });
      } else {
        failed.current = true;
        report(false);
        setWrongSquare(mv.to);
        onFeedback({ kind: 'wrong', text: `${mv.san} não funciona. Tente de novo ou veja a solução.` });
        playSound('illegal');
      }
      setTimeout(() => {
        if (myGen !== gen.current) return;
        setFen(before);
        setLastMove(null);
        setStatus('playing');
      }, 700);
    });
    return true;
  };

  // Hint: highlight the piece to move. Counts as a failure.
  useEffect(() => {
    if (!hintToken || status !== 'playing') return;
    const uci = puzzle.moves[applied.current];
    if (!uci) return;
    failed.current = true;
    report(false);
    setHintSquare(uci.slice(0, 2));
    onFeedback({ kind: 'wrong', text: 'Dica: mova a peça destacada. Este puzzle volta na revisão.' });
  }, [hintToken]);

  // Solution: play the remaining moves one by one.
  useEffect(() => {
    if (!solutionToken) return;
    failed.current = true;
    report(false);
    setStatus('shown');
    // A pending engine check must not revert the board mid-solution.
    const myGen = ++gen.current;
    // Replay from the stored line, not from whatever the board shows now.
    const chess = new Chess(puzzle.fen);
    for (let k = 0; k < applied.current; k++) if (!tryUci(chess, puzzle.moves[k]!)) break;
    setFen(chess.fen());
    setWrongSquare(null);
    let i = applied.current;
    const tick = () => {
      if (myGen !== gen.current) return;
      const uci = puzzle.moves[i];
      const mv = uci ? tryUci(chess, uci) : null;
      if (!mv) {
        onFeedback({ kind: 'failed', text: 'Esta é a solução. O puzzle volta na sua revisão.' });
        onFinished();
        return;
      }
      playSound(soundForSan(mv.san, !!mv.captured));
      setFen(chess.fen());
      setLastMove({ from: mv.from, to: mv.to });
      i++;
      setTimeout(tick, 650);
    };
    tick();
  }, [solutionToken]);

  const tints: Record<string, string> = {};
  if (hintSquare) tints[hintSquare] = 'rgba(92, 139, 176, 0.75)';
  if (wrongSquare) tints[wrongSquare] = 'rgba(250, 65, 45, 0.55)';

  return (
    <Board
      fen={fen}
      orientation={orientation}
      lastMove={lastMove}
      movable={status === 'playing' ? orientation : null}
      onMove={onMove}
      tints={tints}
    />
  );
}
