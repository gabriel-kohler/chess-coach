// Fits FSRS to you, per card kind, and lets your own data pick the grading
// rule. Every attempt keeps its raw signals, so both rules can be replayed:
//   timed:   Again / Hard / Good / Easy, with time relative to your own pace;
//   untimed: Again / Hard / Good from the move's loss only.
// Both give Again in exactly the same cases, so the recall labels match and
// the comparison is fair: each rule's history is scored by time-series splits
// (train on the past, predict the next reviews), lower log-loss wins. Then the
// parameters are fitted with the winning rule and kept only if they predict
// your reviews better than the ones in use. Runs every 100 reviews of a kind.
import { default_w, Rating, type Grade } from 'ts-fsrs';
import { db, getKV, setKV } from '../db.ts';
import { POSITIONS } from '../positions/config.ts';
import { gradeAttempt, type GradingRule } from '../positions/grade.ts';
import { setKindModel, shortTermFor } from './fsrs.ts';
import { CARD_KINDS, type CardKind, type ReviewLogRow } from './types.ts';

export type { GradingRule };

export const OPTIMIZE_EVERY = 100;
const modelKey = (kind: CardKind) => `srs:model:${kind}`;

export interface Evaluation {
  logLoss: number;
  rmseBins: number;
}

export interface SrsModel {
  kind: CardKind;
  rule: GradingRule;
  /** Fitted FSRS weights, or null while the defaults are in use. */
  w: number[] | null;
  /** Reviews the model was fitted on. */
  reviews: number;
  at: number;
  metrics: { timed?: Evaluation; untimed?: Evaluation; fitted?: Evaluation; current?: Evaluation };
}

export function untimedGrade(s: { loss: number | null; gaveUp: boolean }): Grade {
  if (s.gaveUp || s.loss === null || s.loss > POSITIONS.againLoss) return Rating.Again;
  if (s.loss > POSITIONS.goodLoss) return Rating.Hard;
  return Rating.Good;
}

/** The grade a logged attempt gets under a rule, re-derived from its raw signals. */
export function ratingUnder(log: ReviewLogRow, rule: GradingRule): Grade {
  if (log.steps?.length) {
    // A sequence takes the grade of its worst move.
    const grades = log.steps.map((s) => (rule === 'timed' ? (s.rating as Grade) : untimedGrade({ loss: s.loss, gaveUp: s.uci === null })));
    return grades.reduce<Grade>((w, g) => (g < w ? g : w), Rating.Easy);
  }
  if (rule === 'untimed') return untimedGrade(log);
  return gradeAttempt({ loss: log.loss, exact: log.exact, timeMs: log.timeMs, gaveUp: log.gaveUp }, log.expectedMs);
}

export type History = Array<{ rating: number; at: number }>;

/** Each card's reviews in order, graded under a rule. */
export function historiesFor(logs: ReviewLogRow[], rule: GradingRule): History[] {
  const byCard = new Map<string, ReviewLogRow[]>();
  for (const l of logs) {
    const list = byCard.get(l.cardId);
    if (list) list.push(l);
    else byCard.set(l.cardId, [l]);
  }
  return [...byCard.values()].map((list) => list.sort((a, b) => a.at - b.at).map((l) => ({ rating: ratingUnder(l, rule), at: l.at })));
}

type Post = (path: string, body: unknown) => Promise<Record<string, unknown>>;

const post: Post = async (path, body) => {
  const res = await fetch(`/api/fsrs/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? res.status));
  return json;
};

export async function optimizerAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/api/fsrs/status', { cache: 'no-store' });
    return r.ok && ((await r.json()) as { available?: boolean }).available === true;
  } catch {
    return false;
  }
}

const asEval = (r: Record<string, unknown>): Evaluation => ({ logLoss: Number(r.logLoss), rmseBins: Number(r.rmseBins) });

/**
 * Picks the grading rule and fits the weights for one kind. Pure apart from
 * the injected server call, so it is testable; returns the model to keep.
 */
export async function fitModel(kind: CardKind, logs: ReviewLogRow[], current: SrsModel | null, call: Post = post, now = Date.now()): Promise<SrsModel> {
  const timed = historiesFor(logs, 'timed');
  const untimed = historiesFor(logs, 'untimed');
  const enableShortTerm = shortTermFor(kind);
  const [t, u] = await Promise.all([call('evaluate-splits', { histories: timed, enableShortTerm }), call('evaluate-splits', { histories: untimed, enableShortTerm })]);
  const metrics: SrsModel['metrics'] = { timed: asEval(t), untimed: asEval(u) };
  const rule: GradingRule = metrics.timed!.logLoss <= metrics.untimed!.logLoss ? 'timed' : 'untimed';
  const histories = rule === 'timed' ? timed : untimed;
  const fitted = (await call('optimize', { histories, enableShortTerm })).params as number[];
  const inUse = current?.w ?? [...default_w];
  const [f, c] = await Promise.all([call('evaluate', { histories, params: fitted }), call('evaluate', { histories, params: inUse })]);
  metrics.fitted = asEval(f);
  metrics.current = asEval(c);
  // Keep the new weights only when they predict your reviews better.
  const w = metrics.fitted.logLoss < metrics.current.logLoss ? fitted : current?.w ?? null;
  return { kind, rule, w, reviews: logs.length, at: now, metrics };
}

export async function loadModels(): Promise<Record<CardKind, SrsModel | null>> {
  const out = {} as Record<CardKind, SrsModel | null>;
  for (const kind of CARD_KINDS) {
    out[kind] = await getKV<SrsModel | null>(modelKey(kind), null);
    setKindModel(kind, out[kind]?.w ?? null, out[kind]?.rule ?? 'timed');
  }
  return out;
}

async function logsOf(kind: CardKind): Promise<ReviewLogRow[]> {
  return db.reviewLogs.where('[kind+at]').between([kind, 0], [kind, Number.MAX_SAFE_INTEGER]).toArray();
}

let inFlight: Promise<Array<{ kind: CardKind; model: SrsModel }>> | null = null;

/** Runs the optimizer for kinds that gained 100 reviews since the last fit. One run at a time. */
export function maybeOptimize(force = false): Promise<Array<{ kind: CardKind; model: SrsModel }>> {
  inFlight ??= optimizeDue(force).finally(() => (inFlight = null));
  return inFlight;
}

async function optimizeDue(force: boolean): Promise<Array<{ kind: CardKind; model: SrsModel }>> {
  if (!(await optimizerAvailable())) return [];
  const done: Array<{ kind: CardKind; model: SrsModel }> = [];
  for (const kind of CARD_KINDS) {
    const current = await getKV<SrsModel | null>(modelKey(kind), null);
    const logs = await logsOf(kind);
    const due = logs.length >= OPTIMIZE_EVERY && logs.length >= (current?.reviews ?? 0) + OPTIMIZE_EVERY;
    if (!due && !(force && logs.length >= OPTIMIZE_EVERY)) continue;
    const model = await fitModel(kind, logs, current);
    await setKV(modelKey(kind), model);
    setKindModel(kind, model.w, model.rule);
    done.push({ kind, model });
  }
  return done;
}
