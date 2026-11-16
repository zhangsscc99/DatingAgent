/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatLatencySeconds,
  formatReplyLatency,
  SLOW_REPLY_THRESHOLD_MS,
} from '../src/lib/relativeTime';

/**
 * P212 — the reply meta row must not leak internal jargon or bare slow
 * numbers. Visible copy is human language ("约 N 秒" / "本次思考较久"); the
 * token count lives only in the element's title tooltip. vitest runs in the
 * node environment (no DOM renderer), so the tooltip contract is locked via
 * a source guard on MessageBubble.tsx plus pure-function assertions on the
 * formatter.
 */

const bubbleSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'MessageBubble.tsx'),
  'utf8',
);

describe('P212 · reply meta copy', () => {
  it('fast replies render "约 N 秒" with no tokens jargon', () => {
    const text = formatReplyLatency(1676 * 7); // 11.7 s
    expect(text).not.toContain('tokens');
    expect(text).toContain('秒');
    expect(formatReplyLatency(0)).toBe('约 0.0 秒');
    expect(formatReplyLatency(20_000)).toBe('约 20.0 秒');
  });

  it('slow replies render the neutral phrase, no raw seconds', () => {
    const text = formatReplyLatency(SLOW_REPLY_THRESHOLD_MS + 1);
    expect(text).toBe('本次思考较久');
    expect(text).not.toContain('秒');
    expect(text).not.toMatch(/\d/);
    expect(formatReplyLatency(70_200)).toBe('本次思考较久');
  });

  it('keeps the token count in the title tooltip, not the visible text', () => {
    // The visible token span is gone…
    expect(bubbleSrc).not.toContain('{message.meta.tokens} tokens</span>');
    // …and the count only survives inside the title attribute.
    expect(bubbleSrc).toMatch(/title=\{[\s\S]*?\$\{message\.meta\.tokens\} tokens[\s\S]*?\}/);
    // Raw seconds still ride along in the tooltip via the P63 formatter.
    expect(bubbleSrc).toContain('formatLatencySeconds(message.meta.latencyMs)');
    // Visible latency goes through the human-language formatter.
    expect(bubbleSrc).toContain('formatReplyLatency(message.meta.latencyMs)');
    expect(formatLatencySeconds(70_200)).toBe('70.2s');
  });
});
