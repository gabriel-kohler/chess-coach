// Aberturas > Qualquer abertura: find any opening by name, see the engine's
// line, what people at your level play and what your games did from it, and
// train it against people at your level.
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Eye, GraduationCap, Layers, Loader2, Search } from 'lucide-react';
import { BuildingNote } from '@/components/decks/DeckList';
import { BUILD, oursIn } from '@/lib/decks/build';
import { createStudyDeck, findStudyDeck } from '@/lib/decks/store';
import type { StudyDeck } from '@/lib/decks/types';
import { useEffect, useMemo, useState } from 'react';
import { Board } from '@/components/board/Board';
import { LineControls } from '@/components/board/LineControls';
import { useBookBadge } from '@/components/board/useBookBadge';
import { lineFrom, useLineExplorer } from '@/components/board/useLineExplorer';
import { SanLine } from '@/components/San';
import { START_FEN, lineToSan } from '@/lib/chess/replay';
import { db } from '@/lib/db';
import { factsEngine } from '@/lib/engine/stockfish';
import { plural } from '@/lib/format';
import { DEFAULT_OFFSET } from '@/lib/maia/calibrate';
import { maiaPolicy } from '@/lib/maia/client';
import { explorerMoves, ratingBuckets } from '@/lib/openings/explorer';
import { loadLevel, NO_RATING, type Level } from '@/lib/openings/level';
import {
  defaultSide,
  facedOpenings,
  fenAfter,
  gamesLine,
  humanLine,
  lineId,
  loadOpeningLines,
  searchOpenings,
  STUDY_KEY,
  epdAfter,
  type LineMove,
  type OpeningLine,
  type StudyRecord,
} from '@/lib/openings/study';
import { statsAt, type GamesIndex } from '@/lib/repertoire/games';
import { formatScore } from '@/lib/review/scoring';
import { useAccount } from '@/lib/settings';
import type { Color, EngineLine, StoredGame } from '@/lib/types';
import { STUDY_MOVES, useStudyDrill, type StudySetup } from './useStudyDrill';

const sideLabel = (c: Color) => (c === 'white' ? 'brancas' : 'pretas');
const Swatch = ({ c }: { c: Color }) => <span className={clsx('inline-block h-3 w-3 shrink-0 rounded-[2px]', c === 'white' ? 'bg-white' : 'border border-ink-4 bg-[#2b2927]')} />;

/** Your level (lib/openings/level.ts), read again when your rating changes. */
function useLevel() {
  const rating = useAccount()?.stats.chess_rapid?.last?.rating;
  const [level, setLevel] = useState<Level | null>(null);
  useEffect(() => {
    let alive = true;
    void loadLevel().then((l) => alive && setLevel(l));
    return () => {
      alive = false;
    };
  }, [rating]);
  const fallback = (rating ?? NO_RATING) + DEFAULT_OFFSET;
  return level ? { ...level, ready: true } : { rating: rating ?? NO_RATING, userElo: fallback, oppElo: fallback, maia: false, explorer: false, ready: false };
}

/** "1400 a 1799": the explorer's range for a rating. */
function rangeLabel(elo: number): string {
  const b = ratingBuckets(elo);
  const top = { 0: 999, 1000: 1199, 1200: 1399, 1400: 1599, 1600: 1799, 1800: 1999, 2000: 2199, 2200: 2499, 2500: 3000 }[b[b.length - 1]!] ?? b[b.length - 1]!;
  return `${b[0]} a ${top}`;
}

function Layout({ board, children }: { board: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-4 lg:flex-row lg:px-8">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 150px)' }}>{board}</div>
      </div>
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-[400px]">{children}</aside>
    </div>
  );
}

export function OpeningStudy({ index, games, onOpenDeck }: { index: Record<Color, GamesIndex> | null; games: StoredGame[] | undefined; onOpenDeck: (id: string) => void }) {
  const [all, setAll] = useState<OpeningLine[] | null>(null);
  useEffect(() => {
    void loadOpeningLines().then(setAll);
  }, []);
  const [picked, setPicked] = useState<{ line: OpeningLine; side: Color } | null>(null);
  const [drilling, setDrilling] = useState(false);
  const records = useLiveQuery(async () => ((await db.kv.get(STUDY_KEY))?.value as Record<string, StudyRecord>) ?? {}, []);
  const level = useLevel();
  // The deck you saved for this opening and color, if any: the study grades its cards.
  const deck = useLiveQuery(async () => (picked ? ((await findStudyDeck(picked.line, picked.side)) ?? null) : null), [picked ? lineId(picked.line) : '', picked?.side]);

  const pick = (line: OpeningLine, side?: Color) => {
    setPicked({ line, side: side ?? defaultSide(line, index) });
    setDrilling(false);
  };

  if (!picked) return <Picker all={all} games={games} records={records ?? {}} onPick={pick} />;
  const tree = index?.[picked.side].tree ?? null;
  if (drilling) {
    return (
      <Drill
        setup={{ line: picked.line, side: picked.side, tree, userElo: level.userElo, oppElo: level.oppElo, rating: level.rating, maia: level.maia, explorer: level.explorer, deck: deck ? { id: deck.id, positions: deck.positions } : null }}
        onBack={() => setDrilling(false)}
      />
    );
  }
  return (
    <Lines
      line={picked.line}
      side={picked.side}
      index={index}
      level={level}
      record={records?.[lineId(picked.line)]}
      deck={deck ?? null}
      onSide={(side) => setPicked({ ...picked, side })}
      onTrain={() => setDrilling(true)}
      onOpenDeck={onOpenDeck}
      onBack={() => setPicked(null)}
    />
  );
}

// ------------------------------------------------------------------ picker

function Picker({ all, games, records, onPick }: { all: OpeningLine[] | null; games: StoredGame[] | undefined; records: Record<string, StudyRecord>; onPick: (line: OpeningLine, side?: Color) => void }) {
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<OpeningLine | null>(null);
  const results = useMemo(() => (all && query.trim() ? searchOpenings(all, query, 14) : []), [all, query]);
  const faced = useMemo(() => (all && games ? facedOpenings(games, all, Date.now()) : []), [all, games]);
  const studied = useMemo(
    () =>
      all
        ? Object.entries(records)
            .sort((a, b) => b[1].lastAt - a[1].lastAt)
            .slice(0, 6)
            .map(([id, r]) => ({ line: all.find((l) => lineId(l) === id), r }))
            .filter((x): x is { line: OpeningLine; r: StudyRecord } => !!x.line)
        : [],
    [all, records],
  );
  const shown = preview ?? results[0] ?? null;
  return (
    <Layout board={<Board fen={shown ? fenAfter(shown.moves) : START_FEN} orientation="white" lastMove={null} movable={null} />}>
      <div className="rounded-lg bg-panel p-4">
        <label htmlFor="opening-search" className="text-sm font-bold text-ink-3">Qualquer abertura, não só o seu repertório</label>
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 focus-within:border-go">
          <Search size={16} className="shrink-0 text-ink-4" />
          <input
            id="opening-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="moderna, van't kruijs, caro-kann..."
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-2.5 text-ink outline-none placeholder:text-ink-4 focus-visible:outline-none"
          />
        </div>
        {!all && <p className="mt-2 flex items-center gap-2 text-sm text-ink-3"><Loader2 size={14} className="animate-spin" /> Carregando as aberturas...</p>}
        {query.trim() && all && !results.length && <p className="mt-2 text-sm text-ink-3">Nenhuma abertura com esse nome. Os nomes do catálogo são em inglês; os mais comuns em português também funcionam.</p>}
        {results.length > 0 && (
          <ul className="mt-2 flex flex-col" onMouseLeave={() => setPreview(null)}>
            {results.map((l) => (
              <li key={lineId(l)}>
                <button type="button" onClick={() => onPick(l)} onMouseEnter={() => setPreview(l)} onFocus={() => setPreview(l)} className="w-full rounded-md px-2 py-2 text-left hover:bg-raise focus-visible:bg-raise">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-bold text-ink">{l.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-4">{l.eco}</span>
                  </span>
                  <span className="block truncate text-xs text-ink-3"><SanLine fen={START_FEN} san={l.moves.slice(0, 10)} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!query.trim() && faced.length > 0 && (
        <div className="rounded-lg bg-panel p-4">
          <div className="mb-2 text-sm font-bold text-ink-3">As que você mais enfrenta (rapid e blitz, 12 meses)</div>
          <ul className="flex flex-col">
            {faced.map((f) => (
              <li key={`${f.color}|${f.family}`}>
                <button type="button" onClick={() => onPick(f.line, f.color)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-raise">
                  <Swatch c={f.color} />
                  <span className="min-w-0 flex-1 truncate font-bold text-ink">{f.family}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-3">{f.n}</span>
                  <span className={clsx('w-11 shrink-0 text-right text-sm font-bold tabular-nums', f.score < 45 ? 'text-cls-miss' : f.score >= 55 ? 'text-go-hover' : 'text-ink-2')}>{f.score}%</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-4">Cor: o lado com que você jogou. Número de partidas e o seu aproveitamento.</p>
        </div>
      )}

      {!query.trim() && studied.length > 0 && (
        <div className="rounded-lg bg-panel p-4">
          <div className="mb-2 text-sm font-bold text-ink-3">Estudadas por último</div>
          <ul className="flex flex-col">
            {studied.map(({ line, r }) => (
              <li key={lineId(line)}>
                <button type="button" onClick={() => onPick(line, r.side)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-raise">
                  <Swatch c={r.side} />
                  <span className="min-w-0 flex-1 truncate font-bold text-ink">{line.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-3">{plural(r.drills, 'linha')} · {r.asked ? Math.round((100 * r.good) / r.asked) : 0}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Layout>
  );
}

// ------------------------------------------------------------------ lines

type Source = 'engine' | 'human' | 'games';

function Lines({ line, side, index, level, record, deck, onSide, onTrain, onOpenDeck, onBack }: {
  line: OpeningLine;
  side: Color;
  index: Record<Color, GamesIndex> | null;
  level: ReturnType<typeof useLevel>;
  record: StudyRecord | undefined;
  deck: StudyDeck | null;
  onSide: (c: Color) => void;
  onTrain: () => void;
  onOpenDeck: (id: string) => void;
  onBack: () => void;
}) {
  const fen = useMemo(() => fenAfter(line.moves), [line]);
  const tree = index?.[side].tree ?? null;
  const [source, setSource] = useState<Source>('engine');
  const [engine, setEngine] = useState<{ fen: string; lines: EngineLine[]; depth: number } | null>(null);
  const [human, setHuman] = useState<{ key: string; moves: LineMove[] } | null>(null);
  const games = useMemo(() => gamesLine(fen, tree), [fen, tree]);
  const here = tree ? statsAt(tree, epdAfter(line.moves)) : [];
  const reached = here.reduce((s, x) => s + x.n, 0);
  const points = here.reduce((s, x) => s + x.points, 0);

  // The engine's lines from the opening's position, deepening as it thinks.
  useEffect(() => {
    let alive = true;
    setEngine(null);
    void factsEngine().analyse(fen, { depth: 18, multipv: 3, movetime: 6000 }, (u) => alive && setEngine({ fen, lines: u.lines, depth: u.depth })).then((lines) => {
      if (alive && lines.length) setEngine({ fen, lines, depth: lines[0]!.depth });
    });
    return () => {
      alive = false;
    };
  }, [fen]);

  // What people at your level play, both sides.
  const humanKey = `${fen}|${side}|${level.explorer}`;
  useEffect(() => {
    if (!level.ready) return;
    let alive = true;
    setHuman(null);
    void humanLine(fen, { tree, userColor: side, userElo: level.userElo, oppElo: level.oppElo, policy: level.maia ? maiaPolicy : null, explorer: level.explorer ? explorerMoves : null }).then(
      (moves) => alive && setHuman({ key: humanKey, moves }),
    );
    return () => {
      alive = false;
    };
  }, [humanKey, level.ready, level.maia]);

  const best = engine?.fen === fen ? engine.lines[0] : undefined;
  const continuation: string[] =
    source === 'engine' ? (best ? lineToSan(fen, best.pv, 12) : []) : source === 'human' ? (human?.key === humanKey ? human.moves.map((m) => m.san) : []) : games.map((m) => m.san);
  const full = useMemo(() => lineFrom(START_FEN, [...line.moves, ...continuation]), [line, continuation.join(' ')]);
  const explorer = useLineExplorer({ start: START_FEN, line: full, enabled: true, initialPly: line.moves.length });
  const badge = useBookBadge(explorer.fen, explorer.lastMove);

  return (
    <Layout board={<Board fen={explorer.fen} orientation={side} lastMove={explorer.lastMove} movable="both" onMove={explorer.onMove} arrows={explorer.arrows} badge={badge} />}>
      <div className="rounded-lg bg-panel p-4">
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={16} /> Trocar de abertura</button>
        <h2 className="text-xl font-extrabold leading-tight">{line.name}</h2>
        <p className="mt-1 text-sm text-ink-3">{line.eco} · <SanLine fen={START_FEN} san={line.moves} /></p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-ink-3">Você joga de</span>
          {(['white', 'black'] as const).map((c) => (
            <button key={c} type="button" onClick={() => onSide(c)} aria-pressed={side === c} className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1 font-bold', side === c ? 'bg-raise-2 text-ink' : 'bg-panel-2 text-ink-3 hover:text-ink')}>
              <Swatch c={c} /> {c === 'white' ? 'Brancas' : 'Pretas'}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-2">
          {reached ? <>Nas suas partidas de {sideLabel(side)}, {plural(reached, 'chegou aqui', 'chegaram aqui')}: você fez <b className={clsx(points / reached < 0.45 ? 'text-cls-miss' : 'text-ink')}>{Math.round((100 * points) / reached)}%</b>.</> : <>Nenhuma partida sua de {sideLabel(side)} chegou nesta posição.</>}
          {record && <> Estudada: {plural(record.drills, 'linha')}, {record.asked ? Math.round((100 * record.good) / record.asked) : 0}% de acerto.</>}
        </p>
      </div>

      <div className="rounded-lg bg-panel p-4">
        <div className="flex rounded-md bg-panel-2 p-1 text-sm font-bold" role="tablist" aria-label="Linha">
          {([['engine', 'Stockfish'], ['human', 'No seu nível'], ['games', 'Suas partidas']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={source === k} onClick={() => setSource(k)} className={clsx('flex-1 whitespace-nowrap rounded px-2 py-1.5', source === k ? 'bg-raise text-ink' : 'text-ink-3 hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-sm text-ink-2">
          {source === 'engine' && (
            engine?.fen === fen ? (
              <>
                <p>A melhor linha para os dois lados, profundidade {engine.depth}.</p>
                <ul className="mt-2 space-y-1">
                  {engine.lines.map((l, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-12 shrink-0 rounded bg-raise px-1 text-center font-bold tabular-nums">{formatScore(l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 })}</span>
                      <span className="truncate text-ink-3"><SanLine fen={fen} san={lineToSan(fen, l.pv, 6)} /></span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flex items-center gap-2 text-ink-3"><Loader2 size={14} className="animate-spin" /> O motor está calculando...</p>
            )
          )}
          {source === 'human' && (
            human?.key === humanKey ? (
              human.moves.length ? (
                <>
                  <p>O lance mais jogado a cada vez, pelos dois lados, por gente do seu nível{level.explorer ? `: partidas de blitz e rapid do Lichess entre ${rangeLabel(level.userElo)} (o seu rapid ${level.rating} do chess.com equivale a uns ${level.userElo} lá)` : ''}. Onde os seus adversários jogaram a posição 20 vezes ou mais, vale o que eles jogaram (suas).</p>
                  <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                    {human.moves.map((m, i) => (
                      <li key={i} className="tabular-nums"><b className="text-ink">{m.san}</b> <span className="text-ink-4">{Math.round((m.p ?? 0) * 100)}%{m.source === 'games' ? ' (suas)' : m.source === 'maia' ? ' (Maia)' : ''}</span></li>
                    ))}
                  </ol>
                  {human.moves.length < 12 && <p className="mt-2 text-xs text-ink-4">A linha para onde não há dados do seu nível.</p>}
                </>
              ) : (
                <p className="text-ink-3">Sem dados do seu nível para esta posição{level.explorer ? '.' : ' nas suas partidas.'}</p>
              )
            ) : (
              <p className="flex items-center gap-2 text-ink-3"><Loader2 size={14} className="animate-spin" /> Calculando o que se joga no seu nível...</p>
            )
          )}
          {source === 'human' && !level.explorer && (
            <p className="mt-3 rounded-md bg-panel-2 p-2.5 text-xs leading-relaxed text-ink-3">
              Para ver o que se joga no seu rating em qualquer abertura, e não só nas suas partidas: crie um token grátis no Lichess (lichess.org/account/oauth/token, sem marcar nenhuma permissão), coloque <code className="text-ink-2">LICHESS_TOKEN=...</code> no <code className="text-ink-2">.env.local</code> do chess-coach e reinicie o <code className="text-ink-2">npm run dev</code>. O token fica só no servidor local.
            </p>
          )}
          {source === 'games' &&
            (games.length ? (
              <>
                <p>O lance mais jogado nas suas partidas de {sideLabel(side)}, a cada vez, e o seu aproveitamento com ele.</p>
                <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                  {games.map((m, i) => (
                    <li key={i} className="tabular-nums"><b className="text-ink">{m.san}</b> <span className="text-ink-4">{m.n}x · {m.score}%</span></li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="text-ink-3">Nenhuma partida sua de {sideLabel(side)} passou por aqui.</p>
            ))}
        </div>
      </div>

      <LineControls explorer={explorer} title="A linha no tabuleiro" />

      <button type="button" className="btn-go flex items-center justify-center gap-2 text-[17px]" onClick={onTrain}>
        <GraduationCap size={20} /> Treinar esta abertura
      </button>
      <p className="text-xs text-ink-4">Você joga de {sideLabel(side)} e o app responde como alguém do seu nível. O Stockfish julga cada lance seu; os que você errar voltam na sua revisão, no Treinar e na Tática.</p>
      <SaveDeck line={line} side={side} deck={deck} explorer={level.explorer} onOpenDeck={onOpenDeck} />
    </Layout>
  );
}

/** Saves the opening as a deck of its own (built in the background), or opens the one you have. */
function SaveDeck({ line, side, deck, explorer, onOpenDeck }: { line: OpeningLine; side: Color; deck: StudyDeck | null; explorer: boolean; onOpenDeck: (id: string) => void }) {
  const [size, setSize] = useState<number>(BUILD.size);
  const [saving, setSaving] = useState(false);
  if (deck) {
    return (
      <div className="rounded-lg bg-panel p-4">
        <button type="button" className="btn-flat flex w-full items-center justify-center gap-2" onClick={() => onOpenDeck(deck.id)}>
          <Layers size={18} /> Treinar o deck
        </button>
        <p className="mt-2 text-xs text-ink-4">
          {deck.status === 'building' ? <BuildingNote deck={deck} /> : `Deck salvo com ${plural(oursIn(deck.positions, deck.side), 'posição sua', 'posições suas')}.`} O estudo livre desta abertura também revisa os cards dele.
        </p>
      </div>
    );
  }
  const save = async () => {
    setSaving(true);
    try {
      onOpenDeck((await createStudyDeck(line, side, size)).id);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-3">Deck com</span>
        {BUILD.sizes.map((n) => (
          <button key={n} type="button" onClick={() => setSize(n)} aria-pressed={size === n} className={clsx('rounded-md px-2.5 py-1 font-bold tabular-nums', size === n ? 'bg-raise-2 text-ink' : 'bg-panel-2 text-ink-3 hover:text-ink')}>
            {n}
          </button>
        ))}
        <span className="text-ink-3">posições suas</span>
      </div>
      <button type="button" className="btn-flat mt-3 flex w-full items-center justify-center gap-2" disabled={saving} onClick={() => void save()}>
        <Layers size={18} /> Salvar como deck
      </button>
      <p className="mt-2 text-xs text-ink-4">
        As linhas mais jogadas no seu nível viram um deck com revisões próprias, em Aberturas &gt; Decks. Onde você já estudou, o deck usa o seu lance (se o motor aprovou); senão, a resposta do seu repertório; senão, a do Stockfish. A montagem roda em segundo plano e leva de alguns segundos a um ou dois minutos (o Lichess às vezes pede para esperar).
        {!explorer && ' Sem o token do Lichess, as respostas do adversário vêm só das suas partidas.'}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ drill

function Drill({ setup, onBack }: { setup: StudySetup; onBack: () => void }) {
  const d = useStudyDrill(setup);
  const { phase, feedback, reply, count, explorer } = d;
  const ended = phase === 'end';
  const badge = useBookBadge(ended ? explorer.fen : d.fen, ended ? explorer.lastMove : d.lastMove);
  const pct = reply ? Math.round(reply.p * 100) : 0;
  const replyText = reply
    ? reply.source === 'games'
      ? `${reply.san}: ${pct}% dos seus adversários jogaram isto aqui.`
      : reply.source === 'explorer'
        ? `${reply.san}: ${pct}% dos jogadores de ${rangeLabel(setup.oppElo)} jogam isto aqui (blitz e rapid, Lichess).`
        : reply.source === 'maia'
          ? `${reply.san}: ${pct}% segundo o Maia, no seu rating.`
          : `${reply.san}: sem dados do seu nível aqui, o motor escolheu.`
    : null;
  return (
    <Layout
      board={
        ended ? (
          <Board fen={explorer.fen} orientation={setup.side} lastMove={explorer.lastMove} movable="both" onMove={explorer.onMove} arrows={explorer.arrows} badge={badge} />
        ) : (
          <Board fen={d.fen} orientation={setup.side} lastMove={d.lastMove} movable={phase === 'yours' ? setup.side : null} onMove={d.onMove} arrows={d.arrows} badge={badge} />
        )
      }
    >
      <div className="rounded-lg bg-panel p-4">
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={16} /> Voltar às linhas</button>
        <div className="font-extrabold leading-tight">{setup.line.name}</div>
        <div className="mt-2 flex gap-1" aria-label={`Lance ${count.yours} de ${STUDY_MOVES}`}>
          {Array.from({ length: STUDY_MOVES }, (_, i) => <span key={i} className={clsx('h-2 flex-1 rounded-[2px]', i < count.yours ? 'bg-go' : 'bg-raise')} />)}
        </div>
        <p className="mt-2 text-xs text-ink-4">
          {count.asked ? `Certos de primeira nesta linha: ${count.good} de ${count.asked}` : `Você joga de ${sideLabel(setup.side)}`}
          {count.lines > 0 && ` · ${plural(count.lines, 'linha treinada', 'linhas treinadas')}`}
        </p>
      </div>

      <div className={clsx('rounded-lg p-4', feedback.kind === 'wrong' ? 'bg-[#4a2b27]' : feedback.kind === 'good' ? 'bg-[#2f3f25]' : 'bg-panel')}>
        {replyText && !ended && <p className="text-sm text-ink-3">{replyText}</p>}
        <p className={clsx('font-bold', replyText && !ended && 'mt-2')}>
          {phase === 'opponent'
            ? 'O adversário está pensando...'
            : phase === 'checking'
              ? <span className="flex items-center gap-2 text-ink-2"><Loader2 size={16} className="animate-spin" /> Conferindo com o motor...</span>
              : feedback.text || (phase === 'yours' ? 'Sua vez: jogue um bom lance.' : '')}
        </p>
        {phase === 'yours' && feedback.kind === 'good' && <p className="mt-1 text-sm text-ink-3">Sua vez.</p>}
      </div>

      {!ended && (
        <button type="button" className="btn-flat flex items-center justify-center gap-2" onClick={d.showBest} disabled={phase !== 'yours' && phase !== 'wrong'}>
          <Eye size={16} /> Mostrar o melhor
        </button>
      )}
      <LineControls explorer={explorer} title="A linha treinada" />
      {ended && (
        <button type="button" className="btn-go text-[17px]" onClick={d.newLine} autoFocus>
          Outra linha
        </button>
      )}
      <p className="text-xs text-ink-4">Bom lance: perde menos de 5 pontos de chance de vitória para o melhor do motor. Os que você errar voltam na sua revisão amanhã, no Treinar e na Tática.</p>
    </Layout>
  );
}
