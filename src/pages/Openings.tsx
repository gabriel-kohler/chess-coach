import clsx from 'clsx';
import { Chess } from 'chess.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, BookOpen, Check, ChevronLeft, GraduationCap, Layers, Loader2, Map as MapIcon, Search, Trash2, X } from 'lucide-react';
import { DeckList } from '@/components/decks/DeckList';
import { DeckScreen } from '@/components/decks/DeckScreen';
import { useDecks, useRepCards } from '@/components/decks/useDecks';
import { OpeningStudy } from '@/components/openings/OpeningStudy';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { playSound, soundForSan } from '@/components/board/assets';
import { Board, type BoardMove } from '@/components/board/Board';
import type { Arrow } from '@/components/board/geometry';
import { useBookBadge } from '@/components/board/useBookBadge';
import { PageHeader } from '@/components/Layout';
import { MemoryPanel } from '@/components/positions/MemoryPanel';
import { RichText, San } from '@/components/San';
import { tryMove } from '@/lib/chess/replay';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { loadOpenings, nameOpening } from '@/lib/openings/book';
import { epdOf, type CompiledSide, type RepertoireMove } from '@/lib/repertoire/compile';
import { AnalyseButton, RepAnalysis, RepDrillBoard } from '@/components/openings/RepAnalysis';
import { RepFeedbackPanel } from '@/components/openings/RepFeedbackPanel';
import { useRepDrill } from '@/components/openings/useRepDrill';
import { chapterRoot, ourPositionsBelow, pathTo, reachableFrom, START_EPD } from '@/lib/repertoire/data';
import { progress } from '@/lib/repertoire/drill';
import type { RepertoireGap } from '@/lib/repertoire/gaps';
import { statsAt, topDeviations, type GamesIndex } from '@/lib/repertoire/games';
import { useOpeningsData } from '@/lib/repertoire/openingsData';
import type { Merged, UserChapter } from '@/lib/repertoire/user';
import { acceptGap, removeUserChapter, useMergedRepertoire } from '@/lib/repertoire/userChapters';
import { RENEWAL } from '@/lib/renewal/config';
import { loadSuggestions, suggestGaps, type SuggestedMove } from '@/lib/renewal/suggest';
import { formatScore } from '@/lib/review/scoring';
import { repCardId } from '@/lib/srs/cards';
import type { Color } from '@/lib/types';
import { useGames } from '@/lib/hooks';

const START_FEN = new Chess().fen();
const REP_ARROW = 'rgb(150, 190, 70)';

interface Step {
  san: string;
  uci: string;
  fen: string; // after the move
}

export default function Openings() {
  // The repertoire file with your own chapters (answers to gaps you accepted).
  const merged = useMergedRepertoire();
  const rep = merged.rep;
  const [side, setSide] = useState<Color>('white');
  // decks: one opening at a time. study: any opening, not only the repertoire.
  const [mode, setMode] = useState<'decks' | 'explore' | 'train' | 'study'>('decks');
  const [deckId, setDeckId] = useState<string | null>(null);
  const games = useGames();
  // The opening tree of your games and the gaps: worked out in a worker, cached across visits.
  const openings = useOpeningsData(games, rep, merged.signature);
  const index = openings?.index[side] ?? null;
  const gaps = openings?.gaps ?? null;
  const sideRep = rep?.sides[side] ?? null;
  const decks = useDecks(rep);
  // Every card re-read on each grade: only the deck list needs them.
  const cards = useRepCards(mode === 'decks' && !deckId);

  if (rep === undefined) return <div className="p-8 text-ink-3">Carregando...</div>;

  const openDeck = (id: string) => {
    setDeckId(id);
    setMode('decks');
  };
  const deck = deckId ? (decks?.decks.find((d) => d.id === deckId) ?? null) : null;
  const studyRow = deckId ? decks?.study.find((d) => d.id === deckId) : undefined;
  const colorModes = mode === 'explore' || mode === 'train';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-5 md:px-8">
        <PageHeader title="Aberturas" icon={BookOpen} />
        <div className="mb-5 ml-auto flex flex-wrap gap-2">
          {/* Decks and any opening have their color inside; the repertoire's modes follow this one. */}
          {colorModes && (
            <>
              {(['white', 'black'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSide(s)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', side === s ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
                  <span className={clsx('h-3 w-3 rounded-[2px]', s === 'white' ? 'bg-white' : 'border border-ink-4 bg-[#2b2927]')} />
                  {s === 'white' ? 'Brancas' : 'Pretas'}
                </button>
              ))}
              <span className="mx-1 w-px bg-line" />
            </>
          )}
          <button type="button" onClick={() => { setMode('decks'); setDeckId(null); }} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', mode === 'decks' ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            <Layers size={16} /> Decks
          </button>
          <button type="button" onClick={() => setMode('explore')} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', mode === 'explore' ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            <MapIcon size={16} /> Explorar
          </button>
          <button type="button" onClick={() => setMode('train')} disabled={!sideRep?.chapters.length} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', mode === 'train' ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            <GraduationCap size={16} /> Treinar repertório
          </button>
          <button type="button" onClick={() => setMode('study')} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold', mode === 'study' ? 'bg-raise-2 text-ink' : 'bg-panel text-ink-3 hover:text-ink')}>
            <Search size={16} /> Qualquer abertura
          </button>
        </div>
      </div>
      {colorModes && !sideRep?.chapters.length && (
        <div className="mx-4 mb-3 rounded-lg bg-panel px-4 py-3 text-sm text-ink-3 md:mx-8">
          Repertório ainda não compilado para este lado. Rode <code className="text-ink-2">npm run build:repertoire</code>. Enquanto isso, a árvore abaixo mostra só as suas partidas.
        </div>
      )}
      {mode === 'decks' ? (
        !decks ? (
          <div className="flex items-center gap-2 px-8 text-ink-3"><Loader2 size={16} className="animate-spin" /> Carregando os decks...</div>
        ) : deckId ? (
          <DeckScreen deck={deck} study={studyRow} index={deck ? (openings?.index[deck.side] ?? null) : null} onBack={() => setDeckId(null)} />
        ) : (
          <DeckList
            decks={decks.decks}
            study={decks.study}
            cards={cards}
            index={openings?.index ?? null}
            onOpen={openDeck}
            onTrainAll={(s) => {
              setSide(s);
              setMode('train');
            }}
          />
        )
      ) : mode === 'study' ? (
        <OpeningStudy index={openings?.index ?? null} games={games} onOpenDeck={openDeck} />
      ) : mode === 'explore' || !sideRep ? (
        <Explorer
          key={side}
          side={side}
          rep={sideRep}
          index={index}
          gaps={gaps?.filter((g) => g.side === side) ?? null}
          mine={merged.chapters.filter((c) => c.side === side)}
          rejected={merged.rejected.filter((r) => r.chapter.side === side)}
        />
      ) : (
        <Trainer key={side} side={side} rep={sideRep} index={index} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ explorer

function Explorer({ side, rep, index, gaps, mine, rejected }: {
  side: Color;
  rep: CompiledSide | null;
  index: GamesIndex | null;
  gaps: RepertoireGap[] | null;
  mine: UserChapter[];
  rejected: Merged['rejected'];
}) {
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

  const goToPath = (sans: string[]) => {
    const chess = new Chess();
    const steps: Step[] = [];
    for (const san of sans) {
      const mv = tryMove(chess, san);
      if (!mv) break;
      steps.push({ san: mv.san, uci: mv.lan, fen: chess.fen() });
    }
    setPath(steps);
  };
  const goTo = (target: string) => {
    const moves = rep ? pathTo(rep, target) : null;
    if (moves) goToPath(moves.map((m) => m.san));
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
  const last = path.length ? { from: path[path.length - 1]!.uci.slice(0, 2), to: path[path.length - 1]!.uci.slice(2, 4) } : null;
  const badge = useBookBadge(fen, last);
  const rows = mergeRows(repMoves, stats);
  const chapters = rep?.chapters ?? [];
  const youDev = rep && index ? topDeviations(index, rep, 'you', 6) : [];
  const mineIds = new Set(mine.map((c) => c.id));
  const exitsTotal = index?.exits.length ?? 0;
  const deepEnough = index ? index.exits.filter((e) => e.kind === 'end' || e.ply >= 12).length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-4 lg:flex-row lg:px-8">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 150px)' }}>
          <Board
            fen={fen}
            orientation={side}
            lastMove={last}
            movable="both"
            onMove={(m: BoardMove) => { play(`${m.from}${m.to}${m.promotion ?? ''}`); return true; }}
            arrows={arrows}
            badge={badge}
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
              {chapters.map((c) => {
                const own = mine.find((m) => m.id === c.id);
                return (
                  <li key={c.id} className="flex items-stretch gap-1.5">
                    <button type="button" className="min-w-0 flex-1 rounded-md bg-panel-2 p-2.5 text-left hover:bg-raise" onClick={() => (own ? goToPath(own.moves.slice(0, -1)) : goTo(chapterRoot(c.entry)))}>
                      <div className="font-bold text-ink">{c.name}</div>
                      {c.description && <div className="text-sm text-ink-3">{c.description}</div>}
                    </button>
                    {mineIds.has(c.id) && own && (
                      <button type="button" className="rounded-md bg-panel-2 px-2.5 text-ink-3 hover:bg-raise hover:text-cls-miss" title="Remover este capítulo seu" aria-label={`Remover ${c.name}`} onClick={() => void removeUserChapter(own)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </li>
                );
              })}
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
          </div>
        )}

        {rep && path.length === 0 && <GapsPanel gaps={gaps} rejected={rejected} onOpen={goToPath} />}
      </aside>
    </div>
  );
}

const moveLabel = (path: string[]) => `${Math.ceil(path.length / 2)}${path.length % 2 ? '.' : '...'}`;

/**
 * Moves your opponents played outside the repertoire, with Stockfish's
 * answers; one click and the answer is a chapter of yours.
 */
function GapsPanel({ gaps, rejected, onOpen }: { gaps: RepertoireGap[] | null; rejected: Merged['rejected']; onOpen: (path: string[]) => void }) {
  const suggestions = useLiveQuery(loadSuggestions, []);
  const [working, setWorking] = useState<string | null>(null);
  const shown = gaps?.slice(0, 6) ?? [];
  const calculate = async (g: RepertoireGap) => {
    setWorking(g.childEpd);
    try {
      await suggestGaps([g], 1);
    } finally {
      setWorking(null);
    }
  };
  const accept = (g: RepertoireGap, m: SuggestedMove) => void acceptGap(g, m, RENEWAL.suggestDepth);
  return (
    <div className="rounded-lg bg-panel p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold"><AlertTriangle size={15} className="text-cls-mistake" /> Lacunas do repertório</h2>
      <p className="mb-3 text-sm text-ink-3">
        Lances que seus adversários jogaram fora do repertório nos últimos 6 meses, pelo menos {RENEWAL.gapsMinGames} vezes. A resposta é do Stockfish (profundidade {RENEWAL.suggestDepth}, 3 linhas), só com lances que perdem menos de 5 pontos de chance para o melhor: a mesma regra do repertório.
      </p>
      {gaps === null ? (
        <p className="flex items-center gap-2 text-sm text-ink-4"><Loader2 size={14} className="animate-spin" /> Procurando nas suas partidas...</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink-3">Nenhuma lacuna: nos últimos 6 meses seus adversários ficaram dentro do repertório.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((g) => {
            const s = suggestions?.[g.childEpd];
            const ok = s?.moves.filter((m) => m.acceptable) ?? [];
            return (
              <li key={`${g.epd}|${g.uci}`} className="rounded-md bg-panel-2 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="font-bold text-ink hover:text-go-hover" onClick={() => onOpen(g.path)}>
                    {moveLabel(g.path)}<San san={g.san} />
                  </button>
                  <span className="tabular-nums text-ink-4">{plural(g.games.length, 'partida')}, a última em {new Date(g.lastPlayed).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                </div>
                {s ? (
                  <ul className="mt-2 space-y-1.5">
                    {ok.map((m, i) => (
                      <li key={m.uci} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-bold text-ink"><San san={m.san} /></span>
                        <span className="tabular-nums text-ink-3">{Math.round(m.win)}%{i > 0 ? `, ${m.drop.toFixed(1)} abaixo do melhor` : ', o melhor'}</span>
                        {m.line.length > 0 && <span className="text-ink-4">{m.line.slice(0, 3).join(' ')}</span>}
                        <button type="button" className="ml-auto font-bold text-go hover:text-go-hover" onClick={() => accept(g, m)}>Adicionar ao repertório</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 flex items-center justify-between gap-2 text-ink-3">
                    <span>A sugestão sai quando a análise automática estiver livre.</span>
                    <button type="button" className="font-bold text-go hover:text-go-hover disabled:opacity-60" disabled={working !== null} onClick={() => void calculate(g)}>
                      {working === g.childEpd ? 'Calculando...' : 'Calcular agora'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rejected.map((r) => (
        <p key={r.chapter.id} className="mt-3 flex items-center justify-between gap-2 text-sm text-cls-inaccuracy">
          <span>Capítulo seu fora de uso: {r.chapter.name} ({r.reason}).</span>
          <button type="button" className="font-bold text-ink-3 hover:text-ink" onClick={() => void removeUserChapter(r.chapter)}>Remover</button>
        </p>
      ))}
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
  const dueCount = useLiveQuery(() => db.srsCards.where('id').startsWith(repCardId(side, '')).filter((c) => c.due <= Date.now()).count(), [side]);
  const chapter = rep.chapters.find((c) => c.id === chapterId);
  const rootEpd = chapter ? chapterRoot(chapter.entry) : START_EPD;
  const scope = useMemo(() => (chapter ? reachableFrom(rep, rootEpd) : null), [chapter, rootEpd, rep]);
  const ours = useMemo(() => ourPositionsBelow(rep, chapter ? rootEpd : START_EPD), [rep, chapter, rootEpd]);
  // A new line whenever the chapter changes; the chapter's trunk plays by itself.
  const drill = useRepDrill({ side, rep, index, lineKey: chapterId, prefix: chapter?.entry ?? [], scope });
  const { feedback, lines } = drill;
  const prog = progress(drill.cards, ours);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-4 lg:flex-row lg:px-8">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 150px)' }}>
          <RepDrillBoard drill={drill} side={side} rep={rep} />
        </div>
      </div>
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-[400px]">
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
        <RepFeedbackPanel drill={drill} footer={`Sessão: ${plural(lines.done, 'linha')} · ${plural(lines.correct, 'certo')} · ${plural(lines.wrong, 'erro')}`} />
        <AnalyseButton drill={drill} />
        <RepAnalysis drill={drill} side={side} rep={rep} />
        {!drill.exploring && (
          <button type="button" className={clsx(feedback.kind === 'end' ? 'btn-go' : 'btn-flat')} onClick={drill.newLine}>
            {feedback.kind === 'end' ? 'Próxima linha' : 'Pular para outra linha'}
          </button>
        )}
        <p className="text-xs text-ink-4">A nota vale pela primeira tentativa em cada posição: errou é Errei; certo é Difícil, Bom ou Fácil pelo seu tempo, comparado com o seu tempo normal no repertório.</p>
        <MemoryPanel kind="rep" />
      </aside>
    </div>
  );
}
