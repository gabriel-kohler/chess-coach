import { describe, expect, it } from 'vitest';
import { makeGame } from '../../test/positionFixtures';
import { bestOffset, calibrate, calibrationSamples, hitRates } from './calibrate';

const LONG = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Bd2', 'Bxd2+', 'Nbxd2', 'd5', 'exd5', 'Nxd5', 'Qb3', 'Nce7', 'O-O', 'O-O', 'Rfe1', 'c6', 'a4', 'Qb6', 'Qa3', 'Be6', 'Ne4', 'Rad8', 'Nc5', 'Bc8'];

describe('Maia calibration', () => {
  it('samples opponent moves after the opening, with both ratings', () => {
    const g = makeGame({ moves: LONG, userColor: 'white', oppRating: 1400, userRating: 1370 });
    const s = calibrationSamples([g], 100);
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.fen.split(' ')[1] === 'b')).toBe(true); // White is you: Black moves are the opponent's
    expect(s[0]).toMatchObject({ oppRating: 1400, userRating: 1370 });
    expect(Number(s[0]!.fen.split(' ')[5])).toBeGreaterThan(10);
  });

  it('skips daily, bullet and set-up games', () => {
    const games = [makeGame({ moves: LONG, timeClass: 'daily' }), makeGame({ moves: LONG, timeClass: 'bullet' }), makeGame({ moves: LONG, initialFen: '8/8/8/8/8/8/8/8 w - - 0 1' })];
    expect(calibrationSamples(games)).toHaveLength(0);
  });

  it('counts top-1 and top-3 hits', () => {
    const p = (...ucis: string[]) => ucis.map((uci, i) => ({ uci, p: 1 / (i + 1) }));
    expect(hitRates([p('a', 'b', 'c'), p('b', 'a', 'c'), p('b', 'c', 'd', 'a')], ['a', 'a', 'a'])).toEqual({ top1: 1 / 3, top3: 2 / 3 });
  });

  it('picks the offset with the best top-3, then top-1', () => {
    expect(bestOffset([{ offset: 0, top1: 0.5, top3: 0.7 }, { offset: 200, top1: 0.4, top3: 0.8 }, { offset: 300, top1: 0.45, top3: 0.8 }])).toBe(300);
  });

  it('asks Maia with the shifted ratings of both players', async () => {
    const seen: number[] = [];
    const samples = [{ fen: 'x', uci: 'e2e4', oppRating: 1400, userRating: 1370 }];
    const c = await calibrate(samples, async (items) => items.map((it) => (seen.push(it.eloSelf, it.eloOppo), [{ uci: it.eloSelf === 1600 ? 'e2e4' : 'd2d4', p: 1 }])), undefined, [0, 200], 7);
    expect(seen).toEqual([1400, 1370, 1600, 1570]);
    expect(c).toMatchObject({ offset: 200, n: 1, at: 7 });
  });
});
