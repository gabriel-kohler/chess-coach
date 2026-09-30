// The tactics trainer: decides WHICH puzzles you see, in WHAT order, and how
// the results move your rating and your review queue. Tactics is the Lichess
// base: patterns by theme and the climb in level. Positions from your own
// games live in Posições.
//
// A session mixes two sources:
//   1. Reviews: puzzles you failed, back when FSRS predicts your recall has
//      dropped to 90%. A miss comes back the next day, and the interval grows
//      with each right answer, at the pace of your memory.
//   2. New puzzles, never below your level: 55% at your level, 35% above,
//      10% well above. The theme is drawn by weight = curriculum importance
//      for your rating x how weak you are in that theme x how long since you
//      saw it x how often the motif decides the positions you got wrong in
//      your games.
// New puzzles move the Glicko-2 rating (global and per theme); reviews do not,
// so repeating a puzzle never inflates the rating. Nor do the warm-up puzzles
// before games: shorter and a little below your level on purpose.
//
// Cálculo is a session of its own: ChessTempo's kind of problem out of the
// Lichess base. Puzzles from games with a titled player, three moves or more
// of yours, drawn by rating alone: no theme, nothing said about what to look
// for, and the puzzle's rating only once it is over. It moves its own Glicko
// rating, not the tactics one: the puzzles differ in kind, and a rating is a
// measure against one population. A miss joins the same review queue and
// comes back here or in the daily session, whichever opens first.
import type { Grade } from 'ts-fsrs';
import { db, getKV, setKV } from '../db.ts';
import { getAccount } from '../chesscom/sync.ts';
import type { CalcState, Glicko, Puzzle, PuzzleAttempt, PuzzleSrsCard, TacticsState, ThemeStat } from '../types.ts';
import { motifThemes as lineMotifs } from '../explain/motifs.ts';
import { gradeAttempt } from '../positions/grade.ts';
import { loadExpectedTimes, recordReview } from '../positions/store.ts';
import { attemptIdFor, newPuzzleCard, puzzleCardId, yourMoves } from '../srs/cards.ts';
import { ruleFor } from '../srs/fsrs.ts';
import type { Bucket, FsrsFields } from '../srs/types.ts';
import { pickPuzzle } from './bank.ts';
import { GAME_MOTIFS_KEY } from './gameMotifs.ts';
import { decay, update } from './glicko2.ts';
import { coreThemes, importance, MOTIFS } from './themes.ts';

export const TRAINER = {
  sessionSize: 20,
  reviewShare: 0.3,
  /** Offsets from your rating for new puzzles. Nothing is served below your level. */
  bands: [
    { key: 'level', label: 'no seu nível', weight: 0.55, from: -25, to: 75 },
    { key: 'above', label: 'acima do seu nível', weight: 0.35, from: 75, to: 200 },
    { key: 'stretch', label: 'desafio', weight: 0.1, from: 200, to: 350 },
  ],
  /** The controller keeps success on new puzzles inside this window. */
  successWindow: [0.38, 0.62] as [number, number],
  stretchStep: 25,
  stretchBounds: [-100, 150] as [number, number],
  placementCount: 12,
  /** Mastered: FSRS gives the puzzle more than a month of memory. */
  masteredStability: 30,
  /** How much a weak theme pulls the puzzle rating toward the theme's own level. */
  themePull: 0.5,
  /** Before games: quick patterns you should see at once, for speed and confidence. */
  warmup: { offset: -150, spread: 50, maxMoves: 2 },
};

export const CALC = {
  /** Half the daily session at most: each puzzle is a calculation. */
  sessionSize: 10,
  minMoves: 3,
  /** Lichess tags of games with a titled player. */
  sources: ['master', 'masterVsMaster', 'superGM'],
  /** A new Cálculo rating starts at the tactics rating, at least this unsure: it settles in a dozen puzzles. */
  initialRd: 200,
};

/** A Cálculo puzzle: from a titled player's game, three moves or more to find. */
/** Whether an attempt is part of the day's tactics session (the Home plan and Tática agree on it). */
export function countsAsDailyTactics(a: Pick<PuzzleAttempt, 'mode'>): boolean {
  return a.mode !== 'mine' && a.mode !== 'warmup' && a.mode !== 'punish' && a.mode !== 'calc';
}

export function isCalcPuzzle(p: Puzzle): boolean {
  return yourMoves(p) >= CALC.minMoves && p.themes.some((t) => CALC.sources.includes(t));
}

/** punish: a new exercise of Aberturas > Punir; unrated, and its card is made even when solved. calc: Tática > Cálculo, rated on its own rating. */
export type SessionMode = 'new' | 'review' | 'placement' | 'warmup' | 'punish' | 'calc';

export interface SessionItem {
  puzzle: Puzzle;
  mode: SessionMode;
  theme?: string;
  band?: string;
  reason: string;
}

const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

async function initialRating(): Promise<number> {
  // chess.com puzzle ratings sit a little below the Lichess scale.
  const account = await getAccount();
  const cc = account?.stats.tactics?.highest?.rating;
  if (cc && cc > 400) return Math.round(cc + 100);
  const rapid = account?.stats.chess_rapid?.last?.rating;
  if (rapid) return Math.round(rapid + 250);
  return 1500;
}

export async function loadTactics(): Promise<TacticsState> {
  const stored = await getKV<TacticsState | null>('tactics', null);
  if (stored) {
    const days = (Date.now() - stored.updatedAt) / DAY;
    const aged = (g: Glicko) => (days > 1 ? decay(g, days) : g);
    const calc = calcOf(stored);
    return { ...stored, rating: aged(stored.rating), calc: { ...calc, rating: aged(calc.rating) } };
  }
  const rating: Glicko = { rating: await initialRating(), rd: 300, vol: 0.06 };
  return {
    rating,
    themes: {},
    placementDone: false,
    recent: [],
    stretch: 0,
    history: [],
    calc: newCalc(rating),
    updatedAt: Date.now(),
  };
}

const saveTactics = (s: TacticsState) => setKV('tactics', { ...s, updatedAt: Date.now() });

/** Cálculo starts where the tactics rating is: the same scale, a different kind of puzzle. */
function newCalc(rating: Glicko): CalcState {
  return { rating: { rating: rating.rating, rd: Math.max(CALC.initialRd, rating.rd), vol: 0.06 }, recent: [], stretch: 0, history: [] };
}

/** The Cálculo side of the state; a fresh one for a state saved before it. */
export const calcOf = (state: TacticsState): CalcState => state.calc ?? newCalc(state.rating);

/** A theme's rating, shrunk toward the global rating while there is little data. */
export function themeRating(state: TacticsState, theme: string): number {
  const t = state.themes[theme];
  if (!t || t.attempts === 0) return state.rating.rating;
  const k = 6;
  return (t.attempts * t.rating + k * state.rating.rating) / (t.attempts + k);
}

export function themeWeights(state: TacticsState, gameMotifs: Record<string, number> = {}): Record<string, number> {
  const R = state.rating.rating;
  const totalMotifs = Object.values(gameMotifs).reduce((a, b) => a + b, 0) || 1;
  const weights: Record<string, number> = {};
  for (const theme of MOTIFS) {
    const base = importance(theme, R);
    const weakness = Math.min(2.5, Math.max(0.6, Math.exp((R - themeRating(state, theme)) / 250)));
    const last = state.themes[theme]?.lastAt ?? 0;
    const days = last ? (Date.now() - last) / DAY : 14;
    const freshness = 1 + Math.min(1, days / 7) * 0.5;
    const fromGames = 1 + 2 * ((gameMotifs[theme] ?? 0) / totalMotifs);
    weights[theme] = base * weakness * freshness * fromGames;
  }
  return weights;
}

function weightedPick<T extends string>(weights: Record<T, number>, avoid: Set<string>): T {
  const entries = (Object.entries(weights) as Array<[T, number]>).filter(([k, w]) => w > 0 && !avoid.has(k));
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1]![0];
}

function pickBand() {
  let r = Math.random();
  for (const b of TRAINER.bands) {
    r -= b.weight;
    if (r <= 0) return b;
  }
  return TRAINER.bands[0]!;
}

/** Every puzzle you ever attempted: new puzzles are never repeats. */
export async function attemptedIds(): Promise<Set<string>> {
  const ids = await db.attempts.orderBy('puzzleId').uniqueKeys();
  return new Set(ids.map(String));
}

export async function buildSession(state: TacticsState, size = TRAINER.sessionSize): Promise<SessionItem[]> {
  const exclude = await attemptedIds();
  const R = state.rating.rating;

  if (!state.placementDone) {
    // Calibration: puzzles at the current estimate, varied motifs. With a high
    // RD, Glicko moves fast and settles in about a dozen puzzles.
    const items: SessionItem[] = [];
    const used = new Set<string>();
    for (let i = 0; i < TRAINER.placementCount; i++) {
      const theme = weightedPick(Object.fromEntries(MOTIFS.map((t) => [t, importance(t, R)])), used);
      used.add(theme);
      const puzzle = await pickPuzzle({ target: R, theme, exclude });
      if (!puzzle) continue;
      exclude.add(puzzle.id);
      items.push({ puzzle, mode: 'placement', theme, reason: 'Calibração do seu nível' });
    }
    return items;
  }

  const reviews = await duePuzzles();
  const items: SessionItem[] = [];
  for (const c of reviews.slice(0, Math.round(size * TRAINER.reviewShare))) {
    items.push({ puzzle: c.puzzle, mode: 'review', reason: reviewReason(c) });
  }
  items.push(...(await newPuzzles(state, size - items.length, exclude, { perThemeOf: size })));
  return orderSession(items);
}

/**
 * New puzzles, the theme drawn by weight. `new`: in the rating bands above.
 * `warmup`: short ones a little below your level, for before a game. Picked
 * puzzles join `exclude`, so calls in a row never repeat one.
 */
export async function newPuzzles(
  state: TacticsState,
  count: number,
  exclude: Set<string>,
  opts: { mode?: 'new' | 'warmup'; perThemeOf?: number } = {},
): Promise<SessionItem[]> {
  const mode = opts.mode ?? 'new';
  const R = state.rating.rating;
  const gameMotifs = await getKV<Record<string, number>>(GAME_MOTIFS_KEY, {});
  const weights = themeWeights(state, gameMotifs);
  const perTheme = new Map<string, number>();
  const maxPerTheme = Math.max(2, Math.ceil((opts.perThemeOf ?? count) / 5));
  const items: SessionItem[] = [];
  while (items.length < count) {
    const avoid = new Set([...perTheme.entries()].filter(([, n]) => n >= maxPerTheme).map(([t]) => t));
    if (Object.entries(weights).every(([t, w]) => w === 0 || avoid.has(t))) break;
    const theme = weightedPick(weights, avoid);
    let target: number;
    let band: (typeof TRAINER.bands)[number] | null = null;
    if (mode === 'warmup') {
      const w = TRAINER.warmup;
      target = Math.round(R + w.offset + (Math.random() * 2 - 1) * w.spread);
    } else {
      band = pickBand();
      const base = R + TRAINER.themePull * (Math.min(R, themeRating(state, theme)) - R);
      const offset = band.from + Math.random() * (band.to - band.from) + state.stretch;
      target = Math.round(Math.max(base + offset, R - 100));
    }
    const puzzle = await pickPuzzle({ target, theme, exclude, ...(mode === 'warmup' ? { maxMoves: TRAINER.warmup.maxMoves } : {}) });
    if (!puzzle) {
      weights[theme] = 0;
      continue;
    }
    exclude.add(puzzle.id);
    perTheme.set(theme, (perTheme.get(theme) ?? 0) + 1);
    items.push(band ? { puzzle, mode: 'new', theme, band: band.key, reason: band.label } : { puzzle, mode: 'warmup', theme, reason: 'aquecimento' });
  }
  return items;
}

/**
 * A Cálculo session: the long puzzles you failed that are due, then new ones
 * by rating alone, in the same bands as the daily session but against the
 * Cálculo rating. When the bank runs out of titled players' puzzles near the
 * target, long puzzles from any game fill in.
 */
export async function buildCalcSession(state: TacticsState, size = CALC.sessionSize): Promise<SessionItem[]> {
  const exclude = await attemptedIds();
  const calc = calcOf(state);
  const R = calc.rating.rating;
  const items: SessionItem[] = [];
  const reviews = (await duePuzzles()).filter((c) => isCalcPuzzle(c.puzzle));
  for (const c of reviews.slice(0, Math.round(size * TRAINER.reviewShare))) items.push({ puzzle: c.puzzle, mode: 'review', reason: reviewReason(c) });
  const filters: Array<(p: Puzzle) => boolean> = [isCalcPuzzle, (p) => yourMoves(p) >= CALC.minMoves];
  while (items.length < size) {
    const band = pickBand();
    const target = Math.round(R + band.from + Math.random() * (band.to - band.from) + calc.stretch);
    let puzzle: Puzzle | null = null;
    for (const where of filters) {
      puzzle = await pickPuzzle({ target, exclude, where });
      if (puzzle) break;
    }
    if (!puzzle) break;
    exclude.add(puzzle.id);
    items.push({ puzzle, mode: 'calc', band: band.key, reason: band.label });
  }
  return orderSession(items);
}

/** Failed puzzles due now, the most overdue first. */
export async function duePuzzles(now = Date.now()): Promise<PuzzleSrsCard[]> {
  const cards = (await db.srsCards.where('kind').equals('puzzle').filter((c) => !c.suspended && c.due <= now).toArray()) as PuzzleSrsCard[];
  return cards.sort((a, b) => a.due - b.due);
}

export const isMastered = (c: FsrsFields) => c.stability >= TRAINER.masteredStability;

export function reviewReason(c: PuzzleSrsCard): string {
  const d = new Date(c.last_review ?? c.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (c.puzzle.source === 'opening') return `${c.puzzle.note ?? 'Abertura'}: você errou este lance em ${d}.`;
  // The note says the deck, the mistake and how often people at your level make it.
  if (c.puzzle.source === 'punish') return `${c.puzzle.note ?? 'Punir'} Você viu em ${d}.`;
  return `Você viu este puzzle em ${d}.`;
}

/**
 * Interleaves themes, opens with something familiar and ends on an item you
 * are likely to solve, so a session never finishes on a failure streak.
 */
export function orderSession(items: SessionItem[]): SessionItem[] {
  const easy = items.filter((i) => i.mode === 'review' || i.band === 'level');
  const rest = items.filter((i) => !easy.includes(i));
  const shuffled = [...rest].sort(() => Math.random() - 0.5);
  const first = easy.shift();
  const last = easy.pop();
  const middle = [...easy, ...shuffled].sort(() => Math.random() - 0.5);
  // Spread identical themes apart.
  for (let i = 1; i < middle.length; i++) {
    if (middle[i]!.theme && middle[i]!.theme === middle[i - 1]!.theme) {
      const j = middle.findIndex((x, k) => k > i && x.theme !== middle[i]!.theme);
      if (j > 0) [middle[i], middle[j]] = [middle[j]!, middle[i]!];
    }
  }
  return [first, ...middle, last].filter((x): x is SessionItem => !!x);
}

export interface AttemptResult {
  solved: boolean;
  timeMs: number;
}

export interface AttemptOutcome {
  before: number;
  after: number;
  state: TacticsState;
  /** The review grade and when the puzzle comes back, when it is (or joins) your review queue. */
  review: { rating: Grade; due: number } | null;
}

function motifThemes(p: Puzzle): string[] {
  return p.themes.filter((t) => MOTIFS.includes(t));
}

/**
 * Records a first result. With `attemptId` (a training session's step) the
 * review side is idempotent: saving the same step twice schedules it once.
 */
export async function recordAttempt(item: SessionItem, result: AttemptResult, opts: { attemptId?: string } = {}): Promise<AttemptOutcome> {
  const state = await loadTactics();
  const calc = calcOf(state);
  state.calc = calc;
  const track = () => (item.mode === 'calc' ? calc.rating : state.rating);
  const before = track().rating;
  const rated = item.mode === 'new' || item.mode === 'placement';
  const score = result.solved ? 1 : 0;

  if (item.mode === 'calc') {
    calc.rating = update(calc.rating, item.puzzle.rating, score);
    calc.recent = [...calc.recent, result.solved].slice(-30);
    calc.stretch = nextStretch(calc.recent, calc.stretch);
    noteRating(calc.history, calc.rating.rating);
  }

  if (rated) {
    state.rating = update(state.rating, item.puzzle.rating, score);
    for (const theme of motifThemes(item.puzzle)) {
      const prev: ThemeStat = state.themes[theme] ?? { rating: before, rd: 250, vol: 0.06, attempts: 0, solved: 0, lastAt: 0 };
      const g: Glicko = update(prev, item.puzzle.rating, score);
      state.themes[theme] = { ...g, attempts: prev.attempts + 1, solved: prev.solved + score, lastAt: Date.now() };
    }
    if (item.mode === 'new') {
      state.recent = [...state.recent, result.solved].slice(-30);
      state.stretch = nextStretch(state.recent, state.stretch);
    }
    if (item.mode === 'placement') {
      const placements = await db.attempts.where('mode').equals('placement').count();
      if (placements + 1 >= TRAINER.placementCount) state.placementDone = true;
    }
    noteRating(state.history, state.rating.rating);
  }

  const after = track().rating;
  await db.attempts.add({
    puzzleId: item.puzzle.id,
    source: item.puzzle.source,
    at: Date.now(),
    solved: result.solved,
    timeMs: result.timeMs,
    puzzleRating: item.puzzle.rating,
    ratingBefore: before,
    ratingAfter: after,
    themes: item.puzzle.themes,
    mode: item.mode,
  });
  const review = await scheduleCard(item.puzzle, result, Date.now(), opts.attemptId);
  await saveTactics(state);
  return { before, after, state, review };
}

/** The difficulty shift that keeps the success rate on new puzzles inside the target window. */
function nextStretch(recent: boolean[], stretch: number): number {
  if (recent.length < 10) return stretch;
  const rate = recent.filter(Boolean).length / recent.length;
  const [lo, hi] = TRAINER.successWindow;
  const [min, max] = TRAINER.stretchBounds;
  if (rate < lo) return Math.max(min, stretch - TRAINER.stretchStep);
  if (rate > hi) return Math.min(max, stretch + TRAINER.stretchStep);
  return stretch;
}

/** One point per day with activity: today's is updated. */
function noteRating(history: Array<{ day: string; rating: number }>, rating: number) {
  const day = today();
  const last = history[history.length - 1];
  if (last?.day === day) last.rating = rating;
  else history.push({ day, rating });
}

/** Expected time by how many moves you have to find. */
export function puzzleBucket(p: Puzzle): Bucket {
  const n = yourMoves(p);
  return n <= 1 ? 'easy' : n === 2 ? 'medium' : 'hard';
}

/**
 * A failed puzzle joins the FSRS queue; one already there is graded like a
 * position: a miss (or hint, or solution) is Again, a first-try solve is
 * Hard, Good or Easy by your time. A solved new puzzle needs no review.
 */
async function scheduleCard(puzzle: Puzzle, result: AttemptResult, now = Date.now(), attemptId?: string): Promise<AttemptOutcome['review']> {
  const cardId = puzzleCardId(puzzle.id);
  // A Lichess puzzle solved at once has shown what it tests. Punishing an opening mistake is repertoire: it comes back.
  if (result.solved && puzzle.source !== 'punish' && !(await db.srsCards.get(cardId))) return null;
  const bucket = puzzleBucket(puzzle);
  const expectedMs = (await loadExpectedTimes('puzzle'))[bucket];
  const s = result.solved;
  const signals = { uci: null, loss: s ? 0 : null, lossSource: null, exact: s, correct: s, timeMs: result.timeMs, hiddenMs: 0, expectedMs, bucket, gaveUp: false };
  const rating = gradeAttempt(signals, expectedMs, ruleFor('puzzle'));
  const { next } = await recordReview({ attemptId: attemptId ?? attemptIdFor(cardId), cardId, at: now, grade: rating, signals, create: newPuzzleCard(puzzle, now) });
  return { rating, due: next.due };
}

// ------------------------------------------------------------------ progress

export interface LevelProgress {
  current: number;
  next: number;
  pct: number;
  checklist: Array<{ theme: string; rating: number; ok: boolean }>;
  ready: boolean;
}

/** Next 100-point milestone and the motifs that must keep up with it. */
export function levelProgress(state: TacticsState): LevelProgress {
  const R = state.rating.rating;
  const current = Math.floor(R / 100) * 100;
  const next = current + 100;
  const checklist = coreThemes(next).map((theme) => {
    const rating = themeRating(state, theme);
    return { theme, rating, ok: rating >= next - 150 };
  });
  return {
    current,
    next,
    pct: Math.max(0, Math.min(1, (R - current) / 100)),
    checklist,
    ready: R >= next && state.rating.rd < 90 && checklist.every((c) => c.ok),
  };
}

// ------------------------------------------------------------ motif detector

/** Theme keys of the first move of a line (see explain/motifs.ts). */
export function detectMotifs(fen: string, pv: string[], score?: { mate?: number }): string[] {
  return pv[0] ? lineMotifs(fen, pv[0], score?.mate) : [];
}
