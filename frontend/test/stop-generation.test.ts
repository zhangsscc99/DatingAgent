/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P12 — stop-generation contract. There is no DOM harness in this repo, so
 * these are source-level guards (same approach as a11y.test.ts): they lock in
 * the wiring between the composer's stop button, the AbortController in
 * App.tsx, and the "已停止生成" bubble note.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P12 · stop generation', () => {
  it('renders a labelled stop button while streaming', () => {
    const inputBar = read('components/InputBar.tsx');
    expect(inputBar).toContain('streaming && onStop');
    expect(inputBar).toContain('aria-label="停止生成"');
    expect(inputBar).toContain('onClick={onStop}');
  });

  it('aborts the in-flight request through abortRef', () => {
    const app = read('App.tsx');
    expect(app).toContain('abortRef.current?.abort()');
    expect(app).toContain('onStop={stopStreaming}');
  });

  it('clears the streaming state on AbortError instead of showing an error', () => {
    const app = read('App.tsx');
    const abortBranch = app.slice(app.indexOf("name === 'AbortError'"));
    expect(abortBranch).toContain('streaming: false');
    expect(abortBranch).toContain('stopped: true');
    expect(abortBranch).toContain("status: 'aborted'");
    // A user-initiated stop must never surface the generic failure path.
    expect(abortBranch.indexOf("status: 'aborted'")).toBeLessThan(
      abortBranch.indexOf('请求失败'),
    );
  });

  it('keeps the partial reply with a stopped note in the bubble', () => {
    const bubble = read('components/MessageBubble.tsx');
    expect(bubble).toContain('message.stopped');
    expect(bubble).toContain('已停止生成');
  });
});
