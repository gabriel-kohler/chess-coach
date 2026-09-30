// The end of a session: what each part gave, and what comes next. After the
// warm-up, the rules to take into the games, from your own diagnostics.
import clsx from 'clsx';
import { AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Panel } from '@/components/Layout';
import { plural } from '@/lib/format';
import { useGamesAndAnalyses } from '@/lib/hooks';
import { useAccount } from '@/lib/settings';
import { buildInsights } from '@/lib/stats/insights';
import { gameReminders, type Reminder } from '@/lib/training/reminders';
import { activeMs, BLOCK_LABEL, summarize } from '@/lib/training/session';
import type { TrainingSession } from '@/lib/training/types';

function Blocks({ session, onGo }: { session: TrainingSession; onGo: (index: number) => void }) {
  const rows = summarize(session);
  const firstOf = (block: string, status?: 'skipped') => session.steps.findIndex((s) => s.block === block && (!status || s.status === status));
  return (
    <ul className="mt-4 divide-y divide-line/60">
      {rows.map((r) => (
        <li key={r.block} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
          <button type="button" className="min-w-[96px] text-left font-bold text-ink hover:text-go-hover" onClick={() => onGo(firstOf(r.block))}>{BLOCK_LABEL[r.block]}</button>
          <span className="tabular-nums text-ink-3">{r.done} de {r.done + r.skipped + r.pending}</span>
          <span className="ml-auto flex gap-1.5 text-[12px] font-extrabold tabular-nums">
            {r.good > 0 && <span className="rounded bg-go/20 px-1.5 py-0.5 text-go-hover">{r.good} certo{r.good > 1 ? 's' : ''}</span>}
            {r.hard > 0 && <span className="rounded bg-cls-inaccuracy/20 px-1.5 py-0.5 text-cls-inaccuracy">{r.hard} difícil</span>}
            {r.fail > 0 && <span className="rounded bg-cls-blunder/20 px-1.5 py-0.5 text-cls-miss">{r.fail} erro{r.fail > 1 ? 's' : ''}</span>}
            {r.skipped > 0 && (
              <button type="button" className="rounded bg-raise px-1.5 py-0.5 text-ink-3 hover:text-ink" onClick={() => onGo(firstOf(r.block, 'skipped'))}>
                {r.skipped} pulado{r.skipped > 1 ? 's' : ''}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function useReminders(): Reminder[] {
  const account = useAccount();
  const { games, analyses } = useGamesAndAnalyses();
  return useMemo(() => (games && analyses ? gameReminders(buildInsights(games, analyses, account ?? null), games, Date.now()) : []), [games, analyses, account]);
}

function Reminders({ reminders }: { reminders: Reminder[] }) {
  if (!reminders.length) return null;
  return (
    <div className="mt-4 rounded-md bg-panel-2 p-3">
      <div className="mb-1.5 font-bold text-ink">Para as partidas de agora</div>
      <ul className="space-y-1.5 text-sm text-ink-2">
        {reminders.map((r) => (
          <li key={r.text} className={clsx('flex items-start gap-2', r.stop && 'font-bold text-ink')}>
            {r.stop ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-cls-miss" /> : <ShieldCheck size={16} className="mt-0.5 shrink-0 text-go" />} {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrainingSummary({ session, onGo, onMore, extending }: {
  session: TrainingSession;
  onGo: (index: number) => void;
  onMore?: () => void;
  extending: boolean;
}) {
  const minutes = Math.max(1, Math.round(activeMs(session) / 60_000));
  const done = session.steps.filter((s) => s.status === 'done').length;
  const warmup = session.mode === 'warmup';
  const reminders = useReminders();
  // Today's rule says stop: the warm-up does not end on a "play" button.
  const stop = warmup && reminders.some((r) => r.stop);
  if (!session.steps.length) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <Panel>
          <h2 className="text-2xl font-extrabold">Nada para treinar agora</h2>
          <p className="mt-2 text-sm text-ink-2">Não há revisões nem material novo para montar a sessão.</p>
          {session.notes.map((n) => <p key={n} className="mt-2 text-sm text-cls-inaccuracy">{n}</p>)}
          <Link to="/" className="btn-go mt-5 block text-center">Voltar para a Início</Link>
        </Panel>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Panel>
        <h2 className="text-2xl font-extrabold">{stop ? 'Aquecimento feito' : warmup ? 'Pronto para jogar' : 'Treino do dia concluído'}</h2>
        <p className="mt-1 text-sm text-ink-3">
          {plural(done, 'exercício', 'exercícios')} em {plural(minutes, 'minuto')}. Clique numa parte para rever ou refazer: o que já foi feito abre como treino livre.
        </p>
        <Blocks session={session} onGo={onGo} />
        {session.leftover > 0 && <p className="mt-3 text-sm text-ink-3">{plural(session.leftover, 'revisão ficou', 'revisões ficaram')} para amanhã: a sessão tem teto de metade do tempo para elas.</p>}
        {session.notes.map((n) => <p key={n} className="mt-2 text-sm text-cls-inaccuracy">{n}</p>)}
        {warmup && <Reminders reminders={reminders} />}
        <div className="mt-5 flex flex-wrap gap-3">
          {warmup ? (
            !stop && (
              <a href="https://www.chess.com/play/online" target="_blank" rel="noreferrer" className="btn-go flex flex-1 items-center justify-center gap-2" autoFocus>
                Jogar no chess.com <ExternalLink size={17} />
              </a>
            )
          ) : (
            onMore && (
              <button type="button" className="btn-go flex-1" onClick={onMore} disabled={extending} autoFocus>
                {extending ? 'Montando...' : 'Mais 10 minutos'}
              </button>
            )
          )}
          <Link to="/" className={clsx('flex items-center justify-center px-4', stop ? 'btn-go flex-1' : 'btn-flat')}>Voltar para a Início</Link>
        </div>
      </Panel>
    </div>
  );
}
