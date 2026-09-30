// The level review in the database: checked after every sync, and the new
// band's Maia calibration once its games give enough of your opponents' moves.
import { getAccount } from '../chesscom/sync.ts';
import { db, getKV, setKV } from '../db.ts';
import { calibrate, calibrationSamples, CALIBRATION_KEY, type Calibration } from '../maia/calibrate.ts';
import { maiaAvailable, maiaPolicies } from '../maia/client.ts';
import { focusPopulation, focusWeights } from '../positions/focus.ts';
import { POSITIONS } from '../positions/config.ts';
import { loadFocusInputs } from '../positions/store.ts';
import type { FocusWeights } from '../positions/types.ts';
import { ACCOUNT_KEYS, LEVEL_VERSION, RENEWAL } from './config.ts';
import { levelStep, type CalibrationSummary, type LevelReport, type LevelState } from './level.ts';

const DAY = 86_400_000;

export const loadLevelState = () => getKV<LevelState | null>(ACCOUNT_KEYS.level, null);

export function summarize(c: Calibration | null): CalibrationSummary | null {
  if (!c) return null;
  return { offset: c.offset, top3: c.results.find((r) => r.offset === c.offset)?.top3 ?? null, n: c.n, at: c.at };
}

/** After a sync: records a new band and freezes your focuses at the moment you reached it. */
export async function checkLevel(now = Date.now()): Promise<LevelReport | null> {
  const [account, state] = await Promise.all([getAccount(), loadLevelState()]);
  const rating = account?.stats.chess_rapid?.last?.rating;
  const games = await db.games.where('timeClass').equals('rapid').toArray();
  const step = levelStep(state, rating, games);
  if (step.kind === 'init' || step.kind === 'pending') {
    await setKV(ACCOUNT_KEYS.level, step.state);
    return null;
  }
  if (step.kind !== 'crossed' || !state || !rating) return null;
  const inputs = await loadFocusInputs(undefined, step.bandStart - POSITIONS.focusWindowDays * DAY);
  const before = focusWeights(inputs.focus, focusPopulation(inputs.popGames, step.bandStart), step.bandStart);
  const report: LevelReport = {
    band: step.band,
    rating,
    detectedAt: now,
    bandStart: step.bandStart,
    version: LEVEL_VERSION,
    before,
    calibrationBefore: summarize(await getKV<Calibration | null>(CALIBRATION_KEY, null)),
  };
  await setKV<LevelState>(ACCOUNT_KEYS.level, { ...state, highestBand: step.band, pending: null, reports: [...state.reports, report] });
  return report;
}

/** Your focuses on the games of a band, as they stand now (the "after" of the report). */
export async function focusSince(bandStart: number, now = Date.now()): Promise<FocusWeights> {
  const inputs = await loadFocusInputs(undefined, bandStart);
  // The game that brought you into the band was played at the old level.
  return focusWeights(inputs.focus, focusPopulation(inputs.popGames, now, bandStart + 1), now);
}

/**
 * Recalibrates Maia on the newest band's games once they give 50 of your
 * opponents' moves. Sequences built before keep their offset: rebuilding
 * them would reset their FSRS progress.
 */
export async function calibrateNewBand(): Promise<CalibrationSummary | null> {
  const state = await loadLevelState();
  const report = state?.reports.at(-1);
  if (!report || report.calibrationAfter || !(await maiaAvailable())) return null;
  const games = (await db.games.where('endTime').above(report.bandStart).toArray())
    .filter((g) => g.timeClass === 'rapid' || g.timeClass === 'blitz')
    .sort((a, b) => b.endTime - a.endTime);
  const samples = calibrationSamples(games, 300);
  if (samples.length < RENEWAL.calibrationMinSamples) return null;
  const c = await calibrate(samples, maiaPolicies);
  await setKV(CALIBRATION_KEY, c);
  const summary = summarize(c)!;
  const fresh = await loadLevelState();
  if (fresh) await setKV<LevelState>(ACCOUNT_KEYS.level, { ...fresh, reports: fresh.reports.map((r) => (r.band === report.band ? { ...r, calibrationAfter: summary } : r)) });
  return summary;
}

export async function markLevelSeen(band: number): Promise<void> {
  const state = await loadLevelState();
  if (state && state.seen !== band) await setKV<LevelState>(ACCOUNT_KEYS.level, { ...state, seen: band });
}
