// Stockfish 18 (lite, single-threaded WASM) running in Web Workers.
// Scores returned by this module are always from White's point of view.
import { Chess } from 'chess.js';
import type { EngineLine } from '../types.ts';

const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js';

export interface SearchLimits {
  depth?: number;
  movetime?: number;
  multipv?: number;
  searchmoves?: string[];
}

export interface SearchUpdate {
  depth: number;
  lines: EngineLine[];
}

interface Info {
  depth: number;
  multipv: number;
  cp?: number;
  mate?: number;
  pv: string[];
  bound: boolean;
}

function parseInfo(line: string): Info | null {
  if (!line.startsWith('info') || !line.includes(' pv ')) return null;
  const depth = /\bdepth (\d+)/.exec(line);
  const cp = /\bscore cp (-?\d+)/.exec(line);
  const mate = /\bscore mate (-?\d+)/.exec(line);
  if (!depth || (!cp && !mate)) return null;
  return {
    depth: Number(depth[1]),
    multipv: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1),
    cp: cp ? Number(cp[1]) : undefined,
    mate: mate ? Number(mate[1]) : undefined,
    pv: line.split(' pv ')[1]!.trim().split(/\s+/),
    bound: / (lowerbound|upperbound)/.test(line),
  };
}

/**
 * Mate and stalemate on the board: the engine prints no principal variation
 * there ("info depth 0 score mate 0"), so an empty result would read as a
 * draw. Answer them without searching.
 */
function terminalLines(fen: string): EngineLine[] | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  if (chess.isCheckmate()) return [{ depth: 0, pv: [], mate: chess.turn() === 'w' ? -1 : 1 }];
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return [{ depth: 0, pv: [], cp: 0 }];
  return null;
}

function toWhite(info: Info, whiteToMove: boolean): EngineLine {
  const sign = whiteToMove ? 1 : -1;
  return {
    depth: info.depth,
    pv: info.pv,
    ...(info.mate !== undefined ? { mate: sign * info.mate } : { cp: sign * (info.cp ?? 0) }),
  };
}

export class Engine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private started: Promise<void>;
  private generation = 0;
  /** The job the worker is running now, so `stop` never cuts a non-live search. */
  private current: { live: boolean } | null = null;

  constructor(hashMb = 32) {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data);
      for (const l of this.listeners) l(line);
    };
    this.started = this.boot(hashMb);
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private until(predicate: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        onLine?.(line);
        if (predicate(line)) {
          this.listeners.delete(listener);
          resolve(line);
        }
      };
      this.listeners.add(listener);
    });
  }

  private async boot(hashMb: number) {
    const ok = this.until((l) => l === 'uciok');
    this.send('uci');
    await ok;
    this.send(`setoption name Hash value ${hashMb}`);
    await this.isReady();
  }

  private async isReady() {
    const ok = this.until((l) => l === 'readyok');
    this.send('isready');
    await ok;
  }

  /**
   * Runs one search. Calls are serialized; `onUpdate` receives partial results
   * as the search deepens.
   */
  analyse(fen: string, limits: SearchLimits, onUpdate?: (u: SearchUpdate) => void, live = false): Promise<EngineLine[]> {
    const job = this.queue.then(async () => {
      this.current = { live };
      try {
        return await this.search(fen, limits, onUpdate);
      } finally {
        this.current = null;
      }
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async search(fen: string, limits: SearchLimits, onUpdate?: (u: SearchUpdate) => void) {
    const terminal = terminalLines(fen);
    if (terminal) {
      onUpdate?.({ depth: 0, lines: terminal });
      return terminal;
    }
    await this.started;
    const multipv = limits.multipv ?? 1;
    this.send(`setoption name MultiPV value ${multipv}`);
    await this.isReady();
    const whiteToMove = fen.split(' ')[1] === 'w';
    const lines = new Map<number, EngineLine>();
    const choiceByDepth: Array<[number, string]> = [];
    let reportedDepth = 0;
    const done = this.until(
      (l) => l.startsWith('bestmove'),
      (l) => {
        const info = parseInfo(l);
        if (!info || info.bound) return;
        lines.set(info.multipv, toWhite(info, whiteToMove));
        if (info.multipv === 1 && info.pv[0]) choiceByDepth.push([info.depth, info.pv[0]]);
        if (onUpdate && info.multipv === Math.min(multipv, lines.size) && info.depth > reportedDepth) {
          reportedDepth = info.depth;
          onUpdate({ depth: info.depth, lines: sorted(lines) });
        }
      },
    );
    this.send(`position fen ${fen}`);
    const parts = ['go'];
    if (limits.depth) parts.push(`depth ${limits.depth}`);
    if (limits.movetime) parts.push(`movetime ${limits.movetime}`);
    if (!limits.depth && !limits.movetime) parts.push('infinite');
    if (limits.searchmoves?.length) parts.push(`searchmoves ${limits.searchmoves.join(' ')}`);
    this.send(parts.join(' '));
    await done;
    const result = sorted(lines);
    const best = result[0];
    if (best?.pv[0]) {
      // Walk back from the final depth while the choice stays the same.
      let stable = best.depth;
      for (let k = choiceByDepth.length - 1; k >= 0 && choiceByDepth[k]![1] === best.pv[0]; k--) stable = choiceByDepth[k]![0];
      best.stableFrom = stable;
    }
    return result;
  }

  /**
   * Clears the hash between unrelated positions (UCI ucinewgame), so a search
   * does not depend on what ran before it: the same position, the same lines.
   */
  newGame(): Promise<void> {
    const job = this.queue.then(async () => {
      await this.started;
      this.send('ucinewgame');
      await this.isReady();
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** Stops the running search; its promise resolves with what it found. */
  stop() {
    this.send('stop');
  }

  /**
   * Live analysis that follows the board: every call supersedes the previous
   * one. Resolves when the search finishes or is superseded.
   */
  async live(fen: string, limits: SearchLimits, onUpdate: (u: SearchUpdate) => void): Promise<void> {
    const gen = ++this.generation;
    this.stopLive();
    await this.analyse(
      fen,
      limits,
      (u) => {
        if (gen === this.generation) onUpdate(u);
        else this.stopLive();
      },
      true,
    );
  }

  cancelLive() {
    this.generation++;
    this.stopLive();
  }

  private stopLive() {
    if (this.current?.live) this.stop();
  }

  terminate() {
    this.worker.terminate();
    this.listeners.clear();
  }
}

function sorted(lines: Map<number, EngineLine>): EngineLine[] {
  return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** A few engines working through a list of positions in parallel. */
export class EnginePool {
  private engines: Engine[];

  constructor(size: number) {
    this.engines = Array.from({ length: Math.max(1, size) }, () => new Engine(32));
  }

  /**
   * `wait` is awaited before each position (background work pausing while you
   * train); it changes when a position runs, never its result.
   */
  async analyseMany(
    fens: string[],
    limits: SearchLimits,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
    wait?: (signal?: AbortSignal) => Promise<void>,
  ): Promise<EngineLine[][]> {
    const results: EngineLine[][] = new Array(fens.length);
    // Walk backwards: later positions are simpler, and each worker's hash then
    // helps with the earlier ones it analyses next.
    const order = fens.map((_, i) => fens.length - 1 - i);
    let next = 0;
    let done = 0;
    await Promise.all(this.engines.map(async (engine) => {
      while (next < order.length) {
        if (wait) await wait(signal);
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (next >= order.length) break;
        const i = order[next++]!;
        results[i] = await engine.analyse(fens[i]!, limits);
        onProgress?.(++done, fens.length);
      }
    }));
    return results;
  }

  terminate() {
    for (const e of this.engines) e.terminate();
  }
}

let shared: Engine | null = null;
/** One long-lived engine for live analysis, puzzle checks and endgame play. */
export function sharedEngine(): Engine {
  shared ??= new Engine(64);
  return shared;
}

let facts: Engine | null = null;
/**
 * A second engine for on-demand facts ("why not X?", threats), so they never
 * wait behind (or get cut by) a live search on the shared engine.
 */
export function factsEngine(): Engine {
  facts ??= new Engine(32);
  return facts;
}

export function defaultPoolSize(): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(3, cores - 2));
}
