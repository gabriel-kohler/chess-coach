// What goes into a session and in what order, from sources already loaded
// (sources.ts). Pure: the same input always gives the same steps.
//
// Treinar splits its time in a cascade: first what is reserved (the endgame
// when it matters, the openings, a floor for tactics), then the due reviews up
// to half the time, then your new mistakes, and new tactics close the time.
// Aquecer: one reminder of your costliest mistake, quick puzzles, one line of
// each color you already know.
import type { SessionItem } from '../tactics/trainer.ts';
import type { Bucket } from '../srs/types.ts';
import type { Color } from '../types.ts';
import { TRAINING } from './config.ts';
import type { OpeningTarget } from './openings.ts';
import type { PlannedStep, PositionRef, StepItem } from './types.ts';

export interface Times {
  best: Record<Bucket, number>;
  seq: Record<Bucket, number>;
  /** Your typical time on a puzzle (thinking only). */
  puzzleMs: number;
  /** Your typical time on a repertoire move (thinking only). */
  repMoveMs: number;
}

const O = TRAINING.overheadMs;

export function positionMs(p: PositionRef, t: Times): number {
  return p.kind === 'best' ? t.best[p.bucket] + O.best : p.steps * (t.seq[p.bucket] + 2 * TRAINING.defaults.opponentMoveMs) + O.seq;
}
export const puzzleMs = (t: Times) => t.puzzleMs + O.puzzle;
export const repLineMs = (t: Times) => TRAINING.defaults.repLineMoves * (t.repMoveMs + TRAINING.defaults.opponentMoveMs) + O.rep;

/** Identity of what a step shows, so a longer session never repeats one. */
export function refOf(item: StepItem): string {
  switch (item.kind) {
    case 'best':
    case 'seq':
      return `card:${item.cardId}`;
    case 'puzzle':
      return `puzzle:${item.item.puzzle.id}`;
    case 'rep':
      // Two decks can share a root (Réti and the rare first moves both start at the start).
      return `rep:${item.side}:${item.line}:${item.key}${item.deckId ? `:${item.deckId}` : ''}`;
    case 'endgame':
      return `endgame:${item.drillId}`;
  }
}

const positionItem = (p: PositionRef): StepItem => ({ kind: p.kind, cardId: p.id, note: p.note });

export interface RepDue {
  side: Color;
  due: number;
  /** The opening deck the positions belong to, and its name; none: the whole color. */
  deckId?: string;
  name?: string;
}

const sideName = (c: Color) => (c === 'white' ? 'brancas' : 'pretas');

function repReviewReason(g: RepDue): string {
  if (!g.name) return `Repertório de ${sideName(g.side)}: a linha passa pelas posições que venceram hoje.`;
  return `${g.name}: ${g.due === 1 ? '1 posição venceu hoje, e a linha passa por ela.' : `${g.due} posições venceram hoje, e a linha passa por elas.`}`;
}

export interface DailyInput {
  now: number;
  budgetMs: number;
  /** Position cards in a learning step due within the look-ahead, earliest first. */
  learning: PositionRef[];
  bestReviews: PositionRef[];
  seqReviews: PositionRef[];
  puzzleReviews: SessionItem[];
  /** Due repertoire positions by opening deck, each card in one deck only; without a deck, the color's rest. */
  repDue: RepDue[];
  /** New position cards, best-move and sequences, by focus priority. */
  news: PositionRef[];
  openings: OpeningTarget[];
  /** New opponent mistakes to punish (already limited to the day's): their own time, after the openings' lines. */
  punish?: SessionItem[];
  endgame: { drillId: string; reason: string } | null;
  /** The puzzle bank loads: tactics get their floor. */
  tacticsAvailable: boolean;
  /** Calibration pending: the tactics block is these 12, whatever the time. */
  placement: SessionItem[] | null;
  /** New puzzles to close the time, ordered (as many as tacticsSlots asked for). */
  tactics: SessionItem[];
  times: Times;
  /** Refs and notes already in the session ("Mais 10 minutos"). */
  exclude?: Set<string>;
  maxNewPerGame: number;
}

interface Allocation {
  review: PlannedStep[];
  mine: PlannedStep[];
  openings: PlannedStep[];
  punish: PlannedStep[];
  endgame: PlannedStep[];
  tacticsMs: number;
  leftover: number;
}

function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

function allocate(i: DailyInput): Allocation {
  const B = i.budgetMs;
  const exclude = i.exclude ?? new Set<string>();
  const usedNotes = new Set<string>([...exclude].filter((x) => x.startsWith('note:')).map((x) => x.slice(5)));
  const fresh = (item: StepItem) => !exclude.has(refOf(item));

  // 1. Reserved: the endgame, the openings (up to their share), a floor for tactics.
  const endgame: PlannedStep[] = [];
  if (i.endgame && fresh({ kind: 'endgame', drillId: i.endgame.drillId })) {
    endgame.push({ block: 'endgame', item: { kind: 'endgame', drillId: i.endgame.drillId }, estMs: TRAINING.endgameMs, reason: i.endgame.reason });
  }
  const endgameMs = endgame.length ? TRAINING.endgameMs : 0;
  const lineMs = repLineMs(i.times);
  const openings: PlannedStep[] = [];
  for (const t of i.openings) {
    if ((openings.length + 1) * lineMs > TRAINING.openingsShare * B) break;
    const item: StepItem = {
      kind: 'rep',
      side: t.side,
      line: t.line,
      key: t.key,
      ...(t.replay ? { replay: t.replay } : {}),
      ...(t.chapterId ? { chapterId: t.chapterId } : {}),
      ...(t.deckId ? { deckId: t.deckId } : {}),
    };
    if (fresh(item)) openings.push({ block: 'openings', item, estMs: lineMs, reason: t.reason });
  }
  // Punishing the opponents' common mistakes: a puzzle's time each, reserved apart, so the lines keep their share.
  const punish: PlannedStep[] = (i.punish ?? [])
    .filter((s) => fresh({ kind: 'puzzle', item: s }))
    .map((s) => ({ block: 'openings', item: { kind: 'puzzle', item: s }, estMs: puzzleMs(i.times), reason: s.reason }));
  const openingsMs = openings.length * lineMs + punish.reduce((s, p) => s + p.estMs, 0);
  const tacticsFloor = i.tacticsAvailable || i.placement ? TRAINING.tacticsMinShare * B : 0;

  // 2. Reviews, up to half the time: learning steps first, then the kinds in turn.
  // A repertoire line per few due positions of an opening deck, the decks in turn.
  const repLines = i.repDue.map((g) =>
    Array.from({ length: Math.ceil(g.due / TRAINING.repPerLine) }, (_, k) => ({
      g,
      positions: Math.min(TRAINING.repPerLine, g.due - k * TRAINING.repPerLine),
      key: `review:${i.now}:${g.deckId ?? g.side}:${k + 1}`,
    })),
  );
  type Candidate = { kind: 'position'; p: PositionRef } | { kind: 'puzzle'; s: SessionItem } | { kind: 'rep'; g: RepDue; positions: number; key: string };
  const candidates: Candidate[] = [
    ...i.learning.map((p): Candidate => ({ kind: 'position', p })),
    ...roundRobin<Candidate>([
      i.bestReviews.map((p) => ({ kind: 'position', p })),
      i.puzzleReviews.map((s) => ({ kind: 'puzzle', s })),
      i.seqReviews.map((p) => ({ kind: 'position', p })),
      roundRobin(repLines).map((l) => ({ kind: 'rep', ...l })),
    ]),
  ];
  const review: PlannedStep[] = [];
  let reviewMs = 0;
  let leftover = 0;
  const reviewCap = TRAINING.reviewShare * B;
  for (const c of candidates) {
    let step: PlannedStep;
    if (c.kind === 'position') {
      // One card per position a day: a best-move card and its sequence never both.
      if (usedNotes.has(c.p.note) || !fresh(positionItem(c.p))) continue;
      step = { block: 'review', item: positionItem(c.p), estMs: positionMs(c.p, i.times), reason: c.p.reason };
    } else if (c.kind === 'puzzle') {
      if (!fresh({ kind: 'puzzle', item: c.s })) continue;
      step = { block: 'review', item: { kind: 'puzzle', item: c.s }, estMs: puzzleMs(i.times), reason: c.s.reason };
    } else {
      step = {
        block: 'review',
        item: { kind: 'rep', side: c.g.side, line: 'review', key: c.key, ...(c.g.deckId ? { deckId: c.g.deckId } : {}) },
        estMs: lineMs,
        reason: repReviewReason(c.g),
      };
    }
    if (reviewMs + step.estMs > reviewCap) {
      leftover += c.kind === 'rep' ? c.positions : 1;
      continue;
    }
    if (c.kind === 'position') usedNotes.add(c.p.note);
    review.push(step);
    reviewMs += step.estMs;
  }

  // 3. Your new mistakes, by focus, in what is left before the reserves.
  const mineCap = Math.max(0, B - endgameMs - openingsMs - tacticsFloor - reviewMs);
  const mine: PlannedStep[] = [];
  let mineMs = 0;
  const perGame = new Map<string, number>();
  for (const p of i.news) {
    if (usedNotes.has(p.note) || !fresh(positionItem(p))) continue;
    const game = p.primaryGameId;
    if (game && (perGame.get(game) ?? 0) >= i.maxNewPerGame) continue;
    const est = positionMs(p, i.times) * TRAINING.newRepeatFactor;
    if (mineMs + est > mineCap) continue;
    usedNotes.add(p.note);
    if (game) perGame.set(game, (perGame.get(game) ?? 0) + 1);
    mine.push({ block: 'mine', item: positionItem(p), estMs: est, reason: p.reason });
    mineMs += est;
  }

  const tacticsMs = Math.max(0, B - endgameMs - openingsMs - reviewMs - mineMs);
  return { review, mine, openings, punish, endgame, tacticsMs, leftover };
}

/** How many new puzzles close the day's time (the loader fetches that many). */
export function tacticsSlots(i: Omit<DailyInput, 'tactics'>): number {
  if (i.placement || !i.tacticsAvailable) return 0;
  return Math.floor(allocate({ ...i, tactics: [] }).tacticsMs / puzzleMs(i.times));
}

export function composeDaily(i: DailyInput): { steps: PlannedStep[]; leftover: number } {
  const a = allocate(i);
  const exclude = i.exclude ?? new Set<string>();
  const pool = (i.placement ?? i.tactics.slice(0, Math.floor(a.tacticsMs / puzzleMs(i.times)))).filter((s) => !exclude.has(`puzzle:${s.puzzle.id}`));
  const tactics: PlannedStep[] = pool.map((s) => ({ block: 'tactics', item: { kind: 'puzzle', item: s }, estMs: puzzleMs(i.times), reason: s.reason }));
  return { steps: [...a.review, ...a.mine, ...tactics, ...a.openings, ...a.punish, ...a.endgame], leftover: a.leftover };
}

export interface WarmupInput {
  budgetMs: number;
  /** Your costliest kind of mistake, one card of it: graded when due, free practice otherwise. */
  reminder: { p: PositionRef; due: boolean } | null;
  puzzles: SessionItem[];
  /** Colors with a repertoire to play a line of. */
  sides: Color[];
  /** Per color, the opening deck you meet most, when one has lines you know: the line stays in it. */
  decks?: Partial<Record<Color, { id: string; name: string }>>;
  times: Times;
}

function warmupFixedMs(i: Omit<WarmupInput, 'puzzles'>): number {
  return (i.reminder ? positionMs(i.reminder.p, i.times) : 0) + i.sides.length * repLineMs(i.times);
}

/** Puzzles that fit the five minutes, between 3 and 6. */
export function warmupSlots(i: Omit<WarmupInput, 'puzzles'>): number {
  const { min, max } = TRAINING.warmupPuzzles;
  const n = Math.floor((i.budgetMs - warmupFixedMs(i)) / puzzleMs(i.times));
  return Math.max(min, Math.min(max, n));
}

export function composeWarmup(i: WarmupInput): PlannedStep[] {
  const steps: PlannedStep[] = [];
  if (i.reminder) {
    steps.push({ block: 'reminder', item: positionItem(i.reminder.p), estMs: positionMs(i.reminder.p, i.times), reason: i.reminder.p.reason, ...(i.reminder.due ? {} : { practice: true }) });
  }
  for (const s of i.puzzles.slice(0, warmupSlots(i))) steps.push({ block: 'tactics', item: { kind: 'puzzle', item: s }, estMs: puzzleMs(i.times), reason: s.reason });
  for (const side of i.sides) {
    const deck = i.decks?.[side];
    steps.push({
      block: 'openings',
      item: { kind: 'rep', side, line: 'warmup', key: side, ...(deck ? { deckId: deck.id } : {}) },
      estMs: repLineMs(i.times),
      reason: deck
        ? `${deck.name}, a abertura de ${sideName(side)} que você mais enfrenta: uma linha que você já treinou, pelo que os seus adversários jogam.`
        : `Uma linha de ${sideName(side)} que você já treinou, pelo que os seus adversários jogam.`,
    });
  }
  return steps;
}
