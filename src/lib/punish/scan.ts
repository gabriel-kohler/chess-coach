// Goes through your decks' opponent positions, the ones your games reach most
// first, looking for the mistakes people at your level make there. One
// position at a time; the state goes out after each, so the scan stops and
// goes on anywhere. The sources come in as functions (store.ts wires them).
import { Chess } from 'chess.js';
import { ExplorerLimited } from '../openings/study.ts';
import type { ExplorerMove } from '../openings/explorer.ts';
import type { Color, EngineLine } from '../types.ts';
import { BUILD } from '../decks/build.ts';
import { candidates, lossOf, PUNISH, punishItem, type PunishItem } from './find.ts';

/** An opponent position of one of your decks. */
export interface ScanTarget {
  side: Color;
  epd: string;
  fen: string;
  /** Moves your decks already answer there. */
  book: string[];
  /** The best line when known (the repertoire's stored evaluation): no search for it. */
  best?: EngineLine;
  /** How much it matters: your games through it. */
  weight: number;
}

export interface ScanState {
  /** `${side}|${epd}` -> when and in which rating range it was scanned. */
  scanned: Record<string, { at: number; buckets: string }>;
  items: Record<string, PunishItem>;
}

export interface ScanDeps {
  /** The explorer at your opponents' level; throws ExplorerLimited when Lichess asks to wait. */
  explorer: (fen: string) => Promise<ExplorerMove[] | null>;
  analyse: (fen: string, limits: { depth: number; multipv?: number; searchmoves?: string[] }) => Promise<EngineLine[]>;
  wait: () => Promise<void>;
  save?: (s: ScanState, progress: { done: number; total: number }) => Promise<void>;
  stopped?: () => boolean;
}

export const scanKey = (t: Pick<ScanTarget, 'side' | 'epd'>) => `${t.side}|${t.epd}`;

/** Positions still to scan: never scanned, older than a month, or scanned in another rating range. */
export function pending(targets: ScanTarget[], state: ScanState, buckets: string, now: number): ScanTarget[] {
  return targets.filter((t) => {
    const s = state.scanned[scanKey(t)];
    return !s || s.buckets !== buckets || now - s.at > PUNISH.staleMs;
  });
}

export async function scan(targets: ScanTarget[], start: ScanState, buckets: string, deps: ScanDeps, now = Date.now()): Promise<{ state: ScanState; status: 'done' | 'paused'; note?: string }> {
  const s: ScanState = { scanned: { ...start.scanned }, items: { ...start.items } };
  const todo = pending(targets, s, buckets, now).sort((a, b) => b.weight - a.weight);
  const total = targets.length;
  let waits = 0;
  for (let i = 0; i < todo.length; i++) {
    const t = todo[i]!;
    if (deps.stopped?.()) return { state: s, status: 'paused' };
    let moves: ExplorerMove[] | null;
    try {
      moves = await deps.explorer(t.fen);
    } catch (e) {
      if (!(e instanceof ExplorerLimited)) throw e;
      if (++waits > BUILD.maxWaits) return { state: s, status: 'paused', note: 'O Lichess pediu para esperar: a busca continua daqui a pouco.' };
      await deps.wait();
      // The same position again, after the wait.
      i--;
      continue;
    }
    // What this position had before goes: the explorer's answer is new.
    for (const [id, item] of Object.entries(s.items)) if (item.side === t.side && item.before === t.epd) delete s.items[id];
    const cands = moves ? candidates(moves, new Set(t.book)) : [];
    if (cands.length) {
      const best = t.best ?? (await deps.analyse(t.fen, { depth: PUNISH.depth }))[0];
      const lines = await deps.analyse(t.fen, { depth: PUNISH.depth, multipv: cands.length, searchmoves: cands.map((c) => c.uci) });
      for (const c of cands) {
        const loss = lossOf(t.fen, best, lines, c.uci);
        if (loss === null || loss < PUNISH.minLoss) continue;
        const after = new Chess(t.fen);
        after.move({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci[4] });
        const answer = (await deps.analyse(after.fen(), { depth: PUNISH.depth }))[0]?.pv[0];
        const item = answer ? punishItem(t.side, t.fen, c, loss, answer, buckets, now) : null;
        if (item) s.items[item.id] = item;
      }
    }
    s.scanned[scanKey(t)] = { at: now, buckets };
    await deps.save?.(s, { done: total - pending(targets, s, buckets, now).length, total });
  }
  return { state: s, status: 'done' };
}
