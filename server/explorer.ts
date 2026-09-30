// The Lichess opening explorer, filtered by rating: what people at your level
// play in any opening, from millions of games. Since 2025 it needs a token (a
// free personal one, no scope, from lichess.org/account/oauth/token): it stays
// in this Node process, read from .env.local as LICHESS_TOKEN, and never
// reaches the browser. Answers are kept in memory while the server runs.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const EXPLORER = 'https://explorer.lichess.ovh/lichess';
const BUCKETS = new Set(['0', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500']);
const SPEEDS = new Set(['bullet', 'blitz', 'rapid', 'classical']);

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Only what the explorer takes: a FEN, rating buckets and speeds from fixed lists. */
export function explorerUrl(query: URLSearchParams): string | null {
  const fen = query.get('fen') ?? '';
  if (!/^[pnbrqkPNBRQK1-8/]+ [wb] [KQkq-]+ [a-h1-8-]+( \d+ \d+)?$/.test(fen)) return null;
  const ratings = (query.get('ratings') ?? '').split(',').filter((r) => BUCKETS.has(r));
  const speeds = (query.get('speeds') ?? 'blitz,rapid').split(',').filter((s) => SPEEDS.has(s));
  if (!ratings.length || !speeds.length) return null;
  const url = new URL(EXPLORER);
  url.searchParams.set('variant', 'standard');
  url.searchParams.set('fen', fen);
  url.searchParams.set('ratings', ratings.join(','));
  url.searchParams.set('speeds', speeds.join(','));
  url.searchParams.set('moves', '12');
  url.searchParams.set('topGames', '0');
  url.searchParams.set('recentGames', '0');
  return url.toString();
}

export type Upstream = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

/**
 * Lichess asks for one request at a time and, after a 429, a full minute of
 * silence. Requests wait in line, a short pause apart; during the minute they
 * are answered "limited" at once (the app then uses your own games).
 */
export function limiter(upstream: Upstream, opts: { spacingMs: number; coolMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let chain: Promise<unknown> = Promise.resolve();
  let coolUntil = 0;
  return (url: string): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> => {
    const job = chain.then(async () => {
      if (now() < coolUntil) return { ok: false as const, reason: 'limited' };
      const r = await upstream(url);
      if (r.status === 429) coolUntil = now() + opts.coolMs;
      await new Promise((resolve) => setTimeout(resolve, opts.spacingMs));
      return r.status === 200 ? { ok: true as const, body: await r.json() } : { ok: false as const, reason: r.status === 429 ? 'limited' : `explorer ${r.status}` };
    });
    chain = job.catch(() => undefined);
    return job;
  };
}

/** Adds GET /api/explorer (the explorer's answer) and GET /api/explorer/status to the dev and preview servers. */
export function explorerPlugin(env: Record<string, string>): Plugin {
  const token = env.LICHESS_TOKEN || process.env.LICHESS_TOKEN || '';
  const cache = new Map<string, unknown>();
  const ask = limiter((url) => fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }), { spacingMs: 250, coolMs: 60_000 });
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '', 'http://local');
    if (url.pathname === '/api/explorer/status') return send(res, 200, { available: !!token });
    if (url.pathname !== '/api/explorer' || req.method !== 'GET') return next();
    if (!token) return send(res, 503, { error: 'LICHESS_TOKEN is not set' });
    const target = explorerUrl(url.searchParams);
    if (!target) return send(res, 400, { error: 'bad query' });
    const hit = cache.get(target);
    if (hit) return send(res, 200, hit);
    try {
      const r = await ask(target);
      if (!r.ok) return send(res, 200, { unavailable: r.reason }); // not an error for the page: it falls back
      cache.set(target, r.body);
      send(res, 200, r.body);
    } catch (e) {
      send(res, 200, { unavailable: (e as Error).message });
    }
  };
  return {
    name: 'lichess-explorer',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
