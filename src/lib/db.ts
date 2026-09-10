import Dexie, { type EntityTable } from 'dexie';
import type {
  ArchiveMeta,
  GameAnalysis,
  PuzzleAttempt,
  PuzzleCard,
  RepertoireCard,
  StoredGame,
} from './types.ts';

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
  puzzleCards!: EntityTable<PuzzleCard, 'id'>;
  repCards!: EntityTable<RepertoireCard, 'key'>;
  narrations!: EntityTable<Narration, 'key'>;

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
