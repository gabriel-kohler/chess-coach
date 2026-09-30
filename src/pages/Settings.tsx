import { Settings as Cog } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader, Panel } from '@/components/Layout';
import { SyncButton } from '@/components/SyncButton';
import { syncAccount, type SyncProgress } from '@/lib/chesscom/sync';
import { db } from '@/lib/db';
import { savePositionsSettings, usePositionsSettings } from '@/lib/positions/settings';
import { syncPositionCards } from '@/lib/positions/store';
import { saveSettings, useAccount, useSettings } from '@/lib/settings';
import { LEGACY_MINE_KEY } from '@/lib/srs/migrate';
import { TRAINING } from '@/lib/training/config';
import { TRAINING_SESSION_KEYS } from '@/lib/training/keys';
import { saveTrainingSettings, useTrainingSettings } from '@/lib/training/settings';

export function ConnectAccount({ onDone }: { onDone?: () => void }) {
  const [username, setUsername] = useState('snowww_99');
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress.phase !== 'done';

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await syncAccount(username, setProgress);
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  };

  return (
    <form onSubmit={connect} className="flex flex-col gap-3">
      <label className="text-sm font-bold text-ink-2" htmlFor="username">Usuário do chess.com</label>
      <div className="flex flex-wrap gap-2">
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus:border-go"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn-go" disabled={busy || !username.trim()}>
          {busy ? 'Baixando partidas...' : 'Conectar'}
        </button>
      </div>
      {progress?.phase === 'games' && (
        <div>
          <div className="h-2 overflow-hidden rounded bg-panel-2">
            <div className="h-full bg-go transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
          </div>
          <p className="mt-1 text-sm text-ink-3">Mês {progress.month}: {progress.done} de {progress.total} meses</p>
        </div>
      )}
      {error && <p className="text-sm text-cls-blunder">{error}</p>}
      <p className="text-sm text-ink-3">Usa a API pública do chess.com. Nenhuma senha, nada sai do seu navegador.</p>
    </form>
  );
}

export default function Settings() {
  const account = useAccount();
  const settings = useSettings();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);

  const positionLimits = usePositionsSettings();
  const training = useTrainingSettings();

  const resetTraining = async () => {
    await Promise.all([
      db.attempts.clear(),
      db.puzzleCards.clear(),
      db.repCards.clear(),
      db.srsCards.clear(),
      db.reviewLogs.clear(),
      db.kv.delete('tactics'),
      db.kv.delete(LEGACY_MINE_KEY),
      // The sessions point at the cards that just went.
      ...TRAINING_SESSION_KEYS.map((k) => db.kv.delete(k)),
    ]);
    // Positions come back as new cards from the same analyses.
    await syncPositionCards().catch(() => undefined);
    setConfirmReset(false);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <PageHeader title="Configurações" icon={Cog} />
      <div className="flex flex-col gap-4">
        <Panel title="Conta do chess.com">
          {account ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {account.profile.avatar && <img src={account.profile.avatar} alt="" className="h-12 w-12 rounded" />}
                <div>
                  <div className="text-lg font-extrabold">{account.username}</div>
                  <div className="text-sm text-ink-3">Última sincronização: {new Date(account.syncedAt).toLocaleString('pt-BR')}</div>
                </div>
              </div>
              <SyncButton username={account.username} />
            </div>
          ) : (
            <ConnectAccount onDone={() => navigate('/')} />
          )}
          {account && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-ink-3">Trocar de conta</summary>
              <div className="mt-3"><ConnectAccount /></div>
            </details>
          )}
        </Panel>

        <Panel title="Análise (Stockfish 18)">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Profundidade</span>
              <select
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={settings.depth}
                onChange={(e) => saveSettings({ depth: Number(e.target.value) }, settings)}
              >
                <option value={12}>12 (rápida)</option>
                <option value={14}>14</option>
                <option value={16}>16 (padrão)</option>
                <option value={18}>18</option>
                <option value={20}>20 (lenta)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Motores em paralelo</span>
              <select
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={settings.workers}
                onChange={(e) => saveSettings({ workers: Number(e.target.value) }, settings)}
              >
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="text-ink-4">Mais motores analisam mais rápido, mas usam mais memória.</span>
            </label>
          </div>
        </Panel>

        <Panel title="Treino">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Treino do dia</span>
              <select
                id="training-daily-minutes"
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={training.dailyMinutes}
                onChange={(e) => saveTrainingSettings({ dailyMinutes: Number(e.target.value) }, training)}
              >
                {TRAINING.dailyChoices.map((n) => <option key={n} value={n}>{n} min{n === TRAINING.dailyMinutes ? ' (recomendado)' : ''}</option>)}
              </select>
              <span className="text-ink-4">Vale a partir do próximo dia; o de hoje segue como foi montado.</span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Puzzles por sessão</span>
              <select
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={settings.sessionSize}
                onChange={(e) => saveSettings({ sessionSize: Number(e.target.value) }, settings)}
              >
                {[10, 15, 20, 30, 40].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-3 text-sm font-bold text-ink-2">
              <input type="checkbox" checked={settings.sound} onChange={(e) => saveSettings({ sound: e.target.checked }, settings)} className="h-4 w-4 accent-[var(--color-go)]" />
              Sons do tabuleiro
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Posições novas por dia</span>
              <select
                id="positions-new-per-day"
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={positionLimits.newPerDay}
                onChange={(e) => savePositionsSettings({ newPerDay: Number(e.target.value) }, positionLimits)}
              >
                {[0, 5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Revisões de posições por dia</span>
              <select
                id="positions-reviews-per-day"
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={positionLimits.maxReviewsPerDay}
                onChange={(e) => savePositionsSettings({ maxReviewsPerDay: Number(e.target.value) }, positionLimits)}
              >
                {[50, 100, 150, 200, 300].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Sequências novas por dia</span>
              <select
                id="positions-seq-new-per-day"
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={positionLimits.seqNewPerDay}
                onChange={(e) => savePositionsSettings({ seqNewPerDay: Number(e.target.value) }, positionLimits)}
              >
                {[0, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-bold text-ink-2">Revisões de sequências por dia</span>
              <select
                id="positions-seq-reviews-per-day"
                className="rounded-md border border-line bg-panel-2 px-3 py-2"
                value={positionLimits.seqMaxReviewsPerDay}
                onChange={(e) => savePositionsSettings({ seqMaxReviewsPerDay: Number(e.target.value) }, positionLimits)}
              >
                {[20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-5 border-t border-line pt-4">
            {confirmReset ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-ink-2">Apagar rating tático, histórico de puzzles, revisões e o progresso das posições?</span>
                <button type="button" className="btn-flat" onClick={resetTraining}>Apagar</button>
                <button type="button" className="text-ink-3 hover:text-ink" onClick={() => setConfirmReset(false)}>Cancelar</button>
              </div>
            ) : (
              <button type="button" className="text-sm text-ink-3 hover:text-ink" onClick={() => setConfirmReset(true)}>
                Reiniciar o treino tático
              </button>
            )}
          </div>
        </Panel>

        <Panel title="Fontes">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-3">
            <li>Partidas: API pública do chess.com.</li>
            <li>Puzzles: base aberta do Lichess (CC0), filtrada por qualidade.</li>
            <li>Nomes de aberturas: lichess-org/chess-openings (CC0).</li>
            <li>Motor: Stockfish 18 (GPLv3) em WebAssembly, rodando no seu navegador.</li>
            <li>Peças e sons: tema Neo do chess.com, carregados do CDN deles para uso pessoal.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
