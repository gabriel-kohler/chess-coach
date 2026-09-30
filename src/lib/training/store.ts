// The stored sessions: one Treinar per local day, one Aquecer at a time. The
// kv row is the truth; every change goes through one writer, in order, and a
// session is put together once even when two screens ask at the same time.
import { onSwitching } from '../chesscom/sync.ts';
import { db, getKV, setKV } from '../db.ts';
import { localDay } from '../srs/queue.ts';
import { TRAINING } from './config.ts';
import { TRAINING_KEYS } from './keys.ts';
import { appendSteps, attemptIdOf, newSession, reconcile, recordResult, sessionExclude, skipStep, type StepFacts } from './session.ts';
import { loadTrainingSettings } from './settings.ts';
import { loadDaily, loadWarmup } from './sources.ts';
import type { TrainingMode, TrainingSession, TrainingStep } from './types.ts';

const keyOf = (mode: TrainingMode) => TRAINING_KEYS[mode];

// Another account's data is about to go: a session of the old one must not be written back.
let epoch = 0;
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  onSwitching(() => {
    epoch++;
    opening.clear();
  });
}

/** The session to resume: today's Treinar; an Aquecer still running and recent. */
export async function readSession(mode: TrainingMode, now = Date.now()): Promise<TrainingSession | null> {
  const s = await getKV<TrainingSession | null>(keyOf(mode), null);
  if (!s || s.version !== TRAINING.version) return null;
  if (mode === 'daily') return s.day === localDay(now).start ? s : null;
  return !s.finishedAt && now - s.startedAt < TRAINING.warmupResumeMs ? s : null;
}

async function compose(mode: TrainingMode, now: number): Promise<TrainingSession> {
  const day = localDay(now).start;
  if (mode === 'warmup') {
    const w = await loadWarmup(now);
    return newSession('warmup', now, day, TRAINING.warmupMinutes * 60_000, w.steps, 0, w.notes);
  }
  const budgetMs = (await loadTrainingSettings()).dailyMinutes * 60_000;
  const d = await loadDaily(now, budgetMs);
  return newSession('daily', now, day, budgetMs, d.steps, d.leftover, d.notes);
}

const opening = new Map<TrainingMode, Promise<TrainingSession>>();

/** Resumes the session or puts a new one together, once per mode at a time. */
export function openTraining(mode: TrainingMode, now = Date.now()): Promise<TrainingSession> {
  listen();
  let p = opening.get(mode);
  if (p) return p;
  const myEpoch = epoch;
  p = (async () => {
    const found = await readSession(mode, now);
    const s = found ? await reconcileSession(found) : await compose(mode, now);
    if (myEpoch === epoch && s !== found) await setKV(keyOf(mode), s);
    return s;
  })().finally(() => opening.delete(mode));
  opening.set(mode, p);
  return p;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Applies a change to the stored session, one change at a time, on the
 * latest stored version. Null when the session is gone (another day, an
 * account switch).
 */
export function updateSession(mode: TrainingMode, change: (s: TrainingSession) => TrainingSession | Promise<TrainingSession>): Promise<TrainingSession | null> {
  const myEpoch = epoch;
  const job = chain.then(async () => {
    const s = await getKV<TrainingSession | null>(keyOf(mode), null);
    if (!s || myEpoch !== epoch) return null;
    const next = await change(s);
    if (next !== s && myEpoch === epoch) await setKV(keyOf(mode), next);
    return next;
  });
  chain = job.catch(() => undefined);
  return job;
}

/** "Mais 10 minutos": more of the day's training, nothing already in it. */
export function extendDaily(now = Date.now()): Promise<TrainingSession | null> {
  return updateSession('daily', async (s) => {
    const more = await loadDaily(now, TRAINING.moreMinutes * 60_000, sessionExclude(s));
    return appendSteps(s, more.steps, now, TRAINING.moreMinutes);
  });
}

async function stepFacts(s: TrainingSession, step: TrainingStep): Promise<StepFacts> {
  const it = step.item;
  if (it.kind === 'best' || it.kind === 'seq') {
    const [card, own] = await Promise.all([db.srsCards.get(it.cardId), db.reviewLogs.where('attemptId').equals(attemptIdOf(s, step)).first()]);
    const facts: StepFacts = {};
    if (own) facts.ownLog = { rating: own.rating, timeMs: own.timeMs, at: own.at, next: { state: own.after.state, due: own.after.due } };
    if (!card || card.suspended) facts.cardGone = true;
    else if (card.last_review !== null && card.last_review >= step.addedAt) {
      const last = await db.reviewLogs.where('cardId').equals(it.cardId).last();
      if (last && last.at >= step.addedAt) facts.laterLog = { rating: last.rating, timeMs: last.timeMs, at: last.at };
    }
    return facts;
  }
  if (it.kind === 'puzzle') {
    const a = await db.attempts.where('puzzleId').equals(it.item.puzzle.id).filter((x) => x.at >= step.addedAt).first();
    return a ? { puzzleAttempt: { solved: a.solved, timeMs: a.timeMs, at: a.at } } : {};
  }
  return {};
}

/** Pending steps the database already has done (a reload mid-step, another screen) or can no longer show. */
export async function reconcileSession(s: TrainingSession, only?: string): Promise<TrainingSession> {
  let out = s;
  for (const step of s.steps) {
    if (step.status !== 'pending' || (only && step.id !== only)) continue;
    const facts = await stepFacts(s, step);
    const r = reconcile(step, facts);
    if (!r) continue;
    // Saved before a reload: the review is there, and so is where it left the card.
    out = r.status === 'done' ? recordResult(out, step.id, r.result, facts.ownLog?.next ?? null) : skipStep(out, step.id, r.note);
  }
  return out;
}
