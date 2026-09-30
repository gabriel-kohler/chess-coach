// Your own chapters: answers you accepted for repertoire gaps, kept in the
// browser and compiled together with the repertoire file. The file wins a
// conflict on your side: the chapter is set aside until you look at it again.
import type { PgnGame, PgnNode } from '../chess/pgn.ts';
import type { Color } from '../types.ts';
import { compileChapter, type CompiledSide, type RepertoireChapter, type RepertoirePosition } from './compile.ts';
import type { CompiledRepertoire } from './data.ts';
import { turnOf } from './compile.ts';

export interface UserChapter {
  id: string;
  side: Color;
  name: string;
  /** From the start: the path to the gap, the opponent's move, then your answer. */
  moves: string[];
  createdAt: number;
  source: { epd: string; san: string; games: number };
  /** Engine score of your answer, from White's side. */
  eval?: { cp?: number; mate?: number; depth: number };
}

export const userChapterId = (side: Color, childEpd: string) => `user:${side}:${childEpd}`;
export const isUserChapter = (chapterId: string) => chapterId.startsWith('user:');

function asPgn(c: UserChapter): PgnGame {
  let moves: PgnNode[] = [];
  for (const san of [...c.moves].reverse()) moves = [{ san, nags: [], children: moves }];
  return { headers: { Side: c.side, Id: c.id, Name: c.name }, moves };
}

export interface Merged {
  rep: CompiledRepertoire;
  /** Chapters whose answer clashes with the file (or whose moves no longer play). */
  rejected: Array<{ chapter: UserChapter; reason: string }>;
}

/**
 * The repertoire with your chapters in it. Only the positions a chapter
 * touches are copied, so the file's cached object stays as it was.
 */
export function withUserChapters(rep: CompiledRepertoire, chapters: UserChapter[]): Merged {
  if (!chapters.length) return { rep, rejected: [] };
  const sides = { ...rep.sides } as Record<Color, CompiledSide>;
  const rejected: Merged['rejected'] = [];
  for (const c of [...chapters].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const compiled = compileChapter(asPgn(c));
    if (compiled.errors.length) {
      rejected.push({ chapter: c, reason: compiled.errors[0]! });
      continue;
    }
    const side = sides[c.side];
    const touched: Record<string, RepertoirePosition> = {};
    let clash: string | null = null;
    for (const pos of Object.values(compiled.positions)) {
      const have = side.positions[pos.epd];
      const next = have ? { ...have, moves: [...have.moves] } : { ...pos, moves: [] };
      for (const m of pos.moves) {
        if (next.moves.some((x) => x.uci === m.uci)) continue;
        if (turnOf(pos.fen) === c.side && next.moves.length) {
          clash = `o repertório já responde ${next.moves[0]!.san} nesta posição`;
          break;
        }
        next.moves.push(m);
      }
      if (clash) break;
      touched[pos.epd] = next;
    }
    if (clash) {
      rejected.push({ chapter: c, reason: clash });
      continue;
    }
    // The drill starts after the opponent's move: it asks only for your answer.
    const chapter: RepertoireChapter = { ...compiled.chapter, entry: c.moves.slice(0, -1), description: 'Capítulo seu, de uma lacuna do repertório.' };
    sides[c.side] = { ...side, positions: { ...side.positions, ...touched }, chapters: [...side.chapters, chapter] };
  }
  return { rep: { ...rep, sides }, rejected };
}

/** Changes whenever your chapters do: part of the cache keys built on the repertoire. */
export function userChaptersSignature(chapters: UserChapter[]): string {
  return chapters.map((c) => `${c.id}@${c.createdAt}`).sort().join(',');
}
