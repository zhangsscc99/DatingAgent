import { describe, expect, it, vi } from 'vitest';
import {
  hasInteracted,
  markInteraction,
  startInteractionTracking,
} from '../src/lib/interactionState';

/**
 * P133 — the pure interaction-state module backing the P105 autofocus gate.
 * Runs in the node environment: `window` is absent unless a test stubs it.
 */

describe('interactionState', () => {
  it('reports no interaction before any mark', () => {
    expect(hasInteracted()).toBe(false);
  });

  it('tolerates a missing window', () => {
    expect(() => startInteractionTracking()).not.toThrow();
  });

  it('registers its listeners only once', () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener });
    startInteractionTracking();
    startInteractionTracking();
    // pointerdown + keydown, registered a single time despite two calls.
    expect(addEventListener).toHaveBeenCalledTimes(2);
    expect(addEventListener.mock.calls.map((c) => c[0])).toEqual([
      'pointerdown',
      'keydown',
    ]);
    vi.unstubAllGlobals();
  });

  it('markInteraction flips hasInteracted', () => {
    markInteraction();
    expect(hasInteracted()).toBe(true);
  });
});
