// One view for both kinds of deck: a group of chapters of your repertoire, or
// a deck built from any opening. Pure: the trainer, the deck list and the
// training sessions all read decks through here.
import { Chess } from 'chess.js';
import { tryMove } from '../chess/replay.ts';
import { epdOf, turnOf, type CompiledSide, type RepertoireChapter } from '../repertoire/compile.ts';
import { chapterRoot, reachableFrom } from '../repertoire/data.ts';
import type { GamesIndex } from '../repertoire/games.ts';
import { isUserChapter } from '../repertoire/user.ts';
import { deckNamespace, type RepNamespace } from '../srs/cards.ts';
import type { Color, RepCard } from '../types.ts';
import { REPERTOIRE_DECKS, specFor, type DeckSpec } from './catalog.ts';
import type { StudyDeck } from './types.ts';

export interface DeckView {
  id: string;
  name: string;
  side: Color;
  kind: 'repertoire' | 'study';
  /** Where its cards live: the color for your repertoire, its own for a study deck. */
  ns: RepNamespace;
  tree: CompiledSide;
  /** The positions it is made of, both sides; null for the whole tree. */
  scope: Set<string> | null;
  /** The start its lines share (SAN from the start): where the deck is, for its games and your chapters. */
  prefix: string[];
  /**
   * What a line of it plays by itself before asking: nothing for your
   * repertoire (you play from move 1, the shared start too); the opening's
   * moves for a deck from any opening (the deck has no answer there).
   */
  start: string[];
  /** The position after the prefix. */
  root: string;
  /** Your positions in it (your move, with an answer), the trunk included. */
  ours: string[];
  /** Its chapters (your repertoire), your own ones included. */
  chapters: RepertoireChapter[];
  /** Its color's deck for the lines no other deck names. */
  rare?: true;
}

/** Position after each prefix of a SAN path: [start, after 1 move, ...], as far as the moves play. */
export function positionsAlong(path: string[]): string[] {
  const c = new Chess();
  const out = [epdOf(c.fen())];
  for (const san of path) {
    if (!tryMove(c, san)) break;
    out.push(epdOf(c.fen()));
  }
  return out;
}

export function commonPrefix(paths: string[][]): string[] {
  if (!paths.length) return [];
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const san = paths[0]![i];
    if (san === undefined || paths.some((p) => p[i] !== san)) return out;
    out.push(san);
  }
}

const startsWith = (path: string[], prefix: string[]) => prefix.every((m, i) => path[i] === m);

function ourPositions(tree: CompiledSide, scope: Set<string> | null): string[] {
  const out: string[] = [];
  for (const [epd, pos] of Object.entries(tree.positions)) {
    if (scope && !scope.has(epd)) continue;
    if (turnOf(epd) === tree.side && pos.moves.length) out.push(epd);
  }
  return out;
}

/** A chapter's positions: written in the file, or (an old file) everything reachable from its root. */
function chapterScope(tree: CompiledSide, ch: RepertoireChapter): Iterable<string> {
  return ch.own ?? reachableFrom(tree, chapterRoot(ch.entry));
}

interface Draft {
  spec: DeckSpec;
  prefix: string[];
  /** Positions of its chapters from the file: a chapter of yours never widens where the deck is placed. */
  fileOwn: Set<string>;
  scope: Set<string>;
  chapters: RepertoireChapter[];
}

/**
 * The deck a line of yours belongs to (a gap you accepted, a game that left
 * the book): among the decks whose start the line follows, the one it stays
 * in longest, then the longer start, then the rare lines, then the list order.
 * Not the gap's position alone: that is often the start or 1.e4, which every
 * deck of the color has.
 */
export function deckForPath<T extends { prefix: string[]; fileOwn: Set<string>; rare?: boolean }>(decks: T[], path: string[]): T | null {
  const along = positionsAlong(path);
  let best: { d: T; deep: number } | null = null;
  for (const d of decks) {
    if (!startsWith(path, d.prefix)) continue;
    let deep = -1;
    for (let i = 0; i < along.length; i++) if (d.fileOwn.has(along[i]!)) deep = i;
    if (deep < 0) continue;
    const better =
      !best ||
      deep > best.deep ||
      (deep === best.deep && (d.prefix.length > best.d.prefix.length || (d.prefix.length === best.d.prefix.length && !!d.rare && !best.d.rare)));
    if (better) best = { d, deep };
  }
  return best?.d ?? decks.find((d) => d.rare) ?? null;
}

/** Your repertoire of one color as decks, in the list's order; a deck with no chapter in the file is left out. */
export function repertoireDecks(tree: CompiledSide, specs: DeckSpec[] = REPERTOIRE_DECKS): DeckView[] {
  const groups = new Map<string, { spec: DeckSpec; chapters: RepertoireChapter[] }>();
  for (const spec of specs) if (spec.side === tree.side) groups.set(spec.id, { spec, chapters: [] });
  const yours: RepertoireChapter[] = [];
  for (const ch of tree.chapters) {
    if (isUserChapter(ch.id)) yours.push(ch);
    else {
      const spec = specFor(ch.id, tree.side, specs);
      if (spec) groups.get(spec.id)!.chapters.push(ch);
    }
  }
  const drafts: Array<Draft & { rare?: boolean }> = [];
  for (const { spec, chapters } of groups.values()) {
    if (!chapters.length) continue;
    const fileOwn = new Set<string>();
    for (const ch of chapters) for (const e of chapterScope(tree, ch)) fileOwn.add(e);
    drafts.push({ spec, prefix: commonPrefix(chapters.map((c) => c.entry)), fileOwn, scope: new Set(fileOwn), chapters: [...chapters], ...(spec.rare ? { rare: true } : {}) });
  }
  for (const ch of yours) {
    const d = deckForPath(drafts, ch.entry);
    if (!d) continue;
    d.chapters.push(ch);
    for (const e of chapterScope(tree, ch)) d.scope.add(e);
  }
  return drafts.map((d) => ({
    id: d.spec.id,
    name: d.spec.name,
    side: tree.side,
    kind: 'repertoire' as const,
    ns: tree.side,
    tree,
    scope: d.scope,
    prefix: d.prefix,
    start: [],
    root: positionsAlong(d.prefix).at(-1)!,
    ours: ourPositions(tree, d.scope),
    chapters: d.chapters,
    ...(d.spec.rare ? { rare: true as const } : {}),
  }));
}

/** The deck your line of play belongs to, by name, for the reasons in Treinar. */
export function deckNameForPath(decks: DeckView[], path: string[]): string | null {
  const drafts = decks.map((d) => ({ d, prefix: d.prefix, fileOwn: d.scope ?? new Set<string>(), ...(d.rare ? { rare: true } : {}) }));
  return deckForPath(drafts, path)?.d.name ?? null;
}

export function studyDeckView(deck: StudyDeck): DeckView {
  const chapter: RepertoireChapter = { id: deck.id, side: deck.side, name: deck.name, entry: deck.opening.moves, own: Object.keys(deck.positions) };
  const tree: CompiledSide = { side: deck.side, chapters: [chapter], positions: deck.positions };
  return {
    id: deck.id,
    name: deck.name,
    side: deck.side,
    kind: 'study',
    ns: deckNamespace(deck.id),
    tree,
    scope: null,
    prefix: deck.opening.moves,
    start: deck.opening.moves,
    root: positionsAlong(deck.opening.moves).at(-1)!,
    ours: ourPositions(tree, null),
    chapters: [chapter],
  };
}

/**
 * Where a line of one chapter starts: after its trunk, unless one of your
 * positions on the way is due (or new, unless `known`): then just before it,
 * so it gets asked. (A whole deck of your repertoire is played from move 1.)
 */
export function startFor(deck: Pick<DeckView, 'prefix' | 'tree' | 'side'>, cards: Map<string, RepCard>, now = Date.now(), opts: { known?: boolean } = {}): string[] {
  const along = positionsAlong(deck.prefix);
  for (let i = 0; i < deck.prefix.length && i < along.length; i++) {
    const epd = along[i]!;
    if (turnOf(epd) !== deck.side || !deck.tree.positions[epd]?.moves.length) continue;
    const card = cards.get(epd);
    if (card ? !card.suspended && card.due <= now : !opts.known) return deck.prefix.slice(0, i);
  }
  return deck.prefix.slice(0, along.length - 1);
}

/**
 * Your recent games in the deck and your points: the games that reached one
 * of the opponent's moves it covers from its root, so a deck of rare lines
 * counts only the rare lines. When the root is your move (a study deck after
 * the opponent's move), the root itself.
 */
export function deckStats(deck: Pick<DeckView, 'root' | 'side' | 'scope' | 'tree' | 'kind'>, index: GamesIndex | null): { n: number; points: number } {
  const out = { n: 0, points: 0 };
  if (!index) return out;
  const add = (epd: string) => {
    const s = index.recent.get(epd);
    if (s) {
      out.n += s.n;
      out.points += s.points;
    }
  };
  if (deck.kind === 'study' || turnOf(deck.root) === deck.side) {
    add(deck.root);
    return out;
  }
  const seen = new Set<string>();
  for (const m of deck.tree.positions[deck.root]?.moves ?? []) {
    if ((deck.scope && !deck.scope.has(m.to)) || seen.has(m.to)) continue;
    seen.add(m.to);
    add(m.to);
  }
  return out;
}

/**
 * Every due card goes to exactly one deck: the only deck it is in, or, for a
 * card several decks share (their trunk), the one of them with the most due
 * cards of its own; its line starts early enough to ask it (`startFor`).
 * Cards in no deck come back apart.
 */
export function assignDue(decks: DeckView[], due: string[]): { byDeck: Map<string, string[]>; none: string[] } {
  const byDeck = new Map<string, string[]>(decks.map((d) => [d.id, []]));
  const shared: Array<{ epd: string; owners: DeckView[] }> = [];
  const none: string[] = [];
  const ours = decks.map((d) => ({ d, set: new Set(d.ours) }));
  for (const epd of due) {
    const owners = ours.filter((o) => o.set.has(epd)).map((o) => o.d);
    if (!owners.length) none.push(epd);
    else if (owners.length === 1) byDeck.get(owners[0]!.id)!.push(epd);
    else shared.push({ epd, owners });
  }
  const own = new Map([...byDeck].map(([id, list]) => [id, list.length]));
  for (const { epd, owners } of shared) {
    let best = owners[0]!;
    for (const o of owners) if ((own.get(o.id) ?? 0) > (own.get(best.id) ?? 0)) best = o;
    byDeck.get(best.id)!.push(epd);
  }
  return { byDeck, none };
}
