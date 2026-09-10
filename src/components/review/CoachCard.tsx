import clsx from 'clsx';
import { Eye, Lightbulb, Loader2, MessageSquareText, RotateCcw, ShieldAlert, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClassificationIcon } from '@/components/board/ClassificationIcon';
import { RichText, San } from '@/components/San';
import { lineFacts, relevanceThreshold, threat as findThreat, type Threat } from '@/lib/explain/facts';
import { moveFacts, narrate, narrationAvailable, type Narration } from '@/lib/explain/narrate';
import { explainMove } from '@/lib/review/coach';
import { formatScore } from '@/lib/review/scoring';
import type { GameAnalysis, MoveReview, MoveTag, StoredGame } from '@/lib/types';

const ERRORS = new Set(['inaccuracy', 'mistake', 'blunder', 'miss']);

export const TAG_INFO: Record<MoveTag, { label: string; tone: 'bad' | 'good'; hint: (m: MoveReview) => string }> = {
  'obvious-miss': { label: 'Lance óbvio perdido', tone: 'bad', hint: (m) => `O motor acha ${m.bestSan ?? 'o melhor lance'} já na profundidade ${m.difficulty}, e ele ganha algo concreto em poucos lances.` },
  'obvious-blunder': { label: 'Erro óbvio', tone: 'bad', hint: (m) => `A punição aparece para o motor na profundidade ${m.punishDepth}: é tática de um ou dois lances.` },
  'only-move': { label: 'Único lance encontrado', tone: 'good', hint: () => 'Qualquer outro lance perdia pelo menos 10 pontos de chance.' },
  'hard-find': { label: 'Lance difícil encontrado', tone: 'good', hint: (m) => `O motor só fixa esse lance na profundidade ${m.difficulty}.` },
};

export function TagChips({ move }: { move: MoveReview }) {
  if (!move.tags?.length) return null;
  return (
    <div className="mb-2.5 flex flex-wrap gap-1.5">
      {move.tags.map((t) => (
        <span
          key={t}
          title={TAG_INFO[t].hint(move)}
          className={clsx('rounded px-2 py-0.5 text-[12px] font-extrabold uppercase tracking-wide', TAG_INFO[t].tone === 'bad' ? 'bg-cls-blunder/20 text-cls-miss' : 'bg-go/20 text-go-hover')}
        >
          {TAG_INFO[t].label}
        </span>
      ))}
    </div>
  );
}

interface Props {
  game: StoredGame;
  analysis: GameAnalysis;
  move: MoveReview;
  socratic: boolean;
  revealed: boolean;
  onReveal: () => void;
  showBest: boolean;
  onToggleBest: () => void;
  onRetry: () => void;
  onNextMistake: () => void;
  onThreat: (t: Threat | null) => void;
}

export function CoachCard({ game, analysis, move, socratic, revealed, onReveal, showBest, onToggleBest, onRetry, onNextMistake, onThreat }: Props) {
  const isMine = move.color === game.userColor;
  const isError = ERRORS.has(move.classification);
  const [threat, setThreat] = useState<Threat | null | 'none' | 'loading'>(null);
  const [narration, setNarration] = useState<Narration | 'loading' | null>(null);
  const [canNarrate, setCanNarrate] = useState(false);

  useEffect(() => {
    void narrationAvailable().then(setCanNarrate);
  }, []);
  useEffect(() => {
    setThreat(null);
    setNarration(null);
    onThreat(null);
  }, [move.ply]);

  const bestLine = analysis.evals[move.ply - 1]?.lines[0];
  const replyLine = analysis.evals[move.ply]?.lines[0];
  const note = explainMove(move, bestLine, replyLine, game.userRating);
  const reply = useMemo(() => (replyLine && isError ? lineFacts(move.fenAfter, replyLine, move.fenBefore) : null), [replyLine, isError, move.fenAfter, move.fenBefore]);
  const best = useMemo(() => (bestLine && move.uci !== move.bestUci ? lineFacts(move.fenBefore, bestLine) : null), [bestLine, move.uci, move.bestUci, move.fenBefore]);

  // Answers belong to the move that asked; navigating away drops them.
  const currentPly = useRef(move.ply);
  currentPly.current = move.ply;

  const askThreat = async () => {
    const ply = move.ply;
    setThreat('loading');
    const t = await findThreat(move.fenBefore);
    if (currentPly.current !== ply) return;
    setThreat(t ?? 'none');
    onThreat(t);
  };

  const askNarration = async () => {
    const ply = move.ply;
    setNarration('loading');
    const bundle = moveFacts(game, analysis, move, threat && typeof threat === 'object' ? threat : null);
    let result: Narration;
    try {
      result = await narrate(move.fenBefore, move.uci, bundle, game.userRating);
    } catch (e) {
      result = { key: '', text: null, model: '', error: (e as Error).message, at: Date.now() };
    }
    if (currentPly.current === ply) setNarration(result);
  };

  // Socratic mode: on your own mistakes, ask before telling.
  if (socratic && isMine && isError && !revealed) {
    return (
      <div>
        <div className="flex items-start gap-2.5">
          <ClassificationIcon cls={move.classification} size={24} />
          <p className="text-[15px] font-bold leading-snug">
            Você jogou <San san={move.san} />. Antes de ver a análise: o que você deveria ter visto?
          </p>
        </div>
        {threat && typeof threat === 'object' && <ThreatText threat={threat} />}
        {threat === 'none' && <p className="mt-2 text-sm text-ink-3">O adversário não tinha ameaça concreta: o problema era outro.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={onRetry}><RotateCcw size={15} /> Achar o lance</button>
          <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={askThreat} disabled={threat === 'loading'}>
            {threat === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />} Qual era a ameaça?
          </button>
          <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={onReveal}><Eye size={15} /> Revelar</button>
        </div>
      </div>
    );
  }

  const loss = move.loss ?? Math.max(0, move.winBefore - move.winAfter);
  const relevant = loss >= relevanceThreshold(game.userRating);
  return (
    <div>
      <TagChips move={move} />
      <div className="flex items-start gap-2.5">
        <ClassificationIcon cls={move.classification} size={24} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-snug"><RichText text={note.headline} /></p>
          {note.detail && <p className="mt-1 text-[14px] leading-snug text-ink-2"><RichText text={note.detail} /></p>}
        </div>
        <span className="rounded bg-raise px-1.5 py-0.5 text-[13px] font-bold tabular-nums text-ink-2">{formatScore(move.scoreAfter)}</span>
      </div>

      {isError && reply && reply.san.length > 0 && (
        <div className="mt-2.5 rounded-md bg-black/20 p-2.5 text-[13px] leading-relaxed">
          <div className="font-bold text-cls-miss">Depois de <San san={move.san} />:</div>
          <div className="text-ink-2">{reply.san.slice(0, 6).map((s, i) => <San key={i} san={s} className="mr-1.5" />)}</div>
          {reply.payoff && <div className="text-ink-3"><RichText text={`A punição se concretiza ${reply.payoff.text}.`} /></div>}
          {reply.motifs.slice(0, 2).map((m) => <div key={m.theme} className="text-ink-3">{m.text[0]!.toUpperCase() + m.text.slice(1)}.</div>)}
        </div>
      )}

      {best && relevant && (showBest || isError) && (
        <div className="mt-2 rounded-md bg-black/20 p-2.5 text-[13px] leading-relaxed">
          <div className="font-bold text-go-hover">O melhor era <San san={move.bestSan ?? ''} />:</div>
          <div className="text-ink-2">{best.san.slice(0, 6).map((s, i) => <San key={i} san={s} className="mr-1.5" />)}</div>
          {best.payoff && <div className="text-ink-3"><RichText text={`A ideia se concretiza ${best.payoff.text}.`} /></div>}
          {best.motifs.slice(0, 2).map((m) => <div key={m.theme} className="text-ink-3">{m.text[0]!.toUpperCase() + m.text.slice(1)}.</div>)}
          {!best.payoff && !best.motifs.length && <div className="text-ink-4">Sem tática imediata: é uma melhora de posição.</div>}
        </div>
      )}

      {threat && typeof threat === 'object' && <ThreatText threat={threat} />}
      {threat === 'none' && <p className="mt-2 text-sm text-ink-3">Antes de <San san={move.san} /> o adversário não tinha ameaça concreta.</p>}

      {narration && narration !== 'loading' && (
        <div className="mt-2.5 rounded-md border border-line bg-panel p-2.5 text-[14px] leading-relaxed">
          {narration.text ? <RichText text={narration.text} /> : <span className="text-ink-3">Não saiu uma explicação confiável ({narration.error ?? 'sem resposta'}). Ficam os fatos acima.</span>}
          {narration.text && <div className="mt-1.5 text-[11px] text-ink-4">Narrado por {narration.model} a partir dos fatos do Stockfish; lances conferidos.</div>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {move.bestUci && move.uci !== move.bestUci && relevant && (
          <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={onToggleBest}>
            <Lightbulb size={15} /> {showBest ? 'Esconder' : 'Melhor lance'}
          </button>
        )}
        {isMine && isError && (
          <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={onRetry}><RotateCcw size={15} /> Tentar de novo</button>
        )}
        <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={askThreat} disabled={threat === 'loading'} title="O que o adversário faria se fosse a vez dele de novo (lance nulo)">
          {threat === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />} Ameaça
        </button>
        {canNarrate && (
          <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={askNarration} disabled={narration === 'loading'}>
            {narration === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <MessageSquareText size={15} />} Explicar
          </button>
        )}
        <button type="button" className="btn-flat flex items-center gap-1.5 text-sm" onClick={onNextMistake}><SkipForward size={15} /> Próximo erro</button>
      </div>
    </div>
  );
}

function ThreatText({ threat }: { threat: Threat }) {
  return (
    <div className="mt-2 rounded-md bg-black/20 p-2.5 text-[13px] leading-relaxed">
      <div className="font-bold text-cls-mistake">Ameaça do adversário:</div>
      <div className="text-ink-2">{threat.line.san.slice(0, 5).map((s, i) => <San key={i} san={s} className="mr-1.5" />)}</div>
      {threat.line.motifs.slice(0, 2).map((m) => <div key={m.theme} className="text-ink-3">{m.text[0]!.toUpperCase() + m.text.slice(1)}.</div>)}
      {threat.line.payoff && <div className="text-ink-3"><RichText text={`Se concretiza ${threat.line.payoff.text}.`} /></div>}
    </div>
  );
}
