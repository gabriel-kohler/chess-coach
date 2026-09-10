import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';

const Home = lazy(() => import('./pages/Home'));
const Games = lazy(() => import('./pages/Games'));
const Review = lazy(() => import('./pages/Review'));
const Stats = lazy(() => import('./pages/Stats'));
const Openings = lazy(() => import('./pages/Openings'));
const Tactics = lazy(() => import('./pages/Tactics'));
const Endgames = lazy(() => import('./pages/Endgames'));
const Settings = lazy(() => import('./pages/Settings'));

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
      { path: 'endgames', element: <Page><Endgames /></Page> },
      { path: 'settings', element: <Page><Settings /></Page> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
