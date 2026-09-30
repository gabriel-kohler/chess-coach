// Moves the schedules from before FSRS (tactics and repertoire, database v4)
// onto FSRS without losing progress. Same idea as memoryStateFromSm2 in
// fsrs-rs: FSRS defines stability as the days until recall falls to 90%, so
// an interval the old ladder planned for a right answer becomes that many
// days of stability. Difficulty starts where a first answer puts it and goes
// up once per lapse, as an Again would. The due date is kept, so what was due
// today is due today and what was learned is still learned.
import { Rating, State } from 'ts-fsrs';
import type { BestMoveCard } from '../positions/types.ts';
import type { PuzzleCard, PuzzleSrsCard, RepCard, RepertoireCard } from '../types.ts';
import { puzzleCardId, repCardId } from './cards.ts';
import { newFsrsFields, schedulerFor, shortTermFor } from './fsrs.ts';
import type { CardKind, FsrsFields } from './types.ts';

/** Own-game progress waiting for its Posições card, by `${gameId}:${ply}`. */
export const LEGACY_MINE_KEY = 'positions:legacyMine';

export interface LadderCard {
  due: number;
  /** Days the ladder planned; 0 for the ten-minute retry after a miss. */
  interval: number;
  /** Right answers in a row. */
  reps: number;
  lapses: number;
  createdAt?: number;
  lastAt: number;
}

export function fromLadder(c: LadderCard, kind: CardKind): FsrsFields {
  if (c.reps === 0 && c.lapses === 0) return { ...newFsrsFields(c.createdAt ?? c.lastAt), due: c.due };
  const f = schedulerFor(kind);
  let difficulty = f.init_difficulty(c.lapses > 0 ? Rating.Again : Rating.Good);
  for (let i = 1; i < c.lapses; i++) difficulty = f.next_difficulty(difficulty, Rating.Again);
  // Last answer wrong: the memory is as weak as after a first Again.
  const lapsed = c.reps === 0;
  return {
    due: c.due,
    stability: lapsed ? f.init_stability(Rating.Again) : Math.max(c.interval, 1),
    difficulty,
    elapsed_days: 0,
    scheduled_days: c.interval,
    learning_steps: 0,
    reps: c.reps + c.lapses,
    lapses: c.lapses,
    state: lapsed && shortTermFor(kind) ? State.Relearning : State.Review,
    last_review: c.lastAt,
  };
}

export interface Migration {
  cards: Array<RepCard | PuzzleSrsCard>;
  /** Own-game mistakes: they leave tactics, and their progress goes to Posições. */
  mine: Record<string, FsrsFields>;
}

export function migrateLegacy(reps: RepertoireCard[], puzzles: PuzzleCard[]): Migration {
  const cards: Migration['cards'] = [];
  for (const r of reps) {
    const id = repCardId(r.side, r.epd);
    cards.push({ id, kind: 'rep', note: id, primaryGameId: null, createdAt: r.lastAt, suspended: 0, side: r.side, epd: r.epd, ...fromLadder(r, 'rep') });
  }
  const mine: Record<string, FsrsFields> = {};
  for (const p of puzzles) {
    if (p.puzzle.source === 'mine') {
      const played = p.reps + p.lapses > 0;
      if (played && p.puzzle.gameId && p.puzzle.ply) mine[`${p.puzzle.gameId}:${p.puzzle.ply}`] = fromLadder(p, 'best');
      continue;
    }
    const id = puzzleCardId(p.id);
    // The ladder retired a mastered puzzle for good: it stays out of the queue
    // (its 35-day stability still counts it as mastered).
    cards.push({ id, kind: 'puzzle', note: id, primaryGameId: null, createdAt: p.createdAt, suspended: p.mastered ? 1 : 0, puzzle: p.puzzle, ...fromLadder(p, 'puzzle') });
  }
  return { cards, mine };
}

/**
 * Gives a Posições card never reviewed here the most recent progress of its
 * games from the old tactics queue. A card with reviews of its own keeps
 * them. Entries matched to a card are used up either way.
 */
export function carryMine(cards: BestMoveCard[], mine: Record<string, FsrsFields>): { put: BestMoveCard[]; used: string[] } {
  const put: BestMoveCard[] = [];
  const used: string[] = [];
  for (const c of cards) {
    const keys = c.sources.map((s) => `${s.gameId}:${s.ply}`).filter((k) => mine[k]);
    if (!keys.length) continue;
    used.push(...keys);
    if (c.state !== State.New || c.reps > 0) continue;
    const latest = keys.map((k) => mine[k]!).sort((a, b) => (b.last_review ?? 0) - (a.last_review ?? 0))[0]!;
    put.push({ ...c, ...latest });
  }
  return { put, used };
}
