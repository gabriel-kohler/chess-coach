// One step of a session, whatever it is: a position, a sequence, a puzzle, a
// repertoire line or an endgame, each in the trainer it already has, with the
// session's header, the step's own attempt id, and free practice on a redo.
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Grade, State } from 'ts-fsrs';
import { AnalyseButton, RepAnalysis, RepDrillBoard } from '@/components/openings/RepAnalysis';
import { RepFeedbackPanel } from '@/components/openings/RepFeedbackPanel';
import { useRepDrill, type RepLineEnd } from '@/components/openings/useRepDrill';
import { Round } from '@/components/positions/Round';
import { SequenceRound } from '@/components/positions/SequenceRound';
import { PuzzleExercise, type PuzzleOutcome } from '@/components/tactics/PuzzleExercise';
import { db } from '@/lib/db';
import { ENDGAMES, type EndgameRecord } from '@/lib/endgames';
import { plural } from '@/lib/format';
import { repertoireDecks, type DeckView } from '@/lib/decks/views';
import type { BestMoveCard, SequenceCard } from '@/lib/positions/types';
import type { CompiledSide } from '@/lib/repertoire/compile';
import { chapterRoot, reachableFrom, type CompiledRepertoire } from '@/lib/repertoire/data';
import type { GamesIndex } from '@/lib/repertoire/games';
import { recordAttempt, type SessionItem } from '@/lib/tactics/trainer';
import type { Times } from '@/lib/training/compose';
import { attemptIdOf, gradedResult, outcomeOf, repAttemptIdOf, secs } from '@/lib/training/session';
import type { StepResult, TrainingSession, TrainingStep } from '@/lib/training/types';
import type { Color } from '@/lib/types';
import { DrillView } from '@/pages/Endgames';

export interface StepHandlers {
  /** The step's first result: saved at once, even if you already moved on. */
  onGraded: (stepId: string, result: StepResult, next?: { state: State; due: number } | null) => void;
  /** The step cannot be shown (gone from the repertoire, nothing known to play). */
  onGone: (stepId: string, note: string) => void;
  onNext: () => void;
}

interface Props extends StepHandlers {
  session: TrainingSession;
  step: TrainingStep;
  practice: boolean;
  header: React.ReactNode;
  times: Times;
  /** Undefined while it loads; null when there is no repertoire. `study`: your decks from any opening. */
  openings: { rep: CompiledRepertoire; index: Record<Color, GamesIndex>; study: DeckView[] } | null | undefined;
  /** When this visit to the step began: the step's time. */
  since: number;
}

function Waiting({ header, text }: { header: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      <div className="flex min-w-0 items-center justify-center py-10 text-ink-3 lg:flex-1 lg:py-0"><Loader2 className="animate-spin" /></div>
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]">
        {header}
        <p className="rounded-lg bg-panel p-4 text-sm text-ink-3">{text}</p>
      </aside>
    </div>
  );
}

/** The card as it was when the step opened: its own save must not remount the trainer. */
function useCardOnce<T>(id: string): T | null | undefined {
  const [card, setCard] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void db.srsCards.get(id).then((c) => alive && setCard(c && !c.suspended ? (c as T) : null));
    return () => {
      alive = false;
    };
  }, [id]);
  return card;
}

function PositionStep({ session, step, practice, header, times, since, onGraded, onGone, onNext }: Props) {
  const item = step.item as { kind: 'best' | 'seq'; cardId: string };
  const card = useCardOnce<BestMoveCard | SequenceCard>(item.cardId);
  useEffect(() => {
    if (card === null) onGone(step.id, 'Esta posição saiu do seu treino depois de uma nova análise.');
  }, [card]);
  if (card === undefined) return <Waiting header={header} text="Carregando a posição..." />;
  if (card === null) return <Waiting header={header} text="Esta posição saiu do seu treino." />;
  const attemptId = attemptIdOf(session, step);
  const grade = (rating: Grade, timeMs: number, next: { state: State; due: number }) => onGraded(step.id, gradedResult(rating, timeMs, Date.now(), Date.now() - since), next);
  if (card.kind === 'seq') {
    return <SequenceRound card={card} expected={times.seq} header={header} attemptId={attemptId} practice={practice} onSaved={(next, rating, timeMs) => grade(rating, timeMs, next)} onNext={onNext} />;
  }
  return <Round card={card} expectedMs={times.best[card.bucket]} header={header} attemptId={attemptId} practice={practice} onSaved={(r, rating, timeMs) => grade(rating, timeMs, r.next)} onNext={onNext} />;
}

function PuzzleStep({ session, step, practice, header, since, onGraded, onNext }: Props) {
  const item = (step.item as { kind: 'puzzle'; item: SessionItem }).item;
  const [outcome, setOutcome] = useState<PuzzleOutcome | null>(null);
  const onResult = (solved: boolean, timeMs: number) => {
    void recordAttempt(item, { solved, timeMs }, { attemptId: attemptIdOf(session, step) }).then((out) => {
      setOutcome({ delta: out.after - out.before, rating: out.after, review: out.review });
      const ms = Date.now() - since;
      // A miss or a review has an FSRS grade; a new puzzle solved at once has none.
      const result: StepResult = out.review
        ? gradedResult(out.review.rating, timeMs, Date.now(), ms)
        : { at: Date.now(), ms, outcome: solved ? 'good' : 'fail', label: solved ? `Resolvido, ${secs(timeMs)}` : 'Não resolvido' };
      onGraded(step.id, result);
    });
  };
  return <PuzzleExercise item={item} header={header} practice={practice} outcome={outcome} onResult={onResult} onNext={onNext} />;
}

type RepItem = Extract<TrainingStep['item'], { kind: 'rep' }>;

function RepStep(props: Props) {
  const { step, header, openings, onGone } = props;
  const it = step.item as RepItem;
  const side = openings?.rep.sides[it.side] ?? null;
  // An opening deck's line: your repertoire's deck or one you built (deleted since: the step goes).
  const deck = useMemo(() => {
    if (!it.deckId || !openings || !side) return null;
    return [...repertoireDecks(side), ...openings.study].find((d) => d.id === it.deckId) ?? null;
  }, [openings, side, it.deckId]);
  const chapter = it.line === 'chapter' && !it.deckId ? side?.chapters.find((c) => c.id === it.chapterId) : undefined;
  const gone =
    openings !== undefined &&
    (!side || (!!it.deckId && !deck) || (it.line === 'deviation' && !side.positions[it.key]?.moves.length) || (it.line === 'chapter' && !it.deckId && !chapter));
  useEffect(() => {
    if (gone) onGone(step.id, it.deckId && !deck ? 'Este deck não existe mais.' : 'Esta linha saiu do seu repertório desde que a sessão foi montada.');
  }, [gone]);
  if (openings === undefined) return <Waiting header={header} text="Carregando o repertório..." />;
  if (gone || !side) return <Waiting header={header} text="Esta linha saiu do seu repertório." />;
  // Mounted only with the repertoire at hand: the line starts as soon as it mounts.
  return <RepLine {...props} it={it} side={side} deck={deck} index={openings?.index[it.side] ?? null} entry={chapter?.entry ?? []} />;
}

function RepLine({ session, step, practice, header, since, onGraded, onGone, onNext, it, side, deck, index, entry }: Props & { it: RepItem; side: CompiledSide; deck: DeckView | null; index: GamesIndex | null; entry: string[] }) {
  const root = it.line === 'deviation' ? it.key : it.line === 'chapter' ? chapterRoot(entry) : null;
  const scope = useMemo(() => (it.line !== 'deviation' && deck ? deck.scope : root ? reachableFrom(side, root) : null), [side, root, deck, it.line]);
  // A deck's line: from move 1 (after the opening's moves for a deck from any opening).
  const inDeck = it.line !== 'deviation' && deck ? deck : null;
  const onEnd = (r: RepLineEnd) => {
    if (practice) return;
    if (!r.asked) return onGone(step.id, it.line === 'warmup' ? 'Ainda não há linha que você já treinou deste lado.' : 'A linha acabou antes de chegar à sua vez.');
    const worst = r.ratings.reduce<Grade | null>((w, g) => (w === null || g < w ? g : w), null);
    const outcome = r.wrong ? 'fail' : worst !== null ? outcomeOf(worst) : 'good';
    onGraded(step.id, { at: Date.now(), ms: Date.now() - since, outcome, ...(worst !== null ? { grade: worst } : {}), label: `${plural(r.asked, 'lance')}, ${plural(r.wrong, 'erro')}`, line: r.line });
  };
  const drill = useRepDrill({
    side: it.side,
    rep: inDeck?.tree ?? side,
    index,
    lineKey: step.id,
    prefix: it.line === 'deviation' ? (it.replay ?? []) : inDeck ? inDeck.start : entry,
    ...(inDeck ? { ns: inDeck.ns, ...(inDeck.kind === 'study' ? { book: 'do deck' } : {}) } : {}),
    scope,
    ...(it.line === 'review' ? { prefer: 'due' as const } : it.line === 'warmup' ? { prefer: 'known' as const } : {}),
    // A redo replays the same line; a deck's line follows its trunk when it starts before the end of it.
    ...(practice && step.result?.line ? { script: step.result.line } : inDeck ? { script: inDeck.prefix } : {}),
    graded: !practice,
    attemptIdFor: (epd) => repAttemptIdOf(session, step, epd),
    onEnd,
  });
  const { ended } = drill;
  const tree = inDeck?.tree ?? side;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 lg:flex-row lg:p-5">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 40px)' }}>
          <RepDrillBoard drill={drill} side={it.side} rep={tree} />
        </div>
      </div>
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-[380px]">
        {header}
        <RepFeedbackPanel drill={drill} footer={practice ? 'Treino livre: a mesma linha, sem nota.' : 'A nota vale pela primeira tentativa em cada posição.'} />
        <AnalyseButton drill={drill} />
        <RepAnalysis drill={drill} side={it.side} rep={tree} />
        {ended && (
          <button type="button" className="btn-go text-[17px]" onClick={onNext} autoFocus>
            Próxima
          </button>
        )}
      </aside>
    </div>
  );
}

function EndgameStep({ step, practice, header, since, onGraded, onGone, onNext }: Props) {
  const drill = ENDGAMES.find((d) => d.id === (step.item as { drillId: string }).drillId);
  const records = useLiveQuery(async () => ((await db.kv.get('endgames'))?.value as Record<string, EndgameRecord>) ?? {}, []);
  useEffect(() => {
    if (!drill) onGone(step.id, 'Este final não existe mais.');
  }, [drill]);
  if (!drill) return <Waiting header={header} text="Este final não existe mais." />;
  return (
    <DrillView
      drill={drill}
      records={records ?? {}}
      header={header}
      practice={practice}
      countOnce
      onFinish={(ok, moves) => onGraded(step.id, { at: Date.now(), ms: Date.now() - since, outcome: ok ? 'good' : 'fail', label: ok ? `Conseguiu, ${plural(moves, 'lance')}` : 'Não foi dessa vez' })}
      onNext={onNext}
    />
  );
}

export function StepView(props: Props) {
  // The step as it was when this visit began. Every save reads the session
  // back from the database (new objects): a fresh puzzle object would restart it.
  const [step] = useState(props.step);
  const p = { ...props, step };
  switch (step.item.kind) {
    case 'best':
    case 'seq':
      return <PositionStep {...p} />;
    case 'puzzle':
      return <PuzzleStep {...p} />;
    case 'rep':
      return <RepStep {...p} />;
    case 'endgame':
      return <EndgameStep {...p} />;
  }
}
