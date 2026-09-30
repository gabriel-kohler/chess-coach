// Sequence cards follow their position's best-move card: built from it, and
// retired when it goes away or its best move changes. Pure.
import { State } from 'ts-fsrs';
import { newFsrsFields } from '../srs/fsrs.ts';
import { SEQ_VERSION, type SeqBranch } from './sequence.ts';
import type { BestMoveCard, SequenceCard } from './types.ts';

export const seqCardId = (epd: string, replyUci: string) => `seq:${epd}:${replyUci}`;

export function seqCardsFor(root: BestMoveCard, branches: SeqBranch[], offset: number, now: number): SequenceCard[] {
  return branches.map((branch) => ({
    id: seqCardId(root.epd, branch.reply.uci),
    kind: 'seq',
    note: root.note,
    rootId: root.id,
    primaryGameId: root.primaryGameId,
    createdAt: now,
    suspended: 0,
    epd: root.epd,
    fen: root.fen,
    color: root.color,
    prevMove: root.prevMove,
    best: root.best,
    second: root.second,
    stableFrom: root.stableFrom,
    bucket: root.bucket,
    totalLoss: root.totalLoss,
    categories: root.categories,
    sources: root.sources,
    branch,
    built: { version: SEQ_VERSION, offset, at: now },
    ...newFsrsFields(now),
  }));
}

/** Why a sequence no longer matches its position, or null when it still does. */
export function staleReason(seq: SequenceCard, root: BestMoveCard | undefined): 'gone' | 'moved' | 'version' | null {
  if (!root || root.suspended) return 'gone';
  if (root.best.uci !== seq.best.uci || root.fen !== seq.fen) return 'moved';
  if (seq.built.version !== SEQ_VERSION) return 'version';
  return null;
}

export function planSequenceCards(seqs: SequenceCard[], roots: BestMoveCard[]): { put: SequenceCard[]; remove: string[] } {
  const byId = new Map(roots.map((r) => [r.id, r]));
  const put: SequenceCard[] = [];
  const remove: string[] = [];
  for (const s of seqs) {
    const root = byId.get(s.rootId);
    if (staleReason(s, root)) {
      if (s.state === State.New && s.reps === 0) remove.push(s.id);
      else if (!s.suspended) put.push({ ...s, suspended: 1 });
      continue;
    }
    // Keep priority data in step with the position (new games, re-scoring).
    const r = root!;
    const same = !s.suspended && s.totalLoss === r.totalLoss && s.primaryGameId === r.primaryGameId && JSON.stringify(s.categories) === JSON.stringify(r.categories) && JSON.stringify(s.sources) === JSON.stringify(r.sources);
    if (!same) put.push({ ...s, suspended: 0, totalLoss: r.totalLoss, primaryGameId: r.primaryGameId, categories: r.categories, sources: r.sources });
  }
  return { put, remove };
}
