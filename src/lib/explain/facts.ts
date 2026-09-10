// Engine-verified facts about a move. Everything shown to the user (moves,
// lines, evaluations) comes from here: Stockfish plus deterministic code.
import { Chess } from 'chess.js';
import { lineToSan, materialBalance, tryUci } from '../chess/replay.ts';
import { factsEngine } from '../engine/stockfish.ts';
import { winPercent } from '../review/scoring.ts';
import type { Color, EngineLine, Score } from '../types.ts';
import { motifsOf, type Motif } from './motifs.ts';

export interface Payoff {
  /** 0-based index in the line. */
  index: number;
  moveNumber: string; // "27." or "27..."
  san: string;
  kind: 'mate' | 'promotion' | 'material';
  /** Material gained, in pawns, by the side that started the line. */
  swing: number;
  text: string;
}

const lineScore = (l?: EngineLine): Score | undefined => (l ? (l.mate !== undefined ? { mate: l.mate } : { cp: l.cp }) : undefined);

/** Win chance (0-100) for `color` from a White-POV score. */
export function winFor(color: Color, score: Score | undefined): number {
  const w = winPercent(score);
  return color === 'white' ? w : 100 - w;
}

/**
 * Where a line pays off for the side that starts it: the first ply where that
 * side mates, promotes, or is up material that is not undone on the next two
 * plies. Gains for the other side (a deep PV tail, a sacrifice not yet won
 * back) are not the line's idea and are skipped.
 * `baseFen` sets where material is counted from: for the reply to a move,
 * pass the position before that move, so Rxd5 exd5 nets 2, not 5.
 */
export function payoff(fen: string, pv: string[], max = 24, baseFen = fen): Payoff | null {
  const chess = new Chess(fen);
  const starter = chess.turn();
  const sign = starter === 'w' ? 1 : -1;
  const base = sign * materialBalance(baseFen);
  const balances: number[] = [];
  const moves: Array<{ san: string; num: string; promo: boolean; mate: boolean }> = [];
  for (const uci of pv.slice(0, max)) {
    const color = chess.turn();
    const moveNo = Number(chess.fen().split(' ')[5]);
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    moves.push({ san: m.san, num: `${moveNo}${color === 'w' ? '.' : '...'}`, promo: !!m.promotion, mate: chess.isCheckmate() });
    balances.push(sign * materialBalance(chess.fen()) - base);
  }
  const gainer = starter === 'w' ? 'as brancas' : 'as pretas';
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!;
    const ours = i % 2 === 0;
    if (m.mate) return ours ? { index: i, moveNumber: m.num, san: m.san, kind: 'mate', swing: 0, text: `em ${m.num} ${m.san}, com mate` } : null;
    if (m.promo && ours) return { index: i, moveNumber: m.num, san: m.san, kind: 'promotion', swing: balances[i]!, text: `em ${m.num} ${m.san}, quando o peão promove` };
    const d = balances[i]!;
    if (d >= 1) {
      const next = balances.slice(i + 1, i + 3);
      if (next.every((x) => x >= 1)) {
        // Report what is left once the recaptures settle, not the first grab.
        const n = Math.min(d, ...next);
        return { index: i, moveNumber: m.num, san: m.san, kind: 'material', swing: n, text: `em ${m.num} ${m.san}, quando ${gainer} ganham ${n} ponto${n === 1 ? '' : 's'} de material` };
      }
    }
  }
  return null;
}

/**
 * A perpetual check: the side that starts the line checks on every one of its
 * moves until the board repeats. Only pieces and turn are compared: Kf1 Ke1
 * costs the castling right, so the FEN differs, but the check goes on.
 */
export function perpetual(fen: string, pv: string[]): boolean {
  const chess = new Chess(fen);
  const key = () => chess.fen().split(' ').slice(0, 2).join(' ');
  const seen = new Set([key()]);
  let checks = 0;
  for (let i = 0; i < pv.length; i++) {
    if (!tryUci(chess, pv[i]!)) return false;
    if (i % 2 === 0) {
      if (!chess.inCheck()) return false;
      checks++;
    }
    const k = key();
    if (seen.has(k)) return checks >= 2;
    seen.add(k);
  }
  return false;
}

export const PERPETUAL: Motif = { theme: 'perpetualCheck', text: 'xeque perpétuo, força o empate' };

/**
 * A perpetual the engine also scores as a draw. The board comparison in
 * `perpetual` ignores castling rights, so a PV can repeat the board and still
 * go on to an escape; the score tells those apart.
 */
export function perpetualLine(fen: string, line: EngineLine): boolean {
  return line.mate === undefined && Math.abs(line.cp ?? 0) <= 50 && perpetual(fen, line.pv);
}

/** The position with the other side to move, or null when the side to move is in check. */
export function nullMove(fen: string): string | null {
  const chess = new Chess(fen);
  if (chess.inCheck()) return null;
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const flipped = parts.join(' ');
  try {
    new Chess(flipped);
    return flipped;
  } catch {
    return null;
  }
}

/** Below this loss (win-chance points) two moves are the same at your level. */
export function relevanceThreshold(rating: number): number {
  if (rating < 1000) return 5;
  if (rating < 1600) return 3.5;
  if (rating < 2000) return 2.5;
  return 1.5;
}

export interface LineFacts {
  san: string[];
  score: Score;
  payoff: Payoff | null;
  motifs: Motif[];
}

/** `baseFen`: the position before the move being answered (see `payoff`). */
function lineFacts(fen: string, line: EngineLine, baseFen = fen): LineFacts {
  let motifs = line.pv[0] ? motifsOf(fen, line.pv[0], line.mate) : [];
  // "A check that exposes the king" says less than the perpetual it starts.
  if (perpetualLine(fen, line)) motifs = [PERPETUAL, ...motifs.filter((m) => m.theme !== 'exposedKing')];
  return {
    san: lineToSan(fen, line.pv, 12),
    score: lineScore(line) ?? { cp: 0 },
    payoff: payoff(fen, line.pv, 24, baseFen),
    motifs,
  };
}

/**
 * What the best move takes away from the opponent: the reply to the move
 * played forces a perpetual or pays off (mate, promotion, material), and in
 * the best line the opponent gets nothing like it. This is the point of a
 * move with no tactic of its own, like 24.Qc4 covering b5 against
 * ...Qa5+ Kf1 Qb5+.
 */
export function prevented(fenBefore: string, best: EngineLine, reply: LineFacts): Motif | null {
  const draws = reply.motifs.some((m) => m.theme === PERPETUAL.theme);
  const p = reply.payoff;
  if (!draws && !p) return null;
  const chess = new Chess(fenBefore);
  if (!best.pv[0] || !tryUci(chess, best.pv[0])) return null;
  const fen = chess.fen();
  const rest = best.pv.slice(1);
  if (draws) return perpetual(fen, rest) ? null : { theme: 'prevents', text: 'evita o xeque perpétuo' };
  if (!p || payoff(fen, rest, 24, fenBefore)) return null;
  const text = p.kind === 'mate' ? 'evita o mate' : p.kind === 'promotion' ? 'evita a promoção' : `evita perder ${p.swing} ponto${p.swing === 1 ? '' : 's'} de material`;
  return { theme: 'prevents', text };
}

/** Facts for the engine's best line, told against the reply to the move played. */
export function bestLineFacts(fenBefore: string, best: EngineLine, reply: LineFacts | null): LineFacts {
  const facts = lineFacts(fenBefore, best);
  const stop = reply && prevented(fenBefore, best, reply);
  return stop ? { ...facts, motifs: [stop, ...facts.motifs] } : facts;
}

export interface Threat {
  /** Where the line starts: your position with the opponent to move. */
  fen: string;
  /** The opponent's best line if you passed. */
  line: LineFacts;
  /** How much the opponent would gain, in win-chance points. */
  gain: number;
}

/**
 * "What does the opponent threaten?": let the opponent move twice (null
 * move) and see what the engine finds. Only real threats are returned.
 */
export async function threat(fen: string, depth = 16): Promise<Threat | null> {
  const flipped = nullMove(fen);
  if (!flipped) return null;
  const engine = factsEngine();
  const [now] = await engine.analyse(fen, { depth });
  const [theirs] = await engine.analyse(flipped, { depth });
  if (!now || !theirs) return null;
  const them: Color = fen.split(' ')[1] === 'w' ? 'black' : 'white';
  const gain = winFor(them, lineScore(theirs)) - winFor(them, lineScore(now));
  if (gain < 8) return null;
  return { fen: flipped, line: lineFacts(flipped, theirs), gain };
}

export interface Refutation {
  san: string;
  /** Win chance lost against the engine's choice (mover's view). */
  loss: number;
  relevant: boolean;
  best: LineFacts & { firstSan: string };
  /** The opponent's best answer to your move. */
  reply: LineFacts;
}

/** "Why not X?": the concrete answer to any move you propose. */
export async function refute(fen: string, uci: string, rating: number, depth = 18): Promise<Refutation | null> {
  const chess = new Chess(fen);
  let played;
  try {
    played = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
  const mover: Color = played.color === 'w' ? 'white' : 'black';
  const engine = factsEngine();
  const [best] = await engine.analyse(fen, { depth });
  if (!best) return null;
  let reply: EngineLine | undefined;
  if (!chess.isGameOver()) [reply] = await engine.analyse(chess.fen(), { depth });
  const afterScore: Score = chess.isCheckmate() ? { mate: mover === 'white' ? 1 : -1 } : lineScore(reply) ?? { cp: 0 };
  const loss = best.pv[0] === played.lan ? 0 : Math.max(0, winFor(mover, lineScore(best)) - winFor(mover, afterScore));
  const replyFacts = reply ? lineFacts(chess.fen(), reply, fen) : { san: [], score: afterScore, payoff: null, motifs: [] };
  return {
    san: played.san,
    loss,
    relevant: loss >= relevanceThreshold(rating),
    best: { ...bestLineFacts(fen, best, replyFacts), firstSan: lineToSan(fen, best.pv, 1)[0] ?? '' },
    reply: replyFacts,
  };
}

export { lineFacts };
