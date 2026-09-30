// Where the punish scan keeps its state, and whether it has work to do:
// light enough for the Layout to check at every start.
import { getKV } from '../db.ts';

export const PUNISH_KEYS = { items: 'punish:items', scanned: 'punish:scanned', progress: 'punish:progress' } as const;

export interface PunishProgress {
  done: number;
  total: number;
  at: number;
  /** Why the last scan stopped early, when it did. */
  note?: string;
  /** No Lichess token: no shares at your level, no scan. */
  noExplorer?: boolean;
}

/** Never scanned, a scan that stopped halfway, or a day since the last look (new games, an expired month). */
export async function punishScanDue(now = Date.now()): Promise<boolean> {
  const p = await getKV<PunishProgress | null>(PUNISH_KEYS.progress, null);
  return !p || (!p.noExplorer && p.done < p.total) || now - p.at > 86_400_000;
}
