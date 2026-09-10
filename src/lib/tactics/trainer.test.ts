import { describe, expect, it } from 'vitest';
import type { TacticsState } from '../types';
import { detectMotifs, levelProgress, themeRating, themeWeights } from './trainer';
import { importance } from './themes';

const state = (over: Partial<TacticsState> = {}): TacticsState => ({
  rating: { rating: 1500, rd: 80, vol: 0.06 },
  themes: {},
  placementDone: true,
  recent: [],
  stretch: 0,
  history: [],
  updatedAt: Date.now(),
  ...over,
});

describe('detectMotifs', () => {
  it('sees a knight fork of king and rook', () => {
    // White Nf3 forks via Nd4-c6? Use a clean position: Ne5 to f7 forks Rh8 and Qd8.
    const fen = 'r2qk2r/ppp2ppp/8/4N3/8/8/PPP2PPP/R3K2R w KQkq - 0 1';
    expect(detectMotifs(fen, ['e5f7'])).toContain('fork');
  });

  it('sees a free piece', () => {
    const fen = '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1';
    expect(detectMotifs(fen, ['d1d5'])).toContain('hangingPiece');
  });

  it('labels short mates and back-rank mates', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const m = detectMotifs(fen, ['d1d8'], { mate: 1 });
    expect(m).toContain('mateIn1');
    expect(m).toContain('backRankMate');
  });
});

describe('curriculum', () => {
  it('weights forks and hanging pieces above quiet moves for club players', () => {
    expect(importance('hangingPiece', 1300)).toBeGreaterThan(importance('quietMove', 1300));
    expect(importance('quietMove', 2200)).toBeGreaterThan(importance('quietMove', 1300));
  });

  it('shrinks a theme rating toward the global one while data is thin', () => {
    const s = state({ themes: { fork: { rating: 1200, rd: 200, vol: 0.06, attempts: 2, solved: 0, lastAt: Date.now() } } });
    const r = themeRating(s, 'fork');
    expect(r).toBeGreaterThan(1200);
    expect(r).toBeLessThan(1500);
  });

  it('gives a weak theme more weight than a strong one', () => {
    const now = Date.now();
    const s = state({
      themes: {
        pin: { rating: 1200, rd: 80, vol: 0.06, attempts: 40, solved: 10, lastAt: now },
        skewer: { rating: 1800, rd: 80, vol: 0.06, attempts: 40, solved: 30, lastAt: now },
      },
    });
    const w = themeWeights(s);
    expect(w.pin! / importance('pin', 1500)).toBeGreaterThan(w.skewer! / importance('skewer', 1500));
  });

  it('level progress points at the next hundred', () => {
    const p = levelProgress(state({ rating: { rating: 1537, rd: 70, vol: 0.06 } }));
    expect(p.current).toBe(1500);
    expect(p.next).toBe(1600);
    expect(p.ready).toBe(false);
  });
});
