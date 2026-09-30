// Where the openings cost you, from your own games of the last six months:
// the positions where you left the repertoire yourself (and how those games
// went), then the opening decks where you score below your average with that
// color (your repertoire's and the ones you built from any opening).
import { deckNameForPath, deckStats, repertoireDecks, type DeckView } from '../decks/views.ts';
import { START_EPD, type CompiledRepertoire } from '../repertoire/data.ts';
import { RECENT_DAYS, type GamesIndex } from '../repertoire/games.ts';
import type { Color, Outcome, StoredGame } from '../types.ts';
import { TRAINING } from './config.ts';

export interface OpeningTarget {
  side: Color;
  line: 'deviation' | 'chapter';
  /** The position (a deviation) or the deck's root: one line per place. */
  key: string;
  weight: number;
  /** Deviation: the real game's moves (SAN) up to the position where you left the book. */
  replay?: string[];
  /** Sessions put together before the decks: a chapter's line. */
  chapterId?: string;
  /** A weak deck: its lines. */
  deckId?: string;
  reason: string;
}

export type TargetGame = Pick<StoredGame, 'moves' | 'oppName' | 'endTime'>;

const DAY = 86_400_000;
const pts = (o: Outcome) => (o === 'win' ? 1 : o === 'draw' ? 0.5 : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const OUTCOME_VERB: Record<Outcome, string> = { win: 'venceu', draw: 'empatou', loss: 'perdeu' };
/** A small sample says little: pulled toward your average by k games of it. */
const shrunk = (points: number, n: number, toward: number, k: number) => (points + k * toward) / (n + k);

/** Your score with the color in the recent games: every one of them passes the start. */
export function sideAverage(index: GamesIndex): number | null {
  const s = index.recent.get(START_EPD);
  return s?.n ? s.points / s.n : null;
}

export function deviationTargets(rep: CompiledRepertoire, index: GamesIndex, side: Color, games: Map<string, TargetGame>, now: number, decks: DeckView[] = repertoireDecks(rep.sides[side])): OpeningTarget[] {
  const since = now - RECENT_DAYS * DAY;
  const avg = sideAverage(index) ?? 0.5;
  const { deviationMinGames, deviationShrink } = TRAINING.openings;
  const groups = new Map<string, { n: number; points: number; last: GamesIndex['exits'][number] }>();
  for (const e of index.exits) {
    if (e.kind !== 'you' || e.endTime < since) continue;
    if (!rep.sides[side].positions[e.epd]?.moves.length) continue;
    const g = groups.get(e.epd) ?? { n: 0, points: 0, last: e };
    g.n++;
    g.points += pts(e.outcome);
    if (e.endTime > g.last.endTime) g.last = e;
    groups.set(e.epd, g);
  }
  const out: OpeningTarget[] = [];
  for (const [epd, g] of groups) {
    if (g.n < deviationMinGames) continue;
    const game = games.get(g.last.gameId);
    if (!game || game.moves.length < g.last.ply) continue;
    const when = new Date(game.endTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const replay = game.moves.slice(0, g.last.ply);
    const deck = deckNameForPath(decks, replay);
    out.push({
      side,
      line: 'deviation',
      key: epd,
      weight: g.n * (1 - shrunk(g.points, g.n, avg, deviationShrink)),
      replay,
      reason: `${deck ? `${deck}. ` : ''}Nos últimos 6 meses você saiu do repertório aqui em ${g.n} partidas e marcou ${pct(g.points / g.n)}. A última foi contra ${game.oppName} (${when}): você jogou ${g.last.san} e ${OUTCOME_VERB[g.last.outcome]}.`,
    });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** The opening decks of a color where you score below your average there (a small sample pulled toward it). */
export function deckTargets(decks: DeckView[], index: GamesIndex, side: Color): OpeningTarget[] {
  const avg = sideAverage(index);
  if (avg === null) return [];
  const { chapterMinGames, chapterShrink } = TRAINING.openings;
  const out: OpeningTarget[] = [];
  for (const d of decks) {
    if (d.side !== side) continue;
    const s = deckStats(d, index);
    if (s.n < chapterMinGames) continue;
    const deficit = avg - shrunk(s.points, s.n, avg, chapterShrink);
    if (deficit <= 0) continue;
    out.push({
      side,
      line: 'chapter',
      key: d.root,
      weight: s.n * deficit,
      deckId: d.id,
      reason: `${d.name}: você marca ${pct(s.points / s.n)} em ${s.n} partidas dos últimos 6 meses; de ${side === 'white' ? 'brancas' : 'pretas'}, sua média é ${pct(avg)}.`,
    });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Your own deviations first (the most points lost first), then the weak decks (with the ones you built from any opening). */
export function openingTargets(rep: CompiledRepertoire, index: Record<Color, GamesIndex>, games: Map<string, TargetGame>, now: number, study: DeckView[] = []): OpeningTarget[] {
  const sides: Color[] = ['white', 'black'];
  const decks = { white: repertoireDecks(rep.sides.white), black: repertoireDecks(rep.sides.black) };
  const deviations = sides.flatMap((s) => deviationTargets(rep, index[s], s, games, now, decks[s])).sort((a, b) => b.weight - a.weight);
  const weak = sides.flatMap((s) => deckTargets([...decks[s], ...study], index[s], s)).sort((a, b) => b.weight - a.weight);
  return [...deviations, ...weak];
}
