// Client side of the optional narration: builds the facts JSON from the
// analysis (engine + code only), picks the model and caches the answer.
import { CLASS_LABEL } from '@/components/board/ClassificationIcon';
import { db } from '../db.ts';
import type { GameAnalysis, MoveReview, StoredGame } from '../types.ts';
import { bestLineFacts, lineFacts, relevanceThreshold, type LineFacts, type Threat } from './facts.ts';

export type NarrationModel = 'claude-sonnet-5' | 'claude-opus-5';

export interface Narration {
  key: string;
  text: string | null;
  model: string;
  error?: string;
  at: number;
}

let status: Promise<boolean> | null = null;
export function narrationAvailable(): Promise<boolean> {
  status ??= fetch('/api/narrate/status')
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((j: { available?: boolean }) => !!j.available)
    .catch(() => false);
  return status;
}

const pct = (x: number) => Math.round(x);

function lineJson(l: LineFacts | null) {
  if (!l) return undefined;
  return {
    lances: l.san,
    ondeRende: l.payoff?.text,
    motivos: l.motifs.map((m) => m.text),
  };
}

export interface MoveFactsBundle {
  facts: Record<string, unknown>;
  allowed: string[];
  positional: boolean;
}

/** Facts about one reviewed move, all taken from the stored analysis. */
export function moveFacts(game: StoredGame, analysis: GameAnalysis, move: MoveReview, threat: Threat | null): MoveFactsBundle {
  const bestRaw = analysis.evals[move.ply - 1]?.lines[0];
  const replyRaw = analysis.evals[move.ply]?.lines[0];
  const reply = replyRaw ? lineFacts(move.fenAfter, replyRaw, move.fenBefore) : null;
  const best = bestRaw && move.uci !== move.bestUci ? bestLineFacts(move.fenBefore, bestRaw, reply) : null;
  const loss = move.loss ?? Math.max(0, move.winBefore - move.winAfter);
  const facts = {
    lance: `${Math.ceil(move.ply / 2)}${move.color === 'white' ? '.' : '...'} ${move.san}`,
    quemJogou: move.color === game.userColor ? 'o aluno' : 'o adversário',
    cor: move.color === 'white' ? 'brancas' : 'pretas',
    classificacao: CLASS_LABEL[move.classification],
    chanceDeVitoriaAntes: pct(move.winBefore),
    chanceDeVitoriaDepois: pct(move.winAfter),
    perdaEmPontosDeChance: pct(loss),
    equivalenteNoNivelDoAluno: loss < relevanceThreshold(game.userRating),
    tempoGastoSegundos: move.timeSpent ?? undefined,
    melhorLance: best ? { lance: move.bestSan, ...lineJson(best) } : undefined,
    respostaDoAdversario: reply ? lineJson(reply) : undefined,
    ameacaAntesDoLance: threat ? { ...lineJson(threat.line), ganhoDoAdversario: pct(threat.gain) } : undefined,
    rotulos: (move.tags ?? []).map((t) => ({ 'obvious-miss': 'lance óbvio perdido', 'obvious-blunder': 'erro óbvio', 'only-move': 'único lance encontrado', 'hard-find': 'lance difícil encontrado' })[t]),
    profundidadeParaAcharOMelhor: move.difficulty,
    profundidadeParaAcharAPunicao: move.punishDepth,
  };
  const allowed = new Set<string>([move.san]);
  if (move.bestSan) allowed.add(move.bestSan);
  for (const l of [best, reply, threat?.line ?? null]) for (const s of l?.san ?? []) allowed.add(s);
  const concrete = [best, reply].some((l) => l && (l.payoff || l.motifs.length));
  return { facts, allowed: [...allowed], positional: !concrete };
}

export async function narrate(fen: string, uci: string, bundle: MoveFactsBundle, rating: number): Promise<Narration> {
  const model: NarrationModel = bundle.positional ? 'claude-opus-5' : 'claude-sonnet-5';
  const key = `${fen}|${uci}|${model}`;
  const cached = await db.narrations.get(key);
  if (cached?.text) return cached;
  const res = await fetch('/api/narrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, rating, facts: bundle.facts, allowed: bundle.allowed }),
  });
  const body = (await res.json()) as { text?: string | null; model?: string; error?: string; rejected?: string[] };
  const narration: Narration = {
    key,
    text: body.text ?? null,
    model: body.model ?? model,
    error: body.error ?? (body.rejected?.length ? `citou lances fora dos fatos (${body.rejected.join(', ')})` : undefined),
    at: Date.now(),
  };
  if (narration.text) await db.narrations.put(narration);
  return narration;
}
