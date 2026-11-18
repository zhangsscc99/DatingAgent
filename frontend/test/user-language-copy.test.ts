/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SettingsSheet from '../src/components/SettingsSheet';
import SystemStatusFooter from '../src/components/SystemStatusFooter';
import {
  statusLabel,
  type HealthSnapshot,
} from '../src/lib/healthStatus';
import type { ReplyLengthPreference } from '../src/lib/replyLength';

/**
 * P297 — the UI still spoke system language in two places: the settings
 * 回复长度偏好 segments read 「默认 / 精简 / 详细」 (mechanical parameter names)
 * and the footer kept a permanently-visible 「● 在线」 chip that tells the
 * user nothing. The segments now speak intent (适中 / 简短一些 / 详细一些)
 * with their value keys and persistence untouched, and the footer renders
 * nothing at all while healthy — a `role="status"` element exists only when
 * a health poll warns, phrased in human words.
 *
 * Render-level assertions go through renderToStaticMarkup (same harness as
 * footer-copy.test.ts); the health snapshot is injected by mocking the
 * useHealthPoll hook, so no network and no real LLM are involved.
 */

const health = vi.hoisted(() => ({
  snapshot: {
    status: 'unknown',
    reachable: true,
    lastCheckedAt: null,
  } as HealthSnapshot,
}));

vi.mock('../src/hooks/useHealthPoll', () => ({
  useHealthPoll: () => health.snapshot,
}));

const noop = () => {};

const snap = (patch: Partial<HealthSnapshot>): HealthSnapshot => ({
  status: 'unknown',
  reachable: true,
  lastCheckedAt: null,
  ...patch,
});

function renderSheet(replyLength: ReplyLengthPreference = 'default') {
  return renderToStaticMarkup(
    createElement(SettingsSheet, {
      open: true,
      onClose: noop,
      replyLength,
      onReplyLengthChange: noop,
      language: 'auto',
      onLanguageChange: noop,
      theme: 'light',
      onThemeChange: noop,
      canExport: false,
      hasSessions: false,
      onExportMarkdown: noop,
      onExportJson: noop,
      onClearAll: noop,
    }),
  );
}

/** Slice out one segmented group's markup. */
function groupMarkup(html: string, label: string): string {
  const marker = `role="group" aria-label="${label}"`;
  const start = html.indexOf(marker);
  expect(start, `expected segmented group ${label}`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</div>', start));
}

/** Visible inner text of every segment button inside a group. */
function segmentTexts(html: string, label: string): string[] {
  return [...groupMarkup(html, label).matchAll(/>([^<]+)<\/button>/g)].map(
    (m) => m[1],
  );
}

describe('P297 · settings 回复长度偏好 speaks intent, not parameter names', () => {
  it('renders 适中 / 简短一些 / 详细一些 — never the 档位 names', () => {
    const texts = segmentTexts(renderSheet(), '回复长度偏好');
    expect(texts).toEqual(['适中', '简短一些', '详细一些']);
    // No segment's visible label is one of the mechanical names.
    for (const text of texts) {
      expect(['默认', '精简', '详细']).not.toContain(text);
    }
  });

  it('keeps the three values and the pressed-state wiring unchanged', () => {
    const group = groupMarkup(renderSheet('concise'), '回复长度偏好');
    expect(group).toContain('aria-pressed="true" aria-label="简短一些"');
    expect(group).toContain('aria-pressed="false" aria-label="适中"');
    expect(group).toContain('aria-pressed="false" aria-label="详细一些"');
  });
});

describe('P297 · footer only speaks when something is wrong', () => {
  it('healthy and pending snapshots produce no label', () => {
    expect(statusLabel(snap({}))).toBeNull();
    expect(statusLabel(snap({ status: 'ok', lastCheckedAt: 1 }))).toBeNull();
  });

  it('mounts no footer and no role=status while all is well', () => {
    for (const s of [snap({}), snap({ status: 'ok', lastCheckedAt: 1 })]) {
      health.snapshot = s;
      const html = renderToStaticMarkup(createElement(SystemStatusFooter));
      expect(html).toBe('');
      expect(html).not.toContain('role="status"');
      expect(html).not.toContain('在线');
      expect(html).not.toContain('运行正常');
    }
  });

  it('a warn snapshot mounts a role=status element with human wording', () => {
    for (const s of [
      snap({ status: 'degraded', lastCheckedAt: 1 }),
      snap({ status: 'ok', reachable: false, lastCheckedAt: 2 }),
    ]) {
      health.snapshot = s;
      const label = statusLabel(s);
      expect(label).not.toBeNull();
      const html = renderToStaticMarkup(createElement(SystemStatusFooter));
      expect(html).toContain('role="status"');
      expect(html).toContain(label!);
      // Human words only — no standing-status or ops vocabulary.
      expect(label).not.toContain('在线');
      expect(label).not.toContain('运行正常');
      expect(label).not.toContain('服务降级');
    }
  });
});
