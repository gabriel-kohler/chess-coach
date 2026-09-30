// A deck's "Punir": how many of the opponents' common mistakes at your level
// its positions have, how many come back today, and the way into a session.
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader2, Swords } from 'lucide-react';
import { db } from '@/lib/db';
import type { DeckView } from '@/lib/decks/views';
import { plural } from '@/lib/format';
import { ownersOf, type PunishItem } from '@/lib/punish/find';
import { PUNISH_KEYS, type PunishProgress } from '@/lib/punish/keys';
import { PUNISH_CARD_PREFIX, punishPuzzleId } from '@/lib/srs/cards';

/** The deck's mistakes to punish and their cards, live. undefined while loading. */
export function useDeckPunish(deck: DeckView) {
  const items = useLiveQuery(async () => ((await db.kv.get(PUNISH_KEYS.items))?.value as Record<string, PunishItem> | undefined) ?? {}, []);
  const progress = useLiveQuery(async () => ((await db.kv.get(PUNISH_KEYS.progress))?.value as PunishProgress | undefined) ?? null, []);
  const cards = useLiveQuery(() => db.srsCards.where('id').startsWith(PUNISH_CARD_PREFIX).toArray(), []);
  if (!items || progress === undefined || !cards) return undefined;
  const mine = Object.values(items).filter((i) => ownersOf(i, [deck]).length > 0);
  const byId = new Map(cards.map((c) => [c.id.slice('puzzle:'.length), c]));
  const now = Date.now();
  const due = mine.filter((i) => {
    const c = byId.get(punishPuzzleId(i.id));
    return !!c && !c.suspended && c.due <= now;
  }).length;
  const fresh = mine.filter((i) => !byId.has(punishPuzzleId(i.id))).length;
  return { items: mine, due, fresh, progress };
}

export function PunishPanel({ deck, onStart }: { deck: DeckView; onStart: () => void }) {
  const p = useDeckPunish(deck);
  if (!p) return null;
  const { items, due, fresh, progress } = p;
  const scanning = !!progress && !progress.noExplorer && progress.done < progress.total;
  return (
    <div className="rounded-lg bg-panel p-4 text-sm">
      <h3 className="flex items-center gap-1.5 text-[15px] font-extrabold"><Swords size={16} className="text-cls-mistake" /> Punir</h3>
      <p className="mt-1 text-ink-3">
        Os lances ruins que gente do seu nível joga nas posições deste deck, e a punição do Stockfish.
      </p>
      {progress?.noExplorer ? (
        <p className="mt-2 text-ink-3">Precisa do token do Lichess para saber o que se joga no seu nível (Aberturas &gt; Qualquer abertura explica como criar).</p>
      ) : (
        <p className="mt-2 text-ink-2">
          {items.length ? `${plural(items.length, 'erro comum', 'erros comuns')} do seu nível` : 'Nenhum erro comum achado ainda'}
          {items.length > 0 && ` · ${plural(due, 'para revisar', 'para revisar')} · ${plural(fresh, 'novo', 'novos')}`}
        </p>
      )}
      {scanning && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-4">
          <Loader2 size={12} className="animate-spin" /> Buscando: {progress.done} de {progress.total} posições (pausa enquanto você treina).
        </p>
      )}
      {progress?.note && <p className="mt-1 text-xs text-ink-4">{progress.note}</p>}
      <button type="button" className="btn-flat mt-3 flex w-full items-center justify-center gap-2" onClick={onStart}>
        <Swords size={16} /> Treinar punições
      </button>
    </div>
  );
}
