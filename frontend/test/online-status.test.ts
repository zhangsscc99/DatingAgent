/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readOnline, watchOnlineStatus } from '../src/hooks/useOnlineStatus';

/**
 * P154 — vitest runs in node (no DOM), so `navigator` is replaced with a bare
 * `{ onLine }` stub and the window stands in as a real EventTarget; online /
 * offline are dispatched as real Events. The watcher's returned unsubscribe
 * stands in for the effect cleanup on unmount.
 */

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

const stubNavigator = (onLine: boolean) => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine },
    configurable: true,
  });
};

describe('P154 · useOnlineStatus', () => {
  let events: EventTarget;
  let online: boolean;
  let seen: boolean[];

  beforeEach(() => {
    events = new EventTarget();
    online = true;
    seen = [];
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
  });

  it('initialises from navigator.onLine', () => {
    stubNavigator(true);
    expect(readOnline()).toBe(true);
    stubNavigator(false);
    expect(readOnline()).toBe(false);
  });

  it('reports online when navigator is absent (SSR/tests)', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
    expect(readOnline()).toBe(true);
  });

  it('emits the current status immediately on subscribe', () => {
    const stop = watchOnlineStatus(
      events,
      () => online,
      (v) => seen.push(v),
    );
    expect(seen).toEqual([true]);
    stop();
  });

  it('flips to false on an offline event', () => {
    const stop = watchOnlineStatus(
      events,
      () => online,
      (v) => seen.push(v),
    );
    online = false;
    events.dispatchEvent(new Event('offline'));
    expect(seen).toEqual([true, false]);
    stop();
  });

  it('flips to true on an online event', () => {
    online = false;
    const stop = watchOnlineStatus(
      events,
      () => online,
      (v) => seen.push(v),
    );
    expect(seen).toEqual([false]);
    online = true;
    events.dispatchEvent(new Event('online'));
    expect(seen).toEqual([false, true]);
    stop();
  });

  it('removes both listeners on unmount', () => {
    const addSpy = vi.spyOn(events, 'addEventListener');
    const removeSpy = vi.spyOn(events, 'removeEventListener');
    const stop = watchOnlineStatus(
      events,
      () => online,
      (v) => seen.push(v),
    );
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    stop();
    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    online = false;
    events.dispatchEvent(new Event('offline'));
    expect(seen).toEqual([true]);
  });
});
