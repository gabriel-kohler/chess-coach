// Your decks built from any opening: saved from Aberturas > Qualquer abertura,
// grown in the background (one at a time, in one tab), deepened, deleted. The
// building stops and goes on anywhere: the state is saved after every step,
// and the app picks it up again when it opens.
import { epdOf } from '../chess/replay.ts';
import { db, getKV, setKV } from '../db.ts';
import { Engine } from '../engine/stockfish.ts';
import { maiaPolicy } from '../maia/client.ts';
import { explorerMovesOrWait } from '../openings/explorer.ts';
import { loadLevel } from '../openings/level.ts';
import { fenAfter, levelMoves, normalize, type OpeningLine } from '../openings/study.ts';
import { pickReplies } from '../positions/replies.ts';
import { gate } from '../renewal/activity.ts';
import { loadOpeningsData } from '../repertoire/openingsData.ts';
import { loadMergedRepertoire } from '../repertoire/userChapters.ts';
import { deckNamespace, repCardId } from '../srs/cards.ts';
import type { Color } from '../types.ts';
import { BUILD, grow, pickAnswer, seed, type BuildDeps } from './build.ts';
import type { StudyDeck } from './types.ts';

/** Your moves the engine approved while studying, per color and position: a deck answers with them. */
export const STUDY_MOVES_KEY = 'openings:studyMoves';
export type StudyMoves = Record<Color, Record<string, string>>;

export async function saveStudyMove(side: Color, epd: string, uci: string): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const all = await getKV<StudyMoves>(STUDY_MOVES_KEY, { white: {}, black: {} });
    if (all[side][epd] === uci) return;
    await setKV(STUDY_MOVES_KEY, { ...all, [side]: { ...all[side], [epd]: uci } });
  });
}

/** Letters, digits and dashes: card ids are built from it. */
export function deckIdFor(name: string, now: number): string {
  return `s-${normalize(name).replace(/ /g, '-').slice(0, 32)}-${now.toString(36)}`;
}

const sameLine = (d: StudyDeck, line: Pick<OpeningLine, 'name' | 'moves'>) => d.opening.name === line.name && d.opening.moves.join(' ') === line.moves.join(' ');

export async function findStudyDeck(line: Pick<OpeningLine, 'name' | 'moves'>, side: Color): Promise<StudyDeck | undefined> {
  return db.decks.where('side').equals(side).filter((d) => sameLine(d, line)).first();
}

/** A deck for an opening and a color: made (and its building started), or the one you already have. */
export async function createStudyDeck(line: OpeningLine, side: Color, size: number = BUILD.size, now = Date.now()): Promise<StudyDeck> {
  const existing = await findStudyDeck(line, side);
  if (existing) return existing;
  const deck: StudyDeck = {
    id: deckIdFor(line.name, now),
    name: line.name,
    side,
    opening: { eco: line.eco, name: line.name, moves: line.moves },
    ...seed(fenAfter(line.moves)),
    size,
    limits: { minP: BUILD.minP, maxDepth: BUILD.maxDepth },
    status: 'building',
    builtAt: null,
    createdAt: now,
  };
  await db.decks.put(deck);
  deckWaiting = true;
  void buildDecks();
  return deck;
}

/** More positions, the lines allowed a bit rarer and deeper; what the deck has stays. */
export async function deepenStudyDeck(id: string): Promise<void> {
  const deck = await db.decks.get(id);
  if (!deck) return;
  await db.decks.update(id, {
    size: deck.size + BUILD.deepen,
    limits: { minP: deck.limits.minP / 2, maxDepth: deck.limits.maxDepth + 2 },
    status: 'building',
  });
  deckWaiting = true;
  void buildDecks();
}

const deleted = new Set<string>();

/** The deck and its cards go; your review history stays (the optimizer learns from it). */
export async function deleteStudyDeck(id: string): Promise<void> {
  deleted.add(id);
  await db.transaction('rw', db.decks, db.srsCards, async () => {
    await db.decks.delete(id);
    await db.srsCards.where('id').startsWith(repCardId(deckNamespace(id), '')).delete();
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function buildOne(deck: StudyDeck, engine: Engine): Promise<'done' | 'paused'> {
  const [level, rep, openings, studied] = await Promise.all([
    loadLevel(),
    loadMergedRepertoire(),
    loadOpeningsData().catch(() => null),
    getKV<StudyMoves>(STUDY_MOVES_KEY, { white: {}, black: {} }),
  ]);
  const side = deck.side;
  const book = rep?.sides[side].positions ?? {};
  const ctx = {
    tree: openings?.data.index[side].tree ?? null,
    userColor: side,
    userElo: level.userElo,
    oppElo: level.oppElo,
    policy: level.maia ? maiaPolicy : null,
    explorer: level.explorer ? explorerMovesOrWait : null,
  };
  const deps: BuildDeps = {
    replies: async (fen) => pickReplies(await levelMoves(fen, ctx)).map((m) => ({ uci: m.uci, san: m.san, p: m.p })),
    answer: async (fen) => {
      const epd = epdOf(fen);
      const known = pickAnswer(fen, studied[side][epd], book[epd]?.moves[0]);
      if (known !== 'engine') return known;
      // The engine waits while you train: your move checks get the CPU.
      await gate();
      await engine.newGame();
      const best = (await engine.analyse(fen, { depth: 16 }))[0]?.pv[0];
      return best ? { uci: best, source: 'engine' } : null;
    },
    wait: () => sleep(60_000),
    save: async (s) => {
      if (deleted.has(deck.id)) return;
      await db.decks.update(deck.id, { positions: s.positions, sources: s.sources, frontier: s.frontier, differs: s.differs });
    },
    stopped: () => deleted.has(deck.id),
  };
  const r = await grow(deck, side, deps);
  if (deleted.has(deck.id)) return 'done';
  await db.decks.update(deck.id, {
    positions: r.state.positions,
    sources: r.state.sources,
    frontier: r.state.frontier,
    differs: r.state.differs,
    ...(r.status === 'done' ? { status: 'ready' as const, builtAt: Date.now() } : {}),
    note: r.note ?? '',
  });
  return r.status;
}

let running: Promise<void> | null = null;
let again = false;
/** A deck was saved or deepened: the long scan for mistakes gives way at its next position. */
let deckWaiting = false;

async function buildAll(): Promise<void> {
  // Its own Stockfish, started only when a search needs it: the one checking your moves stays free.
  const held: { engine: Engine | null } = { engine: null };
  const engineFor = () => (held.engine ??= new Engine(32));
  try {
    let waits = 0;
    for (;;) {
      deckWaiting = false;
      for (;;) {
        const next = (await db.decks.orderBy('createdAt').filter((d) => d.status === 'building' && !deleted.has(d.id)).first()) ?? null;
        if (!next) break;
        // Lichess asked to wait a few times in a row: try again in a minute.
        if ((await buildOne(next, engineFor())) === 'paused' && !deleted.has(next.id)) await sleep(60_000);
      }
      // Then the opponents' common mistakes in your decks, with the same engine: one background Stockfish at a time.
      // The first scan takes about half an hour; a deck you save meanwhile is built first.
      const { runPunishScan } = await import('../punish/store.ts');
      const status = await runPunishScan(engineFor, () => deckWaiting);
      if (deckWaiting) continue;
      if (status === 'paused' && ++waits <= 5) {
        await sleep(60_000);
        continue;
      }
      break;
    }
  } finally {
    held.engine?.terminate();
  }
}

/**
 * Builds every deck still building, one at a time, then looks for the
 * mistakes to punish in your decks; a call while it runs makes it look again
 * when done. With the app in several tabs only one runs it (a Web Lock held
 * while it works).
 */
export function buildDecks(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const once = () => (locks ? locks.request('chess-coach:decks', buildAll) : buildAll());
  running = (async () => {
    do {
      again = false;
      await once();
    } while (again);
  })()
    .catch((e) => console.warn('decks:', e))
    .finally(() => {
      running = null;
    });
  return running;
}
