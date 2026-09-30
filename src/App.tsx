import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { onTablesChanged } from './lib/data/live';
import { prefetchOpenings } from './lib/repertoire/openingsData';

// Every page is its own chunk; once the app is idle they are all loaded ahead
// so the first visit to a page does not wait.
const pages = {
  home: () => import('./pages/Home'),
  games: () => import('./pages/Games'),
  review: () => import('./pages/Review'),
  stats: () => import('./pages/Stats'),
  openings: () => import('./pages/Openings'),
  tactics: () => import('./pages/Tactics'),
  positions: () => import('./pages/Positions'),
  endgames: () => import('./pages/Endgames'),
  settings: () => import('./pages/Settings'),
  level: () => import('./pages/Level'),
  training: () => import('./pages/Training'),
};

const Home = lazy(pages.home);
const Games = lazy(pages.games);
const Review = lazy(pages.review);
const Stats = lazy(pages.stats);
const Openings = lazy(pages.openings);
const Tactics = lazy(pages.tactics);
const Positions = lazy(pages.positions);
const Endgames = lazy(pages.endgames);
const Settings = lazy(pages.settings);
const Level = lazy(pages.level);
const Training = lazy(pages.training);

function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-8 text-ink-3">Carregando...</div>}>{children}</Suspense>;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Page><Home /></Page> },
      { path: 'games', element: <Page><Games /></Page> },
      { path: 'review/:id', element: <Page><Review /></Page> },
      { path: 'stats', element: <Page><Stats /></Page> },
      { path: 'openings', element: <Page><Openings /></Page> },
      { path: 'tactics', element: <Page><Tactics /></Page> },
      { path: 'positions', element: <Page><Positions /></Page> },
      { path: 'endgames', element: <Page><Endgames /></Page> },
      { path: 'settings', element: <Page><Settings /></Page> },
      { path: 'level', element: <Page><Level /></Page> },
      // Treinar (once a day) and Aquecer (before games): one session each, from the Home buttons.
      { path: 'train', element: <Page><Training key="daily" mode="daily" /></Page> },
      { path: 'warmup', element: <Page><Training key="warmup" mode="warmup" /></Page> },
    ],
  },
]);

const whenIdle = (cb: () => void) => (window.requestIdleCallback ? window.requestIdleCallback(cb, { timeout: 5000 }) : window.setTimeout(cb, 2000));

// The Openings page's tree and gaps take seconds (in a worker): worked out ahead, and again when games or your chapters change.
onTablesChanged(['games', 'userChapters'], () => whenIdle(() => void prefetchOpenings().catch(() => undefined)));

export function App() {
  useEffect(() => {
    whenIdle(() => {
      for (const load of Object.values(pages)) void load().catch(() => undefined);
      void prefetchOpenings().catch(() => undefined);
    });
  }, []);
  return <RouterProvider router={router} />;
}
