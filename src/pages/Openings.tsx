import clsx from 'clsx';
import { Chess } from 'chess.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, BookOpen, Check, ChevronLeft, GraduationCap, Map as MapIcon, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playSound, soundForSan } from '@/components/board/assets';
import { Board, type BoardMove } from '@/components/board/Board';
import type { Arrow } from '@/components/board/geometry';
import { PageHeader } from '@/components/Layout';
import { RichText, San } from '@/components/San';
import { tryMove } from '@/lib/chess/replay';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { loadOpenings, nameOpening } from '@/lib/openings/book';
import { epdOf, type CompiledSide, type RepertoireMove } from '@/lib/repertoire/compile';
import { chapterRoot, loadRepertoire, ourPositionsBelow, pathTo, START_EPD, type CompiledRepertoire } from '@/lib/repertoire/data';
import { cardsFor, grade, pickReply, progress } from '@/lib/repertoire/drill';
import { indexGames, statsAt, topDeviations, type GamesIndex } from '@/lib/repertoire/games';
import { formatScore } from '@/lib/review/scoring';
import type { Color, RepertoireCard } from '@/lib/types';
import { useGamesAndAnalyses } from '@/lib/hooks';

const START_FEN = new Chess().fen();
const REP_ARROW = 'rgb(150, 190, 70)';

interface Step {
  san: string;
  uci: string;
  fen: string; // after the move
}

export default function Openings() {
  const [rep, setRep] = useState<CompiledRepertoire | null | undefined>(undefined);
  const [side, setSide] = useState<Color>('white');
  const [mode, setMode] = useState<'explore' | 'train'>('explore');
  const { games } = useGamesAndAnalyses();
  const [index, setIndex] = useState<GamesIndex | null>(null);

  useEffect(() => {
    void loadRepertoire().then(setRep);
  }, []);

  const sideRep = rep?.sides[side] ?? null;
  const serious = useMemo(() => games?.filter((g) => g.timeClass === 'rapid' || g.timeClass === 'blitz') ?? null, [games]);

  useEffect(() => {
    setIndex(null);
    if (!serious) return;
    let alive = true;
    void indexGames(serious, side, sideRep, `${serious.length}|${rep?.builtAt ?? ''}`).then((i) => alive && setIndex(i));
    return () => {
      alive = false;
    };
  }, [serious, side, sideRep, rep?.builtAt]);

  if (rep === undefined) return <div className="p-8 text-ink-3">Carregando...</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-5 md:px-8">
        <PageHeader title="Aberturas" icon={BookOpen} />
        <div className="mb-5 ml-auto flex gap-2">
          {(['white', 'black'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', side === s ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
              <span className={clsx('h-3 w-3 rounded-[2px]', s === 'white' ? 'bg-white' : 'border border-ink-4 bg-[#2b2927]')} />
              {s === 'white' ? 'Brancas' : 'Pretas'}
            </button>
          ))}
          <span className="mx-1 w-px bg-line" />
          <button type="button" onClick={() => setMode('explore')} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', mode === 'explore' ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            <MapIcon size={16} /> Explorar
          </button>
          <button type="button" onClick={() => setMode('train')} disabled={!sideRep?.chapters.length} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', mode === 'train' ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            <GraduationCap size={16} /> Treinar
          </button>
        </div>
      </div>
      {!sideRep?.chapters.length && (
        <div className="mx-4 mb-3 rounded-lg bg-panel px-4 py-3 text-sm text-ink-3 md:mx-8">
          Repertório ainda não compilado para este lado. Rode <code className="text-ink-2">npm run build:repertoire</code>. Enquanto isso, a árvore abaixo mostra só as suas partidas.
        </div>
      )}
      {mode === 'explore' || !sideRep ? (
        <Explorer key={side} side={side} rep={sideRep} index={index} />
      ) : (
        <Trainer key={side} side={side} rep={sideRep} index={index} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ explorer

function Explorer({ side, rep, index }: { side: Color; rep: CompiledSide | null; index: GamesIndex | null }) {
  const [path, setPath] = useState<Step[]>([]);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const fen = path.length ? path[path.length - 1]!.fen : START_FEN;
  const epd = epdOf(fen);
  const pos = rep?.positions[epd];
  const ourTurn = (fen.split(' ')[1] === 'w') === (side === 'white');
  const stats = index ? statsAt(index.tree, epd) : [];
  const totalHere = stats.reduce((s, x) => s + x.n, 0);
  const repMoves = pos?.moves ?? [];
  const lastRepMove = useMemo(() => {
    if (!path.length || !rep) return null;
    const prevFen = path.length > 1 ? path[path.length - 2]!.fen : START_FEN;
    return rep.positions[epdOf(prevFen)]?.moves.find((m) => m.uci === path[path.length - 1]!.uci) ?? null;
  }, [path, rep]);

  useEffect(() => {
    let alive = true;
    void loadOpenings().then((o) => {
      if (alive) setOpeningName(nameOpening(o, path.map((s) => s.fen))?.name ?? null);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  const play = useCallback((uci: string) => {
    const chess = new Chess(fen);
    try {
      const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      playSound(soundForSan(mv.san, !!mv.captured));
      setPath((p) => [...p, { san: mv.san, uci: mv.lan, fen: chess.fen() }]);
    } catch {
      /* not legal here */
    }
  }, [fen]);

  const goTo = (target: string) => {
    if (!rep) return;
    const moves = pathTo(rep, target);
    if (!moves) return;
    const chess = new Chess();
    const steps: Step[] = [];
    for (const m of moves) {
      if (!tryMove(chess, m.san)) break;
      steps.push({ san: m.san, uci: m.uci, fen: chess.fen() });
    }
    setPath(steps);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setPath((p) => p.slice(0, -1));
      if (e.key === 'ArrowRight' && repMoves[0]) play(repMoves[0].uci);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [repMoves, play]);

  const arrows: Arrow[] = ourTurn && repMoves[0] ? [{ from: repMoves[0].uci.slice(0, 2), to: repMoves[0].uci.slice(2, 4), color: REP_ARROW }] : [];
  const rows = mergeRows(repMoves, stats);
  const chapters = rep?.chapters ?? [];
  const youDev = rep && index ? topDeviations(index, rep, 'you', 6) : [];
  const holes = rep && index ? topDeviations(index, rep, 'hole', 6) : [];
  const exitsTotal = index?.exits.length ?? 0;
  const deepEnough = index ? index.exits.filter((e) => e.kind === 'end' || e.ply >= 12).length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-4 lg:flex-row lg:px-8">
      <div className="flex min-w-0 flex-1 justify-center">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 150px)' }}>
          <Board
            fen={fen}
            orientation={side}
            lastMove={path.length ? { from: path[path.length - 1]!.uci.slice(0, 2), to: path[path.length - 1]!.uci.slice(2, 4) } : null}
            movable="both"
            onMove={(m: BoardMove) => { play(`${m.from}${m.to}${m.promotion ?? ''}`); return true; }}
            arrows={arrows}
          />
        </div>
      </div>

      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-[440px]">
        <div className="rounded-lg bg-panel p-4">
          <div className="flex flex-wrap items-center gap-1 text-[14px]">
            <button type="button" onClick={() => setPath([])} className="rounded px-1.5 py-0.5 font-bold text-ink-3 hover:bg-raise hover:text-ink">Início</button>
            {path.map((s, i) => (
              <button key={i} type="button" onClick={() => setPath(path.slice(0, i + 1))} className={clsx('rounded px-1 py-0.5 hover:bg-raise', i === path.length - 1 ? 'bg-raise-2 font-bold text-ink' : 'text-ink-2')}>
                {i % 2 === 0 && <span className="mr-0.5 text-ink-4">{i / 2 + 1}.</span>}
                <San san={s.san} />
              </button>
            ))}
            {path.length > 0 && <button type="button" onClick={() => setPath((p) => p.slice(0, -1))} className="ml-auto rounded p-1 text-ink-3 hover:bg-raise hover:text-ink" aria-label="Voltar"><ChevronLeft size={18} /></button>}
          </div>
          {openingName && <p className="mt-2 text-sm font-bold text-ink-3">{openingName}</p>}
          {lastRepMove && (lastRepMove.preComment || lastRepMove.comment) && (
            <div className="mt-3 rounded-md bg-panel-2 p-3 text-[14px] leading-relaxed text-ink-2">
              {lastRepMove.preComment && <p className="mb-1 text-ink-3"><RichText text={lastRepMove.preComment} /></p>}
              {lastRepMove.comment && <p><RichText text={lastRepMove.comment} /></p>}
            </div>
          )}
          {pos?.eval && <p className="mt-2 text-xs text-ink-4">Stockfish: {formatScore(pos.eval)} (profundidade {pos.eval.depth})</p>}
          {path.length > 0 && !pos && rep && <p className="mt-3 text-sm text-cls-inaccuracy">Fora do repertório.</p>}
        </div>

        <div className="rounded-lg bg-panel p-4">
          <h2 className="mb-2 text-[15px] font-extrabold">{ourTurn ? 'Seu lance' : 'Respostas do adversário'}</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-4">{ourTurn ? 'O repertório termina aqui: siga o plano do comentário.' : 'Nenhuma partida sua chegou aqui.'}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-4">
                  <th className="pb-1.5 font-bold">Lance</th>
                  <th className="pb-1.5 font-bold">Repertório</th>
                  <th className="pb-1.5 text-right font-bold">Suas partidas</th>
                  <th className="pb-1.5 text-right font-bold">Aprov.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const hole = !ourTurn && !r.inRep && r.n >= 3 && repMoves.length > 0;
                  const deviation = ourTurn && !r.inRep && r.n > 0 && repMoves.length > 0;
                  return (
                    <tr key={r.uci} className="cursor-pointer border-t border-line/50 hover:bg-raise/50" onClick={() => play(r.uci)}>
                      <td className="py-1.5 font-bold"><San san={r.san} /></td>
                      <td className="py-1.5">
                        {r.inRep ? <Check size={16} className="text-go" strokeWidth={3} /> : hole ? <span className="text-xs font-bold text-cls-mistake">buraco</span> : deviation ? <span className="text-xs font-bold text-cls-inaccuracy">você joga</span> : <span className="text-ink-4">-</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-ink-3">{r.n ? `${r.n} (${Math.round((100 * r.n) / Math.max(1, totalHere))}%)` : '-'}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.n ? `${Math.round((100 * r.points) / r.n)}%` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {path.length === 0 && chapters.length > 0 && (
          <div className="rounded-lg bg-panel p-4">
            <h2 className="mb-2 text-[15px] font-extrabold">Capítulos</h2>
            <ul className="space-y-1.5">
              {chapters.map((c) => (
                <li key={c.id}>
                  <button type="button" className="w-full rounded-md bg-panel-2 p-2.5 text-left hover:bg-raise" onClick={() => goTo(chapterRoot(c.entry))}>
                    <div className="font-bold text-ink">{c.name}</div>
                    {c.description && <div className="text-sm text-ink-3">{c.description}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {index && rep && path.length === 0 && (
          <div className="rounded-lg bg-panel p-4">
            <h2 className="mb-1 text-[15px] font-extrabold">Onde as suas partidas saem do repertório</h2>
            <p className="mb-3 text-sm text-ink-3">Rapid e blitz de {side === 'white' ? 'brancas' : 'pretas'}: {index.games} partidas; {deepEnough} de {exitsTotal} seguem o repertório até o fim ou além do lance 6.</p>
            {youDev.length > 0 && (
              <>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-cls-inaccuracy"><X size={15} /> Você saiu da linha</h3>
                <DeviationList items={youDev} onOpen={goTo} />
              </>
            )}
            {holes.length > 0 && (
              <>
                <h3 className="mb-1.5 mt-3 flex items-center gap-1.5 text-sm font-bold text-cls-mistake"><AlertTriangle size={15} /> O adversário saiu do repertório</h3>
                <DeviationList items={holes} onOpen={goTo} />
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function DeviationList({ items, onOpen }: { items: ReturnType<typeof topDeviations>; onOpen: (epd: string) => void }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((d) => (
        <li key={`${d.epd}-${d.san}`}>
          <button type="button" onClick={() => onOpen(d.epd)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-raise">
            <span className="text-ink-2">
              <San san={d.san} className="font-bold text-ink" />
              {d.expected && <> em vez de <San san={d.expected} className="font-bold text-go" /></>}
            </span>
            <span className="tabular-nums text-ink-4">{d.n}x</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function mergeRows(repMoves: RepertoireMove[], stats: ReturnType<typeof statsAt>) {
  const rows = new Map<string, { san: string; uci: string; inRep: boolean; n: number; points: number }>();
  for (const m of repMoves) rows.set(m.uci, { san: m.san, uci: m.uci, inRep: true, n: 0, points: 0 });
  for (const s of stats) {
    const r = rows.get(s.uci) ?? { san: s.san, uci: s.uci, inRep: false, n: 0, points: 0 };
    r.n = s.n;
    r.points = s.points;
    rows.set(s.uci, r);
  }
  return [...rows.values()].sort((a, b) => b.n - a.n || Number(b.inRep) - Number(a.inRep));
}

// ------------------------------------------------------------------ trainer

function Trainer({ side, rep, index }: { side: Color; rep: CompiledSide; index: GamesIndex | null }) {
  const [chapterId, setChapterId] = useState<string>('all');
  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [cards, setCards] = useState<Map<string, RepertoireCard>>(new Map());
  const [feedback, setFeedback] = useState<{ kind: 'good' | 'wrong' | 'end' | 'none'; text: string; comment?: string }>({ kind: 'none', text: '' });
  const [missed, setMissed] = useState<string | null>(null);
  const [lines, setLines] = useState({ done: 0, correct: 0, wrong: 0 });
  const [waiting, setWaiting] = useState(false);
  // Each drilled line has its own generation; timers from an abandoned line stop.
  const lineGen = useRef(0);
  const dueCount = useLiveQuery(() => db.repCards.where('due').belowOrEqual(Date.now()).filter((c) => c.side === side).count(), [side]);

  const chapter = rep.chapters.find((c) => c.id === chapterId);
  const rootEpd = chapter ? chapterRoot(chapter.entry) : START_EPD;
  const scope = useMemo(() => {
    if (!chapter) return null;
    const set = new Set<string>();
    const queue = [rootEpd];
    set.add(rootEpd);
    while (queue.length) {
      const e = queue.shift()!;
      for (const m of rep.positions[e]?.moves ?? []) if (!set.has(m.to)) { set.add(m.to); queue.push(m.to); }
    }
    return set;
  }, [chapter, rootEpd, rep]);
  const ours = useMemo(() => ourPositionsBelow(rep, chapter ? rootEpd : START_EPD), [rep, chapter, rootEpd]);
  const prog = progress(cards, ours);

  const refresh = useCallback(async () => setCards(await cardsFor(side)), [side]);
  useEffect(() => { void refresh(); }, [refresh]);

  const ourColor = side === 'white' ? 'w' : 'b';

  /** Plays opponent moves (and the chapter trunk) until it is our turn or the line ends. */
  const advance = useCallback(async (startFen: string) => {
    const myLine = lineGen.current;
    const chess = new Chess(startFen);
    const cardMap = await cardsFor(side);
    if (myLine !== lineGen.current) return;
    setCards(cardMap);
    const step = () => {
      if (myLine !== lineGen.current) return;
      const e = epdOf(chess.fen());
      const pos = rep.positions[e];
      if (!pos?.moves.length) {
        setFeedback({ kind: 'end', text: 'Fim da linha.' });
        setLines((l) => ({ ...l, done: l.done + 1 }));
        setWaiting(false);
        return;
      }
      if (chess.turn() === ourColor) {
        setWaiting(false);
        return;
      }
      const reply = pickReply(rep, e, cardMap, index?.tree ?? null, scope);
      if (!reply) {
        setFeedback({ kind: 'end', text: 'Fim da linha.' });
        setLines((l) => ({ ...l, done: l.done + 1 }));
        setWaiting(false);
        return;
      }
      setTimeout(() => {
        if (myLine !== lineGen.current) return;
        const mv = tryMove(chess, reply.san);
        if (!mv) {
          setFeedback({ kind: 'end', text: 'Fim da linha.' });
          setWaiting(false);
          return;
        }
        playSound(soundForSan(mv.san, !!mv.captured));
        setFen(chess.fen());
        setLastMove({ from: mv.from, to: mv.to });
        step();
      }, 420);
    };
    setWaiting(true);
    step();
  }, [ourColor, rep, index, scope, side]);

  const newLine = useCallback(() => {
    lineGen.current++;
    setFeedback({ kind: 'none', text: '' });
    setMissed(null);
    const chess = new Chess();
    for (const san of chapter?.entry ?? []) if (!tryMove(chess, san)) break;
    setFen(chess.fen());
    setLastMove(null);
    void advance(chess.fen());
  }, [advance, chapter]);

  useEffect(() => { newLine(); }, [chapterId]);

  const onMove = (m: BoardMove): boolean => {
    if (waiting || feedback.kind === 'end') return false;
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
    if (mv.lan !== expected.uci) {
      playSound('illegal');
      if (missed !== e) {
        void grade(side, e, false);
        setLines((l) => ({ ...l, wrong: l.wrong + 1 }));
      }
      setMissed(e);
      setFeedback({ kind: 'wrong', text: `${mv.san} não é o lance do repertório. Jogue ${expected.san}.`, comment: expected.comment });
      return false;
    }
    playSound(soundForSan(mv.san, !!mv.captured));
    if (missed !== e) {
      void grade(side, e, true);
      setLines((l) => ({ ...l, correct: l.correct + 1 }));
    }
    setMissed(null);
    setFeedback({ kind: 'good', text: `${mv.san}. Correto!`, comment: expected.comment });
    setFen(chess.fen());
    setLastMove({ from: mv.from, to: mv.to });
    void advance(chess.fen());
    return true;
  };

  const expected = rep.positions[epdOf(fen)]?.moves[0];
  const arrows: Arrow[] = missed && expected ? [{ from: expected.uci.slice(0, 2), to: expected.uci.slice(2, 4), color: REP_ARROW }] : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-4 lg:flex-row lg:px-8">
      <div className="flex min-w-0 flex-1 justify-center">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 150px)' }}>
          <Board fen={fen} orientation={side} lastMove={lastMove} movable={waiting || feedback.kind === 'end' ? null : side} onMove={onMove} arrows={arrows} />
        </div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[400px]">
        <div className="rounded-lg bg-panel p-4">
          <label className="text-sm font-bold text-ink-3" htmlFor="chapter">Treinar</label>
          <select id="chapter" value={chapterId} onChange={(e) => setChapterId(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-panel-2 px-3 py-2">
            <option value="all">Repertório inteiro de {side === 'white' ? 'brancas' : 'pretas'}</option>
            {rep.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-go" style={{ width: `${(100 * prog.learned) / Math.max(1, prog.total)}%` }} />
          </div>
          <p className="mt-1.5 text-sm text-ink-3">{prog.learned} de {prog.total} posições aprendidas · {dueCount ?? 0} para revisar</p>
        </div>
        <div className={clsx('rounded-lg p-4', feedback.kind === 'wrong' ? 'bg-[#4a2b27]' : feedback.kind === 'good' ? 'bg-[#2f3f25]' : 'bg-panel')}>
          <p className="font-bold">
            {feedback.kind === 'none' ? (waiting ? 'O adversário está jogando...' : 'Sua vez: jogue o lance do repertório.') : <RichText text={feedback.text} />}
          </p>
          {feedback.comment && <p className="mt-2 text-sm leading-relaxed text-ink-2"><RichText text={feedback.comment} /></p>}
          <p className="mt-3 text-xs text-ink-4">Sessão: {plural(lines.done, 'linha')} · {plural(lines.correct, 'certo')} · {plural(lines.wrong, 'erro')}</p>
        </div>
        <button type="button" className={clsx(feedback.kind === 'end' ? 'btn-go' : 'btn-flat')} onClick={newLine}>
          {feedback.kind === 'end' ? 'Próxima linha' : 'Pular para outra linha'}
        </button>
      </aside>
    </div>
  );
}
