// Deterministic coach text: every statement comes from the engine lines and
// the chess.js motif detector, never from free-form guessing.
import { lineToSan } from '../chess/replay.ts';
import { PERPETUAL, perpetualLine, relevanceThreshold } from '../explain/facts.ts';
import { enPrise, motifsOf, PIECE_NAME } from '../explain/motifs.ts';
import type { EngineLine, MoveReview } from '../types.ts';

export interface CoachNote {
  headline: string;
  detail: string | null;
  line: string[] | null;
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** What the opponent's best reply does to you. */
function punishment(move: MoveReview, reply?: EngineLine): string | null {
  const uci = reply?.pv[0];
  if (!uci) return null;
  const moverSign = move.color === 'white' ? 1 : -1;
  if (reply.mate !== undefined && moverSign * reply.mate < 0) {
    const n = Math.abs(reply.mate);
    return n <= 1 ? 'Permite mate em 1.' : `Permite mate em ${n}.`;
  }
  const motif = perpetualLine(move.fenAfter, reply) ? PERPETUAL : motifsOf(move.fenAfter, uci, reply.mate)[0];
  const san = lineToSan(move.fenAfter, [uci])[0];
  if (motif && san) return `Permite ${san}: ${motif.text}.`;
  const hanging = enPrise(move.fenAfter, move.color === 'white' ? 'w' : 'b')[0];
  if (hanging) return `Deixa ${hanging.type === 'r' || hanging.type === 'q' ? 'a' : 'o'} ${PIECE_NAME[hanging.type]} em ${hanging.square} sem defesa suficiente.`;
  return san ? `A resposta forte é ${san}.` : null;
}

/** What the best move would have achieved. */
function opportunity(move: MoveReview, best?: EngineLine): string | null {
  if (!best?.pv[0] || !move.bestSan) return null;
  const moverSign = move.color === 'white' ? 1 : -1;
  if (best.mate !== undefined && moverSign * best.mate > 0) return `${move.bestSan} dava mate em ${Math.abs(best.mate)}.`;
  const motif = perpetualLine(move.fenBefore, best) ? PERPETUAL : motifsOf(move.fenBefore, best.pv[0], best.mate)[0];
  return motif ? `${move.bestSan}: ${motif.text}.` : null;
}

export function explainMove(move: MoveReview, bestLine?: EngineLine, replyLine?: EngineLine, rating = 1500): CoachNote {
  const san = move.san;
  const best = move.bestSan;
  const line = move.bestLine ? lineToSan(move.fenBefore, move.bestLine, 8) : null;
  const equivalent = (move.loss ?? Math.max(0, move.winBefore - move.winAfter)) < relevanceThreshold(rating);
  switch (move.classification) {
    case 'book':
      return { headline: `${san} é teoria.`, detail: null, line: null };
    case 'brilliant':
      return { headline: `${san} é brilhante!`, detail: 'Um sacrifício que funciona: o motor confirma que você não perde nada.', line };
    case 'great':
      return { headline: `${san} é um ótimo lance.`, detail: move.winAfter >= 55 ? 'Era o único lance que mantinha a vantagem.' : 'Era o único lance que segurava a posição.', line };
    case 'best':
      return { headline: `${san} é o melhor lance.`, detail: null, line };
    case 'excellent':
    case 'good':
      return {
        headline: `${san} é ${move.classification === 'excellent' ? 'excelente' : 'bom'}.`,
        detail: best && best !== san ? (equivalent ? `Equivalente a ${best} no seu nível.` : `${best} era mais preciso.`) : null,
        line,
      };
    case 'miss':
      return { headline: `${san}: chance perdida.`, detail: opportunity(move, bestLine) ?? (best ? `O melhor era ${best}.` : null), line };
    case 'inaccuracy':
      return { headline: `${san} é uma imprecisão.`, detail: best ? cap(`o melhor era ${best}.`) : null, line };
    case 'mistake':
      return { headline: `${san} é um erro.`, detail: punishment(move, replyLine), line };
    case 'blunder':
      return { headline: `${san} é uma capivarada.`, detail: punishment(move, replyLine), line };
  }
}
