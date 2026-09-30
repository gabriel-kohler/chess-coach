// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { explorerUrl, limiter } from '../../../server/explorer';
import { ratingBuckets } from './explorer';

describe('your rating range on the Lichess explorer', () => {
  it('your bucket and the one on your side of it', () => {
    // chess.com 1370 is about 1670 on Lichess: 1400 to 1799.
    expect(ratingBuckets(1670)).toEqual([1400, 1600]);
    expect(ratingBuckets(1750)).toEqual([1600, 1800]);
    expect(ratingBuckets(900)).toEqual([0, 1000]);
    expect(ratingBuckets(2600)).toEqual([2200, 2500]);
  });
});

describe('asking Lichess politely', () => {
  it('one request at a time, and a full minute of silence after a 429', async () => {
    let clock = 0;
    let inFlight = 0;
    let most = 0;
    const statuses = [200, 429, 200];
    const upstream = vi.fn(async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const status = statuses.shift() ?? 200;
      return { status, json: async () => ({ moves: [] }) };
    });
    const ask = limiter(upstream, { spacingMs: 1, coolMs: 60_000, now: () => clock });
    const [a, b, c] = await Promise.all([ask('u1'), ask('u2'), ask('u3')]);
    expect(most).toBe(1);
    expect(a).toEqual({ ok: true, body: { moves: [] } });
    expect(b).toEqual({ ok: false, reason: 'limited' });
    // The third came during the minute: answered at once, Lichess not asked.
    expect(c).toEqual({ ok: false, reason: 'limited' });
    expect(upstream).toHaveBeenCalledTimes(2);
    clock = 61_000;
    expect(await ask('u4')).toEqual({ ok: true, body: { moves: [] } });
  });
});

describe('what the server asks Lichess', () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  it('a position, rating buckets and speeds from fixed lists; nothing else gets through', () => {
    const url = new URL(explorerUrl(q({ fen: 'rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ratings: '1400,1600', speeds: 'blitz,rapid' }))!);
    expect(url.origin + url.pathname).toBe('https://explorer.lichess.ovh/lichess');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ variant: 'standard', ratings: '1400,1600', speeds: 'blitz,rapid', topGames: '0', recentGames: '0' });
    expect(explorerUrl(q({ fen: 'not a fen', ratings: '1400' }))).toBeNull();
    expect(explorerUrl(q({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ratings: '1450' }))).toBeNull();
    expect(new URL(explorerUrl(q({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ratings: '1400,9999', speeds: 'rapid,hyper' }))!).searchParams.get('speeds')).toBe('rapid');
  });
});
