import clsx from 'clsx';
import { BarChart3, BookOpen, Crown, Home, ListChecks, Settings as Cog, Swords, Target } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import { setSoundEnabled } from './board/assets';
import { db } from '@/lib/db';
import { punishScanDue } from '@/lib/punish/keys';
import { useAccount, useSettings } from '@/lib/settings';

// Two groups: your games, then what you train.
const NAV = [
  [
    { to: '/', label: 'Início', icon: Home, end: true },
    { to: '/games', label: 'Partidas', icon: Swords },
    { to: '/stats', label: 'Estatísticas', icon: BarChart3 },
  ],
  [
    { to: '/openings', label: 'Aberturas', icon: BookOpen },
    { to: '/tactics', label: 'Tática', icon: Target },
    { to: '/positions', label: 'Posições', icon: ListChecks },
    { to: '/endgames', label: 'Finais', icon: Crown },
  ],
];

const navItem = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors',
    isActive ? 'bg-raise text-ink' : 'text-ink-3 hover:bg-white/5 hover:text-ink',
  );

/** The bishop's mitre with its diagonal cut: the app's mark. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="shrink-0">
      <mask id="logo-cut">
        <rect width="48" height="48" fill="#fff" />
        <path d="M31 14 L19 29" stroke="#000" strokeWidth="4" strokeLinecap="round" />
      </mask>
      <path d="M24 4 C 32.5 11.5 37.5 19 37.5 26.5 A 13.5 13.5 0 0 1 10.5 26.5 C 10.5 19 15.5 11.5 24 4 Z" fill="currentColor" mask="url(#logo-cut)" />
    </svg>
  );
}

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
      <aside className="flex w-[64px] shrink-0 flex-col border-r border-line bg-nav px-2 py-5 md:w-[232px] md:px-4">
        <div className="mb-6 flex items-center gap-2.5 px-3 text-ink">
          <Logo />
          <span className="hidden text-[15px] font-semibold tracking-tight md:block">Chess Coach</span>
        </div>
        <nav className="flex flex-1 flex-col">
          {NAV.map((group, g) => (
            <div key={g} className={clsx('flex flex-col gap-0.5', g > 0 && 'mt-3 border-t border-line pt-3')}>
              {group.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={navItem} title={label}>
                  <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                  <span className="hidden md:block">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <NavLink to="/settings" className={navItem} title="Configurações">
          <Cog size={18} strokeWidth={1.75} className="shrink-0" />
          <span className="hidden md:block">Configurações</span>
        </NavLink>
        {account && (
          <div className="mt-3 flex items-center gap-2.5 border-t border-line px-2 pt-3.5">
            {account.profile.avatar ? (
              <img src={account.profile.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full" />
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raise-2 text-xs font-semibold uppercase">{account.username[0]}</span>
            )}
            <span className="hidden truncate text-[13px] font-medium md:block">{account.username}</span>
          </div>
        )}
      </aside>
      <main className="scroll-thin stage-halo min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

export function Panel({ title, children, className, action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={clsx('rounded-2xl bg-panel p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
