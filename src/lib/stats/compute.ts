import { parseTimeControl, startTimeOf } from '../chesscom/import.ts';
import type { GameAnalysis, Outcome, StoredGame, TimeClass } from '../types.ts';

export interface Record3 {
  n: number;
  win: number;
  draw: number;
  loss: number;
  /** Points per game, 0-100. */
  score: number;
}

export function record(games: Array<{ outcome: Outcome }>): Record3 {
  const r = { n: games.length, win: 0, draw: 0, loss: 0, score: 0 };
  for (const g of games) r[g.outcome]++;
  r.score = r.n ? (100 * (r.win + r.draw / 2)) / r.n : 0;
  return r;
}

export interface StatsFilter {
  timeClasses: TimeClass[];
  sinceDays: number | null;
  ratedOnly: boolean;
}

export function filterGames(games: StoredGame[], f: StatsFilter): StoredGame[] {
  const since = f.sinceDays ? Date.now() - f.sinceDays * 86400000 : 0;
  return games.filter((g) => f.timeClasses.includes(g.timeClass) && g.endTime >= since && (!f.ratedOnly || g.rated));
}

export function ratingSeries(games: StoredGame[], tc: TimeClass): Array<{ t: number; rating: number }> {
  return games
    .filter((g) => g.timeClass === tc && g.rated)
    .sort((a, b) => a.endTime - b.endTime)
    .map((g) => ({ t: g.endTime, rating: g.userRating }));
}

/** When a game started (older imports read it back from the PGN). */
export function gameStart(g: StoredGame): number {
  return g.startTime ?? startTimeOf(g.pgn) ?? g.endTime;
}

/**
 * Games grouped into sittings: a break of more than 45 minutes between one
 * game's end and the next game's start opens a new sitting. Measuring end to
 * end would split every pair of long games (30|0) even when back to back.
 */
export function sittings(games: StoredGame[], gapMin = 45): StoredGame[][] {
  const sorted = [...games].sort((a, b) => a.endTime - b.endTime);
  const out: StoredGame[][] = [];
  for (const g of sorted) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && gameStart(g) - prev.endTime < gapMin * 60000) last!.push(g);
    else out.push([g]);
  }
  return out;
}

export interface TiltStats {
  afterLosses: Array<{ label: string; rec: Record3 }>;
  byGameInSitting: Array<{ label: string; rec: Record3 }>;
  afterWin: Record3;
  afterLoss: Record3;
  longSittings: number;
}

export function tilt(games: StoredGame[]): TiltStats {
  const afterLosses = new Map<string, StoredGame[]>();
  const bySeat = new Map<string, StoredGame[]>();
  const afterWin: StoredGame[] = [];
  const afterLoss: StoredGame[] = [];
  let longSittings = 0;
  for (const s of sittings(games)) {
    if (s.length >= 8) longSittings++;
    let streak = 0;
    s.forEach((g, i) => {
      const k = streak >= 3 ? '3+' : String(streak);
      (afterLosses.get(k) ?? afterLosses.set(k, []).get(k)!).push(g);
      const seat = i >= 5 ? '6+' : String(i + 1);
      (bySeat.get(seat) ?? bySeat.set(seat, []).get(seat)!).push(g);
      if (i > 0) (s[i - 1]!.outcome === 'win' ? afterWin : s[i - 1]!.outcome === 'loss' ? afterLoss : []).push(g);
      streak = g.outcome === 'loss' ? streak + 1 : 0;
    });
  }
  const order = (m: Map<string, StoredGame[]>, keys: string[]) => keys.filter((k) => m.has(k)).map((k) => ({ label: k, rec: record(m.get(k)!) }));
  return {
    afterLosses: order(afterLosses, ['0', '1', '2', '3+']),
    byGameInSitting: order(bySeat, ['1', '2', '3', '4', '5', '6+']),
    afterWin: record(afterWin),
    afterLoss: record(afterLoss),
    longSittings,
  };
}

export function byHour(games: StoredGame[]): Array<{ label: string; rec: Record3 }> {
  const buckets = new Map<number, StoredGame[]>();
  for (const g of games) {
    const h = Math.floor(new Date(g.endTime).getHours() / 3) * 3;
    (buckets.get(h) ?? buckets.set(h, []).get(h)!).push(g);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([h, list]) => ({ label: `${String(h).padStart(2, '0')}h-${String(h + 3).padStart(2, '0')}h`, rec: record(list) }));
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export function byWeekday(games: StoredGame[]): Array<{ label: string; rec: Record3 }> {
  const b: StoredGame[][] = Array.from({ length: 7 }, () => []);
  for (const g of games) b[new Date(g.endTime).getDay()]!.push(g);
  return b.map((list, i) => ({ label: WEEKDAYS[i]!, rec: record(list) }));
}

export function byRatingGap(games: StoredGame[]): Array<{ label: string; rec: Record3 }> {
  const bands: Array<[number, number, string]> = [
    [-9999, -100, '100+ abaixo'],
    [-100, -25, '25-100 abaixo'],
    [-25, 25, 'Mesmo nível'],
    [25, 100, '25-100 acima'],
    [100, 9999, '100+ acima'],
  ];
  return bands
    .map(([lo, hi, label]) => ({ label, rec: record(games.filter((g) => g.oppRating - g.userRating >= lo && g.oppRating - g.userRating < hi)) }))
    .filter((x) => x.rec.n > 0);
}

export const RESULT_LABEL: Record<string, string> = {
  win: 'Vitória',
  checkmated: 'Xeque-mate',
  resigned: 'Desistência',
  timeout: 'Tempo',
  abandoned: 'Saiu da partida',
  agreed: 'Acordo',
  repetition: 'Repetição',
  stalemate: 'Afogamento',
  insufficient: 'Material insuficiente',
  '50move': 'Regra dos 50 lances',
  timevsinsufficient: 'Tempo x material insuficiente',
};

export function howGamesEnd(games: StoredGame[]) {
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const g of games) {
    if (g.outcome === 'win') wins.set(g.oppResult, (wins.get(g.oppResult) ?? 0) + 1);
    if (g.outcome === 'loss') losses.set(g.userResult, (losses.get(g.userResult) ?? 0) + 1);
  }
  const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { wins: sort(wins), losses: sort(losses) };
}

/** "Italian Game Two Knights Defense" -> "Italian Game" */
export function openingFamilyFromName(name?: string): string {
  if (!name) return 'Desconhecida';
  const words = name.split(' ');
  const stop = words.findIndex((w) => /^(Defense|Defence|Game|Opening|Attack|Gambit|System|Countergambit)$/.test(w));
  return (stop >= 0 ? words.slice(0, stop + 1) : words.slice(0, 3)).join(' ');
}

export function openingTable(games: StoredGame[]) {
  const map = new Map<string, StoredGame[]>();
  for (const g of games) {
    const key = `${g.userColor}|${openingFamilyFromName(g.opening)}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(g);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const [color, name] = key.split('|') as ['white' | 'black', string];
      return { color, name, rec: record(list), avgOpp: list.reduce((s, g) => s + g.oppRating, 0) / list.length };
    })
    .sort((a, b) => b.rec.n - a.rec.n);
}

// --------------------------------------------------------------- clock

export interface ClockStats {
  games: number;
  timeTroubleShare: number;
  scoreInTrouble: number;
  scoreOutOfTrouble: number;
  lossesOnTime: number;
  fastMoveShare: number;
  avgOpeningSeconds: number;
}

/** Time trouble = your clock under 10% of the base time with the game still going. */
export function clockStats(games: StoredGame[]): ClockStats | null {
  const usable = games.filter((g) => g.clocks.some((c) => c !== null) && parseTimeControl(g.timeControl));
  if (!usable.length) return null;
  let trouble = 0;
  const inTrouble: StoredGame[] = [];
  const outTrouble: StoredGame[] = [];
  let fast = 0;
  let movesCounted = 0;
  let openingSecs = 0;
  let openingGames = 0;
  for (const g of usable) {
    const tc = parseTimeControl(g.timeControl)!;
    const whiteFirst = !g.initialFen || g.initialFen.split(' ')[1] === 'w';
    const mine = (g.userColor === 'white') === whiteFirst ? 0 : 1;
    let prev = tc.base;
    let hadTrouble = false;
    let opening = 0;
    for (let i = mine; i < g.clocks.length; i += 2) {
      const c = g.clocks[i];
      if (c === null || c === undefined) continue;
      const spent = prev - c + tc.increment;
      prev = c;
      if (i >= 16 && spent < Math.max(1, tc.base / 300)) fast++;
      movesCounted++;
      if (i < 20) opening += spent;
      if (c < tc.base * 0.1 && i < g.clocks.length - 4) hadTrouble = true;
    }
    if (g.clocks.length >= 20) {
      openingSecs += opening;
      openingGames++;
    }
    if (hadTrouble) {
      trouble++;
      inTrouble.push(g);
    } else outTrouble.push(g);
  }
  return {
    games: usable.length,
    timeTroubleShare: trouble / usable.length,
    scoreInTrouble: record(inTrouble).score,
    scoreOutOfTrouble: record(outTrouble).score,
    lossesOnTime: usable.filter((g) => g.outcome === 'loss' && g.userResult === 'timeout').length,
    fastMoveShare: movesCounted ? fast / movesCounted : 0,
    avgOpeningSeconds: openingGames ? openingSecs / openingGames : 0,
  };
}

// ------------------------------------------------------------ analysis

export type Phase = 'opening' | 'middlegame' | 'endgame';

export function phaseOf(fen: string, ply: number): Phase {
  if (ply <= 20) return 'opening';
  const board = fen.split(' ')[0]!;
  let material = 0;
  for (const ch of board) material += ({ q: 9, r: 5, b: 3, n: 3 } as Record<string, number>)[ch.toLowerCase()] ?? 0;
  return material <= 26 ? 'endgame' : 'middlegame';
}

export interface AnalysisStats {
  games: number;
  accuracy: number;
  blundersPerGame: number;
  mistakesPerGame: number;
  /** Games you had at 80%+ win chance and did not win. */
  thrown: StoredGame[];
  thrownShare: number;
  /** Where the decisive error of each loss happened. */
  decisivePhase: Record<Phase, number>;
  /** Decisive errors played in under 10% of the typical think time. */
  decisiveFast: number;
  decisiveWithClock: number;
  decisiveLowClock: number;
  lossesAnalysed: number;
  /** Losses where the opponent played worse than you on average. */
  lostToWorse: number;
}

export function analysisStats(games: StoredGame[], analyses: Map<string, GameAnalysis>): AnalysisStats | null {
  const pairs = games.map((g) => [g, analyses.get(g.id)] as const).filter((p): p is readonly [StoredGame, GameAnalysis] => !!p[1]);
  if (!pairs.length) return null;
  let acc = 0;
  let blunders = 0;
  let mistakes = 0;
  const thrown: StoredGame[] = [];
  const decisivePhase: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  let decisiveFast = 0;
  let decisiveWithClock = 0;
  let decisiveLowClock = 0;
  let lossesAnalysed = 0;
  let lostToWorse = 0;

  for (const [g, a] of pairs) {
    const mine = a.moves.filter((m) => m.color === g.userColor);
    acc += a.accuracy[g.userColor];
    blunders += mine.filter((m) => m.classification === 'blunder').length;
    mistakes += mine.filter((m) => m.classification === 'mistake' || m.classification === 'miss').length;
    const peak = Math.max(...mine.map((m) => m.winBefore));
    if (peak >= 80 && g.outcome !== 'win') thrown.push(g);

    if (g.outcome === 'loss') {
      lossesAnalysed++;
      const opp = g.userColor === 'white' ? 'black' : 'white';
      if (a.accuracy[opp] < a.accuracy[g.userColor]) lostToWorse++;
      // The decisive error: your last move that dropped you under 30% for good.
      let decisive = null;
      for (const m of mine) {
        if (m.winBefore >= 30 && m.winAfter < 30) decisive = m;
      }
      if (decisive) {
        decisivePhase[phaseOf(decisive.fenBefore, decisive.ply)]++;
        const tc = parseTimeControl(g.timeControl);
        if (tc && decisive.timeSpent !== null && decisive.timeSpent !== undefined) {
          decisiveWithClock++;
          const typical = tc.base / 40 + tc.increment;
          if (decisive.timeSpent < typical * 0.35) decisiveFast++;
          if ((decisive.clock ?? tc.base) < tc.base * 0.15) decisiveLowClock++;
        }
      }
    }
  }
  return {
    games: pairs.length,
    accuracy: acc / pairs.length,
    blundersPerGame: blunders / pairs.length,
    mistakesPerGame: mistakes / pairs.length,
    thrown,
    thrownShare: thrown.length / pairs.length,
    decisivePhase,
    decisiveFast,
    decisiveWithClock,
    decisiveLowClock,
    lossesAnalysed,
    lostToWorse,
  };
}
