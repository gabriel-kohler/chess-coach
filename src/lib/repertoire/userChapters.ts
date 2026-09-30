// Your chapters in the database, and the repertoire with them merged in.
import { Chess } from 'chess.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { tryMove } from '../chess/replay.ts';
import { db } from '../db.ts';
import { loadOpenings, nameOpening } from '../openings/book.ts';
import type { SuggestedMove } from '../renewal/suggest.ts';
import { repCardId } from '../srs/cards.ts';
import { chapterRoot, loadRepertoire, type CompiledRepertoire } from './data.ts';
import type { RepertoireGap } from './gaps.ts';
import { userChapterId, userChaptersSignature, withUserChapters, type Merged, type UserChapter } from './user.ts';

const moveLabel = (path: string[]) => {
  const n = path.length;
  return `${Math.ceil(n / 2)}${n % 2 ? '.' : '...'}${path[n - 1]}`;
};

/** Your answer to a gap becomes a chapter of your repertoire. */
export async function acceptGap(gap: RepertoireGap, answer: SuggestedMove, depth: number, now = Date.now()): Promise<UserChapter> {
  const chess = new Chess();
  const fens: string[] = [];
  for (const san of gap.path) if (tryMove(chess, san)) fens.push(chess.fen());
  const opening = nameOpening(await loadOpenings(), fens)?.name;
  const chapter: UserChapter = {
    id: userChapterId(gap.side, gap.childEpd),
    side: gap.side,
    name: `${opening ?? 'Linha sua'}: resposta a ${moveLabel(gap.path)}`,
    moves: [...gap.path, answer.san],
    createdAt: now,
    source: { epd: gap.epd, san: gap.san, games: gap.games.length },
    eval: { ...answer.score, depth },
  };
  await db.userChapters.put(chapter);
  // New positions of yours: the mistakes to punish there are looked for in the background.
  void import('../decks/store.ts').then((m) => m.buildDecks()).catch(() => undefined);
  return chapter;
}

/** Removes a chapter and the practice card of its answer. */
export async function removeUserChapter(c: UserChapter): Promise<void> {
  await db.transaction('rw', db.userChapters, db.srsCards, async () => {
    await db.userChapters.delete(c.id);
    await db.srsCards.delete(repCardId(c.side, chapterRoot(c.moves.slice(0, -1))));
  });
}

export async function loadMergedRepertoire(): Promise<CompiledRepertoire | null> {
  const [base, chapters] = await Promise.all([loadRepertoire(), db.userChapters.toArray()]);
  return base ? withUserChapters(base, chapters).rep : null;
}

export interface MergedRepertoire {
  /** undefined while loading, null when the repertoire file is missing. */
  rep: CompiledRepertoire | null | undefined;
  rejected: Merged['rejected'];
  chapters: UserChapter[];
  /** Changes with your chapters: part of every cache key built on the repertoire. */
  signature: string;
}

export function useMergedRepertoire(): MergedRepertoire {
  const [base, setBase] = useState<CompiledRepertoire | null | undefined>(undefined);
  useEffect(() => {
    void loadRepertoire().then(setBase);
  }, []);
  const chapters = useLiveQuery(() => db.userChapters.toArray(), []);
  return useMemo(() => {
    if (base === undefined || chapters === undefined) return { rep: undefined, rejected: [], chapters: [], signature: '' };
    if (!base) return { rep: null, rejected: [], chapters, signature: '' };
    const m = withUserChapters(base, chapters);
    return { rep: m.rep, rejected: m.rejected, chapters, signature: userChaptersSignature(chapters) };
  }, [base, chapters]);
}
