// One deck, trained in the Chessable style: its lines only, its reviews
// first, its trunk played by itself unless a position on it is due. A deck
// built from any opening also says where it answers differently from your
// repertoire, and can grow or go.
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Board } from '@/components/board/Board';
import { AnalyseButton, RepAnalysis, RepDrillBoard } from '@/components/openings/RepAnalysis';
import { RepFeedbackPanel } from '@/components/openings/RepFeedbackPanel';
import { useRepDrill } from '@/components/openings/useRepDrill';
import { MemoryPanel } from '@/components/positions/MemoryPanel';
import { START_FEN } from '@/lib/chess/replay';
import { plural } from '@/lib/format';
import { fenAfter } from '@/lib/openings/study';
import { BUILD } from '@/lib/decks/build';
import { deepenStudyDeck, deleteStudyDeck } from '@/lib/decks/store';
import type { AnswerSource, StudyDeck } from '@/lib/decks/types';
import { startFor, type DeckView } from '@/lib/decks/views';
import { chapterRoot, reachableFrom } from '@/lib/repertoire/data';
import { progress } from '@/lib/repertoire/drill';
import type { GamesIndex } from '@/lib/repertoire/games';
import type { RepCard } from '@/lib/types';
import { BuildingNote } from './DeckList';
import { Frame } from './Frame';
import { PunishPanel } from './PunishPanel';
import { PunishSession } from './PunishSession';

const SOURCE_LABEL: Record<AnswerSource, string> = { study: 'do seu estudo', repertoire: 'do seu repertório', engine: 'do Stockfish' };

function BackTitle({ deck, onBack }: { deck: { name: string; side: 'white' | 'black' }; onBack: () => void }) {
  return (
    <>
      <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={16} /> Todos os decks</button>
      <h2 className="flex items-center gap-2 text-xl font-extrabold leading-tight">
        <span className={clsx('inline-block h-3 w-3 shrink-0 rounded-[2px]', deck.side === 'white' ? 'bg-white' : 'border border-ink-4 bg-[#2b2927]')} />
        {deck.name}
      </h2>
    </>
  );
}

/**
 * A deck, or the wait while one from any opening is building: a drill on
 * screen holds the background engine (renewal/activity.ts), so the deck would
 * wait for its own screen.
 */
export function DeckScreen({ deck, study, index, onBack }: { deck: DeckView | null; study: StudyDeck | undefined; index: GamesIndex | null; onBack: () => void }) {
  if (!deck || study?.status === 'building') {
    return (
      <Frame board={<Board fen={study ? fenAfter(study.opening.moves) : START_FEN} orientation={study?.side ?? 'white'} lastMove={null} movable={null} />}>
        <div className="rounded-lg bg-panel p-4">
          {study ? <BackTitle deck={study} onBack={onBack} /> : <BackTitle deck={{ name: 'Deck', side: 'white' }} onBack={onBack} />}
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-3">{study ? <><Loader2 size={14} className="shrink-0 animate-spin" /> <span><BuildingNote deck={study} /></span></> : 'Este deck não existe mais.'}</p>
          {study && (
            <p className="mt-2 text-xs text-ink-4">
              As linhas mais jogadas no seu nível viram posições do deck, uma a uma; o treino abre quando ele ficar pronto, de alguns segundos a um ou dois minutos. Pode sair desta tela: a montagem continua (e espera enquanto você treina outra coisa).
            </p>
          )}
        </div>
      </Frame>
    );
  }
  return <DeckOrPunish key={deck.id} deck={deck} study={study} index={index} onBack={onBack} />;
}

/** The deck's lines, or its session of punishments (the drill unmounts: nothing holds the engine meanwhile). */
function DeckOrPunish(props: { deck: DeckView; study: StudyDeck | undefined; index: GamesIndex | null; onBack: () => void }) {
  const [punishing, setPunishing] = useState(false);
  if (punishing) return <PunishSession deck={props.deck} index={props.index} onBack={() => setPunishing(false)} />;
  return <DeckTrainer {...props} onPunish={() => setPunishing(true)} />;
}

function DeckTrainer({ deck, study, index, onBack, onPunish }: { deck: DeckView; study: StudyDeck | undefined; index: GamesIndex | null; onBack: () => void; onPunish: () => void }) {
  const [lineId, setLineId] = useState('all');
  const chapter = lineId === 'all' ? null : (deck.chapters.find((c) => c.id === lineId) ?? null);
  const scope = useMemo(() => (chapter ? new Set(chapter.own ?? reachableFrom(deck.tree, chapterRoot(chapter.entry))) : deck.scope), [chapter, deck]);
  const ours = useMemo(() => (chapter ? deck.ours.filter((e) => scope?.has(e)) : deck.ours), [chapter, deck, scope]);
  // The whole deck from move 1 (a deck from any opening after its opening's moves); one chapter after its trunk, unless a position on it is due.
  const drill = useRepDrill({
    side: deck.side,
    ns: deck.ns,
    rep: deck.tree,
    index,
    lineKey: `${deck.id}:${lineId}`,
    prefix: chapter ? chapter.entry : deck.start,
    ...(chapter ? { startFor: (cards: Map<string, RepCard>) => startFor({ prefix: chapter.entry, tree: deck.tree, side: deck.side }, cards) } : {}),
    scope,
    prefer: 'due',
    // The shared start's opponent moves come as written, wherever the line starts.
    script: chapter ? chapter.entry : deck.prefix,
    ...(deck.kind === 'study' ? { book: 'do deck' } : {}),
  });
  const { feedback, lines } = drill;
  const prog = progress(drill.cards, ours);

  return (
    <Frame board={<RepDrillBoard drill={drill} side={deck.side} rep={deck.tree} />}>
      <div className="rounded-lg bg-panel p-4">
        <BackTitle deck={deck} onBack={onBack} />
        {deck.chapters.length > 1 && (
          <>
            <label className="mt-3 block text-sm font-bold text-ink-3" htmlFor="deck-line">Treinar</label>
            <select id="deck-line" value={lineId} onChange={(e) => setLineId(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-panel-2 px-3 py-2">
              <option value="all">O deck inteiro</option>
              {deck.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full bg-go" style={{ width: `${(100 * prog.learned) / Math.max(1, prog.total)}%` }} />
        </div>
        <p className="mt-1.5 text-sm text-ink-3">{prog.learned} de {prog.total} posições aprendidas · {prog.due} para revisar</p>
      </div>
      <RepFeedbackPanel drill={drill} footer={`Sessão: ${plural(lines.done, 'linha')} · ${plural(lines.correct, 'certo')} · ${plural(lines.wrong, 'erro')}`} />
      <AnalyseButton drill={drill} />
      <RepAnalysis drill={drill} side={deck.side} rep={deck.tree} />
      {!drill.exploring && (
        <button type="button" className={clsx(feedback.kind === 'end' ? 'btn-go' : 'btn-flat')} onClick={drill.newLine}>
          {feedback.kind === 'end' ? 'Próxima linha' : 'Pular para outra linha'}
        </button>
      )}
      <PunishPanel deck={deck} onStart={onPunish} />
      {study && <StudyPanel study={study} />}
      <p className="text-xs text-ink-4">
        {deck.kind === 'repertoire'
          ? 'As revisões são as do seu repertório: uma posição que está em dois decks é um card só.'
          : 'Este deck tem cards próprios: pode responder diferente do seu repertório.'}{' '}
        A nota vale pela primeira tentativa em cada posição: errou é Errei; certo é Difícil, Bom ou Fácil pelo seu tempo.
      </p>
      <MemoryPanel kind="rep" />
    </Frame>
  );
}

function StudyPanel({ study }: { study: StudyDeck }) {
  const [confirm, setConfirm] = useState(false);
  const counts = Object.values(study.sources).reduce<Record<AnswerSource, number>>((c, s) => ({ ...c, [s]: c[s] + 1 }), { study: 0, repertoire: 0, engine: 0 });
  const parts = (Object.keys(SOURCE_LABEL) as AnswerSource[]).filter((k) => counts[k]).map((k) => `${counts[k]} ${SOURCE_LABEL[k]}`);
  const building = study.status === 'building';
  return (
    <div className="rounded-lg bg-panel p-4 text-sm">
      <p className="text-ink-2">
        {study.opening.name} ({study.opening.eco}). As respostas do adversário são o que se joga no seu nível; as suas: {parts.join(', ') || 'nenhuma ainda'}.
      </p>
      {building && <p className="mt-2 flex items-center gap-1.5 text-ink-3"><Loader2 size={14} className="animate-spin" /> <BuildingNote deck={study} /></p>}
      {study.differs.length > 0 && (
        <div className="mt-3 rounded-md bg-panel-2 p-3">
          <p className="flex items-center gap-1.5 font-bold text-cls-inaccuracy"><AlertTriangle size={14} /> Diferente do seu repertório</p>
          <ul className="mt-1 space-y-0.5 text-ink-3">
            {study.differs.map((d) => <li key={d.epd}>Seu repertório responde {d.repertoire} aqui; este deck treina {d.deck}.</li>)}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-flat flex items-center gap-1.5" disabled={building} onClick={() => void deepenStudyDeck(study.id)}>
          <Plus size={16} /> Aprofundar (+{BUILD.deepen} posições)
        </button>
        {confirm ? (
          <>
            <button type="button" className="btn-flat flex items-center gap-1.5 text-cls-miss" onClick={() => void deleteStudyDeck(study.id)}>
              <Trash2 size={16} /> Excluir o deck e os cards
            </button>
            <button type="button" className="btn-flat" onClick={() => setConfirm(false)}>Manter</button>
          </>
        ) : (
          <button type="button" className="btn-flat flex items-center gap-1.5" onClick={() => setConfirm(true)}>
            <Trash2 size={16} /> Excluir
          </button>
        )}
      </div>
    </div>
  );
}
