// From saved analyses to cards. Pure: the store runs it inside a transaction.
// Re-running on the same analyses changes nothing, and FSRS state survives
// any change to the analyses (re-scoring, new games, deleted games).
import { State } from 'ts-fsrs';
import { epdOf, uciToSan } from '../chess/replay.ts';
import { newFsrsFields } from '../srs/fsrs.ts';
import type { EngineLine, GameAnalysis, StoredGame } from '../types.ts';
import { POSITIONS, SCORE_VERSION } from './config.ts';
import { categoriesOf, gameContext, moveLoss, type FocusMove } from './focus.ts';
import { bucketOf } from './grade.ts';
import type { BestMoveCard, DerivedSource, SourceRef, StoredLine } from './types.ts';

export { moveLoss };

/** Changes whenever the analysis is redone or re-scored (rescoring keeps createdAt). */
export function analysisSig(a: GameAnalysis): string {
  return `${a.version ?? 0}|${a.createdAt}|${a.depth}`;
}

function stored(line: EngineLine, plies: number): StoredLine {
  return { pv: line.pv.slice(0, plies), score: line.mate !== undefined ? { mate: line.mate } : { cp: line.cp ?? 0 }, depth: line.depth };
}

export function deriveSources(g: StoredGame, a: GameAnalysis): { sources: DerivedSource[]; focus: FocusMove[] } {
  const ctx = gameContext(g, a);
  const sig = analysisSig(a);
  const sources: DerivedSource[] = [];
  const focus: FocusMove[] = [];
  for (const m of a.moves) {
    if (m.color !== g.userColor || m.classification === 'book') continue;
    const loss = moveLoss(m);
    if (loss < POSITIONS.minLoss) continue;
    const categories = categoriesOf(m, ctx);
    focus.push({ gameId: g.id, endTime: g.endTime, loss, categories });

    const bestLine = a.evals[m.ply - 1]?.lines[0];
    const bestUci = bestLine?.pv[0];
    if (!bestLine || !bestUci) continue;
    // Still winning comfortably after the move: not worth a card.
    if (m.winBefore - loss >= POSITIONS.stillWinning) continue;
    const bestSan = uciToSan(m.fenBefore, bestUci);
    if (!bestSan) continue;
    const secondLine = a.evals[m.ply - 1]?.lines[1];
    const replyLine = a.evals[m.ply]?.lines[0];
    const prev = a.moves[m.ply - 2];
    sources.push({
      gameId: g.id,
      ply: m.ply,
      endTime: g.endTime,
      oppName: g.oppName,
      timeClass: g.timeClass,
      uci: m.uci,
      san: m.san,
      loss,
      classification: m.classification,
      reply: replyLine?.pv.length ? stored(replyLine, 12) : null,
      sig,
      epd: epdOf(m.fenBefore),
      fen: m.fenBefore,
      color: m.color,
      prevMove: prev ? { from: prev.uci.slice(0, 2), to: prev.uci.slice(2, 4) } : null,
      best: { ...stored(bestLine, 16), uci: bestUci, san: bestSan },
      second: secondLine?.pv[0] ? { ...stored(secondLine, 16), uci: secondLine.pv[0] } : null,
      stableFrom: bestLine.stableFrom ?? m.difficulty ?? null,
      categories,
    });
  }
  return { sources, focus };
}

const STATIC_KEYS = [
  'kind',
  'note',
  'primaryGameId',
  'epd',
  'fen',
  'color',
  'prevMove',
  'best',
  'second',
  'stableFrom',
  'bucket',
  'totalLoss',
  'categories',
  'sources',
  'sig',
  'suspended',
] as const;

type StaticFields = Pick<BestMoveCard, (typeof STATIC_KEYS)[number]>;

function staticOf(c: StaticFields): string {
  return JSON.stringify(STATIC_KEYS.map((k) => c[k]));
}

function toRef(s: DerivedSource): SourceRef {
  const { gameId, ply, endTime, oppName, timeClass, uci, san, loss, classification, reply, sig } = s;
  return { gameId, ply, endTime, oppName, timeClass, uci, san, loss, classification, reply, sig };
}

export interface PlanReport {
  created: number;
  updated: number;
  suspended: number;
  revived: number;
  removed: number;
  unchanged: number;
}

export function planBestCards(existing: BestMoveCard[], sources: DerivedSource[], now: number): { put: BestMoveCard[]; remove: string[]; report: PlanReport } {
  const byEpd = new Map<string, DerivedSource[]>();
  for (const s of sources) {
    const list = byEpd.get(s.epd);
    if (list) list.push(s);
    else byEpd.set(s.epd, [s]);
  }
  const report: PlanReport = { created: 0, updated: 0, suspended: 0, revived: 0, removed: 0, unchanged: 0 };
  const put: BestMoveCard[] = [];
  const remove: string[] = [];
  const prevById = new Map(existing.filter((c) => c.kind === 'best').map((c) => [c.id, c]));
  const seen = new Set<string>();

  for (const [epd, group] of byEpd) {
    const primary = [...group].sort((a, b) => b.loss - a.loss || b.endTime - a.endTime)[0]!;
    const refs = [...group].sort((a, b) => b.endTime - a.endTime || a.gameId.localeCompare(b.gameId)).map(toRef);
    const sig = `${SCORE_VERSION}:${refs.map((r) => `${r.gameId}#${r.ply}@${r.sig}`).sort().join(',')}`;
    const fields: StaticFields = {
      kind: 'best',
      note: epd,
      primaryGameId: primary.gameId,
      epd,
      fen: primary.fen,
      color: primary.color,
      prevMove: primary.prevMove,
      best: primary.best,
      second: primary.second,
      stableFrom: primary.stableFrom,
      bucket: bucketOf(primary.stableFrom),
      totalLoss: Math.round(group.reduce((s, x) => s + x.loss, 0) * 10) / 10,
      categories: primary.categories,
      sources: refs,
      sig,
      suspended: 0,
    };
    const id = `best:${epd}`;
    seen.add(id);
    const prev = prevById.get(id);
    if (!prev) {
      put.push({ ...fields, id, createdAt: now, ...newFsrsFields(now) });
      report.created++;
      continue;
    }
    if (staticOf(prev) === staticOf(fields)) {
      report.unchanged++;
      continue;
    }
    const next: BestMoveCard = { ...prev, ...fields };
    if (prev.sig !== sig) delete next.scored;
    put.push(next);
    if (prev.suspended) report.revived++;
    else report.updated++;
  }

  for (const prev of prevById.values()) {
    if (seen.has(prev.id)) continue;
    if (prev.state === State.New && prev.reps === 0) {
      remove.push(prev.id);
      report.removed++;
    } else if (!prev.suspended) {
      put.push({ ...prev, suspended: 1 });
      report.suspended++;
    }
  }
  return { put, remove, report };
}
