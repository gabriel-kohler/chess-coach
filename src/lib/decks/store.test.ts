// @vitest-environment node
import { State } from 'ts-fsrs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { OpeningLine } from '../openings/study';
import { grade } from '../repertoire/drill';
import { buildDecks, createStudyDeck, deckIdFor, deepenStudyDeck, deleteStudyDeck, findStudyDeck, saveStudyMove } from './store';
import { positionsAlong } from './views';

// The engine's best is always the first legal move by name; nobody at your level has data (no explorer, no games, no Maia).
vi.mock('../engine/stockfish', async () => {
  const { Chess } = await import('chess.js');
  class Engine {
    async newGame() {}
    async analyse(fen: string) {
      const m = new Chess(fen).moves({ verbose: true }).sort((a, b) => a.lan.localeCompare(b.lan))[0];
      return m ? [{ depth: 16, cp: 0, pv: [m.lan] }] : [];
    }
    terminate() {}
  }
  return { Engine };
});
vi.mock('../openings/level', () => ({ loadLevel: async () => ({ rating: 1370, userElo: 1670, oppElo: 1670, maia: false, explorer: false }) }));
vi.mock('../repertoire/openingsData', () => ({ loadOpeningsData: async () => null }));
vi.mock('../repertoire/userChapters', () => ({ loadMergedRepertoire: async () => null }));

const NOW = new Date(2026, 8, 11, 9, 0).getTime();
const vant: OpeningLine = { eco: 'A00', name: "Van't Kruijs Opening", family: "Van't Kruijs Opening", moves: ['e3'], key: 'vant kruijs opening' };
const AFTER_E3 = positionsAlong(['e3']).at(-1)!;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('your decks from any opening', () => {
  it('an id made for card ids: no "|"', () => {
    expect(deckIdFor("Van't Kruijs Opening", NOW)).toMatch(/^s-vant-kruijs-opening-[a-z0-9]+$/);
  });

  it('saved once per opening and color, and built in the background with your study move first', async () => {
    await saveStudyMove('black', AFTER_E3, 'd7d5');
    const deck = await createStudyDeck(vant, 'black', 20, NOW);
    expect(await createStudyDeck(vant, 'black', 20, NOW + 1)).toMatchObject({ id: deck.id });
    await buildDecks();
    const built = (await findStudyDeck(vant, 'black'))!;
    expect(built.status).toBe('ready');
    // Nobody at your level has data after 1.e3 d5 here: one position, your answer from your study.
    expect(built.positions[AFTER_E3]!.moves[0]!.uci).toBe('d7d5');
    expect(built.sources[AFTER_E3]).toBe('study');
    expect(await findStudyDeck(vant, 'white')).toBeUndefined();
  });

  it('"Aprofundar" asks for more, rarer and deeper lines, keeping what the deck has', async () => {
    const deck = await createStudyDeck(vant, 'black', 20, NOW);
    await buildDecks();
    await deepenStudyDeck(deck.id);
    await buildDecks();
    const after = (await db.decks.get(deck.id))!;
    expect(after).toMatchObject({ size: 40, status: 'ready', limits: { minP: 0.01, maxDepth: 12 } });
  });

  it('deleting a deck removes it and its cards; your review history stays', async () => {
    const deck = await createStudyDeck(vant, 'black', 20, NOW);
    await buildDecks();
    const attempt = { uci: 'e7e5', correct: true, timeMs: 5_000, hiddenMs: 0, expectedMs: 10_000 };
    await grade('black', AFTER_E3, attempt, NOW, undefined, `d:${deck.id}`);
    await grade('black', AFTER_E3, attempt, NOW, undefined, 'black');
    await deleteStudyDeck(deck.id);
    expect(await db.decks.count()).toBe(0);
    expect((await db.srsCards.toArray()).map((c) => c.id)).toEqual([`rep:black|${AFTER_E3}`]);
    expect(await db.reviewLogs.count()).toBe(2);
    expect((await db.srsCards.get(`rep:black|${AFTER_E3}`))!.state).toBe(State.Learning);
  });
});
