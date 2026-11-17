/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';

/**
 * P254 — the 关于 section used to print ops details straight to the user:
 * 「版本 1.0.0 · 构建 2bbc609」 plus a second line 「模型 qwen3.8-flash」.
 * Visible copy is now product-facing (「DatingAgent 1.0.0」 plus one human
 * sentence); the version/gitSha/model triple survives only inside the
 * paragraph's `title` attribute for troubleshooting. Mounted on the fake
 * DOM with a stubbed /api/version fetch (same approach as
 * interrupted-turn-restore.test.ts).
 */

/** Ops detail that must never reach rendered text. */
const OPS_LEAK = /qwen|gpt|claude|llama|构建\s*[0-9a-f]{7}/i;

const noop = () => {};

const sheetProps = {
  onClose: noop,
  replyLength: 'default' as const,
  onReplyLengthChange: noop,
  language: 'auto' as const,
  onLanguageChange: noop,
  theme: 'light' as const,
  onThemeChange: noop,
  canExport: false,
  hasSessions: false,
  onExportMarkdown: noop,
  onExportJson: noop,
  onClearAll: noop,
};

const versionFetch = (data: { version: string; gitSha: string }) =>
  vi.fn(async () => ({ ok: true, json: async () => data }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('P254 · 关于 section: product copy visible, ops detail in title only', () => {
  let dom: FakeDom;

  const mount = async (extra: Record<string, unknown> = {}) => {
    const { createRoot } = await import('react-dom/client');
    const { default: SettingsSheet } = await import(
      '../src/components/SettingsSheet'
    );
    const container = dom.document.createElement('div') as FakeElement;
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(SettingsSheet, { ...sheetProps, open: true, ...extra }),
      );
      await flush();
    });
    return container;
  };

  const aboutSection = (container: FakeElement) =>
    container.querySelector('section[aria-label="关于"]');

  beforeAll(() => {
    dom = installFakeDom();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('renders the semver as 「DatingAgent x.y.z」 with no model name or build hash in text', async () => {
    vi.stubGlobal(
      'fetch',
      versionFetch({ version: '1.0.0', gitSha: '2bbc609' }),
    );
    const section = aboutSection(await mount({ llmModel: 'qwen3.8-flash' }));
    expect(section, '关于 section').toBeTruthy();
    const text = section!.textContent;
    expect(text).toContain('DatingAgent');
    expect(text).toMatch(/\d+\.\d+\.\d+/);
    expect(OPS_LEAK.test(text)).toBe(false);
  });

  it('keeps 版本/构建/模型 reachable in the about paragraph title attribute', async () => {
    vi.stubGlobal(
      'fetch',
      versionFetch({ version: '1.0.0', gitSha: '2bbc609' }),
    );
    const section = aboutSection(await mount({ llmModel: 'qwen3.8-flash' }))!;
    const para = section.querySelector('.settings-about');
    const detail =
      para?.getAttribute('title') ?? section.getAttribute('aria-label') ?? '';
    expect(detail).toContain('版本 1.0.0');
    expect(detail).toContain('构建 2bbc609');
    expect(detail).toContain('模型 qwen3.8-flash');
    // …and the attribute is all that carries it: still absent from text.
    expect(OPS_LEAK.test(section.textContent)).toBe(false);
  });

  it('omits the model fragment from the title when llmModel is absent', async () => {
    vi.stubGlobal(
      'fetch',
      versionFetch({ version: '1.0.0', gitSha: '2bbc609' }),
    );
    const section = aboutSection(await mount())!;
    const para = section.querySelector('.settings-about');
    const title = para?.getAttribute('title') ?? '';
    expect(title).toBe('版本 1.0.0 · 构建 2bbc609');
  });

  it('keeps the loading and error fallbacks', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const loading = aboutSection(await mount());
    expect(loading!.textContent).toContain('版本加载中…');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('down'))),
    );
    const errored = aboutSection(await mount());
    expect(errored!.textContent).toContain('版本未知');
    // Even the fallback copy stays free of ops detail.
    expect(OPS_LEAK.test(errored!.textContent)).toBe(false);
  });
});
