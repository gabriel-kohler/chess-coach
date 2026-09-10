// Stockfish over stdin/stdout for Node scripts (build-time checks).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ENGINE_PATH = join(dirname(require.resolve('stockfish/package.json')), 'bin', 'stockfish-18-lite-single.js');

export class UciEngine {
  constructor() {
    this.proc = spawn(process.execPath, [ENGINE_PATH], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buffer = '';
    this.waiters = [];
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      let idx;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this.onLine(line);
      }
    });
  }

  onLine(line) {
    for (const w of [...this.waiters]) w(line);
  }

  send(cmd) {
    this.proc.stdin.write(`${cmd}\n`);
  }

  until(predicate, onLine) {
    return new Promise((resolve) => {
      const waiter = (line) => {
        onLine?.(line);
        if (predicate(line)) {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve(line);
        }
      };
      this.waiters.push(waiter);
    });
  }

  async init({ hash = 64 } = {}) {
    const ok = this.until((l) => l === 'uciok');
    this.send('uci');
    await ok;
    this.send(`setoption name Hash value ${hash}`);
    await this.ready();
  }

  async ready() {
    const ok = this.until((l) => l === 'readyok');
    this.send('isready');
    await ok;
  }

  /**
   * Returns the principal variations at the final depth. Scores are from the
   * side to move's point of view.
   */
  async analyse(fen, { depth = 16, multipv = 1, searchmoves } = {}) {
    this.send(`setoption name MultiPV value ${multipv}`);
    await this.ready();
    const lines = new Map();
    const done = this.until(
      (l) => l.startsWith('bestmove'),
      (l) => {
        if (!l.startsWith('info') || !l.includes(' pv ')) return;
        const d = Number(/ depth (\d+)/.exec(l)?.[1] ?? 0);
        const k = Number(/ multipv (\d+)/.exec(l)?.[1] ?? 1);
        const cp = / score cp (-?\d+)/.exec(l);
        const mate = / score mate (-?\d+)/.exec(l);
        const pv = l.split(' pv ')[1].trim().split(/\s+/);
        if (/ (lowerbound|upperbound)/.test(l)) return;
        lines.set(k, { depth: d, cp: cp ? Number(cp[1]) : undefined, mate: mate ? Number(mate[1]) : undefined, pv, move: pv[0] });
      },
    );
    this.send('ucinewgame');
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}${searchmoves?.length ? ` searchmoves ${searchmoves.join(' ')}` : ''}`);
    await done;
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  quit() {
    this.send('quit');
    setTimeout(() => this.proc.kill(), 200);
  }
}

/** Centipawns from the side to move's point of view, mates squashed to +-10000. */
export function scoreOf(line) {
  if (!line) return 0;
  if (line.mate !== undefined) return line.mate > 0 ? 10000 - line.mate : -10000 - line.mate;
  return line.cp ?? 0;
}

export async function createPool(size, opts) {
  const engines = await Promise.all(Array.from({ length: size }, async () => {
    const e = new UciEngine();
    await e.init(opts);
    return e;
  }));
  const idle = [...engines];
  const queue = [];
  const release = (e) => {
    const next = queue.shift();
    if (next) next(e);
    else idle.push(e);
  };
  const acquire = () => new Promise((resolve) => {
    const e = idle.pop();
    if (e) resolve(e);
    else queue.push(resolve);
  });
  return {
    async run(task) {
      const e = await acquire();
      try {
        return await task(e);
      } finally {
        release(e);
      }
    },
    close() {
      for (const e of engines) e.quit();
    },
  };
}
