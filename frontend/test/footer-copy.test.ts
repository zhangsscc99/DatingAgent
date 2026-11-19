/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import InputBar from '../src/components/InputBar';
import SystemStatusFooter from '../src/components/SystemStatusFooter';
import { statusLabel, type HealthSnapshot } from '../src/lib/healthStatus';
import {
  replyLengthLabel,
  type ReplyLengthPreference,
} from '../src/lib/replyLength';

/**
 * P291 — the footer and the composer reply-length toggle used to surface
 * internal vocabulary: 「运行正常」/「服务降级」/「无法连接」 on the footer and
 * the raw 档位 names 「默认」/「精简」/「详细」 next to the input box. The visible
 * copy is now plain language / intent phrasing; technical detail survives
 * only in title/aria-label. Pure render + pure-function assertions only —
 * same harness as header-status-copy.test.ts, no extra deps.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const footerTsx = readFileSync(join(SRC, 'components/SystemStatusFooter.tsx'), 'utf8');

const noop = () => {};

const snap = (patch: Partial<HealthSnapshot>): HealthSnapshot => ({
  status: 'unknown',
  reachable: true,
  lastCheckedAt: null,
  ...patch,
});

const PARAM_WORDS = ['默认', '精简', '详细'];

const toggleInnerText = (html: string) => {
  const start = html.indexOf('reply-length-toggle');
  const openEnd = html.indexOf('>', start);
  return html
    .slice(openEnd + 1, html.indexOf('</button>', openEnd))
    // P385: the pill now carries a chevron child — the visible *text* is
    // still just the intent label, so measure text nodes only.
    .replace(/<[^>]*>/g, '');
};

function renderBar(replyLength: ReplyLengthPreference) {
  return renderToStaticMarkup(
    createElement(InputBar, {
      onSend: noop,
      replyLength,
      onReplyLengthChange: noop,
    }),
  );
}

describe('P291 · footer copy is plain language', () => {
  it('the visible label never says 「运行正常」 in any state', () => {
    for (const s of [
      snap({}),
      snap({ status: 'ok', lastCheckedAt: 1 }),
      snap({ status: 'degraded', lastCheckedAt: 1 }),
      snap({ status: 'ok', reachable: false, lastCheckedAt: 2 }),
    ]) {
      const label = statusLabel(s) ?? '';
      expect(label).not.toContain('运行正常');
      expect(label).not.toContain('服务降级');
      expect(label).not.toContain('无法连接');
      expect(label).not.toContain('在线');
    }
  });

  it('unreachable and degraded states explain it in human words', () => {
    expect(statusLabel(snap({ reachable: false, lastCheckedAt: 1 }))).toContain('重试');
    expect(statusLabel(snap({ status: 'degraded', lastCheckedAt: 1 }))).toContain('稍等');
  });

  it('ok and pending states show no label at all (P297)', () => {
    expect(statusLabel(snap({ status: 'ok', lastCheckedAt: 1 }))).toBeNull();
    expect(statusLabel(snap({}))).toBeNull();
  });

  it('a healthy render mounts no footer and no status live-region (P297)', () => {
    // SSR exercises the pending snapshot — the first poll is an effect.
    const html = renderToStaticMarkup(createElement(SystemStatusFooter));
    expect(html).toBe('');
  });

  it('technical level/status detail lives in title/aria-label only', () => {
    expect(footerTsx).toContain('statusDetail(snapshot)');
    expect(footerTsx).toContain('title={detail}');
    expect(footerTsx).toContain('aria-label={detail}');
    expect(footerTsx).toContain('{statusLabel(snapshot)}');
    const labelSpan = footerTsx.slice(
      footerTsx.indexOf('system-status-label'),
      footerTsx.indexOf('</footer>'),
    );
    expect(labelSpan).not.toContain('footerLevel');
    expect(labelSpan).not.toContain('snapshot.status');
  });
});

describe('P291 · reply-length toggle copy speaks intent', () => {
  it('every preference label is an intent phrase, not a parameter name', () => {
    for (const pref of ['default', 'concise', 'detailed'] as const) {
      const label = replyLengthLabel(pref);
      expect(PARAM_WORDS).not.toContain(label);
      expect(label).toContain('回答');
    }
  });

  it('the rendered toggle button shows no bare 档位 name as its visible text', () => {
    for (const pref of ['default', 'concise', 'detailed'] as const) {
      const text = toggleInnerText(renderBar(pref));
      expect(PARAM_WORDS).not.toContain(text);
      expect(text).toBe(replyLengthLabel(pref));
    }
  });

  it('aria-label/title still describe the intent — current and next', () => {
    const html = renderBar('default');
    expect(html).toContain('aria-label="回复长度：回答适中（默认档），点击切换为回答简短一些（精简档）"');
    expect(html).toContain('title="回复长度：回答适中（默认档），点击切换为回答简短一些（精简档）"');
  });
});
