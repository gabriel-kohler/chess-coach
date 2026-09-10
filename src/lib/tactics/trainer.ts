// The tactics trainer: decides WHICH puzzles you see, in WHAT order, and how
// the results move your rating and your review queue.
//
// A session mixes three sources:
//   1. Reviews: puzzles you failed, back on a spaced schedule (1, 3, 7, 16, 35
//      days) until you solve them first try four times in a row.
//   2. Your own mistakes: positions from your analysed games where you missed
//      a win or blundered, turned into puzzles.
//   3. New puzzles, never below your level: 55% at your level, 35% above,
//      10% well above. The theme is drawn by weight = curriculum importance
//      for your rating x how weak you are in that theme x how long since you
//      saw it x how often the motif shows up in your own mistakes.
// New puzzles move the Glicko-2 rating (global and per theme); reviews do not,
// so repeating a puzzle never inflates the rating.
import { db, getKV, setKV } from '../db.ts';
import { getAccount } from '../chesscom/sync.ts';
import type { GameAnalysis, Glicko, Puzzle, PuzzleCard, StoredGame, TacticsState, ThemeStat } from '../types.ts';
import { motifThemes as lineMotifs } from '../explain/motifs.ts';
import { pickPuzzle } from './bank.ts';
import { decay, update } from './glicko2.ts';
import { coreThemes, importance, MOTIFS } from './themes.ts';

export const TRAINER = {
  sessionSize: 20,
  reviewShare: 0.3,
  mineShare: 0.15,
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
  srsDays: [1, 3, 7, 16, 35],
  masteredAfter: 4,
  /** How much a weak theme pulls the puzzle rating toward the theme's own level. */
  themePull: 0.5,
};

export type SessionMode = 'new' | 'review' | 'mine' | 'placement';

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
    return { ...stored, rating: days > 1 ? decay(stored.rating, days) : stored.rating };
  }
  const rating = await initialRating();
  return {
    rating: { rating, rd: 300, vol: 0.06 },
    themes: {},
    placementDone: false,
    recent: [],
    stretch: 0,
    history: [],
    updatedAt: Date.now(),
  };
}

const saveTactics = (s: TacticsState) => setKV('tactics', { ...s, updatedAt: Date.now() });

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

async function attemptedIds(): Promise<Set<string>> {
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

  const now = Date.now();
  const due = await db.puzzleCards.where('due').belowOrEqual(now).filter((c) => !c.mastered).toArray();
  const isObvious = (c: PuzzleCard) => (c.puzzle.tags ?? []).some((t) => t === 'obvious-miss' || t === 'obvious-blunder');
  const mineFresh = due
    .filter((c) => c.puzzle.source === 'mine' && c.reps === 0 && c.lapses === 0)
    .sort((a, b) => Number(isObvious(b)) - Number(isObvious(a)) || b.createdAt - a.createdAt);
  const reviews = due.filter((c) => !mineFresh.includes(c)).sort((a, b) => a.due - b.due);

  const items: SessionItem[] = [];
  for (const c of reviews.slice(0, Math.round(size * TRAINER.reviewShare))) {
    items.push({ puzzle: c.puzzle, mode: c.puzzle.source === 'mine' ? 'mine' : 'review', reason: reviewReason(c) });
  }
  for (const c of mineFresh.slice(0, Math.round(size * TRAINER.mineShare))) {
    items.push({ puzzle: c.puzzle, mode: 'mine', reason: c.puzzle.note ?? 'Erro de uma partida sua' });
  }

  const gameMotifs = await getKV<Record<string, number>>('gameMotifs', {});
  const weights = themeWeights(state, gameMotifs);
  const perTheme = new Map<string, number>();
  const maxPerTheme = Math.max(2, Math.ceil(size / 5));
  while (items.length < size) {
    const avoid = new Set([...perTheme.entries()].filter(([, n]) => n >= maxPerTheme).map(([t]) => t));
    const theme = weightedPick(weights, avoid);
    const band = pickBand();
    const base = R + TRAINER.themePull * (Math.min(R, themeRating(state, theme)) - R);
    const offset = band.from + Math.random() * (band.to - band.from) + state.stretch;
    const target = Math.round(Math.max(base + offset, R - 100));
    const puzzle = await pickPuzzle({ target, theme, exclude });
    if (!puzzle) {
      weights[theme] = 0;
      if (Object.values(weights).every((w) => w === 0)) break;
      continue;
    }
    exclude.add(puzzle.id);
    perTheme.set(theme, (perTheme.get(theme) ?? 0) + 1);
    items.push({ puzzle, mode: 'new', theme, band: band.key, reason: band.label });
  }
  return orderSession(items);
}

function reviewReason(c: PuzzleCard): string {
  const d = new Date(c.lastAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return c.puzzle.source === 'mine' ? `Revisão de erro seu (${d})` : `Revisão: você errou em ${d}`;
}

/**
 * Interleaves themes, opens with something familiar and ends on an item you
 * are likely to solve, so a session never finishes on a failure streak.
 */
function orderSession(items: SessionItem[]): SessionItem[] {
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
}

function motifThemes(p: Puzzle): string[] {
  return p.themes.filter((t) => MOTIFS.includes(t));
}

export async function recordAttempt(item: SessionItem, result: AttemptResult): Promise<AttemptOutcome> {
  const state = await loadTactics();
  const before = state.rating.rating;
  const rated = item.mode === 'new' || item.mode === 'placement';
  const score = result.solved ? 1 : 0;

  if (rated) {
    state.rating = update(state.rating, item.puzzle.rating, score);
    for (const theme of motifThemes(item.puzzle)) {
      const prev: ThemeStat = state.themes[theme] ?? { rating: before, rd: 250, vol: 0.06, attempts: 0, solved: 0, lastAt: 0 };
      const g: Glicko = update(prev, item.puzzle.rating, score);
      state.themes[theme] = { ...g, attempts: prev.attempts + 1, solved: prev.solved + score, lastAt: Date.now() };
    }
    if (item.mode === 'new') {
      state.recent = [...state.recent, result.solved].slice(-30);
      adjustStretch(state);
    }
    if (item.mode === 'placement') {
      const placements = await db.attempts.where('mode').equals('placement').count();
      if (placements + 1 >= TRAINER.placementCount) state.placementDone = true;
    }
    const day = today();
    const last = state.history[state.history.length - 1];
    if (last?.day === day) last.rating = state.rating.rating;
    else state.history.push({ day, rating: state.rating.rating });
  }

  await db.attempts.add({
    puzzleId: item.puzzle.id,
    source: item.puzzle.source,
    at: Date.now(),
    solved: result.solved,
    timeMs: result.timeMs,
    puzzleRating: item.puzzle.rating,
    ratingBefore: before,
    ratingAfter: state.rating.rating,
    themes: item.puzzle.themes,
    mode: item.mode,
  });
  await scheduleCard(item.puzzle, result.solved, item.mode);
  await saveTactics(state);
  return { before, after: state.rating.rating, state };
}

/** Keeps the success rate on new puzzles inside the target window. */
function adjustStretch(state: TacticsState) {
  if (state.recent.length < 10) return;
  const rate = state.recent.filter(Boolean).length / state.recent.length;
  const [lo, hi] = TRAINER.successWindow;
  const [min, max] = TRAINER.stretchBounds;
  if (rate < lo) state.stretch = Math.max(min, state.stretch - TRAINER.stretchStep);
  else if (rate > hi) state.stretch = Math.min(max, state.stretch + TRAINER.stretchStep);
}

async function scheduleCard(puzzle: Puzzle, solved: boolean, mode: SessionMode) {
  const now = Date.now();
  const card = await db.puzzleCards.get(puzzle.id);
  if (!card) {
    if (solved && mode !== 'mine') return; // solved new puzzles need no review
    await db.puzzleCards.put({
      id: puzzle.id,
      puzzle,
      due: now + DAY,
      interval: 1,
      reps: solved ? 1 : 0,
      lapses: solved ? 0 : 1,
      createdAt: now,
      lastAt: now,
      mastered: false,
    });
    return;
  }
  if (solved) {
    const reps = card.reps + 1;
    const interval = TRAINER.srsDays[Math.min(reps, TRAINER.srsDays.length - 1)]!;
    await db.puzzleCards.put({ ...card, reps, interval, due: now + interval * DAY, lastAt: now, mastered: reps >= TRAINER.masteredAfter });
  } else {
    await db.puzzleCards.put({ ...card, reps: 0, lapses: card.lapses + 1, interval: 1, due: now + DAY, lastAt: now, mastered: false });
  }
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

// ------------------------------------------------------- own-game mistakes

/**
 * Turns your mistakes in an analysed game into puzzles, in the Lichess format:
 * the opponent's previous move is the setup, your best reply is the solution.
 */
export async function addMistakePuzzles(game: StoredGame, analysis: GameAnalysis): Promise<number> {
  let added = 0;
  for (let i = 1; i < analysis.moves.length; i++) {
    const m = analysis.moves[i]!;
    const prev = analysis.moves[i - 1]!;
    if (m.color !== game.userColor) continue;
    if (!['mistake', 'blunder', 'miss'].includes(m.classification) || !m.bestUci) continue;
    const bestLine = analysis.evals[i]?.lines[0];
    const moverSign = m.color === 'white' ? 1 : -1;
    const mateForMover = bestLine?.mate !== undefined && moverSign * bestLine.mate > 0;
    const bestCp = mateForMover ? 10000 : moverSign * (bestLine?.cp ?? 0);
    const obviousMiss = !!m.tags?.includes('obvious-miss');
    const obviousBlunder = !!m.tags?.includes('obvious-blunder');
    // Something concrete to find, or a cheap blunder to learn to avoid.
    if (bestCp < 150 && !obviousBlunder) continue;
    const id = `g:${game.id}:${m.ply}`;
    if (await db.puzzleCards.get(id)) continue;
    const opp = game.oppName;
    const when = new Date(game.endTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const note = obviousMiss
      ? `Lance óbvio que você perdeu, contra ${opp} (${when}): você jogou ${m.san}`
      : obviousBlunder && bestCp < 150
        ? `Contra ${opp} (${when}) você jogou ${m.san} e entregou material. Ache um lance seguro`
        : `Sua partida contra ${opp} (${when}): você jogou ${m.san}`;
    const puzzle: Puzzle = {
      id,
      source: 'mine',
      fen: prev.fenBefore,
      moves: [prev.uci, m.bestUci],
      rating: Math.round(game.userRating + 250),
      themes: detectMotifs(m.fenBefore, bestLine?.pv ?? [m.bestUci], bestLine),
      gameId: game.id,
      ply: m.ply,
      note,
      tags: m.tags,
    };
    await db.puzzleCards.put({ id, puzzle, due: Date.now(), interval: 0, reps: 0, lapses: 0, createdAt: Date.now(), lastAt: Date.now(), mastered: false });
    added++;
  }
  return added;
}

// ------------------------------------------------------------ motif detector

/** Theme keys of the first move of a line (see explain/motifs.ts). */
export function detectMotifs(fen: string, pv: string[], score?: { mate?: number }): string[] {
  return pv[0] ? lineMotifs(fen, pv[0], score?.mate) : [];
}

/** Recomputes how often each motif appears in your analysed mistakes. */
export async function refreshGameMotifs(): Promise<Record<string, number>> {
  const cards = await db.puzzleCards.toArray();
  const counts: Record<string, number> = {};
  for (const c of cards) {
    if (c.puzzle.source !== 'mine') continue;
    for (const t of c.puzzle.themes) counts[t] = (counts[t] ?? 0) + 1;
  }
  await setKV('gameMotifs', counts);
  return counts;
}
