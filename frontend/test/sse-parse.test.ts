/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTerminalEvent, parseSseDataLine } from '../src/lib/sse';
import type { AgentEvent } from '../src/types';

/**
 * P171 — malformed SSE lines must not kill a turn. A proxy/WAF can splice
 * an HTML error page, a truncated half-frame or an empty `data:` line into
 * the stream; the parser returns null for all of those so the read loop
 * skips the line and keeps the tokens already received.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

/** Mirror of the App.tsx read loop: skip nulls, accumulate the rest. */
function collectEvents(lines: string[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const line of lines) {
    const event = parseSseDataLine(line);
    if (event === null) continue;
    events.push(event);
  }
  return events;
}

describe('P171 · tolerant SSE parsing', () => {
  describe('parseSseDataLine — valid frames', () => {
    it('parses a message event', () => {
      const line = 'data: {"type":"message","data":{"content":"你好"}}';
      expect(parseSseDataLine(line)).toEqual({
        type: 'message',
        data: { content: '你好' },
      });
    });

    it('parses a done event with meta', () => {
      const line =
        'data: {"type":"done","data":{"sessionId":"s1","tool":"plan_date","tokens":42,"latencyMs":120}}';
      expect(parseSseDataLine(line)).toEqual({
        type: 'done',
        data: { sessionId: 's1', tool: 'plan_date', tokens: 42, latencyMs: 120 },
      });
    });

    it('parses a tool_start event', () => {
      const line = 'data: {"type":"tool_start","data":{"name":"plan_date"}}';
      expect(parseSseDataLine(line)).toEqual({
        type: 'tool_start',
        data: { name: 'plan_date' },
      });
    });

    it('parses an error event', () => {
      const line = 'data: {"type":"error","data":{"message":"boom"}}';
      expect(parseSseDataLine(line)).toEqual({
        type: 'error',
        data: { message: 'boom' },
      });
    });
  });

  describe('parseSseDataLine — malformed frames return null, never throw', () => {
    const badLines: [string, string][] = [
      ['a line without the data prefix', '{"type":"message","data":{"content":"x"}}'],
      ['an SSE comment', ': ping'],
      ['a blank line', ''],
      ['a whitespace-only line', '   '],
      ['an empty data frame', 'data: '],
      ['the [DONE] sentinel', 'data: [DONE]'],
      ['half-truncated JSON', 'data: {"type":"message","data":{"cont'],
      ['an injected HTML error page', 'data: <!doctype html><html><body>502 Bad Gateway</body>'],
      ['a bare HTML fragment line', '<!doctype html><html>'],
      ['JSON that is not an event', 'data: {"foo":1}'],
      ['a JSON primitive', 'data: 42'],
    ];

    for (const [label, line] of badLines) {
      it(`returns null for ${label}`, () => {
        expect(() => parseSseDataLine(line)).not.toThrow();
        expect(parseSseDataLine(line)).toBeNull();
      });
    }
  });

  describe('read-loop resilience', () => {
    it('a bad line between good events does not stop a later done', () => {
      const events = collectEvents([
        'data: {"type":"message","data":{"content":"partial "}}',
        'data: <!doctype html><html><body>proxy error</body></html>',
        'data: {"type":"message","data":{"cont',
        '',
        'data: {"type":"message","data":{"content":"partial reply"}}',
        'data: {"type":"done","data":{"sessionId":"s1","tokens":7}}',
      ]);
      expect(events.map((e) => e.type)).toEqual(['message', 'message', 'done']);
      expect((events[1].data as { content: string }).content).toBe('partial reply');
      expect(isTerminalEvent(events[2])).toBe(true);
    });
  });

  describe('isTerminalEvent', () => {
    it('is true for done and error', () => {
      expect(isTerminalEvent({ type: 'done', data: {} })).toBe(true);
      expect(isTerminalEvent({ type: 'error', data: { message: 'x' } })).toBe(true);
    });

    it('is false for mid-stream events', () => {
      expect(isTerminalEvent({ type: 'message', data: {} })).toBe(false);
      expect(isTerminalEvent({ type: 'tool_start', data: {} })).toBe(false);
      expect(isTerminalEvent({ type: 'thinking', data: {} })).toBe(false);
    });
  });

  describe('source guard', () => {
    it('App.tsx parses SSE lines through the helper, never raw JSON.parse', () => {
      const app = read('App.tsx');
      expect(app).toContain("from './lib/sse'");
      expect(app).toContain('parseSseDataLine(line)');
      // No bare JSON.parse on an SSE line anywhere in the stream loop.
      expect(app).not.toMatch(/JSON\.parse\(line/);
    });
  });
});
