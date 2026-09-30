import clsx from 'clsx';
import { Chess } from 'chess.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ExternalLink, FlipVertical2, Lightbulb, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { playSound, soundForSan } from '@/components/board/assets';
import { Board, type BoardMove } from '@/components/board/Board';
import { CLASS_LABEL, ClassificationIcon } from '@/components/board/ClassificationIcon';
import type { Arrow } from '@/components/board/geometry';
import { CoachCard, TAG_INFO } from '@/components/review/CoachCard';
import { EvalBar } from '@/components/review/EvalBar';
import { EvalGraph } from '@/components/review/EvalGraph';
import { MoveList } from '@/components/review/MoveList';
import { PlayerBar } from '@/components/review/PlayerBar';
import { RichText, San, SanLine } from '@/components/San';
import { parseTimeControl } from '@/lib/chesscom/import';
import { lineToSan, replay, START_FEN, tryMove, type PlyInfo } from '@/lib/chess/replay';
import { db, setKV } from '@/lib/db';
import { nullMove, refute, type Refutation, type Threat } from '@/lib/explain/facts';
import { sharedEngine } from '@/lib/engine/stockfish';
import { plural } from '@/lib/format';
import { enqueueAnalysis, isAutoJob, useAnalysisQueue } from '@/lib/review/queue';
import { formatScore, winPercent } from '@/lib/review/scoring';
import { useAccount, useSettings } from '@/lib/settings';
import { ANALYSIS_VERSION, CLASSIFICATIONS, type Color, type EngineLine, type GameAnalysis, type MoveReview, type MoveTag, type Score } from '@/lib/types';

const BEST_ARROW = 'rgb(150, 190, 70)';
const ERRORS = new Set(['inaccuracy', 'mistake', 'blunder', 'miss']);

interface Variation {
  base: number; // main-line ply the variation starts from
  moves: PlyInfo[];
  index: number; // how many variation moves are shown
}

interface Retry {
  ply: number; // the move being retried (1-based)
  fen: string | null; // position after the attempt
  status: 'waiting' | 'checking' | 'right' | 'ok' | 'wrong';
  message?: string;
  lastMove?: { from: string; to: string };
}

function lineScore(l?: EngineLine): Score | undefined {
  if (!l) return undefined;
  return l.mate !== undefined ? { mate: l.mate } : { cp: l.cp };
}

export default function Review() {
  const { id } = useParams();
  const game = useLiveQuery(async () => (await db.games.get(id ?? '')) ?? null, [id]);
  const analysis = useLiveQuery(() => db.analyses.get(id ?? ''), [id]);
  const account = useAccount();
  const settings = useSettings();
  const queue = useAnalysisQueue();

  const initial = game?.initialFen ?? START_FEN;
  const plies = useMemo(() => (game ? replay(game.moves, initial) : []), [game, initial]);
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<Color>('white');
  const [variation, setVariation] = useState<Variation | null>(null);
  const [live, setLive] = useState<{ fen: string; lines: EngineLine[]; depth: number } | null>(null);
  const [showBest, setShowBest] = useState(false);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [threatArrow, setThreatArrow] = useState<Threat | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [refutation, setRefutation] = useState<{ key: string; data: Refutation | null } | null>(null);
  const socratic = useLiveQuery(async () => ((await db.kv.get('socratic'))?.value as boolean | undefined) ?? false, []) ?? false;

  const userColor = game?.userColor;
  useEffect(() => {
    if (userColor) setOrientation(userColor);
  }, [id, userColor]);

  // "?ply=N" (from the position trainer) opens the game on that move.
  const [params] = useSearchParams();
  const startPly = Number(params.get('ply'));
  useEffect(() => {
    if (startPly > 0 && plies.length) setPly(Math.min(startPly, plies.length));
  }, [id, startPly, plies.length]);

  const mainFen = ply === 0 ? initial : plies[ply - 1]?.fenAfter ?? initial;
  const variationFen = variation ? (variation.index === 0 ? (variation.base === 0 ? initial : plies[variation.base - 1]!.fenAfter) : variation.moves[variation.index - 1]!.fenAfter) : null;
  const fen = retry?.fen ?? (retry ? plies[retry.ply - 1]!.fenBefore : variationFen ?? mainFen);
  const exploring = !!variation;

  const review: MoveReview | undefined = !exploring && !retry && ply > 0 ? analysis?.moves[ply - 1] : undefined;
  const scores: Score[] = useMemo(() => {
    if (!analysis) return [];
    return [lineScore(analysis.evals[0]?.lines[0]) ?? { cp: 0 }, ...analysis.moves.map((m) => m.scoreAfter)];
  }, [analysis]);

  // Live engine while exploring or retrying.
  useEffect(() => {
    if (!exploring) {
      setLive(null);
      return;
    }
    const engine = sharedEngine();
    const target = fen;
    let cancelled = false;
    void engine.live(target, { depth: 22, multipv: 3 }, (u) => {
      if (!cancelled) setLive({ fen: target, lines: u.lines, depth: u.depth });
    });
    return () => {
      cancelled = true;
      engine.cancelLive();
    };
  }, [fen, exploring]);

  // "Why not X?": when you leave the game line, the engine refutes your move.
  // Results are memoized per deviation, so leaving and coming back never
  // strands the panel on "Calculando".
  const deviation = variation && variation.index >= 1 ? { base: variation.base, move: variation.moves[0]! } : null;
  const deviationKey = deviation ? `${deviation.base}|${deviation.move.uci}` : null;
  const refutations = useRef(new Map<string, Promise<Refutation | null>>());
  useEffect(() => {
    if (!deviation || !deviationKey || !game) return;
    let alive = true;
    let job = refutations.current.get(deviationKey);
    if (!job) {
      job = refute(deviation.move.fenBefore, deviation.move.uci, game.userRating);
      refutations.current.set(deviationKey, job);
      job.catch(() => refutations.current.delete(deviationKey));
    }
    setRefutation({ key: deviationKey, data: null });
    void job.then((data) => {
      if (alive) setRefutation({ key: deviationKey, data });
    });
    return () => {
      alive = false;
    };
  }, [deviationKey]);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(plies.length, next));
      setRetry(null);
      setShowBest(false);
      if (variation) {
        setVariation(null);
      }
      if (clamped === ply + 1 && plies[ply]) playSound(soundForSan(plies[ply]!.san, !!plies[ply]!.captured));
      setPly(clamped);
    },
    [plies, ply, variation],
  );

  const stepVariation = (delta: number) => {
    if (!variation) return;
    const index = variation.index + delta;
    if (index < 0) {
      setVariation(null);
      setPly(variation.base);
      return;
    }
    if (index > variation.moves.length) return;
    setVariation({ ...variation, index });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); variation ? stepVariation(-1) : go(ply - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); variation ? stepVariation(1) : go(ply + 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(plies.length);
      else if (e.key === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else if (e.key === 'Escape') { setVariation(null); setRetry(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nextMistake = () => {
    if (!analysis || !game) return;
    const next = analysis.moves.find((m) => m.ply > ply && m.color === game.userColor && ERRORS.has(m.classification));
    if (next) go(next.ply);
  };

  const startRetry = () => {
    if (!review) return;
    setRetry({ ply: review.ply, fen: null, status: 'waiting' });
    setShowBest(false);
  };

  const onBoardMove = (m: BoardMove): boolean => {
    const chess = new Chess(fen);
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      return false;
    }
    playSound(soundForSan(mv.san, !!mv.captured));

    if (retry) {
      const target = analysis?.moves[retry.ply - 1];
      if (!target) return false;
      if (mv.lan === target.bestUci) {
        setRetry({ ...retry, fen: mv.after, status: 'right', message: `Correto! ${mv.san} é o melhor lance.`, lastMove: { from: mv.from, to: mv.to } });
        return true;
      }
      setRetry({ ...retry, fen: mv.after, status: 'checking', lastMove: { from: mv.from, to: mv.to } });
      const attempt = { ply: retry.ply, fen: mv.after };
      const same = (r: Retry | null) => !!r && r.ply === attempt.ply && r.fen === attempt.fen;
      void sharedEngine()
        .analyse(mv.after, { depth: 14 })
        .then((lines) => {
          const w = winPercent(lineScore(lines[0]));
          const moverWin = target.color === 'white' ? w : 100 - w;
          const drop = target.winBefore - moverWin;
          if (drop <= 5) setRetry((r) => (same(r) ? { ...r!, status: 'ok', message: `${mv.san} também funciona. O melhor era ${target.bestSan}.` } : r));
          else {
            setRetry((r) => (same(r) ? { ...r!, status: 'wrong', message: `${mv.san} não resolve. Tente outra vez.` } : r));
            setTimeout(() => setRetry((r) => (same(r) && r!.status === 'wrong' ? { ...r!, fen: null, lastMove: undefined, status: 'waiting' } : r)), 1100);
          }
        });
      return true;
    }

    const info: PlyInfo = { san: mv.san, uci: mv.lan, from: mv.from, to: mv.to, fenBefore: mv.before, fenAfter: mv.after, captured: mv.captured, piece: mv.piece, flags: mv.flags };
    if (!variation) {
      if (plies[ply]?.uci === mv.lan) {
        setPly(ply + 1);
        return true;
      }
      setVariation({ base: ply, moves: [info], index: 1 });
    } else {
      setVariation({ ...variation, moves: [...variation.moves.slice(0, variation.index), info], index: variation.index + 1 });
    }
    return true;
  };

  if (game === undefined) return <div className="p-8 text-ink-3">Carregando...</div>;
  if (game === null) return <div className="p-8 text-ink-3">Partida não encontrada. <Link to="/games" className="text-go">Voltar</Link></div>;

  const me = game.userColor;
  const players = {
    white: me === 'white' ? { name: account?.username ?? 'Você', rating: game.userRating, avatar: account?.profile.avatar } : { name: game.oppName, rating: game.oppRating },
    black: me === 'black' ? { name: account?.username ?? 'Você', rating: game.userRating, avatar: account?.profile.avatar } : { name: game.oppName, rating: game.oppRating },
  };
  const top: Color = orientation === 'white' ? 'black' : 'white';
  const bottom: Color = orientation;
  const baseTime = parseTimeControl(game.timeControl)?.base ?? null;
  const clockFor = (color: Color) => {
    if (exploring || retry) return null;
    for (let i = ply - 1; i >= 0; i--) {
      const mover: Color = plies[i]!.fenBefore.split(' ')[1] === 'w' ? 'white' : 'black';
      if (mover === color) return game.clocks[i] ?? null;
    }
    return game.clocks.some((c) => c !== null) ? baseTime : null;
  };
  const turnNow: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black';

  // Board decorations
  const lastMove = retry?.lastMove ?? (variation && variation.index > 0 ? variation.moves[variation.index - 1] : ply > 0 && !retry ? plies[ply - 1] : null);
  const arrows: Arrow[] = [];
  const pendingQuestion = socratic && review && game && review.color === game.userColor && ERRORS.has(review.classification) && !revealed.has(review.ply);
  if (review && review.bestUci && review.uci !== review.bestUci && !pendingQuestion && (showBest || ERRORS.has(review.classification))) {
    arrows.push({ from: review.bestUci.slice(0, 2), to: review.bestUci.slice(2, 4), color: BEST_ARROW });
  }
  if (exploring && live?.lines[0]?.pv[0] && live.fen === fen) {
    const b = live.lines[0].pv[0];
    arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4), color: BEST_ARROW });
  }
  if (retry?.status === 'wrong' || (retry && showBest)) {
    const t = analysis?.moves[retry.ply - 1];
    if (t?.bestUci && showBest) arrows.push({ from: t.bestUci.slice(0, 2), to: t.bestUci.slice(2, 4), color: BEST_ARROW });
  }
  if (threatArrow?.line.san.length && review) {
    const first = threatArrow.line;
    const c = new Chess(nullMove(review.fenBefore) ?? review.fenBefore);
    const mv = tryMove(c, first.san[0]!);
    if (mv) arrows.push({ from: mv.from, to: mv.to, color: 'rgb(248, 85, 63)' });
  }
  const badge = review ? { square: review.uci.slice(2, 4), classification: review.classification } : null;
  const barScore: Score | undefined = exploring ? (live && live.fen === fen ? lineScore(live.lines[0]) : undefined) : retry ? scores[retry.ply - 1] : scores[ply];

  const analysing = queue.current === game.id;
  const queued = queue.pending.includes(game.id);
  // Waiting in (or running in) the automatic analysis: one worker, behind your requests.
  const inAuto = (analysing || queued) && isAutoJob(game.id);
  const listMoves = plies.map((p, i) => ({ ply: i + 1, san: p.san, classification: analysis?.moves[i]?.classification, timeSpent: analysis?.moves[i]?.timeSpent }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      {/* board column */}
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="flex w-full gap-2" style={{ maxWidth: 'calc(100vh - 100px)' }}>
          <div className="flex py-[46px]"><EvalBar score={barScore} orientation={orientation} /></div>
          <div className="min-w-0 flex-1">
            <PlayerBar {...players[top]} color={top} fen={fen} clock={clockFor(top)} active={turnNow === top} accuracy={analysis?.accuracy[top]} />
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={lastMove ? { from: lastMove.from!, to: lastMove.to! } : null}
              movable={retry ? (retry.status === 'waiting' ? me : null) : 'both'}
              onMove={onBoardMove}
              arrows={arrows}
              badge={badge}
            />
            <PlayerBar {...players[bottom]} color={bottom} fen={fen} clock={clockFor(bottom)} active={turnNow === bottom} accuracy={analysis?.accuracy[bottom]} />
          </div>
        </div>
      </div>

      {/* side panel */}
      <aside className="flex min-h-[420px] w-full shrink-0 flex-col overflow-hidden rounded-lg bg-panel lg:h-full lg:w-[420px]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="flex items-center gap-2 text-[17px] font-extrabold"><Sparkles size={20} className="text-go" /> Revisão da partida</h1>
          <div className="flex items-center gap-1">
            <a href={game.url} target="_blank" rel="noreferrer" className="rounded p-1.5 text-ink-3 hover:bg-raise hover:text-ink" title="Abrir no chess.com"><ExternalLink size={18} /></a>
            <button
              type="button"
              className={clsx('rounded px-2 py-1 text-xs font-bold', socratic ? 'bg-go/25 text-go-hover' : 'text-ink-3 hover:bg-raise hover:text-ink')}
              title="Nos seus erros, o coach pergunta antes de mostrar a resposta"
              onClick={() => void setKV('socratic', !socratic)}
            >
              Socrático {socratic ? 'ligado' : 'desligado'}
            </button>
            <button type="button" className="rounded p-1.5 text-ink-3 hover:bg-raise hover:text-ink" title="Girar tabuleiro (f)" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}><FlipVertical2 size={18} /></button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="scroll-thin max-h-[62%] shrink-0 overflow-y-auto">
          {!analysis && (
            <div className="m-4 rounded-lg bg-panel-2 p-4">
              <p className="mb-3 text-sm text-ink-2">
                {game.opening ?? 'Partida'}{' '}
                <span className="text-ink-4">· {new Date(game.endTime).toLocaleDateString('pt-BR')}</span>
              </p>
              {analysing || queued ? (
                <div>
                  <div className="mb-1.5 flex justify-between text-sm text-ink-3">
                    <span>{analysing ? (inAuto ? 'Na análise automática, em segundo plano...' : 'Analisando com Stockfish 18...') : inAuto ? 'Na fila da análise automática.' : 'Na fila...'}</span>
                    {analysing && <span>{queue.plyDone}/{queue.plyTotal}</span>}
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-page">
                    <div className="h-full bg-go transition-all" style={{ width: `${(100 * queue.plyDone) / Math.max(1, queue.plyTotal)}%` }} />
                  </div>
                  {inAuto && (
                    <button type="button" className="btn-go mt-3 w-full" onClick={() => enqueueAnalysis([game.id], settings, true)}>
                      Analisar agora
                    </button>
                  )}
                </div>
              ) : (
                <button type="button" className="btn-go w-full text-[17px]" onClick={() => enqueueAnalysis([game.id], settings, true)}>
                  Revisar partida
                </button>
              )}
            </div>
          )}

          {analysis && analysis.version !== ANALYSIS_VERSION && (
            <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-md bg-panel-2 px-3 py-2 text-sm">
              <span className="text-ink-3">{analysing || queued ? 'Atualizando a análise...' : queue.error ? `Falhou: ${queue.error}` : 'Análise antiga, sem os rótulos de dificuldade.'}</span>
              {!analysing && !queued && (
                <button type="button" className="font-bold text-go hover:text-go-hover" onClick={() => enqueueAnalysis([game.id], settings, true)}>Atualizar análise</button>
              )}
            </div>
          )}

          {analysis && ply === 0 && !exploring && !retry && (
            <Summary analysis={analysis} players={players} me={me} onStart={() => go(1)} />
          )}

          {analysis && (review || retry || exploring) && (
            <div className="m-3 rounded-lg bg-panel-2 p-3.5">
              {retry ? (
                <RetryBox retry={retry} onGiveUp={() => setShowBest(true)} onClose={() => setRetry(null)} />
              ) : exploring ? (
                <ExploreBox live={live} fen={fen} variation={variation!} refutation={refutation?.key === deviationKey ? refutation.data : null} loadingRefutation={refutation?.key === deviationKey && !refutation.data} onBack={() => { setVariation(null); }} />
              ) : review ? (
                <CoachCard
                  game={game}
                  analysis={analysis}
                  move={review}
                  socratic={socratic}
                  revealed={revealed.has(review.ply)}
                  onReveal={() => setRevealed((r) => new Set(r).add(review.ply))}
                  showBest={showBest}
                  onToggleBest={() => setShowBest((b) => !b)}
                  onRetry={startRetry}
                  onNextMistake={nextMistake}
                  onThreat={setThreatArrow}
                />
              ) : null}
            </div>
          )}

          {analysis && scores.length > 1 && (
            <div className="px-3 pb-2 pt-1">
              <EvalGraph scores={scores} moves={analysis.moves} ply={ply} onSelect={go} />
            </div>
          )}
          </div>

          <div className="min-h-[140px] flex-1 border-t border-line py-1">
            <MoveList moves={listMoves} ply={exploring || retry ? -1 : ply} onSelect={go} />
          </div>
        </div>

        <div className="flex items-center justify-center gap-1 border-t border-line bg-panel-2 px-3 py-2">
          {[
            { icon: ChevronFirst, label: 'Início', act: () => go(0) },
            { icon: ChevronLeft, label: 'Anterior', act: () => (variation ? stepVariation(-1) : go(ply - 1)) },
            { icon: ChevronRight, label: 'Próximo', act: () => (variation ? stepVariation(1) : go(ply + 1)) },
            { icon: ChevronLast, label: 'Fim', act: () => go(plies.length) },
          ].map(({ icon: Icon, label, act }) => (
            <button key={label} type="button" onClick={act} title={label} className="flex h-10 flex-1 items-center justify-center rounded bg-raise text-ink-2 hover:bg-raise-2 hover:text-ink">
              <Icon size={26} strokeWidth={2.6} />
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Summary({
  analysis,
  players,
  me,
  onStart,
}: {
  analysis: GameAnalysis;
  players: Record<Color, { name: string; rating: number; avatar?: string }>;
  me: Color;
  onStart: () => void;
}) {
  const counts = (color: Color) => {
    const c = Object.fromEntries(CLASSIFICATIONS.map((k) => [k, 0])) as Record<string, number>;
    for (const m of analysis.moves) if (m.color === color) c[m.classification]!++;
    return c;
  };
  const w = counts('white');
  const b = counts('black');
  const mine = analysis.moves.filter((m) => m.color === me);
  const tagCount = (t: MoveTag) => mine.filter((m) => m.tags?.includes(t)).length;
  const teaching: Array<[MoveTag, number]> = (['obvious-blunder', 'obvious-miss', 'only-move', 'hard-find'] as MoveTag[]).map((t) => [t, tagCount(t)]);
  return (
    <div className="m-3 rounded-lg bg-panel-2 p-4">
      {analysis.opening && <p className="mb-3 text-center text-sm text-ink-3">{analysis.opening}</p>}
      {teaching.some(([, n]) => n > 0) && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {teaching.map(([t, n]) => (
            // A zero stays neutral so only what happened in the game carries color.
            <div key={t} className={clsx('rounded-md px-2.5 py-2', n === 0 ? 'bg-raise/50' : TAG_INFO[t].tone === 'bad' ? 'bg-cls-blunder/15' : 'bg-go/15')} title={TAG_INFO[t].label}>
              <div className={clsx('text-xl font-extrabold', n === 0 ? 'text-ink-3' : TAG_INFO[t].tone === 'bad' ? 'text-cls-miss' : 'text-go-hover')}>{n}</div>
              <div className={clsx('text-[12px] font-bold', n === 0 ? 'text-ink-3' : 'text-ink-2')}>{TAG_INFO[t].label}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
        {(['white', 'black'] as const).map((c, i) => (
          <div key={c} className={clsx('flex flex-col items-center gap-1', i === 1 && 'col-start-3')}>
            <span className={clsx('max-w-[140px] truncate text-sm font-bold', c === me ? 'text-ink' : 'text-ink-2')}>{players[c].name}</span>
            <span className={clsx('min-w-[76px] rounded-md px-3 py-1.5 text-[24px] font-extrabold', c === 'white' ? 'bg-white text-[#262421]' : 'bg-[#3c3a37] text-white')}>
              {analysis.accuracy[c].toFixed(1)}
            </span>
          </div>
        ))}
        <span className="col-start-2 row-start-1 text-xs font-bold uppercase tracking-wide text-ink-4">Precisão</span>
      </div>
      <table className="w-full text-[14px]">
        <tbody>
          {CLASSIFICATIONS.map((k) => (
            <tr key={k}>
              <td className="w-10 py-0.5 text-center font-bold tabular-nums text-ink-2">{w[k]}</td>
              <td className="py-0.5">
                <span className="flex items-center justify-center gap-2 font-semibold text-ink-2">
                  <ClassificationIcon cls={k} size={18} />
                  <span className="w-28">{CLASS_LABEL[k]}</span>
                </span>
              </td>
              <td className="w-10 py-0.5 text-center font-bold tabular-nums text-ink-2">{b[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-go mt-4 w-full text-[17px]" onClick={onStart}>Começar revisão</button>
    </div>
  );
}

function RetryBox({ retry, onGiveUp, onClose }: { retry: Retry; onGiveUp: () => void; onClose: () => void }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-bold">
          {retry.status === 'waiting' && (retry.message ? <span className="text-cls-miss"><RichText text={retry.message} /></span> : 'Encontre o lance melhor.')}
          {retry.status === 'checking' && 'Conferindo com o motor...'}
          {(retry.status === 'right' || retry.status === 'ok' || retry.status === 'wrong') && <RichText text={retry.message ?? ''} />}
        </p>
        <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Fechar"><X size={18} /></button>
      </div>
      {retry.status !== 'right' && retry.status !== 'ok' && (
        <button type="button" className="btn-flat mt-3 flex items-center gap-1.5 text-sm" onClick={onGiveUp}>
          <Lightbulb size={15} /> Mostrar a resposta
        </button>
      )}
    </div>
  );
}

function ExploreBox({ live, fen, variation, refutation, loadingRefutation, onBack }: {
  live: { fen: string; lines: EngineLine[]; depth: number } | null;
  fen: string;
  variation: Variation;
  refutation: Refutation | null;
  loadingRefutation: boolean;
  onBack: () => void;
}) {
  const lines = live && live.fen === fen ? live.lines : [];
  const first = variation.moves[0];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold text-ink-2">
          Explorando {variation.moves.slice(0, variation.index).map((m, i) => <San key={i} san={m.san} className="mr-1 text-ink" />)}
        </p>
        <button type="button" className="text-sm font-bold text-go hover:text-go-hover" onClick={onBack}>Voltar à partida</button>
      </div>

      {first && (
        <div className="mb-2.5 rounded-md bg-black/20 p-2.5 text-[13px] leading-relaxed">
          <div className="font-bold text-ink">Por que não <San san={first.san} />?</div>
          {loadingRefutation || !refutation ? (
            <div className="text-ink-3">Calculando a resposta...</div>
          ) : refutation.loss === 0 ? (
            <div className="text-go-hover">É o lance do motor.</div>
          ) : !refutation.relevant ? (
            <div className="text-go-hover">Equivalente a <San san={refutation.best.firstSan} /> no seu nível (perde só {plural(Math.round(refutation.loss), 'ponto', 'pontos')} de chance).</div>
          ) : (
            <>
              <div className="text-cls-miss">Perde {Math.round(refutation.loss)} pontos de chance de vitória.</div>
              {refutation.reply.san.length > 0 && (
                <div className="text-ink-2">Resposta: <SanLine fen={first.fenAfter} san={refutation.reply.san.slice(0, 6)} /></div>
              )}
              {refutation.reply.payoff && <div className="text-ink-3"><RichText text={`A punição se concretiza ${refutation.reply.payoff.text}.`} /></div>}
              {refutation.reply.motifs.slice(0, 2).map((m) => <div key={m.theme} className="text-ink-3">{m.text[0]!.toUpperCase() + m.text.slice(1)}.</div>)}
              <div className="mt-1 text-ink-2">O motor prefere <San san={refutation.best.firstSan} className="font-bold" />{refutation.best.payoff ? <>, que se concretiza <RichText text={refutation.best.payoff.text} /></> : ''}.</div>
              {refutation.best.motifs.filter((m) => m.theme === 'prevents').map((m) => <div key={m.theme} className="text-ink-3">{m.text[0]!.toUpperCase() + m.text.slice(1)}.</div>)}
            </>
          )}
        </div>
      )}

      {lines.length ? (
        <ul className="space-y-1">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2 text-[13px]">
              <span className="w-12 shrink-0 rounded bg-raise px-1 text-center font-bold tabular-nums">{formatScore(lineScore(l))}</span>
              <span className="truncate text-ink-3"><SanLine fen={fen} san={lineToSan(fen, l.pv, 8)} /></span>
            </li>
          ))}
          <li className="text-xs text-ink-4">profundidade {live?.depth}</li>
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Calculando...</p>
      )}
    </div>
  );
}
