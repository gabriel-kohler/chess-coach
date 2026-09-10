import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { syncAccount, type SyncProgress } from '@/lib/chesscom/sync';
import { plural } from '@/lib/format';

export function SyncButton({ username, compact = false }: { username: string; compact?: boolean }) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress.phase !== 'done';

  const run = async () => {
    setError(null);
    try {
      await syncAccount(username, setProgress);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {!compact && progress && (
        <span className="text-sm text-ink-3">
          {progress.phase === 'done'
            ? plural(progress.added, 'partida nova', 'partidas novas')
            : progress.phase === 'games'
              ? `Baixando ${progress.month} (${progress.done + 1}/${progress.total})`
              : 'Conectando...'}
        </span>
      )}
      {error && <span className="text-sm text-cls-blunder">{error}</span>}
      <button type="button" className="btn-flat flex items-center gap-2" onClick={run} disabled={busy}>
        <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
        {busy ? 'Sincronizando' : 'Sincronizar'}
      </button>
    </div>
  );
}
