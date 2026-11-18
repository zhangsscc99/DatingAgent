/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  type FakeDom,
} from './helpers/fakeDom';
import { TOOL_FALLBACK } from '../src/components/Sidebar';
import { toolDisplayName } from '../src/lib/toolLabels';

/**
 * P322 — before /api/tools resolves, the 进阶工具 section used to paint
 * short: opening the drawer showed only part of the list until the fetch
 * landed, so a slow network read as "the product only has two tools". The
 * list now renders the same five TOOL_FALLBACK rows as inert skeletons
 * (disabled + aria-busy + real labels at the real row height) while the
 * request is in flight, then swaps in the live buttons — same count, same
 * slots, no flash. A rejected or empty response still ends on the static
 * fallback entries as working buttons, never permanent skeletons.
 *
 * Mounted assertions run the real App on the fake DOM with a hand-driven
 * /api/tools promise, same style as sidebar-tool-entries.test.ts (P316).
 */

/** Expected visible label for each row — read off the single source of
 *  truth (TOOL_FALLBACK + toolDisplayName), never re-hardcoded. */
const EXPECTED_LABELS = TOOL_FALLBACK.map(
  (t) => toolDisplayName(t.name) ?? t.label,
);

interface Deferred {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The five rows the live endpoint ships — same ids the fallback maps. */
const LIVE_TOOLS = TOOL_FALLBACK.map((t) => ({ ...t }));

describe('P322 · 进阶工具 skeleton rows while /api/tools is in flight', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const install = (toolsFetch: () => Promise<unknown>) => {
    dom = installFakeDom(); // matchMedia matches nothing → desktop sidebar
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string'
            ? input
            : String((input as { url?: string })?.url);
        if (url === '/api/tools') return toolsFetch();
        if (url === '/api/health') return jsonResponse({ status: 'ok' });
        return jsonResponse({ ok: true });
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  };

  const mountApp = async () => {
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(createElement(App));
    });
    await flush();
  };

  const unmountApp = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  const toolRows = () => {
    const sec = qs('section[aria-label="进阶工具"]') as FakeElement | null;
    expect(sec, '进阶工具 section').toBeTruthy();
    const list = sec!.querySelector('.tool-list') as FakeElement | null;
    expect(list, '.tool-list').toBeTruthy();
    return list!.children; // <li class="tool-item"> slots
  };

  const rowButton = (li: FakeElement) => {
    const btn = li.querySelector('button') as FakeElement | null;
    expect(btn, 'button inside tool-item li').toBeTruthy();
    return btn!;
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('paints ≥5 disabled aria-busy skeleton rows before the fetch resolves, then swaps in the real buttons unchanged', async () => {
    const toolsReq = deferred();
    install(() => toolsReq.promise); // stays pending until resolved below
    await mountApp();

    // --- pending: five placeholder slots, each busy + skeleton + disabled
    const pendingRows = toolRows();
    expect(pendingRows.length).toBeGreaterThanOrEqual(5);
    const pendingLabels: string[] = [];
    for (const li of pendingRows) {
      const btn = rowButton(li);
      expect(btn.getAttribute('aria-busy')).toBe('true');
      expect(btn.classList.contains('tool-entry-skeleton')).toBe(true);
      expect(btn.disabled).toBe(true);
      pendingLabels.push(btn.textContent ?? '');
    }
    // Placeholder copy is the final copy — no text change on hydrate.
    expect(pendingLabels).toEqual(EXPECTED_LABELS);

    // --- resolved: same count, same labels, live enabled buttons
    toolsReq.resolve(jsonResponse({ tools: LIVE_TOOLS }));
    await flush();

    const rows = toolRows();
    expect(rows.length).toBe(EXPECTED_LABELS.length);
    const labels: string[] = [];
    for (const li of rows) {
      const btn = rowButton(li);
      expect(btn.getAttribute('aria-busy')).toBeNull();
      expect(btn.classList.contains('tool-entry-skeleton')).toBe(false);
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('tool-entry')).toBe(true);
      labels.push(btn.textContent ?? '');
    }
    expect(labels).toEqual(pendingLabels);

    await unmountApp();
  });

  it('a failed /api/tools fetch still ends on the five real fallback entries — no permanent skeletons', async () => {
    install(() => Promise.reject(new Error('network down')));
    await mountApp();
    await flush();

    const rows = toolRows();
    expect(rows.length).toBe(EXPECTED_LABELS.length);
    const labels: string[] = [];
    for (const li of rows) {
      const btn = rowButton(li);
      expect(btn.getAttribute('aria-busy')).toBeNull();
      expect(btn.classList.contains('tool-entry-skeleton')).toBe(false);
      expect(btn.disabled).toBe(false);
      labels.push(btn.textContent ?? '');
    }
    expect(labels).toEqual(EXPECTED_LABELS);

    await unmountApp();
  });

  it('an empty tools payload also ends on the five real fallback entries', async () => {
    install(() => Promise.resolve(jsonResponse({ tools: [] })));
    await mountApp();
    await flush();

    const rows = toolRows();
    expect(rows.length).toBe(EXPECTED_LABELS.length);
    for (const li of rows) {
      const btn = rowButton(li);
      expect(btn.getAttribute('aria-busy')).toBeNull();
      expect(btn.classList.contains('tool-entry-skeleton')).toBe(false);
      expect(btn.disabled).toBe(false);
    }

    await unmountApp();
  });
});
