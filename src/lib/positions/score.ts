// How much a move you try loses against the best one. Stored numbers first;
// otherwise one engine search over both moves, so they are compared in the
// same search at the same depth (the rule classify.ts uses). The stored best
// score came from a time-capped search of varying depth, and mixing it with a
// fresh score would shift the loss by a few points: the whole Hard band.
import type { Engine } from '../engine/stockfish.ts';
import { factsEngine } from '../engine/stockfish.ts';
import { winFor } from '../explain/facts.ts';
import type { EngineLine, Score } from '../types.ts';
import { POSITIONS } from './config.ts';
import type { MoveScore, ScoreTarget, StoredLine } from './types.ts';

const scoreOf = (l: EngineLine): Score => (l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 });

/** The rest of a line after its first move: the opponent's best answer to it. */
function tail(line: StoredLine): StoredLine | null {
  return line.pv.length > 1 ? { pv: line.pv.slice(1), score: line.score, depth: line.depth } : null;
}

export function storedScore(card: ScoreTarget, uci: string, isMate: boolean): MoveScore | null {
  const base = { uci, best: card.best };
  if (uci === card.best.uci) return { ...base, loss: 0, exact: true, source: 'best', reply: tail(card.best) };
  if (isMate) return { ...base, loss: 0, exact: false, source: 'mate', reply: null };
  if (card.second?.uci === uci) {
    const loss = Math.max(0, winFor(card.color, card.best.score) - winFor(card.color, card.second.score));
    return { ...base, loss, exact: false, source: 'stored', reply: tail(card.second) };
  }
  const played = card.sources?.find((s) => s.uci === uci);
  if (played) return { ...base, loss: played.loss, exact: false, source: 'game', reply: played.reply };
  const cached = card.scored?.[uci];
  if (cached) return { uci, loss: cached.loss, exact: false, source: 'engine', best: cached.best, reply: cached.reply };
  return null;
}

export async function engineScore(card: ScoreTarget, uci: string, engine: Pick<Engine, 'analyse'> = factsEngine()): Promise<MoveScore> {
  const lines = await engine.analyse(card.fen, { depth: POSITIONS.scoreDepth, multipv: 2, searchmoves: [card.best.uci, uci] });
  const top = lines[0];
  const mine = lines.find((l) => l.pv[0] === uci);
  if (!top || !mine) throw new Error(`engine gave no line for ${uci}`);
  const loss = Math.max(0, winFor(card.color, scoreOf(top)) - winFor(card.color, scoreOf(mine)));
  const mineStored: StoredLine = { pv: mine.pv.slice(0, 13), score: scoreOf(mine), depth: mine.depth };
  return {
    uci,
    loss,
    exact: false,
    source: 'engine',
    best: { uci: top.pv[0]!, pv: top.pv.slice(0, 16), score: scoreOf(top), depth: top.depth },
    reply: tail(mineStored),
  };
}
