// Training in progress. Background engine work (the automatic analysis, gap
// suggestions, the decks and the mistakes to punish) waits before each
// position while you train, so your move checks and explanations get the CPU;
// and while the tab is hidden, so the app never slows the rest of the browser
// (Chrome flags a hidden tab running Stockfish). An analysis you asked for
// does not wait.
import { useEffect } from 'react';

let active = 0;
let waiters: Array<() => void> = [];
let visibleWaiters: Array<() => void> = [];

const hidden = () => typeof document !== 'undefined' && document.hidden;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const w = visibleWaiters;
    visibleWaiters = [];
    for (const f of w) f();
  });
}

export function trainingActive(): boolean {
  return active > 0;
}

/** Marks a training session as running; call the returned function when it ends. */
export function beginTraining(): () => void {
  active++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active--;
    if (!active) {
      const w = waiters;
      waiters = [];
      for (const f of w) f();
    }
  };
}

/** Holds background engine work while the component is mounted (and `on`). */
export function useTrainingActive(on = true) {
  useEffect(() => (on ? beginTraining() : undefined), [on]);
}

/** Resolves when no training is running and the tab is visible, or at once when so. */
export function gate(signal?: AbortSignal): Promise<void> {
  if ((!active && !hidden()) || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    // One condition clears: check both again (the tab may still be hidden when training ends).
    const again = () => void gate(signal).then(resolve);
    if (active) waiters.push(again);
    else visibleWaiters.push(again);
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
}
