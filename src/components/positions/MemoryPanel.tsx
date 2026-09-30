// "How your memory is doing": real retention on long-term reviews against
// what FSRS predicted, the grading rule your data picked, and when the
// parameters are fitted next.
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { default_w } from 'ts-fsrs';
import { Panel } from '@/components/Layout';
import { db } from '@/lib/db';
import { plural } from '@/lib/format';
import { maybeOptimize, OPTIMIZE_EVERY, optimizerAvailable, type SrsModel } from '@/lib/srs/optimizer';
import { retentionStats } from '@/lib/srs/retention';
import type { CardKind } from '@/lib/srs/types';

const pct = (x: number) => `${Math.round(x * 100)}%`;

const WHAT_RETURNS: Record<CardKind, string> = {
  best: 'as posições',
  seq: 'as sequências',
  puzzle: 'os puzzles',
  rep: 'as posições do repertório',
};

export function MemoryPanel({ kind }: { kind: CardKind }) {
  const logs = useLiveQuery(() => db.reviewLogs.where('[kind+at]').between([kind, 0], [kind, Number.MAX_SAFE_INTEGER]).toArray(), [kind]);
  const model = useLiveQuery(async () => ((await db.kv.get(`srs:model:${kind}`))?.value as SrsModel | undefined) ?? null, [kind]);
  const [server, setServer] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void optimizerAvailable().then(setServer);
  }, []);
  if (!logs) return null;

  const stats = retentionStats(logs, model?.w ?? default_w);
  const next = (model?.reviews ?? 0) + OPTIMIZE_EVERY;
  const left = Math.max(0, Math.max(OPTIMIZE_EVERY, next) - logs.length);
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await maybeOptimize(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setRunning(false);
  };

  return (
    <Panel title="Como sua memória está indo">
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-md bg-panel-2 p-3">
          <div className="text-2xl font-extrabold tabular-nums">{stats.actual === null ? '-' : pct(stats.actual)}</div>
          <div className="text-xs text-ink-3">lembrou nas revisões</div>
        </div>
        <div className="rounded-md bg-panel-2 p-3">
          <div className="text-2xl font-extrabold tabular-nums">{stats.predicted === null ? '-' : pct(stats.predicted)}</div>
          <div className="text-xs text-ink-3">o FSRS previa</div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-sm text-ink-2">
        <p>
          {plural(stats.reviews, 'tentativa', 'tentativas')}, {plural(stats.longTerm, 'revisão de longo prazo', 'revisões de longo prazo')}.
          {stats.longTerm === 0 && ` A comparação aparece quando ${WHAT_RETURNS[kind]} voltarem depois de dias.`}
        </p>
        {model ? (
          <p>
            Nota em uso: <b className="text-ink">{model.rule === 'timed' ? 'com tempo' : 'sem tempo'}</b>, escolhida pelos seus dados em {new Date(model.at).toLocaleDateString('pt-BR')}
            {model.metrics.timed && model.metrics.untimed && (
              <> (erro de previsão {model.metrics.timed.logLoss.toFixed(3)} com tempo, {model.metrics.untimed.logLoss.toFixed(3)} sem tempo; menor é melhor)</>
            )}
            . {model.w ? 'Parâmetros ajustados a você.' : 'Parâmetros padrão: os ajustados não previram melhor.'}
          </p>
        ) : (
          <p>Nota em uso: com tempo, a regra inicial. A primeira comparação com a regra sem tempo acontece com {OPTIMIZE_EVERY} tentativas.</p>
        )}
        {left > 0 ? (
          <p className="text-ink-3">{model ? 'Próximo ajuste' : 'Primeiro ajuste'} em {plural(left, 'tentativa', 'tentativas')}.</p>
        ) : server === false ? (
          <p className="text-ink-3">O ajuste roda no servidor local: abra o app com npm run dev.</p>
        ) : (
          <button type="button" className="btn-flat mt-1 flex items-center gap-2 text-sm" onClick={() => void run()} disabled={running || !server}>
            {running && <Loader2 size={14} className="animate-spin" />} {running ? 'Ajustando...' : 'Ajustar agora'}
          </button>
        )}
        {error && <p className="text-cls-miss">{error}</p>}
      </div>
    </Panel>
  );
}
