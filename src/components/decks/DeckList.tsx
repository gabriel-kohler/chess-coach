// Aberturas > Decks: your openings one by one, each with its own reviews,
// what you have learned of it and how your games in it go. The whole color
// stays one click away ("Tudo de brancas").
import clsx from 'clsx';
import { ChevronRight, Layers, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { plural } from '@/lib/format';
import type { StudyDeck } from '@/lib/decks/types';
import { deckStats, type DeckView } from '@/lib/decks/views';
import { oursIn } from '@/lib/decks/build';
import { progress } from '@/lib/repertoire/drill';
import type { GamesIndex } from '@/lib/repertoire/games';
import type { Color, RepCard } from '@/lib/types';

const sideLabel = (c: Color) => (c === 'white' ? 'brancas' : 'pretas');
const Swatch = ({ c }: { c: Color }) => <span className={clsx('inline-block h-3 w-3 shrink-0 rounded-[2px]', c === 'white' ? 'bg-white' : 'border border-ink-4 bg-[#0a0a0a]')} />;
/** A few games say little: a score is shown from this many. */
const MIN_GAMES = 5;

interface Row {
  deck: DeckView;
  learned: number;
  total: number;
  due: number;
  /** null while your games are still being read. */
  games: number | null;
  score: number | null;
}

export function DeckList({ decks, study, cards, index, onOpen, onTrainAll }: {
  decks: DeckView[];
  study: StudyDeck[];
  cards: Map<string, Map<string, RepCard>> | undefined;
  index: Record<Color, GamesIndex> | null;
  onOpen: (id: string) => void;
  onTrainAll: (side: Color) => void;
}) {
  const now = Date.now();
  const rows = useMemo(() => {
    const out: Row[] = decks.map((deck) => {
      const p = progress(cards?.get(deck.ns) ?? new Map(), deck.ours, now);
      const s = deckStats(deck, index?.[deck.side] ?? null);
      return { deck, learned: p.learned, total: p.total, due: p.due, games: index ? s.n : null, score: s.n >= MIN_GAMES ? Math.round((100 * s.points) / s.n) : null };
    });
    // Reviews first; then where you score least; the list's order otherwise.
    return out.map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.due > 0) - Number(a.r.due > 0) || (a.r.score ?? 101) - (b.r.score ?? 101) || a.i - b.i).map((x) => x.r);
  }, [decks, cards, index]);
  // Still building: shown on the deck's row; one with no position yet has a row of its own.
  const buildingById = new Map(study.filter((d) => d.status === 'building').map((d) => [d.id, d]));
  const empty = study.filter((d) => !Object.keys(d.positions).length);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-8">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(['white', 'black'] as const).map((side) => {
          const mine = rows.filter((r) => r.deck.side === side);
          return (
            <section key={side} className="flex flex-col gap-2" aria-label={`Decks de ${sideLabel(side)}`}>
              <h2 className="flex items-center gap-2 px-1 text-[15px] font-extrabold"><Swatch c={side} /> {side === 'white' ? 'Brancas' : 'Pretas'}</h2>
              <button type="button" onClick={() => onTrainAll(side)} className="flex items-center gap-3 rounded-lg bg-panel px-4 py-3 text-left hover:bg-raise">
                <Layers size={18} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink">Tudo de {sideLabel(side)}</span>
                  <span className="block text-sm text-ink-3">O repertório inteiro da cor, como antes.</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-4" />
              </button>
              {mine.map((r) => <DeckRow key={r.deck.id} row={r} building={buildingById.get(r.deck.id)} onOpen={onOpen} />)}
              {empty.filter((d) => d.side === side).map((d) => (
                <button key={d.id} type="button" onClick={() => onOpen(d.id)} className="flex items-center gap-3 rounded-lg bg-panel px-4 py-3 text-left text-sm text-ink-3 hover:bg-raise">
                  <Loader2 size={16} className="shrink-0 animate-spin" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{d.name}</span>
                    <BuildingNote deck={d} />
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-ink-4">
        Cada deck tem as suas revisões. Uma posição que aparece em dois decks do seu repertório é um card só: revisou num, vale no outro. Para um deck de uma abertura fora do repertório, abra Qualquer abertura e toque em Salvar como deck.
      </p>
    </div>
  );
}

export function BuildingNote({ deck }: { deck: StudyDeck }) {
  return <>Montando: {Math.min(oursIn(deck.positions, deck.side), deck.size)} de {deck.size} posições suas{deck.note ? `. ${deck.note}` : '.'}</>;
}

function DeckRow({ row, building, onOpen }: { row: Row; building: StudyDeck | undefined; onOpen: (id: string) => void }) {
  const { deck, learned, total, due, games, score } = row;
  return (
    <button type="button" onClick={() => onOpen(deck.id)} className="flex flex-col gap-2 rounded-lg bg-panel px-4 py-3 text-left hover:bg-raise">
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-bold leading-snug text-ink">
          {deck.name}
          {deck.kind === 'study' && <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 align-middle text-[11px] font-bold uppercase tracking-wide text-ink-3">qualquer abertura</span>}
        </span>
        {due > 0 && <span className="shrink-0 rounded bg-cls-inaccuracy/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-cls-inaccuracy">{due} para revisar</span>}
      </span>
      <span className="flex items-center gap-3">
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2" aria-hidden>
          <span className="block h-full bg-ink" style={{ width: `${(100 * learned) / Math.max(1, total)}%` }} />
        </span>
        <span className="shrink-0 text-xs tabular-nums text-ink-3">{learned} de {total}</span>
      </span>
      {building && (
        <span className="flex items-center gap-1.5 text-xs text-ink-3"><Loader2 size={12} className="animate-spin" /> <BuildingNote deck={building} /></span>
      )}
      <span className="text-xs text-ink-4">
        {games === null ? 'Lendo suas partidas...' : games === 0 ? 'Nenhuma partida sua nos últimos 6 meses.' : score === null ? `${plural(games, 'partida')} nos últimos 6 meses.` : (
          <>Você marca <b className={clsx(score < 45 ? 'text-cls-miss' : score >= 55 ? 'text-go-hover' : 'text-ink-2')}>{score}%</b> em {plural(games, 'partida')} dos últimos 6 meses.</>
        )}
      </span>
    </button>
  );
}
