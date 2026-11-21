/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { humanizeChatError } from '../src/lib/errorCopy';

/**
 * P87 — the old failure path copied the backend's raw `err.message`
 * (`LLM request failed: 401 …`) straight into the bubble and dropped the
 * structured `code` the harness already sends. This pure function is the
 * single map every error surface now uses: `code` first, `status` second,
 * generic Chinese last — the raw detail only ever reaches console.warn.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P87 · humanizeChatError', () => {
  it('maps code tool_unavailable to actionable zh copy with no identifiers', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = humanizeChatError({ code: 'tool_unavailable' });
    expect(text).toContain('这个功能暂时用不了');
    expect(text).not.toMatch(/tool/i);
    expect(/[一-鿿]/.test(text)).toBe(true);
    // Actionable: tells the user what to do next.
    expect(text).toContain('再试');
  });

  it('maps a 5xx status to busy-service copy, never a bare HTTP code', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const status of [500, 502, 503]) {
      const text = humanizeChatError({ status });
      expect(text).not.toContain('HTTP');
      expect(text).not.toContain(String(status));
      expect(text).toContain('稍等');
    }
  });

  it('never echoes a raw internal message — English, ids and codes stay out', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = humanizeChatError({ message: 'LLM request failed: 401 Unauthorized' });
    expect(text).not.toContain('LLM');
    expect(text).not.toContain('401');
    expect(text).not.toContain('Unauthorized');
    expect(text).not.toMatch(/[a-zA-Z]/);
    expect(text.length).toBeGreaterThan(0);
    // The raw detail is preserved for debugging — in the log, not the UI.
    expect(warn).toHaveBeenCalledWith(
      '[chat-error]',
      expect.objectContaining({ message: 'LLM request failed: 401 Unauthorized' }),
    );
  });

  it('speaks the real Retry-After seconds on a 429', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = humanizeChatError({ status: 429, retryAfterSec: 12 });
    expect(text).toContain('12');
    expect(text).toContain('秒');
    expect(humanizeChatError({ status: 429 })).toContain('稍');
  });

  it('maps auth and payload statuses without leaking the digits', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const status of [401, 403]) {
      const text = humanizeChatError({ status });
      expect(text).not.toContain(String(status));
      expect(text).toContain('刷新');
    }
    expect(humanizeChatError({ status: 413 })).toContain('消息太长');
  });

  it('treats status 0 as a dropped connection', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(humanizeChatError({ status: 0, message: 'Failed to fetch' })).toBe(
      '网络好像断了，检查一下再试',
    );
  });

  it('falls back to a non-empty generic Chinese sentence on empty input', () => {
    const text = humanizeChatError({});
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/[a-zA-Z]/);
    expect(/[一-鿿]/.test(text)).toBe(true);
  });

  it('produces no English or bare status codes for any input shape', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inputs = [
      { code: 'tool_unavailable' },
      { code: 'unknown_internal_code' },
      { message: 'socket hang up' },
      { status: 400 },
      { status: 404 },
      { status: 503 },
      { status: 0 },
      { status: 429, retryAfterSec: 30 },
    ];
    for (const input of inputs) {
      const text = humanizeChatError(input);
      expect(text).not.toMatch(/[a-zA-Z]/);
      expect(text).not.toMatch(/HTTP|[45]\d\d/);
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
