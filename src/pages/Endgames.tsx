import clsx from 'clsx';
import { Chess } from 'chess.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Check, Lightbulb, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playSound, soundForSan } from '@/components/board/assets';
import { Board, type BoardMove } from '@/components/board/Board';
import { LineControls } from '@/components/board/LineControls';
import { lineFrom, useLineExplorer } from '@/components/board/useLineExplorer';
import type { Arrow } from '@/components/board/geometry';
import { PageHeader } from '@/components/Layout';
import { RichText } from '@/components/San';
import { db, getKV, setKV } from '@/lib/db';
import { ENDGAMES, type EndgameDrill, type EndgameRecord } from '@/lib/endgames';
import { sharedEngine } from '@/lib/engine/stockfish';
import { tryUci } from '@/lib/chess/replay';
import { plural } from '@/lib/format';
import { useTrainingActive } from '@/lib/renewal/activity';
import type { EngineLine } from '@/lib/types';
import { ARROW } from '@/components/board/colors';

const GOAL_TEXT: Record<EndgameDrill['goal'], (n: number) => string> = {
  mate: (n) => `Dê mate em até ${n} lances.`,
  promote: (n) => `Promova o peão em até ${n} lances, sem perder a vantagem.`,
  win: (n) => `Deixe o adversário só com o rei em até ${n} lances.`,
  draw: (n) => `Segure o empate por ${n} lances.`,
};

type Status = 'playing' | 'thinking' | 'success' | 'failed';

function userScore(line: EngineLine | undefined, side: 'white' | 'black'): number {
  if (!line) return 0;
  const cp = line.mate !== undefined ? (line.mate > 0 ? 10000 : -10000) : line.cp ?? 0;
  return side === 'white' ? cp : -cp;
}

function onlyKing(fen: string, color: 'w' | 'b'): boolean {
  const board = fen.split(' ')[0]!;
  const pieces = [...board].filter((c) => /[a-z]/i.test(c) && (color === 'w' ? c === c.toUpperCase() : c === c.toLowerCase()));
  return pieces.length === 1;
}

export default function Endgames() {
  const records = useLiveQuery(async () => ((await db.kv.get('endgames'))?.value as Record<string, EndgameRecord>) ?? {}, []);
  const [drill, setDrill] = useState<EndgameDrill | null>(null);

  if (drill) return <DrillView drill={drill} records={records ?? {}} onExit={() => setDrill(null)} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader title="Finais" />
      <p className="mb-5 max-w-3xl text-ink-2">
        Mais da metade das suas derrotas em rapid acontece depois do lance 30. Estes são os finais que aparecem de verdade nas partidas. Você joga contra o Stockfish na força máxima: ou converte, ou segura.
      </p>
      {[1, 2, 3].map((level) => (
        <section key={level} className="mb-6">
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-ink-3">{level === 1 ? 'Básico' : level === 2 ? 'Intermediário' : 'Avançado'}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ENDGAMES.filter((d) => d.level === level).map((d) => {
              const r = records?.[d.id];
              return (
                <button key={d.id} type="button" onClick={() => setDrill(d)} className="flex flex-col rounded-lg bg-panel p-4 text-left hover:bg-raise">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[16px] font-extrabold">{d.name}</span>
                    {r?.successes ? <span className="flex items-center gap-1 text-sm font-bold text-go"><Check size={16} strokeWidth={3} />{r.successes}</span> : null}
                  </div>
                  <span className="mt-1 text-sm text-ink-3">{d.side === 'white' ? 'Brancas' : 'Pretas'} · {GOAL_TEXT[d.goal](d.moves)}</span>
                  <span className="mt-2 line-clamp-2 text-sm text-ink-4">{d.idea}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function DrillView({ drill, records, onExit, header, practice = false, countOnce = false, onFinish, onNext }: {
  drill: EndgameDrill;
  records: Record<string, EndgameRecord>;
  onExit?: () => void;
  /** Replaces the back button and title (a training session has its own header). */
  header?: React.ReactNode;
  /** Free practice: nothing is recorded. */
  practice?: boolean;
  /** Only the first attempt counts (a training step); "Recomeçar" is practice after it. */
  countOnce?: boolean;
  onFinish?: (ok: boolean, movesUsed: number) => void;
  /** Shows "Próxima" once the attempt is over. */
  onNext?: () => void;
}) {
  useTrainingActive();
  const [fen, setFen] = useState(drill.fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [status, setStatus] = useState<Status>('playing');
  const [used, setUsed] = useState(0);
  const [message, setMessage] = useState('');
  const [hint, setHint] = useState<Arrow | null>(null);
  const [run, setRun] = useState(0);
  const runRef = useRef(0);
  runRef.current = run;
  const fenRef = useRef(drill.fen);
  const history = useRef<string[]>([]);
  // The moves of this attempt (SAN): navigable once it is over.
  const [played, setPlayed] = useState<string[]>([]);
  const saved = useRef(false);
  // With countOnce: the run that counted; later runs are free practice.
  const countedRun = useRef<number | null>(null);
  // Every engine answer belongs to one attempt; "Recomeçar" starts a new one.
  const attempt = useRef(0);
  const flags = useRef({ practice, countOnce, onFinish });
  flags.current = { practice, countOnce, onFinish };

  const save = useCallback(async (success: boolean, movesUsed: number) => {
    if (saved.current) return;
    saved.current = true;
    // Read and written together: the records on screen may be older than the stored ones.
    await db.transaction('rw', db.kv, async () => {
      const all = await getKV<Record<string, EndgameRecord>>('endgames', {});
      const prev = all[drill.id] ?? { attempts: 0, successes: 0, lastAt: 0 };
      await setKV('endgames', {
        ...all,
        [drill.id]: {
          attempts: prev.attempts + 1,
          successes: prev.successes + (success ? 1 : 0),
          best: success ? Math.min(prev.best ?? Infinity, movesUsed) : prev.best,
          lastAt: Date.now(),
        },
      });
    });
  }, [drill.id]);

  const finish = useCallback((ok: boolean, text: string, movesUsed: number) => {
    setStatus(ok ? 'success' : 'failed');
    setMessage(text);
    playSound(ok ? 'notify' : 'illegal');
    const f = flags.current;
    if (f.practice || (f.countOnce && countedRun.current !== null)) return;
    countedRun.current = runRef.current;
    void save(ok, movesUsed);
    f.onFinish?.(ok, movesUsed);
  }, [save]);

  const engineMove = useCallback(async (position: string, movesUsed: number) => {
    const mine = attempt.current;
    setStatus('thinking');
    const lines = await sharedEngine().analyse(position, { depth: 18, movetime: 1500 });
    if (mine !== attempt.current) return;
    const best = lines[0]?.pv[0];
    const chess = new Chess(position);
    const mv = best ? tryUci(chess, best) : null;
    if (!mv) {
      setStatus('playing');
      return;
    }
    playSound(soundForSan(mv.san, !!mv.captured));
    history.current.push(chess.fen().split(' ').slice(0, 4).join(' '));
    setFen(chess.fen());
    setLastMove({ from: mv.from, to: mv.to });
    setPlayed((p) => [...p, mv.san]);
    if (chess.isCheckmate()) return finish(false, 'Levou mate.', movesUsed);
    if (drill.goal === 'draw' && (chess.isStalemate() || chess.isInsufficientMaterial())) return finish(true, 'Empate garantido!', movesUsed);
    setStatus('playing');
  }, [drill.goal, finish]);

  // (Re)start
  useEffect(() => {
    attempt.current++;
    setFen(drill.fen);
    setLastMove(null);
    setUsed(0);
    setMessage('');
    setHint(null);
    saved.current = false;
    history.current = [];
    setPlayed([]);
    if (drill.engineFirst) void engineMove(drill.fen, 0);
    else setStatus('playing');
  }, [drill, run]);

  const onMove = (m: BoardMove): boolean => {
    if (status !== 'playing') return false;
    const chess = new Chess(fen);
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      return false;
    }
    playSound(soundForSan(mv.san, !!mv.captured));
    const movesUsed = used + 1;
    setUsed(movesUsed);
    setHint(null);
    setFen(chess.fen());
    setLastMove({ from: mv.from, to: mv.to });
    setPlayed((p) => [...p, mv.san]);
    const epd = chess.fen().split(' ').slice(0, 4).join(' ');
    history.current.push(epd);
    const repeated = history.current.filter((h) => h === epd).length >= 3;
    const oppColor = drill.side === 'white' ? 'b' : 'w';

    if (chess.isCheckmate()) {
      finish(true, 'Mate!', movesUsed);
      return true;
    }
    if (drill.goal !== 'draw' && (chess.isStalemate() || chess.isInsufficientMaterial() || repeated)) {
      finish(false, chess.isStalemate() ? 'Afogamento: empate.' : 'A partida empatou.', movesUsed);
      return true;
    }
    if (drill.goal === 'draw' && (chess.isStalemate() || chess.isInsufficientMaterial() || repeated)) {
      finish(true, 'Empate garantido!', movesUsed);
      return true;
    }
    if (drill.goal === 'win' && onlyKing(chess.fen(), oppColor)) {
      finish(true, 'Só sobrou o rei. Vitória técnica!', movesUsed);
      return true;
    }

    // Judge the position with the engine before it answers.
    setStatus('thinking');
    const mine = attempt.current;
    void sharedEngine().analyse(chess.fen(), { depth: 16, movetime: 1200 }).then((lines) => {
      if (mine !== attempt.current) return;
      const score = userScore(lines[0], drill.side);
      if (drill.goal === 'draw') {
        if (score <= -400) return finish(false, 'A posição ficou perdida. Veja a ideia e tente de novo.', movesUsed);
        if (movesUsed >= drill.moves) return finish(true, `Você segurou por ${drill.moves} lances. Empate!`, movesUsed);
      } else {
        if (mv.promotion && score >= 500) return finish(true, 'Promoveu com vantagem decisiva!', movesUsed);
        if (score < 200) return finish(false, 'A vantagem escapou. Veja a ideia e tente de novo.', movesUsed);
        if (movesUsed >= drill.moves) return finish(false, `Acabaram os ${drill.moves} lances.`, movesUsed);
      }
      void engineMove(chess.fen(), movesUsed);
    });
    return true;
  };

  const askHint = async () => {
    const mine = attempt.current;
    const asked = fen;
    const lines = await sharedEngine().analyse(fen, { depth: 18, movetime: 1500 });
    const best = lines[0]?.pv[0];
    if (mine !== attempt.current || asked !== fenRef.current) return;
    if (best) setHint({ from: best.slice(0, 2), to: best.slice(2, 4), color: ARROW.best });
  };

  fenRef.current = fen;
  const r = records[drill.id];
  // Once it is over: walk the game back and forth, or try other moves with the engine.
  const over = status === 'success' || status === 'failed';
  const game = useMemo(() => lineFrom(drill.fen, played), [drill.fen, played]);
  const explorer = useLineExplorer({ start: drill.fen, line: game, enabled: over, initialPly: game.length });
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 40px)' }}>
          {over ? (
            <Board fen={explorer.fen} orientation={drill.side} lastMove={explorer.lastMove} movable="both" onMove={explorer.onMove} arrows={explorer.arrows} />
          ) : (
            <Board fen={fen} orientation={drill.side} lastMove={lastMove} movable={status === 'playing' ? drill.side : null} onMove={onMove} arrows={hint ? [hint] : []} />
          )}
        </div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]">
        {header}
        <div className="rounded-lg bg-panel p-4">
          {!header && <button type="button" onClick={onExit} className="mb-3 flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={16} /> Finais</button>}
          <h1 className="text-xl font-extrabold">{drill.name}</h1>
          <p className="mt-1 font-bold text-ink-2">Você joga de {drill.side === 'white' ? 'brancas' : 'pretas'}. {GOAL_TEXT[drill.goal](drill.moves)}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-3"><RichText text={drill.idea} /></p>
          {r && <p className="mt-3 text-xs text-ink-4">{r.successes} de {r.attempts} tentativas{r.best ? ` · melhor: ${plural(r.best, 'lance')}` : ''}</p>}
        </div>
        <div className={clsx('rounded-lg p-4', status === 'success' ? 'bg-ok-soft' : status === 'failed' ? 'bg-bad-soft' : 'bg-panel')}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-ink-2">{status === 'thinking' ? 'O motor está pensando...' : status === 'playing' ? 'Sua vez' : status === 'success' ? 'Conseguiu!' : 'Não foi dessa vez'}</span>
            <span className="tabular-nums text-ink-3">{used}/{drill.moves} lances</span>
          </div>
          {message && <p className={clsx('mt-2 font-bold', status === 'success' ? 'text-go-hover' : 'text-cls-miss')}>{message}</p>}
          {(practice || (countOnce && countedRun.current !== null && run > countedRun.current)) && <p className="mt-2 text-xs text-ink-4">Treino livre: não conta para os seus acertos.</p>}
        </div>
        <LineControls explorer={explorer} title="A partida" />
        <div className="flex gap-2">
          <button type="button" className="btn-flat flex flex-1 items-center justify-center gap-2" onClick={askHint} disabled={status !== 'playing'}><Lightbulb size={16} /> Dica</button>
          <button type="button" className={clsx('flex flex-1 items-center justify-center gap-2', over && !onNext ? 'btn-go' : 'btn-flat')} onClick={() => setRun((x) => x + 1)}><RotateCcw size={16} /> Recomeçar</button>
        </div>
        {over && onNext && (
          <button type="button" className="btn-go flex items-center justify-center gap-2 text-[17px]" onClick={onNext} autoFocus>
            Próxima
          </button>
        )}
      </aside>
    </div>
  );
}
