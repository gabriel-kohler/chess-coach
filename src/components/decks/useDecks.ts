// Every deck, both colors: your repertoire's (views over its chapters) and the
// ones you built from any opening, with your cards grouped by where they live.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '@/lib/db';
import type { StudyDeck } from '@/lib/decks/types';
import { repertoireDecks, studyDeckView, type DeckView } from '@/lib/decks/views';
import type { CompiledRepertoire } from '@/lib/repertoire/data';
import type { RepCard } from '@/lib/types';

export interface Decks {
  /** Your repertoire's decks (White, then Black), then the study decks with positions. */
  decks: DeckView[];
  /** Every study deck, building ones included. */
  study: StudyDeck[];
}

/** undefined while loading. */
export function useDecks(rep: CompiledRepertoire | null | undefined): Decks | undefined {
  const study = useLiveQuery(() => db.decks.orderBy('createdAt').toArray(), []);
  return useMemo(() => {
    if (rep === undefined || study === undefined) return undefined;
    const mine = rep ? [...repertoireDecks(rep.sides.white), ...repertoireDecks(rep.sides.black)] : [];
    return { decks: [...mine, ...study.filter((d) => Object.keys(d.positions).length).map(studyDeckView)], study };
  }, [rep, study]);
}

/** Your repertoire cards by namespace ("white", "black", "d:<deck>"), then by position; read only while `enabled`. */
export function useRepCards(enabled = true): Map<string, Map<string, RepCard>> | undefined {
  const cards = useLiveQuery(() => (enabled ? (db.srsCards.where('kind').equals('rep').toArray() as Promise<RepCard[]>) : undefined), [enabled]);
  return useMemo(() => {
    if (!cards) return undefined;
    const out = new Map<string, Map<string, RepCard>>();
    for (const c of cards) {
      const ns = c.id.slice(4, c.id.indexOf('|'));
      (out.get(ns) ?? out.set(ns, new Map()).get(ns)!).set(c.epd, c);
    }
    return out;
  }, [cards]);
}
