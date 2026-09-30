// How long Treinar runs, in its own kv key (like positions/settings.ts).
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getKV, setKV } from '../db.ts';
import { TRAINING } from './config.ts';
import { TRAINING_KEYS } from './keys.ts';

export interface TrainingSettings {
  dailyMinutes: number;
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = { dailyMinutes: TRAINING.dailyMinutes };

export async function loadTrainingSettings(): Promise<TrainingSettings> {
  return { ...DEFAULT_TRAINING_SETTINGS, ...(await getKV<Partial<TrainingSettings>>(TRAINING_KEYS.settings, {})) };
}

export function useTrainingSettings(): TrainingSettings {
  const row = useLiveQuery(() => db.kv.get(TRAINING_KEYS.settings), []);
  return { ...DEFAULT_TRAINING_SETTINGS, ...((row?.value as Partial<TrainingSettings>) ?? {}) };
}

export async function saveTrainingSettings(patch: Partial<TrainingSettings>, current: TrainingSettings) {
  await setKV(TRAINING_KEYS.settings, { ...current, ...patch });
}
