// Keeps the cache in step with IndexedDB: when a table changes (in this tab or
// another), every cached query that reads it is refreshed. Queries name their
// tables in `meta.tables`.
import Dexie from 'dexie';
import { db } from '../db.ts';
import { queryClient } from './queryClient.ts';

/** Bursts (a sync writes month after month) are coalesced into one refresh. */
const SETTLE_MS = 250;

export interface TableMeta extends Record<string, unknown> {
  tables: string[];
}

/** Table names in Dexie's change keys: `idb://<database>/<table>/<index>`. */
export function changedTables(parts: Record<string, unknown>, dbName: string): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(parts)) {
    const [, , name, table] = key.split('/');
    if (name === dbName && table) out.add(table);
  }
  return out;
}

let watching = false;
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** How many times each table changed since the page loaded: cheap "did anything change?" checks. */
const versions = new Map<string, number>();

export function tableVersion(table: string): number {
  return versions.get(table) ?? 0;
}

const followers: Array<{ tables: string[]; run: () => void }> = [];

/** Runs `run` once a burst of changes to any of these tables has settled. */
export function onTablesChanged(tables: string[], run: () => void): void {
  followers.push({ tables, run });
}

export function watchDatabase(): void {
  if (watching) return;
  watching = true;
  Dexie.on('storagemutated', (parts) => {
    for (const t of changedTables(parts, db.name)) {
      pending.add(t);
      versions.set(t, (versions.get(t) ?? 0) + 1);
    }
    if (!pending.size || timer) return;
    timer = setTimeout(() => {
      const tables = pending;
      pending = new Set();
      timer = null;
      void queryClient.invalidateQueries({ predicate: (q) => ((q.meta as TableMeta | undefined)?.tables ?? []).some((t) => tables.has(t)) });
      for (const f of followers) if (f.tables.some((t) => tables.has(t))) f.run();
    }, SETTLE_MS);
  });
}
