// chess.com's book icon on the last move when it reaches a position of the
// openings book: the same book the game review marks its "Teoria" moves by.
import { useEffect, useState } from 'react';
import { epdOf } from '@/lib/chess/replay';
import { loadOpenings } from '@/lib/openings/book';
import type { Classification } from '@/lib/types';

let book: Record<string, unknown> | null = null;

export function useBookBadge(fen: string, lastMove: { from: string; to: string } | null): { square: string; classification: Classification } | null {
  const [ready, setReady] = useState(!!book);
  useEffect(() => {
    if (book) return;
    let alive = true;
    void loadOpenings().then((o) => {
      book = o;
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!ready || !book || !lastMove || !(epdOf(fen) in book)) return null;
  return { square: lastMove.to, classification: 'book' };
}
