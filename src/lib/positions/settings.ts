// Daily limits of the position trainer, in their own kv key (the general
// settings object belongs to another part of the app).
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getKV, setKV } from '../db.ts';

export interface PositionsSettings {
  newPerDay: number;
  maxReviewsPerDay: number;
  /** Sequences are longer: fewer per day. */
  seqNewPerDay: number;
  seqMaxReviewsPerDay: number;
}

export const DEFAULT_POSITIONS_SETTINGS: PositionsSettings = { newPerDay: 10, maxReviewsPerDay: 100, seqNewPerDay: 5, seqMaxReviewsPerDay: 50 };
const KEY = 'positions:settings';

export async function loadPositionsSettings(): Promise<PositionsSettings> {
  return { ...DEFAULT_POSITIONS_SETTINGS, ...(await getKV<Partial<PositionsSettings>>(KEY, {})) };
}

export function usePositionsSettings(): PositionsSettings {
  const row = useLiveQuery(() => db.kv.get(KEY), []);
  return { ...DEFAULT_POSITIONS_SETTINGS, ...((row?.value as Partial<PositionsSettings>) ?? {}) };
}

export async function savePositionsSettings(patch: Partial<PositionsSettings>, current: PositionsSettings) {
  await setKV(KEY, { ...current, ...patch });
}
