// One repertoire line at a time, in the Chessable style: the app plays the
// opponent, you play your repertoire move, and your first try at each of your
// positions is graded. The Openings trainer and the training sessions share it.
// A line starts after `prefix` (a chapter's trunk, or a real game up to where
// you left the book), played by itself and never graded; a deck works its
// start out from your cards (`startFor`), so a due position on its trunk is
// asked.
import { Chess } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import { playSound, soundForSan } from '@/components/board/assets';
import type { BoardMove } from '@/components/board/Board';
import type { Arrow } from '@/components/board/geometry';
import { lineFrom, useLineExplorer } from '@/components/board/useLineExplorer';
import { tryMove } from '@/lib/chess/replay';
import { useTrainingActive } from '@/lib/renewal/activity';
import { epdOf, type CompiledSide, type RepertoireMove } from '@/lib/repertoire/compile';
import { aheadIn, cardsFor, dueBelow, grade, pickReply, repertoireExpectedMs } from '@/lib/repertoire/drill';
import type { GamesIndex } from '@/lib/repertoire/games';
import type { RepNamespace } from '@/lib/srs/cards';
import type { Color, RepCard } from '@/lib/types';

export const START_FEN = new Chess().fen();
const REP_ARROW = 'rgb(150, 190, 70)';

export interface RepFeedback {
  kind: 'good' | 'wrong' | 'end' | 'none';
  text: string;
  comment?: string;
  id?: number;
  rating?: Grade;
}

export interface RepLineEnd {
  /** SAN from the start: the prefix and the line. */
  line: string[];
  /** Your positions asked in the line. */
  asked: number;
  wrong: number;
  ratings: Grade[];
}

export interface RepDrillOptions {
  side: Color;
  /** Where the cards live: your repertoire of `side`, unless a deck with its own. */
  ns?: RepNamespace;
  rep: CompiledSide;
  index: GamesIndex | null;
  /** The line starts over when this changes (a chapter, a session step). */
  lineKey: string;
  prefix: string[];
  /** The start worked out from your cards at each new line (a deck's `startFor`); `prefix` otherwise. */
  startFor?: (cards: Map<string, RepCard>) => string[];
  /** Whose move is the right one, as the messages say it: "do repertório" unless a deck of its own. */
  book?: string;
  /** Positions the opponent's replies stay in; null for the whole repertoire. */
  scope: Set<string> | null;
  prefer?: 'due' | 'known';
  /** Replay these opponent moves (SAN from the start) where they fit: a redo plays the same line. */
  script?: string[];
  /** Free practice when false: nothing is graded. */
  graded?: boolean;
  /** Fixed ids (a training step's), so grading a position twice counts once. */
  attemptIdFor?: (epd: string) => string;
  onEnd?: (r: RepLineEnd) => void;
}

/** Ply of a FEN from the start: the move counters say it. */
function plyOf(fen: string): number {
  const [, turn, , , , full] = fen.split(' ');
  return (Number(full) - 1) * 2 + (turn === 'b' ? 1 : 0);
}

export function useRepDrill(options: RepDrillOptions) {
  useTrainingActive();
  const { side, lineKey } = options;
  const ns = options.ns ?? side;
  // rep and index are read when used: the merged repertoire is rebuilt when your chapters change, the index arrives later.
  const opts = useRef(options);
  opts.current = options;
  const graded = options.graded ?? true;

  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [cards, setCards] = useState<Map<string, RepCard>>(new Map());
  const [feedback, setFeedback] = useState<RepFeedback>({ kind: 'none', text: '' });
  const feedbackId = useRef(0);
  const [missed, setMissed] = useState<string | null>(null);
  const [lines, setLines] = useState({ done: 0, correct: 0, wrong: 0 });
  // Until the first line is set up (it reads your cards first), it is not your turn yet.
  const [waiting, setWaiting] = useState(true);
  // The moves of the line being drilled, from the start: navigable once it ends.
  const [drilled, setDrilledState] = useState<string[]>([]);
  const drilledRef = useRef<string[]>([]);
  const setDrilled = (d: string[]) => {
    drilledRef.current = d;
    setDrilledState(d);
  };
  const stats = useRef({ asked: 0, wrong: 0, ratings: [] as Grade[], saving: [] as Array<Promise<unknown>> });
  // Analysing mid-line: the line's moves when you stopped (the explorer works on them), null while drilling.
  const [exploring, setExploring] = useState<string[] | null>(null);
  const ungraded = useRef(new Set<string>());
  // Each drilled line has its own generation; timers from an abandoned line stop.
  const lineGen = useRef(0);
  // Thinking time on your move, from when the opponent's move lands; time with the tab hidden does not count.
  const clock = useRef({ turnAt: Date.now(), hidden: 0, hiddenSince: null as number | null });
  const expectedMs = useRef(10_000);
  useEffect(() => {
    void repertoireExpectedMs().then((ms) => (expectedMs.current = ms));
    const onVis = () => {
      const c = clock.current;
      if (document.hidden) c.hiddenSince = Date.now();
      else if (c.hiddenSince !== null) {
        c.hidden += Date.now() - c.hiddenSince;
        c.hiddenSince = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const startClock = () => (clock.current = { turnAt: Date.now(), hidden: 0, hiddenSince: document.hidden ? Date.now() : null });

  const refresh = useCallback(async () => setCards(await cardsFor(ns)), [ns]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ourColor = side === 'white' ? 'w' : 'b';

  const end = useCallback((counted: boolean) => {
    setFeedback({ kind: 'end', text: 'Fim da linha.' });
    if (counted) setLines((l) => ({ ...l, done: l.done + 1 }));
    setWaiting(false);
    // Ended while you analysed (the opponent's last move was on its way): the analysis stays open, on the whole line.
    setExploring(null);
    // The last move's grade may still be saving: the line is reported with it.
    const s = stats.current;
    const line = drilledRef.current;
    void Promise.all(s.saving).then(() => opts.current.onEnd?.({ line, asked: s.asked, wrong: s.wrong, ratings: s.ratings }));
  }, []);

  /** Plays opponent moves until it is your turn or the line ends. */
  const advance = useCallback(async (startFen: string) => {
    const myLine = lineGen.current;
    const chess = new Chess(startFen);
    const cardMap = await cardsFor(ns);
    if (myLine !== lineGen.current) return;
    setCards(cardMap);
    const o = opts.current;
    const below = o.prefer === 'due' ? dueBelow(o.rep, cardMap, Date.now(), o.scope) : undefined;
    // The lines that go on come up more than sidelines answered in one move.
    const ahead = aheadIn(o.rep, o.scope);
    const step = () => {
      if (myLine !== lineGen.current) return;
      const { rep, index, scope, prefer, script } = opts.current;
      const e = epdOf(chess.fen());
      const pos = rep.positions[e];
      if (!pos?.moves.length) return end(true);
      if (chess.turn() === ourColor) {
        setWaiting(false);
        startClock();
        return;
      }
      const scripted = script?.[plyOf(chess.fen())];
      const reply: RepertoireMove | null =
        (scripted ? pos.moves.find((m) => m.san === scripted) : undefined) ??
        pickReply(rep, e, cardMap, index?.tree ?? null, scope, { ...(prefer ? { prefer } : {}), ...(below ? { dueBelow: below } : {}), ahead });
      if (!reply) return end(true);
      setTimeout(() => {
        if (myLine !== lineGen.current) return;
        const mv = tryMove(chess, reply.san);
        if (!mv) return end(false);
        playSound(soundForSan(mv.san, !!mv.captured));
        setFen(chess.fen());
        setLastMove({ from: mv.from, to: mv.to });
        setDrilled([...drilledRef.current, mv.san]);
        step();
      }, 420);
    };
    setWaiting(true);
    step();
  }, [ourColor, ns, end]);

  const newLine = useCallback(() => {
    const myLine = ++lineGen.current;
    stats.current = { asked: 0, wrong: 0, ratings: [], saving: [] };
    setFeedback({ kind: 'none', text: '' });
    setMissed(null);
    setExploring(null);
    ungraded.current = new Set();
    setWaiting(true);
    void (async () => {
      const o = opts.current;
      // A deck's start depends on what is due now: read at every line.
      const prefix = o.startFor ? o.startFor(await cardsFor(ns)) : o.prefix;
      if (myLine !== lineGen.current) return;
      const chess = new Chess();
      const played: string[] = [];
      let last: { from: string; to: string } | null = null;
      for (const san of prefix) {
        const mv = tryMove(chess, san);
        if (!mv) break;
        played.push(mv.san);
        last = { from: mv.from, to: mv.to };
      }
      setDrilled(played);
      setFen(chess.fen());
      setLastMove(last);
      void advance(chess.fen());
    })();
  }, [advance, ns]);

  useEffect(() => {
    newLine();
  }, [lineKey]);

  const onMove = (m: BoardMove): boolean => {
    if (waiting || feedback.kind === 'end') return false;
    const { rep, attemptIdFor } = opts.current;
    const e = epdOf(fen);
    const expected = rep.positions[e]?.moves[0];
    if (!expected) return false;
    const chess = new Chess(fen);
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      return false;
    }
    // Only the first try at a position is graded; after a miss, the right move just continues the line.
    // A position you analysed while it waited for you is not graded this time: you saw the engine.
    const first = missed !== e && !ungraded.current.has(e);
    const c = clock.current;
    const hiddenMs = c.hidden + (c.hiddenSince !== null ? Date.now() - c.hiddenSince : 0);
    const attempt = { uci: mv.lan, timeMs: Math.max(0, Date.now() - c.turnAt - hiddenMs), hiddenMs, expectedMs: expectedMs.current };
    const s = stats.current;
    const record = (correct: boolean) => {
      if (!graded) return null;
      const p = grade(side, e, { ...attempt, correct }, Date.now(), attemptIdFor?.(e), ns).then((rating) => {
        s.ratings.push(rating);
        return rating;
      });
      s.saving.push(p.catch(() => undefined));
      return p;
    };
    if (mv.lan !== expected.uci) {
      playSound('illegal');
      if (first) {
        s.asked++;
        s.wrong++;
        void record(false);
        setLines((l) => ({ ...l, wrong: l.wrong + 1 }));
      }
      setMissed(e);
      setFeedback({ kind: 'wrong', text: `${mv.san} não é o lance ${opts.current.book ?? 'do repertório'}. Jogue ${expected.san}.`, comment: expected.comment });
      return false;
    }
    playSound(soundForSan(mv.san, !!mv.captured));
    const id = ++feedbackId.current;
    if (first) {
      s.asked++;
      // The grade lands on this move's message, unless another one replaced it.
      void record(true)?.then((rating) => setFeedback((f) => (f.id === id ? { ...f, rating } : f)));
      setLines((l) => ({ ...l, correct: l.correct + 1 }));
    }
    setMissed(null);
    setFeedback({ kind: 'good', text: `${mv.san}. Correto!`, comment: expected.comment, id });
    setFen(chess.fen());
    setLastMove({ from: mv.from, to: mv.to });
    setDrilled([...drilledRef.current, mv.san]);
    void advance(chess.fen());
    return true;
  };

  const expected = options.rep.positions[epdOf(fen)]?.moves[0];
  const arrows: Arrow[] = missed && expected ? [{ from: expected.uci.slice(0, 2), to: expected.uci.slice(2, 4), color: REP_ARROW }] : [];
  // At the end of a line, or whenever you stop to analyse: walk it back and forth, or try other moves with the engine.
  const ended = feedback.kind === 'end';
  const drilledLine = useMemo(() => lineFrom(START_FEN, exploring ?? drilled), [drilled, exploring]);
  // Analysing, Stockfish shows its line on every position, the line's own too.
  const explorer = useLineExplorer({ start: START_FEN, line: drilledLine, enabled: ended || !!exploring, initialPly: drilledLine.length, engineAlways: true });

  // Every position on the analysis board goes ungraded for the rest of the line: the engine and the book were on screen.
  // The one that waited for your move included: the analysis opens on it.
  useEffect(() => {
    if (exploring) ungraded.current.add(epdOf(explorer.fen));
  }, [exploring, explorer.fen]);

  /** Stops the line to analyse it: the moves so far are kept as they are while the line waits. */
  const explore = () => {
    if (ended || exploring) return;
    setExploring(drilledRef.current);
  };
  /** Back to the line where it stopped. */
  const resume = () => setExploring(null);

  // Away from where the line stopped, on a position your repertoire goes on from: the line can go on from there instead.
  const atStop = !explorer.variation && explorer.ply === drilledLine.length;
  const canTrainHere = !!exploring && !atStop && !!options.rep.positions[epdOf(explorer.fen)]?.moves.length;
  /** Goes on from the analysis board's position: the moves that lead there become the line. */
  const trainHere = () => {
    if (!canTrainHere) return;
    // The stopped line's opponent move, if one was on its way, is dropped.
    lineGen.current++;
    const last = explorer.path[explorer.path.length - 1];
    setExploring(null);
    setMissed(null);
    setFeedback({ kind: 'none', text: '' });
    setDrilled(explorer.path.map((p) => p.san));
    setFen(explorer.fen);
    setLastMove(last ? { from: last.from, to: last.to } : null);
    void advance(explorer.fen);
  };

  const book = options.book ?? 'do repertório';
  return { fen, lastMove, waiting, feedback, missed, drilled, ended, lines, cards, arrows, explorer, book, exploring: !!exploring, explore, resume, atStop, canTrainHere, trainHere, onMove, newLine, refresh };
}

export type RepDrill = ReturnType<typeof useRepDrill>;
