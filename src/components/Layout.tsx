import clsx from 'clsx';
import { BarChart3, BookOpen, Crown, Home, ListChecks, Puzzle, Settings as Cog, Swords } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import { setSoundEnabled } from './board/assets';
import { db } from '@/lib/db';
import { punishScanDue } from '@/lib/punish/keys';
import { useAccount, useSettings } from '@/lib/settings';

const NAV = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/games', label: 'Partidas', icon: Swords },
  { to: '/stats', label: 'Estatísticas', icon: BarChart3 },
  { to: '/openings', label: 'Aberturas', icon: BookOpen },
  { to: '/tactics', label: 'Tática', icon: Puzzle },
  { to: '/positions', label: 'Posições', icon: ListChecks },
  { to: '/endgames', label: 'Finais', icon: Crown },
];

export function Layout() {
  const account = useAccount();
  const settings = useSettings();
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);
  // Analyses from an older scoring get recomputed from their engine lines.
  useEffect(() => {
    void import('@/lib/review/analyze').then((m) => m.rescoreOutdated());
  }, []);
  // Your fitted FSRS weights and grading rule for every mode; refit every 100 attempts of a kind.
  useEffect(() => {
    void import('@/lib/srs/optimizer').then((m) => m.loadModels().then(() => m.maybeOptimize())).catch(() => undefined);
  }, []);
  // After every sync (and a stale one every 10 minutes): cards, level, automatic analysis, gaps.
  useEffect(() => {
    void import('@/lib/renewal/pipeline').then((m) => m.startRenewal()).catch(() => undefined);
  }, []);
  // A deck from any opening still building when the app closed goes on from where it stopped, and the
  // mistakes to punish in your decks are looked for (the background job's code loads only then).
  useEffect(() => {
    void Promise.all([db.decks.filter((d) => d.status === 'building').count(), punishScanDue()])
      .then(([building, scan]) => (building || scan ? import('@/lib/decks/store').then((m) => m.buildDecks()) : undefined))
      .catch(() => undefined);
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[64px] shrink-0 flex-col bg-nav py-3 md:w-[168px]">
        <div className="mb-4 flex items-center gap-2 px-3 md:px-4">
          <div className="grid h-8 w-8 grid-cols-2 overflow-hidden rounded">
            <span className="bg-sq-light" /><span className="bg-sq-dark" /><span className="bg-sq-dark" /><span className="bg-sq-light" />
          </div>
          <span className="hidden text-lg font-extrabold tracking-tight md:block">Coach</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-4 py-2.5 text-[15px] font-bold transition-colors',
                  isActive ? 'bg-black/25 text-ink' : 'text-ink-2 hover:bg-black/15 hover:text-ink',
                )
              }
            >
              <Icon size={22} strokeWidth={2.2} className="shrink-0" />
              <span className="hidden md:block">{label}</span>
            </NavLink>
          ))}
        </nav>
        <NavLink
          to="/settings"
          className={({ isActive }) => clsx('flex items-center gap-3 px-4 py-2.5 text-[15px] font-bold', isActive ? 'text-ink' : 'text-ink-3 hover:text-ink')}
        >
          {account?.profile.avatar ? (
            <img src={account.profile.avatar} alt="" className="h-6 w-6 shrink-0 rounded" />
          ) : (
            <Cog size={22} className="shrink-0" />
          )}
          <span className="hidden truncate md:block">{account?.username ?? 'Configurar'}</span>
        </NavLink>
      </aside>
      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, icon: Icon = ListChecks, children }: { title: string; icon?: typeof ListChecks; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-2.5 text-[26px] font-extrabold tracking-tight">
        <Icon size={28} className="text-go" strokeWidth={2.4} />
        {title}
      </h1>
      {children}
    </div>
  );
}

export function Panel({ title, children, className, action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={clsx('rounded-lg bg-panel p-4', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-extrabold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
