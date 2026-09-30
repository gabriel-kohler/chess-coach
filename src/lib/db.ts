import Dexie, { type EntityTable } from 'dexie';
import type { StudyDeck } from './decks/types.ts';
import type { BestMoveCard, SequenceCard } from './positions/types.ts';
import type { UserChapter } from './repertoire/user.ts';
import { LEGACY_MINE_KEY, migrateLegacy } from './srs/migrate.ts';
import type { ReviewLogRow } from './srs/types.ts';
import type {
  ArchiveMeta,
  GameAnalysis,
  PuzzleAttempt,
  PuzzleCard,
  PuzzleSrsCard,
  RepCard,
  RepertoireCard,
  StoredGame,
} from './types.ts';

/** Every spaced-repetition card kind lives in one table. */
export type SrsCard = BestMoveCard | SequenceCard | PuzzleSrsCard | RepCard;

interface Narration {
  key: string;
  text: string | null;
  model: string;
  error?: string;
  at: number;
}

interface KV {
  key: string;
  value: unknown;
}

export class CoachDB extends Dexie {
  kv!: EntityTable<KV, 'key'>;
  games!: EntityTable<StoredGame, 'id'>;
  archives!: EntityTable<ArchiveMeta, 'url'>;
  analyses!: EntityTable<GameAnalysis, 'gameId'>;
  attempts!: EntityTable<PuzzleAttempt, 'id'>;
  /** Before FSRS: read only by the v5 migration, kept as a backup. */
  puzzleCards!: EntityTable<PuzzleCard, 'id'>;
  /** Before FSRS: read only by the v5 migration, kept as a backup. */
  repCards!: EntityTable<RepertoireCard, 'key'>;
  narrations!: EntityTable<Narration, 'key'>;
  srsCards!: EntityTable<SrsCard, 'id'>;
  reviewLogs!: EntityTable<ReviewLogRow, 'id'>;
  userChapters!: EntityTable<UserChapter, 'id'>;
  /** Decks built from any opening (Aberturas > Qualquer abertura). Yours, like the repertoire: they stay when the account changes. */
  decks!: EntityTable<StudyDeck, 'id'>;

  constructor() {
    super('chess-coach');
    this.version(3).stores({
      kv: 'key',
      games: 'id, endTime, timeClass, outcome, archive, userColor',
      archives: 'url, month',
      analyses: 'gameId, createdAt',
      attempts: '++id, puzzleId, at, source, mode',
      puzzleCards: 'id, due',
      repCards: 'key, side, due',
      narrations: 'key',
    });
    // Position trainer: FSRS cards and one log row per attempt.
    this.version(4).stores({
      srsCards: 'id, kind, note, due, state',
      reviewLogs: '++id, &attemptId, cardId, at, [kind+at]',
    });
    // Tactics and repertoire join FSRS with their progress converted; your
    // own-game mistakes wait in kv for their Posições card (srs/migrate.ts).
    this.version(5)
      .stores({})
      .upgrade(async (tx) => {
        const [reps, puzzles] = await Promise.all([tx.table<RepertoireCard>('repCards').toArray(), tx.table<PuzzleCard>('puzzleCards').toArray()]);
        const { cards, mine } = migrateLegacy(reps, puzzles);
        if (cards.length) await tx.table('srsCards').bulkPut(cards);
        if (Object.keys(mine).length) await tx.table('kv').put({ key: LEGACY_MINE_KEY, value: mine });
      });
    // Your own repertoire chapters, from the gaps you accepted.
    this.version(6).stores({ userChapters: 'id, side, createdAt' });
    // Opening decks built from any opening; their cards are srsCards `rep:d:<id>|<epd>`.
    this.version(7).stores({ decks: 'id, side, createdAt' });
  }
}

export const db = new CoachDB();

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setKV<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value });
}
