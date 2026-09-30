// A deck's session of punishments: its reviews first, then new mistakes
// people at your level make in it, then Lichess opening puzzles of its
// openings. The app plays the mistake; any move within 5 points of Stockfish's
// punishment is right, and its line to the end comes when you ask for it.
// Nothing here moves your tactics rating. The board keeps the deck's frame.
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PuzzleExercise, type PuzzleOutcome } from '@/components/tactics/PuzzleExercise';
import type { DeckView } from '@/lib/decks/views';
import { plural } from '@/lib/format';
import { loadLevel } from '@/lib/openings/level';
import { deckSession } from '@/lib/punish/select';
import { loadScanState, punishCards } from '@/lib/punish/store';
import { lichessForDeck } from '@/lib/punish/lichess';
import type { GamesIndex } from '@/lib/repertoire/games';
import { recordAttempt, type SessionItem } from '@/lib/tactics/trainer';
import { Frame } from './Frame';

export function PunishSession({ deck, index, onBack }: { deck: DeckView; index: GamesIndex | null; onBack: () => void }) {
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [at, setAt] = useState(0);
  const [outcome, setOutcome] = useState<PuzzleOutcome | null>(null);
  const [score, setScore] = useState({ done: 0, solved: 0 });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ items: found }, cards, level] = await Promise.all([loadScanState(), punishCards(), loadLevel()]);
      const lichess = await lichessForDeck(deck).catch(() => []);
      const reach = (i: { before: string }) => [...(index?.tree.get(i.before)?.values() ?? [])].reduce((s, x) => s + x.n, 0);
      if (alive) setItems(deckSession(deck, Object.values(found), cards, lichess, level.rating, Date.now(), reach));
    })();
    return () => {
      alive = false;
    };
  }, [deck.id]);

  const header = (
    <div className="rounded-lg bg-panel p-4">
      <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={16} /> Voltar ao deck</button>
      <div className="font-extrabold leading-tight">{deck.name}: Punir</div>
      {items && items.length > 0 && <p className="mt-1 text-xs text-ink-4">{Math.min(at + 1, items.length)} de {items.length} · {plural(score.solved, 'certo', 'certos')} de primeira</p>}
    </div>
  );

  if (!items) return <div className="flex items-center gap-2 px-8 text-ink-3"><Loader2 size={16} className="animate-spin" /> Montando a sessão...</div>;
  const item = items[at];
  if (!item) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-6">
        {header}
        <p className="rounded-lg bg-panel p-4 text-sm text-ink-2">
          {items.length
            ? `Sessão feita: ${score.solved} de ${score.done} certos de primeira. As punições voltam na revisão e no Treinar.`
            : 'Nada para punir neste deck por enquanto: a busca pelos erros comuns ainda não passou por ele, ou não achou nenhum.'}
        </p>
        <button type="button" className="btn-go" onClick={onBack}>Voltar ao deck</button>
      </div>
    );
  }
  return (
    <PuzzleExercise
      key={at}
      item={item}
      header={header}
      frame={(board, panel) => <Frame board={board}>{panel}</Frame>}
      outcome={outcome}
      onResult={(solved, timeMs) => {
        setScore((s) => ({ done: s.done + 1, solved: s.solved + (solved ? 1 : 0) }));
        void recordAttempt(item, { solved, timeMs }).then((out) => setOutcome({ delta: 0, rating: out.after, review: out.review }));
      }}
      onNext={() => {
        setOutcome(null);
        setAt((a) => a + 1);
      }}
    />
  );
}
