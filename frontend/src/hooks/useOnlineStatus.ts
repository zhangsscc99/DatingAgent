import { useEffect, useState } from 'react';

/**
 * P154 — current connectivity as reported by the browser. `navigator` is
 * absent under SSR/tests, where we optimistically report online.
 */
export function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Minimal event surface so the watcher is testable without a real window. */
export interface OnlineStatusEvents {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/**
 * Non-React core of useOnlineStatus: reports the current status immediately,
 * then again on every online/offline event. The returned function removes
 * both listeners and is used as the effect cleanup on unmount.
 */
export function watchOnlineStatus(
  events: OnlineStatusEvents,
  read: () => boolean,
  onChange: (online: boolean) => void,
): () => void {
  const update = () => onChange(read());
  events.addEventListener('online', update);
  events.addEventListener('offline', update);
  update();
  return () => {
    events.removeEventListener('online', update);
    events.removeEventListener('offline', update);
  };
}

/** P154 — boolean tracking navigator.onLine plus window online/offline events. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(readOnline);
  useEffect(() => watchOnlineStatus(window, readOnline, setOnline), []);
  return online;
}
