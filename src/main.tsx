import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { watchDatabase } from './lib/data/live';
import { queryClient } from './lib/data/queryClient';
import '@fontsource-variable/inter';
import '@fontsource-variable/merriweather';
import './index.css';

watchDatabase();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
