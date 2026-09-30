// The mistakes found, kept in kv, and the background scan that finds them. It
// runs inside the decks' background job (decks/store.ts), after the decks are
// built and with the same Stockfish, so two background engines never run
// together; it waits while you train.
import { db, getKV, setKV } from '../db.ts';
import type { StudyDeck } from '../decks/types.ts';
import type { Engine } from '../engine/stockfish.ts';
import { explorerCached, explorerMovesOrWait, ratingBuckets } from '../openings/explorer.ts';
import { loadLevel } from '../openings/level.ts';
import { turnOf, type RepertoirePosition } from '../repertoire/compile.ts';
import type { CompiledRepertoire } from '../repertoire/data.ts';
import type { GamesIndex } from '../repertoire/games.ts';
import { loadOpeningsData } from '../repertoire/openingsData.ts';
import { loadMergedRepertoire } from '../repertoire/userChapters.ts';
import { gate } from '../renewal/activity.ts';
import { PUNISH_CARD_PREFIX } from '../srs/cards.ts';
import type { Color, EngineLine, PuzzleSrsCard } from '../types.ts';
import { PUNISH } from './find.ts';
import { PUNISH_KEYS, type PunishProgress } from './keys.ts';
import { pending, scan, scanKey, type ScanState, type ScanTarget } from './scan.ts';

export async function loadScanState(): Promise<ScanState> {
  const [items, scanned] = await Promise.all([getKV<ScanState['items']>(PUNISH_KEYS.items, {}), getKV<ScanState['scanned']>(PUNISH_KEYS.scanned, {})]);
  return { items, scanned };
}

/** Your punish cards by puzzle id ("punish:<epd>"). */
export async function punishCards(): Promise<Map<string, PuzzleSrsCard>> {
  const cards = (await db.srsCards.where('id').startsWith(PUNISH_CARD_PREFIX).toArray()) as PuzzleSrsCard[];
  return new Map(cards.map((c) => [c.puzzle.id, c]));
}

const gamesAt = (index: GamesIndex | null, epd: string) => [...(index?.tree.get(epd)?.values() ?? [])].reduce((s, x) => s + x.n, 0);

const evalLine = (pos: RepertoirePosition): EngineLine | undefined =>
  pos.eval?.best ? { depth: pos.eval.depth, pv: [pos.eval.best], ...(pos.eval.mate !== undefined ? { mate: pos.eval.mate } : { cp: pos.eval.cp ?? 0 }) } : undefined;

/**
 * Your decks' opponent positions up to move 10, once each: your repertoire's
 * (every position is in a deck) and the ones of your decks from any opening.
 * The moves any of them answers there are the book. Weighted by your games.
 */
export function scanTargets(rep: CompiledRepertoire | null, study: StudyDeck[], index: Record<Color, GamesIndex> | null): ScanTarget[] {
  const out = new Map<string, ScanTarget>();
  const add = (side: Color, pos: RepertoirePosition, best?: EngineLine) => {
    if (turnOf(pos.epd) === side || !pos.moves.length || pos.ply > PUNISH.maxPly) return;
    const key = scanKey({ side, epd: pos.epd });
    const have = out.get(key);
    if (have) {
      have.book = [...new Set([...have.book, ...pos.moves.map((m) => m.uci)])];
      have.best ??= best;
      return;
    }
    out.set(key, { side, epd: pos.epd, fen: pos.fen, book: pos.moves.map((m) => m.uci), ...(best ? { best } : {}), weight: gamesAt(index?.[side] ?? null, pos.epd) });
  };
  if (rep) for (const side of ['white', 'black'] as const) for (const pos of Object.values(rep.sides[side].positions)) add(side, pos, evalLine(pos));
  for (const d of study) for (const pos of Object.values(d.positions)) add(d.side, pos);
  return [...out.values()];
}

/**
 * Scans what is pending, with the decks' engine (made only when a search is
 * needed). Without the Lichess explorer there is nothing to scan: the shares
 * at your level come from it.
 */
export async function runPunishScan(engineFor: () => Engine, stopped: () => boolean = () => false): Promise<'done' | 'paused'> {
  const level = await loadLevel();
  if (!level.explorer) {
    await setKV<PunishProgress>(PUNISH_KEYS.progress, { done: 0, total: 0, at: Date.now(), noExplorer: true });
    return 'done';
  }
  const [rep, openings, study, state] = await Promise.all([loadMergedRepertoire(), loadOpeningsData().catch(() => null), db.decks.toArray(), loadScanState()]);
  const targets = scanTargets(rep, study.filter((d) => Object.keys(d.positions).length), openings?.data.index ?? null);
  const buckets = ratingBuckets(level.oppElo).join(',');
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const result = await scan(targets, state, buckets, {
    explorer: async (fen) => {
      const cached = await explorerCached(fen, level.oppElo);
      const moves = await explorerMovesOrWait(fen, level.oppElo);
      // Lichess, asked too fast, stops answering every screen for a minute.
      if (!cached) await sleep(1500);
      return moves;
    },
    analyse: async (fen, limits) => {
      // While you train (or the tab is hidden) the engine waits.
      await gate();
      const engine = engineFor();
      await engine.newGame();
      const t = Date.now();
      const lines = await engine.analyse(fen, limits);
      // Then it rests as long as it worked: half a core at most, for half an hour of scanning.
      await sleep(Math.min(3000, Date.now() - t));
      return lines;
    },
    wait: () => sleep(60_000),
    save: async (s, progress) => {
      await db.transaction('rw', db.kv, async () => {
        await setKV(PUNISH_KEYS.items, s.items);
        await setKV(PUNISH_KEYS.scanned, s.scanned);
        await setKV<PunishProgress>(PUNISH_KEYS.progress, { ...progress, at: Date.now() });
      });
    },
    stopped,
  });
  const done = targets.length - pending(targets, result.state, buckets, Date.now()).length;
  await setKV<PunishProgress>(PUNISH_KEYS.progress, { done, total: targets.length, at: Date.now(), ...(result.note ? { note: result.note } : {}) });
  return result.status;
}
