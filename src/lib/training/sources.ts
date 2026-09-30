// Gathers what a session is made of: each source on its own, so a missing
// one (no puzzle bank, no repertoire, no analysed game) takes its block out
// and the time goes to the next one, instead of failing the whole session.
import { State } from 'ts-fsrs';
import { db, getKV } from '../db.ts';
import { ENDGAMES, type EndgameRecord } from '../endgames.ts';
import { POSITIONS } from '../positions/config.ts';
import { FOCUS_LABEL, priorityOf } from '../positions/focus.ts';
import { median } from '../positions/grade.ts';
import { loadPositionsSettings } from '../positions/settings.ts';
import { FOCUS_KEY, loadDailyQueue, loadExpectedTimes } from '../positions/store.ts';
import type { BestMoveCard, FocusCategory, FocusWeights, SequenceCard } from '../positions/types.ts';
import { assignDue, deckStats, repertoireDecks, studyDeckView, type DeckView } from '../decks/views.ts';
import { loadLevel } from '../openings/level.ts';
import { ownersOf, type PunishItem } from '../punish/find.ts';
import { newPunishItem, pickDaily } from '../punish/select.ts';
import { loadScanState, punishCards } from '../punish/store.ts';
import { localDay } from '../srs/queue.ts';
import { cardsFor, dueInRepertoire, repertoireExpectedMs } from '../repertoire/drill.ts';
import type { CompiledRepertoire } from '../repertoire/data.ts';
import type { GamesIndex } from '../repertoire/games.ts';
import { loadOpeningsData, type OpeningsData } from '../repertoire/openingsData.ts';
import { loadIndex } from '../tactics/bank.ts';
import { attemptedIds, buildSession, duePuzzles, loadTactics, newPuzzles, orderSession, reviewReason, type SessionItem } from '../tactics/trainer.ts';
import type { Color, PuzzleSrsCard, RepCard, StoredGame } from '../types.ts';
import { composeDaily, composeWarmup, tacticsSlots, warmupSlots, type RepDue, type Times } from './compose.ts';
import { TRAINING } from './config.ts';
import { pickEndgame } from './endgame.ts';
import { openingTargets } from './openings.ts';
import type { PlannedStep, PositionRef } from './types.ts';

type PositionCard = BestMoveCard | SequenceCard;

/** What a position teaches, said in the reason: the focus it belongs to that weighs most. */
const TOLD: FocusCategory[] = ['convert', 'defend', 'fast', 'lowClock', 'endgame', 'opening', 'miss'];

/** The position's own panel says which game it came from; the reason says why it is here. */
export function positionRef(c: PositionCard, weights: FocusWeights | null, label: string): PositionRef {
  const focus = TOLD.filter((k) => c.categories.includes(k)).sort((a, b) => (weights?.shares[b]?.share ?? 0) - (weights?.shares[a]?.share ?? 0))[0];
  return {
    id: c.id,
    kind: c.kind,
    note: c.note,
    primaryGameId: c.primaryGameId,
    bucket: c.bucket,
    steps: c.kind === 'seq' ? 1 + c.branch.nodes.length : 1,
    priority: priorityOf(c, weights),
    reason: `${label}.${focus ? ` Foco: ${FOCUS_LABEL[focus].toLowerCase()}.` : ''}`,
  };
}

const learningLabel = (c: PositionCard) => (c.state === State.Relearning ? 'Reaprendendo' : 'Aprendendo');
const kindLabel = (c: PositionCard, what: string) => `${what}${c.kind === 'seq' ? ' (sequência)' : ''}`;

function puzzleReview(c: PuzzleSrsCard): SessionItem {
  return { puzzle: c.puzzle, mode: 'review', reason: `Revisão. ${reviewReason(c)}` };
}

export async function loadTimes(): Promise<Times> {
  const [best, repMoveMs, recent] = await Promise.all([loadExpectedTimes('best'), repertoireExpectedMs(), db.attempts.orderBy('at').reverse().limit(200).toArray()]);
  // One move to punish an opening mistake is not a puzzle's time.
  const took = recent.filter((a) => a.mode !== 'punish').map((a) => a.timeMs).filter((t) => t > 0 && t < 5 * 60_000);
  // A run of solutions asked for at once would make every puzzle look instant.
  const [lo, hi] = TRAINING.puzzleMsClamp;
  const puzzleMs = took.length >= 10 ? Math.min(hi, Math.max(lo, median(took))) : TRAINING.defaults.puzzleMs;
  // Sequences are timed per move against the best-move times, as in Posições.
  return { best, seq: best, puzzleMs, repMoveMs };
}

async function tryLoad<T>(load: () => Promise<T>, note: string, notes: string[]): Promise<T | null> {
  try {
    return await load();
  } catch (e) {
    console.warn('training source:', e);
    notes.push(note);
    return null;
  }
}

interface Openings {
  rep: CompiledRepertoire;
  data: OpeningsData;
  games: StoredGame[];
}

/** Your decks built from any opening that have positions. */
export async function loadStudyDecks(): Promise<DeckView[]> {
  return (await db.decks.toArray()).filter((d) => Object.keys(d.positions).length).map(studyDeckView);
}

/**
 * Due repertoire positions by opening deck, each card in one deck only (a
 * trunk card goes with the deck that has the most due cards); a card in no
 * deck stays with its color. The decks you built from any opening have their own.
 */
export async function repDue(rep: CompiledRepertoire | null, study: DeckView[], now: number): Promise<RepDue[]> {
  const out: RepDue[] = [];
  if (rep) {
    for (const side of ['white', 'black'] as const) {
      const decks = repertoireDecks(rep.sides[side]);
      const due = dueInRepertoire(rep.sides[side], await cardsFor(side), now).map((c) => c.epd);
      const { byDeck, none } = assignDue(decks, due);
      for (const d of decks) {
        const n = byDeck.get(d.id)?.length ?? 0;
        if (n) out.push({ side, due: n, deckId: d.id, name: d.name });
      }
      if (none.length) out.push({ side, due: none.length });
    }
  }
  for (const d of study) {
    const n = dueInRepertoire(d.tree, await cardsFor(d.ns), now).length;
    if (n) out.push({ side: d.side, due: n, deckId: d.id, name: d.name });
  }
  return out;
}

export async function loadDaily(now: number, budgetMs: number, exclude?: Set<string>): Promise<{ steps: PlannedStep[]; leftover: number; notes: string[] }> {
  const notes: string[] = [];
  const settings = await loadPositionsSettings();
  const [bestQ, seqQ, weights, times, dueP, records] = await Promise.all([
    loadDailyQueue('best', settings, now, 0),
    loadDailyQueue('seq', settings, now, 0),
    getKV<FocusWeights | null>(FOCUS_KEY, null),
    loadTimes(),
    duePuzzles(now),
    getKV<Record<string, EndgameRecord>>('endgames', {}),
  ]);
  const openings = (await tryLoad<Openings | null>(loadOpeningsData, 'Não consegui ler o repertório: a sessão vai sem aberturas.', notes)) ?? null;
  const study = (await tryLoad(loadStudyDecks, 'Não consegui ler os seus decks de qualquer abertura.', notes)) ?? [];
  const punish = openings ? ((await tryLoad(() => dailyPunish(openings, study, now, exclude), 'Não consegui ler os erros para punir.', notes)) ?? []) : [];
  const state = await loadTactics();
  const bank = await tryLoad(loadIndex, 'Banco de puzzles não encontrado (npm run build:puzzles): a sessão vai sem tática nova.', notes);

  const learning = [...bestQ.learning, ...seqQ.learning].filter((c) => c.due <= now + POSITIONS.learnAheadMs).sort((a, b) => a.due - b.due);
  const news = [...bestQ.news, ...seqQ.news].map((c) => positionRef(c, weights, kindLabel(c, 'Nova'))).sort((a, b) => b.priority - a.priority);
  const games = new Map((openings?.games ?? []).map((g) => [g.id, g]));
  const endgame = pickEndgame(ENDGAMES, records, weights, now);
  const placement = bank && !state.placementDone ? await buildSession(state) : null;
  const base = {
    now,
    budgetMs,
    learning: learning.map((c) => positionRef(c, weights, kindLabel(c, learningLabel(c)))),
    bestReviews: bestQ.reviews.map((c) => positionRef(c, weights, 'Revisão')),
    seqReviews: seqQ.reviews.map((c) => positionRef(c, weights, 'Revisão (sequência)')),
    puzzleReviews: dueP.map(puzzleReview),
    repDue: await repDue(openings?.rep ?? null, study, now),
    news,
    openings: openings ? openingTargets(openings.rep, openings.data.index, games, now, study) : [],
    punish,
    endgame: endgame ? { drillId: endgame.drill.id, reason: `${endgame.drill.name}. ${endgame.reason}` } : null,
    tacticsAvailable: !!bank,
    placement,
    times,
    ...(exclude ? { exclude } : {}),
    maxNewPerGame: POSITIONS.maxNewPerGame,
  };
  const slots = tacticsSlots(base);
  let tactics: SessionItem[] = [];
  if (slots > 0) {
    const taken = await attemptedIds();
    for (const p of dueP) taken.add(p.puzzle.id);
    for (const x of exclude ?? []) if (x.startsWith('puzzle:')) taken.add(x.slice(7));
    tactics = orderSession(await newPuzzles(state, slots, taken));
  }
  return { ...composeDaily({ ...base, tactics }), notes };
}

/**
 * The day's new opponent mistakes to punish: the ones worth most, none with a
 * card yet, and the day's limit counting what you already tried today and what
 * the session already has ("Mais 10 minutos" brings no more).
 */
export async function dailyPunish(openings: Pick<Openings, 'rep' | 'data'>, study: DeckView[], now: number, exclude?: Set<string>): Promise<SessionItem[]> {
  const [{ items }, cards, level] = await Promise.all([loadScanState(), punishCards(), loadLevel()]);
  const day = localDay(now);
  const tried = await db.attempts.where('at').between(day.start, day.end).filter((a) => a.mode === 'punish' && a.source === 'punish').toArray();
  const planned = new Set([...tried.map((a) => a.puzzleId), ...[...(exclude ?? [])].filter((x) => x.startsWith('puzzle:punish:')).map((x) => x.slice('puzzle:'.length))]);
  const decks = [...repertoireDecks(openings.rep.sides.white), ...repertoireDecks(openings.rep.sides.black), ...study];
  const reach = (i: PunishItem) => [...(openings.data.index[i.side].tree.get(i.before)?.values() ?? [])].reduce((s, x) => s + x.n, 0);
  // Only mistakes one of your decks still has.
  const live = Object.values(items).filter((i) => ownersOf(i, decks).length > 0);
  return pickDaily(live, { carded: new Set(cards.keys()), planned, limit: TRAINING.punishPerDay, reach }).map((i) => newPunishItem(i, decks, level.rating));
}

/** The reminder's pick: your costliest kind of mistake, among the ones before and during games. */
const REMINDED: FocusCategory[] = ['convert', 'defend', 'lowClock', 'fast'];

export function pickReminder(cards: BestMoveCard[], weights: FocusWeights | null, now: number): { card: BestMoveCard; category: FocusCategory; due: boolean } | null {
  const order = [...REMINDED].sort((a, b) => (weights?.shares[b]?.share ?? 0) - (weights?.shares[a]?.share ?? 0));
  const byPriority = (a: BestMoveCard, b: BestMoveCard) => priorityOf(b, weights) - priorityOf(a, weights);
  for (const category of order) {
    // Only positions you have already seen: no new lesson right before a game.
    const pool = cards.filter((c) => !c.suspended && c.reps > 0 && c.categories.includes(category));
    const due = pool.filter((c) => c.due <= now).sort(byPriority)[0];
    if (due) return { card: due, category, due: true };
    const learned = pool.filter((c) => c.state === State.Review).sort(byPriority)[0];
    if (learned) return { card: learned, category, due: false };
  }
  return null;
}

export async function loadWarmup(now: number): Promise<{ steps: PlannedStep[]; notes: string[] }> {
  const notes: string[] = [];
  const [weights, times, cards] = await Promise.all([
    getKV<FocusWeights | null>(FOCUS_KEY, null),
    loadTimes(),
    db.srsCards.where('kind').equals('best').toArray() as Promise<BestMoveCard[]>,
  ]);
  const pick = pickReminder(cards, weights, now);
  const reminder = pick ? { p: { ...positionRef(pick.card, weights, 'Lembrete'), reason: `Seu erro que mais custa pontos: ${FOCUS_LABEL[pick.category].toLowerCase()}.` }, due: pick.due } : null;
  const openings = await tryLoad<Openings | null>(loadOpeningsData, 'Não consegui ler o repertório: o aquecimento vai sem aberturas.', notes);
  const sides: Color[] = [];
  const decks: Partial<Record<Color, { id: string; name: string }>> = {};
  if (openings) {
    for (const side of ['white', 'black'] as const) {
      const cards = await cardsFor(side);
      // A color whose repertoire you never trained has no line you already know.
      if (!cards.size) continue;
      sides.push(side);
      const deck = warmupDeck(repertoireDecks(openings.rep.sides[side]), cards, openings.data.index[side]);
      if (deck) decks[side] = { id: deck.id, name: deck.name };
    }
  }
  const bank = await tryLoad(loadIndex, 'Banco de puzzles não encontrado (npm run build:puzzles): o aquecimento vai sem puzzles.', notes);
  let puzzles: SessionItem[] = [];
  if (bank) {
    const state = await loadTactics();
    puzzles = await newPuzzles(state, warmupSlots({ budgetMs: TRAINING.warmupMinutes * 60_000, reminder, sides, times }), await attemptedIds(), { mode: 'warmup' });
  }
  return { steps: composeWarmup({ budgetMs: TRAINING.warmupMinutes * 60_000, reminder, puzzles, sides, decks, times }), notes };
}

/** Before a game: the deck of the color you met most in the last 6 months, among those with a position you already know. */
export function warmupDeck(decks: DeckView[], cards: Map<string, RepCard>, index: GamesIndex | null): DeckView | null {
  let best: { d: DeckView; n: number } | null = null;
  for (const d of decks) {
    if (!d.ours.some((e) => (cards.get(e)?.reps ?? 0) > 0)) continue;
    const n = deckStats(d, index).n;
    if (n > 0 && (!best || n > best.n)) best = { d, n };
  }
  return best?.d ?? null;
}
