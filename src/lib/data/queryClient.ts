// The data cache: what is read once stays in memory across screens, so going back to a page
// renders at once. The difference is the source: IndexedDB says when it
// changes (see live.ts), so data stays fresh until the database changes, and
// a change refetches only what is on screen, keeping the old value meanwhile.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      // Kept in memory 30 minutes after the last screen using it closes.
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 0,
    },
  },
});
