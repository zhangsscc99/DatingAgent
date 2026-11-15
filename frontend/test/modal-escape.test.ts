/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDialogDismiss } from '../src/lib/dialogDismiss';

/**
 * P136 — Escape dismisses the profile overlay through whichever path exists
 * (close for edit mode, the 稍后再说 skip path for first-visit onboarding),
 * Tab wraps inside the panel, and the element that opened the dialog regains
 * focus when it closes. Vitest runs in node, so `document` is a bare
 * EventTarget with stubbed activeElement/body/contains — the same approach
 * as health-poll-visibility.test.ts — and events are plain `Event`s with a
 * `key`/`shiftKey` payload. The last block keeps source-level wiring guards.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

interface FakeEl {
  focus: ReturnType<typeof vi.fn>;
  hasAttribute(name: string): boolean;
}

const fakeEl = (): FakeEl => ({
  focus: vi.fn(),
  hasAttribute: () => false,
});

type FakeDoc = EventTarget & {
  activeElement: unknown;
  body: unknown;
  contains(el: unknown): boolean;
};

/** A document stand-in: `mounted` is the set of elements still attached. */
function makeDoc() {
  const doc = new EventTarget() as FakeDoc;
  const mounted = new Set<unknown>();
  const body = fakeEl();
  doc.body = body;
  doc.activeElement = body;
  doc.contains = (el: unknown) => el === body || mounted.has(el);
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  return { doc, body, mounted };
}

const keydown = (key: string, shiftKey = false) =>
  Object.assign(new Event('keydown'), { key, shiftKey });

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  vi.restoreAllMocks();
});

describe('P136 · Escape dismissal', () => {
  it('calls the skip path exactly once on Escape', () => {
    const { doc } = makeDoc();
    const onSkip = vi.fn();
    const handle = startDialogDismiss({ onSkip });
    doc.dispatchEvent(keydown('Escape'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('calls the close path exactly once on Escape (and prefers it over skip)', () => {
    const { doc } = makeDoc();
    const onClose = vi.fn();
    const onSkip = vi.fn();
    const handle = startDialogDismiss({ onClose, onSkip });
    doc.dispatchEvent(keydown('Escape'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
    handle.stop();
  });

  it('is a no-op — never throws — when neither path exists', () => {
    const { doc } = makeDoc();
    const handle = startDialogDismiss({});
    expect(() => doc.dispatchEvent(keydown('Escape'))).not.toThrow();
    handle.stop();
  });

  it('restores focus to the captured opener when it is still in the document', () => {
    const { doc, mounted } = makeDoc();
    const opener = fakeEl();
    mounted.add(opener);
    doc.activeElement = opener;
    const handle = startDialogDismiss({ opener: opener as unknown as Element });
    handle.stop();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('does not steal focus when nothing opened the dialog (body was active)', () => {
    const { doc, body } = makeDoc();
    const handle = startDialogDismiss({ opener: doc.body as Element });
    handle.stop();
    expect(body.focus).not.toHaveBeenCalled();
  });

  it('skips the restore when the opener left the document', () => {
    makeDoc();
    const opener = fakeEl(); // never added to `mounted`
    const handle = startDialogDismiss({ opener: opener as unknown as Element });
    handle.stop();
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('does not refocus the opener on a listener refresh while the panel is still mounted', () => {
    const { doc, mounted } = makeDoc();
    const opener = fakeEl();
    const panel = fakeEl();
    mounted.add(opener);
    mounted.add(panel);
    const handle = startDialogDismiss({
      opener: opener as unknown as Element,
      getPanel: () => panel as unknown as Element,
    });
    handle.stop();
    expect(opener.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).not.toBe(opener);
  });
});

describe('P136 · Tab containment', () => {
  it('wraps Tab from the last focusable to the first and Shift+Tab back', () => {
    const { doc } = makeDoc();
    const a = fakeEl();
    const b = fakeEl();
    const c = fakeEl();
    const list = [a, b, c];
    const panel = {
      contains: (el: unknown) => list.includes(el as FakeEl),
      querySelectorAll: () => list,
    };
    doc.activeElement = c;
    const handle = startDialogDismiss({ getPanel: () => panel as unknown as Element });

    doc.dispatchEvent(keydown('Tab'));
    expect(a.focus).toHaveBeenCalledTimes(1);
    expect(b.focus).not.toHaveBeenCalled();

    doc.activeElement = a;
    doc.dispatchEvent(keydown('Tab', true));
    expect(c.focus).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('leaves Tab alone for elements in the middle of the panel', () => {
    const { doc } = makeDoc();
    const a = fakeEl();
    const b = fakeEl();
    const c = fakeEl();
    const list = [a, b, c];
    const panel = {
      contains: (el: unknown) => list.includes(el as FakeEl),
      querySelectorAll: () => list,
    };
    doc.activeElement = b;
    const handle = startDialogDismiss({ getPanel: () => panel as unknown as Element });
    doc.dispatchEvent(keydown('Tab'));
    expect(a.focus).not.toHaveBeenCalled();
    expect(c.focus).not.toHaveBeenCalled();
    handle.stop();
  });
});

describe('P136 · wiring', () => {
  it('ProfileOnboarding delegates dismissal/containment/restore to startDialogDismiss', () => {
    const src = read('components/ProfileOnboarding.tsx');
    expect(src).toContain('startDialogDismiss({');
    expect(src).toContain('onSkip: allowSkip ? onSkip : undefined');
    expect(src).toContain('getPanel: () => panelRef.current');
    expect(src).toContain('opener: openerRef.current');
    expect(src).toContain('ref={panelRef}');
  });

  it('App hands the overlay a skip path for onboarding and a close path for editing', () => {
    const app = read('App.tsx');
    expect(app).toContain('onSkip={showOnboarding && !editingProfile ? handleProfileSkip : undefined}');
    expect(app).toContain('onClose={editingProfile ? () => setEditingProfile(false) : undefined}');
    expect(app).toContain('allowSkip={showOnboarding && !editingProfile}');
  });
});
