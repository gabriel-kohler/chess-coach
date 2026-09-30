// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { beginTraining, gate, trainingActive, useTrainingActive } from './activity';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Session() {
  useTrainingActive();
  return null;
}

describe('training in progress', () => {
  it('StrictMode mounting twice still leaves exactly one session, and unmounting clears it', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(StrictMode, null, createElement(Session))));
    expect(trainingActive()).toBe(true);
    await act(async () => root.unmount());
    expect(trainingActive()).toBe(false);
  });

  it('background work waits for the session to end, or for its own abort', async () => {
    const end = beginTraining();
    let passed = false;
    const waiting = gate().then(() => (passed = true));
    await Promise.resolve();
    expect(passed).toBe(false);
    const ctrl = new AbortController();
    const aborted = gate(ctrl.signal);
    ctrl.abort();
    await aborted;
    end();
    await waiting;
    expect(passed).toBe(true);
    end(); // ending twice changes nothing
    expect(trainingActive()).toBe(false);
  });

  it('with the tab hidden, background work waits until it is visible again, even after training ends', async () => {
    const setHidden = (h: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));
    setHidden(true);
    let passed = false;
    const waiting = gate().then(() => (passed = true));
    await flush();
    expect(passed).toBe(false);
    // Training starts and ends while hidden: still waiting.
    const end = beginTraining();
    end();
    await flush();
    expect(passed).toBe(false);
    setHidden(false);
    await waiting;
    expect(passed).toBe(true);
    // Training ends while hidden: it waits for the tab too.
    const end2 = beginTraining();
    let second = false;
    const both = gate().then(() => (second = true));
    setHidden(true);
    end2();
    await flush();
    expect(second).toBe(false);
    setHidden(false);
    await both;
    expect(second).toBe(true);
  });
});
