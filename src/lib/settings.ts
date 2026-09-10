import { useLiveQuery } from 'dexie-react-hooks';
import { db, setKV } from './db.ts';
import type { Account } from './chesscom/sync.ts';

export interface Settings {
  depth: number;
  workers: number;
  sound: boolean;
  sessionSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  depth: 16,
  workers: Math.max(1, Math.min(3, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) - 2)),
  sound: true,
  sessionSize: 20,
};

export function useSettings(): Settings {
  const row = useLiveQuery(() => db.kv.get('settings'), []);
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>, current: Settings) {
  await setKV('settings', { ...current, ...patch });
}

/** undefined while loading, null when no account is connected. */
export function useAccount(): Account | null | undefined {
  return useLiveQuery(async () => ((await db.kv.get('account'))?.value as Account | undefined) ?? null, []);
}
