// @vitest-environment node
import { Rating, State } from 'ts-fsrs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { RepCard } from '../types';
import type { CompiledSide, RepertoirePosition } from './compile';
import { START_EPD } from './data';
import { aheadIn, cardsFor, dueBelow, dueInRepertoire, grade, pickReply, progress, repGrade } from './drill';

const NOW = new Date(2026, 8, 10, 9, 0).getTime();
const attempt = (correct: boolean, timeMs = 6_000) => ({ uci: 'e2e4', correct, timeMs, hiddenMs: 0, expectedMs: 10_000 });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('repertoire on FSRS', () => {
  it('grades the first try by your time: a miss is Again, a right move Hard, Good or Easy', () => {
    expect(repGrade(attempt(false, 1_000))).toBe(Rating.Again);
    expect(repGrade(attempt(true, 4_000))).toBe(Rating.Easy);
    expect(repGrade(attempt(true, 10_000))).toBe(Rating.Good);
    expect(repGrade(attempt(true, 25_000))).toBe(Rating.Hard);
  });

  it('a new position is created by its first try, and a miss comes back in minutes', async () => {
    await grade('white', 'epdA', attempt(false), NOW);
    await grade('white', 'epdB', attempt(true), NOW);
    const cards = await cardsFor('white');
    expect([...cards.keys()].sort()).toEqual(['epdA', 'epdB']);
    expect(cards.get('epdA')!.due - NOW).toBe(60_000);
    expect(await cardsFor('black')).toEqual(new Map());
    expect(await db.reviewLogs.where('[kind+at]').between(['rep', 0], ['rep', NOW + 1]).count()).toBe(2);
  });

  it('a fixed attempt id grades a position once, however many times it is saved', async () => {
    await grade('white', 'epdA', attempt(true), NOW, 'daily-1|s4|epdA');
    await grade('white', 'epdA', attempt(false), NOW + 1_000, 'daily-1|s4|epdA');
    expect(await db.reviewLogs.count()).toBe(1);
    expect((await cardsFor('white')).get('epdA')!.reps).toBe(1);
  });

  it('a deck of its own keeps its own card for a position; your repertoire has one per position', async () => {
    await grade('black', 'epdA', attempt(true), NOW);
    await grade('black', 'epdA', attempt(false), NOW, undefined, 'd:vant-1');
    await grade('black', 'epdA', attempt(true), NOW, undefined, 'd:vant-2');
    expect((await cardsFor('black')).get('epdA')!.id).toBe('rep:black|epdA');
    expect((await cardsFor('d:vant-1')).get('epdA')).toMatchObject({ id: 'rep:d:vant-1|epdA', deck: 'vant-1', side: 'black', lapses: 0, state: State.Learning });
    expect((await cardsFor('d:vant-2')).size).toBe(1);
    // A deck's cards are not your repertoire's.
    expect((await cardsFor('black')).size).toBe(1);
  });

  it('learned means graduated to review', async () => {
    await grade('white', 'epdA', attempt(true), NOW);
    expect(progress(await cardsFor('white'), ['epdA'], NOW).learned).toBe(0); // a 10-minute step first
    await grade('white', 'epdA', attempt(true), NOW + 11 * 60_000);
    const cards = await cardsFor('white');
    expect((cards.get('epdA') as RepCard).state).toBe(State.Review);
    expect(progress(cards, ['epdA', 'epdB'], NOW + 12 * 60_000)).toEqual({ total: 2, learned: 1, due: 0 });
  });
});

describe('the reply the app plays', () => {
  // Black's repertoire: after 1.e4, 1.d4 or 1.c4 you have a move; a deeper position D2 below d4.
  const pos = (epd: string, to: string[]): RepertoirePosition => ({ epd, fen: `${epd} 0 1`, ply: 0, moves: to.map((t, i) => ({ san: `m${i}`, uci: `u${epd}${i}`, to: t, nags: [] })) });
  const side: CompiledSide = {
    side: 'black',
    chapters: [],
    positions: { [START_EPD]: pos(START_EPD, ['E4', 'D4', 'C4']), E4: pos('E4', ['x1']), D4: pos('D4', ['D1']), D1: pos('D1', ['D2']), D2: pos('D2', ['x2']), C4: pos('C4', ['x3']) },
  };
  const card = (epd: string, due: number, over: Partial<RepCard> = {}) => ({ id: `rep:black|${epd}`, kind: 'rep', epd, side: 'black', due, state: State.Review, suspended: 0, ...over }) as RepCard;
  // E4 learned, D2 (under d4) due, C4 never seen.
  const cards = new Map([['E4', card('E4', NOW + 5 * 86_400_000)], ['D2', card('D2', NOW - 1)]]);
  const draws = Array.from({ length: 20 }, (_, i) => i / 20);

  it('toward a due review further down, while there is one', () => {
    const below = dueBelow(side, cards, NOW);
    expect([...below].sort()).toEqual(['D1', 'D2', 'D4', START_EPD].sort());
    for (const r of draws) expect(pickReply(side, START_EPD, cards, null, null, { prefer: 'due', dueBelow: below, now: NOW, random: () => r })!.to).toBe('D4');
  });

  it('in a deck, toward its own reviews only: never toward another deck through a shared position', () => {
    // The deck is 1.d4 without D2, and C4; D2 is due but belongs to another deck.
    const scope = new Set([START_EPD, 'D4', 'D1', 'C4', 'x3']);
    expect(dueBelow(side, cards, NOW, scope).size).toBe(0);
    const withC4Due = new Map([...cards, ['C4', card('C4', NOW - 1)]]);
    expect([...dueBelow(side, withC4Due, NOW, scope)].sort()).toEqual(['C4', START_EPD].sort());
  });

  it('the lines that go on come up more than a sideline answered in one move', () => {
    // Black: after 1.e4 one move and the line ends; after 1.d4 your move, their reply, your move again.
    const p = (epd: string, to: string[]): RepertoirePosition => ({ epd, fen: `${epd} 0 1`, ply: 0, moves: to.map((t, i) => ({ san: `m${i}`, uci: `u${epd}${i}`, to: t, nags: [] })) });
    const S = 's w - -', E4 = 'e4 b - -', D4 = 'd4 b - -', D5 = 'd5 w - -', C4 = 'c4 b - -';
    const two: CompiledSide = { side: 'black', chapters: [], positions: { [S]: p(S, [E4, D4]), [E4]: p(E4, ['e5 w - -']), [D4]: p(D4, [D5]), [D5]: p(D5, [C4]), [C4]: p(C4, ['e6 w - -']) } };
    const ahead = aheadIn(two, null);
    expect([ahead(S), ahead(D4), ahead(E4)]).toEqual([2, 2, 1]);
    const known = new Map([E4, D4, C4].map((e) => [e, card(e, NOW + 5 * 86_400_000)]));
    const count = (pref: Parameters<typeof pickReply>[5]) => draws.filter((r) => pickReply(two, S, known, null, null, { ...pref, now: NOW, random: () => r })!.to === D4).length;
    expect(count({ ahead })).toBeGreaterThan(count({}));
    // Inside a deck, only its lines count.
    expect(aheadIn(two, new Set([S, D4, D5]))(D4)).toBe(1);
  });

  it('before games, never into a position you have not seen', () => {
    const picked = new Set(draws.map((r) => pickReply(side, START_EPD, cards, null, null, { prefer: 'known', now: NOW, random: () => r })!.to));
    expect(picked.has('C4')).toBe(false);
    // Nothing known: the line ends instead of teaching something new.
    expect(pickReply(side, START_EPD, new Map(), null, null, { prefer: 'known', now: NOW })).toBeNull();
    // Without a preference, the unseen one still comes up (that is how you learn it).
    expect(new Set(draws.map((r) => pickReply(side, START_EPD, cards, null, null, { now: NOW, random: () => r })!.to)).has('C4')).toBe(true);
  });

  it('due positions no longer in the repertoire are left out', () => {
    const withGone = new Map([...cards, ['GONE', card('GONE', NOW - 1)]]);
    expect(dueInRepertoire(side, withGone, NOW).map((c) => c.epd)).toEqual(['D2']);
  });
});
