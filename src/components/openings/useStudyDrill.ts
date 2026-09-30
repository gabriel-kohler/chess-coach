// Training any opening: the opening's moves play by themselves, then the app
// answers as people at your level do (see levelMoves: your opponents, the
// Lichess explorer in your rating range, Maia past the opening) and the
// engine judges your moves. A move that gives up 5 or more win-chance points
// is a miss: you see the best one, try again, and the position joins your
// reviews (the deck's card, when you saved the opening as a deck and the
// position is in it). The moves the engine approves are kept: a deck you
// build later answers with them.
import { Chess } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playSound, soundForSan } from '@/components/board/assets';
import type { BoardMove } from '@/components/board/Board';
import type { Arrow } from '@/components/board/geometry';
import { lineFrom, useLineExplorer } from '@/components/board/useLineExplorer';
import { epdOf, START_FEN, tryMove, tryUci, uciToSan } from '@/lib/chess/replay';
import { sharedEngine } from '@/lib/engine/stockfish';
import { maiaPolicy } from '@/lib/maia/client';
import { explorerMoves } from '@/lib/openings/explorer';
import { drawReply, engineReplies, levelMoves, lineId, moveLoss, type LevelSource, type OpeningLine } from '@/lib/openings/study';
import { recordOpeningMiss, saveStudyLine } from '@/lib/openings/studyStore';
import { saveStudyMove } from '@/lib/decks/store';
import { pickReplies } from '@/lib/positions/replies';
import { useTrainingActive } from '@/lib/renewal/activity';
import { INACCURACY } from '@/lib/repertoire/accept';
import type { RepertoirePosition } from '@/lib/repertoire/compile';
import { grade, repertoireExpectedMs } from '@/lib/repertoire/drill';
import type { OpeningTree } from '@/lib/repertoire/games';
import { deckNamespace } from '@/lib/srs/cards';
import type { Color, EngineLine } from '@/lib/types';

/** Your moves after the opening in one line. */
export const STUDY_MOVES = 8;
const REPLY_MS = 450;
const BEST_ARROW = 'rgb(150, 190, 70)';

export interface StudySetup {
  line: OpeningLine;
  side: Color;
  /** Your games as that color. */
  tree: OpeningTree | null;
  /** Ratings on Maia's scale (already offset). */
  userElo: number;
  oppElo: number;
  /** Your rating, for the review exercises. */
  rating: number;
  maia: boolean;
  /** The server has a Lichess token: the explorer answers. */
  explorer: boolean;
  /** Your deck of this opening: its positions are graded on its cards instead of becoming puzzles. */
  deck?: { id: string; positions: Record<string, RepertoirePosition> } | null;
}

export type StudyPhase = 'opponent' | 'yours' | 'checking' | 'wrong' | 'end';

export interface StudyReply {
  san: string;
  p: number;
  /** engine: no data for your level here, the engine's choices stand in. */
  source: LevelSource | 'engine';
}

export interface StudyFeedback {
  kind: 'none' | 'good' | 'wrong' | 'end';
  text: string;
}

const colorOf = (fen: string): Color => (fen.split(' ')[1] === 'w' ? 'white' : 'black');

export function useStudyDrill(setup: StudySetup) {
  useTrainingActive();
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [played, setPlayedState] = useState<string[]>([]);
  const playedRef = useRef<string[]>([]);
  const setPlayed = (p: string[]) => {
    playedRef.current = p;
    setPlayedState(p);
  };
  const [phase, setPhase] = useState<StudyPhase>('opponent');
  const [feedback, setFeedback] = useState<StudyFeedback>({ kind: 'none', text: '' });
  const [reply, setReply] = useState<StudyReply | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [count, setCount] = useState({ yours: 0, asked: 0, good: 0, lines: 0 });
  const stats = useRef({ yours: 0, asked: 0, good: 0 });
  const chess = useRef(new Chess());
  const gen = useRef(0);
  const best = useRef(new Map<string, Promise<EngineLine[]>>());
  /** The opponent's last move and the position before it: a missed answer's review replays it. */
  const prev = useRef<{ fenBefore: string; uci: string; lastMove: { from: string; to: string } } | null>(null);
  const missed = useRef(new Set<string>());
  const turnAt = useRef(Date.now());

  const engine = sharedEngine();
  const bestFor = useCallback((f: string) => {
    let p = best.current.get(f);
    if (!p) {
      p = engine.analyse(f, { depth: 16, multipv: 4, movetime: 2500 });
      best.current.set(f, p);
    }
    return p;
  }, [engine]);

  const sync = () => setCount((c) => ({ ...c, ...stats.current }));

  const end = useCallback((text: string) => {
    setPhase('end');
    setFeedback({ kind: 'end', text });
    setArrows([]);
    const s = stats.current;
    setCount((c) => ({ ...c, ...s, lines: c.lines + 1 }));
    if (s.asked) void saveStudyLine(lineId(setupRef.current.line), setupRef.current.side, s.asked, s.good);
  }, []);

  const opponentReplies = useCallback(async (f: string): Promise<StudyReply & { uci: string } | null> => {
    const s = setupRef.current;
    const moves = await levelMoves(f, { tree: s.tree, userColor: s.side, userElo: s.userElo, oppElo: s.oppElo, policy: s.maia ? maiaPolicy : null, explorer: s.explorer ? explorerMoves : null });
    // The 2 to 4 moves people really play (10% or more), each drawn as often as they play it.
    const pick = drawReply(pickReplies(moves));
    if (pick) return { uci: pick.uci, san: pick.san, p: pick.p, source: pick.source };
    // No data for your level here: the engine's choices stand in.
    const engineMoves = engineReplies(f, await bestFor(f));
    const total = engineMoves.reduce((a, m) => a + m.p, 0);
    const chosen = drawReply(engineMoves);
    return chosen ? { uci: chosen.uci, san: chosen.san, p: chosen.p / total, source: 'engine' } : null;
  }, [bestFor]);

  const advance = useCallback((myGen: number) => {
    if (myGen !== gen.current) return;
    const c = chess.current;
    if (c.isGameOver()) return end(c.isCheckmate() ? 'Mate na linha.' : 'A partida empatou na linha.');
    const f = c.fen();
    if (colorOf(f) === setupRef.current.side) {
      if (stats.current.yours >= STUDY_MOVES) return end(`Fim da linha: ${STUDY_MOVES} lances seus depois da abertura.`);
      setPhase('yours');
      turnAt.current = Date.now();
      void bestFor(f); // ready by the time you move
      return;
    }
    setPhase('opponent');
    void opponentReplies(f).then((pick) => {
      if (myGen !== gen.current) return;
      if (!pick) return end('Sem resposta para esta posição.');
      setTimeout(() => {
        if (myGen !== gen.current) return;
        const before = c.fen();
        const mv = tryUci(c, pick.uci);
        if (!mv) return end('Sem resposta para esta posição.');
        playSound(soundForSan(mv.san, !!mv.captured));
        prev.current = { fenBefore: before, uci: mv.lan, lastMove: { from: mv.from, to: mv.to } };
        setFen(c.fen());
        setLastMove({ from: mv.from, to: mv.to });
        setPlayed([...playedRef.current, mv.san]);
        setReply({ san: mv.san, p: pick.p, source: pick.source });
        advance(myGen);
      }, REPLY_MS);
    });
  }, [bestFor, end, opponentReplies]);

  /** A new line from the opening's last move. */
  const newLine = useCallback(() => {
    const myGen = ++gen.current;
    const s = setupRef.current;
    stats.current = { yours: 0, asked: 0, good: 0 };
    sync();
    missed.current = new Set();
    setFeedback({ kind: 'none', text: '' });
    setReply(null);
    setArrows([]);
    const c = new Chess();
    prev.current = null;
    let last: { from: string; to: string } | null = null;
    for (const san of s.line.moves) {
      const before = c.fen();
      const mv = tryMove(c, san);
      if (!mv) break;
      last = { from: mv.from, to: mv.to };
      if (colorOf(before) !== s.side) prev.current = { fenBefore: before, uci: mv.lan, lastMove: last };
    }
    chess.current = c;
    setPlayed(c.history());
    setFen(c.fen());
    setLastMove(last);
    advance(myGen);
  }, [advance]);

  useEffect(() => {
    newLine();
    return () => {
      gen.current++;
    };
  }, [setup.line.name, setup.side]);

  /** The deck's answer at a position, when you saved the opening as a deck and the position is in it. */
  const deckMove = (f: string) => setupRef.current.deck?.positions[epdOf(f)]?.moves[0];
  const expectedMs = useRef(10_000);
  useEffect(() => {
    void repertoireExpectedMs().then((ms) => (expectedMs.current = ms));
  }, []);
  /** Your first try at one of the deck's positions, on its card: its move is the right one, a miss is Again. */
  const gradeDeck = (f: string, uci: string, correct: boolean, timeMs: number) => {
    const s = setupRef.current;
    if (!s.deck) return;
    void grade(s.side, epdOf(f), { uci, correct, timeMs, hiddenMs: 0, expectedMs: expectedMs.current }, Date.now(), undefined, deckNamespace(s.deck.id));
  };

  const miss = (f: string, bestUci: string | undefined, timeMs: number, playedUci: string) => {
    const epd = epdOf(f);
    if (missed.current.has(epd)) return;
    missed.current.add(epd);
    stats.current.asked++;
    sync();
    const p = prev.current;
    const s = setupRef.current;
    if (deckMove(f)) return gradeDeck(f, playedUci, false, timeMs);
    if (p && bestUci) void recordOpeningMiss({ name: s.line.name, fenBefore: p.fenBefore, oppUci: p.uci, bestUci, epd, rating: s.rating, timeMs });
  };

  /** Your move is played on the board; the line goes on from it. */
  const accept = (san: string, myGen: number) => {
    const c = chess.current;
    const mv = tryMove(c, san);
    if (!mv) return;
    stats.current.yours++;
    sync();
    setFen(c.fen());
    setLastMove({ from: mv.from, to: mv.to });
    setPlayed([...playedRef.current, mv.san]);
    advance(myGen);
  };

  const onMove = (m: BoardMove): boolean => {
    if (phase !== 'yours') return false;
    const f = chess.current.fen();
    const test = new Chess(f);
    const mv = tryMove(test, m);
    if (!mv) return false;
    playSound(soundForSan(mv.san, !!mv.captured));
    setFen(test.fen());
    setLastMove({ from: mv.from, to: mv.to });
    setArrows([]);
    setPhase('checking');
    const myGen = gen.current;
    const timeMs = Date.now() - turnAt.current;
    void (async () => {
      const lines = await bestFor(f);
      const after = lines.some((l) => l.pv[0] === mv.lan) ? undefined : (await engine.analyse(test.fen(), { depth: 14, movetime: 1500 }))[0];
      if (myGen !== gen.current) return;
      const loss = moveLoss(lines, mv.lan, f.split(' ')[1] === 'w', after) ?? 0;
      const bestUci = lines[0]?.pv[0];
      const bestSan = bestUci ? uciToSan(f, bestUci) : null;
      const first = !missed.current.has(epdOf(f));
      if (loss < INACCURACY) {
        if (first) {
          stats.current.asked++;
          stats.current.good++;
          // Another good move is not the deck's answer: no grade either way.
          if (deckMove(f)?.uci === mv.lan) gradeDeck(f, mv.lan, true, timeMs);
        }
        void saveStudyMove(setupRef.current.side, epdOf(f), mv.lan);
        const points = Math.round(loss);
        setFeedback({
          kind: 'good',
          text: bestUci === mv.lan || points === 0 ? `${mv.san}: o lance do motor.` : `${mv.san}: bom lance. O motor preferia ${bestSan}, ${points} ${points === 1 ? 'ponto' : 'pontos'} de chance à frente.`,
        });
        accept(mv.san, myGen);
        return;
      }
      miss(f, bestUci, timeMs, mv.lan);
      setFeedback({ kind: 'wrong', text: `${mv.san} perde ${Math.round(loss)} pontos de chance de vitória. O melhor é ${bestSan ?? 'outro lance'}. Tente de novo.` });
      if (bestUci) setArrows([{ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), color: BEST_ARROW }]);
      setPhase('wrong');
      setTimeout(() => {
        if (myGen !== gen.current) return;
        setFen(f);
        setLastMove(prev.current?.lastMove ?? null);
        setPhase('yours');
      }, 900);
    })();
    return true;
  };

  /** Plays the engine's move for you (the position counts as missed). */
  const showBest = () => {
    if (phase !== 'yours' && phase !== 'wrong') return;
    const f = chess.current.fen();
    const myGen = gen.current;
    setPhase('checking');
    void bestFor(f).then((lines) => {
      if (myGen !== gen.current) return;
      const uci = lines[0]?.pv[0];
      const san = uci ? uciToSan(f, uci) : null;
      if (!uci || !san) return end('O motor não achou um lance aqui.');
      miss(f, uci, Date.now() - turnAt.current, uci);
      setFeedback({ kind: 'wrong', text: `O lance era ${san}. Esta posição volta na sua revisão.` });
      setArrows([]);
      accept(san, myGen);
    });
  };

  const ended = phase === 'end';
  const line = useMemo(() => lineFrom(START_FEN, played), [played]);
  const explorer = useLineExplorer({ start: START_FEN, line, enabled: ended, initialPly: line.length });

  return { fen, lastMove, played, phase, feedback, reply, arrows, count, explorer, onMove, showBest, newLine };
}

export type StudyDrill = ReturnType<typeof useStudyDrill>;
