/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P232 — the visible subtitle under the header title still rendered
 * 「AI 恋爱关系顾问 · Agent Harness」: framework vocabulary meaningless
 * to a dating user (the <title> and server HTML were already clean).
 * The subtitle is now a human positioning line. These guards pin the
 * source so the jargon cannot regress and the new copy stays non-empty
 * and user-facing (CJK).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');

const subtitleMatch = app.match(
  /<p className="subtitle">([^<]+)<\/p>/,
);
const subtitle = subtitleMatch?.[1] ?? '';

const JARGON = [
  'Agent Harness',
  'Harness',
  'Tool-calling',
  'SSE',
  'TypeScript',
];

describe('P232 · header subtitle copy carries no framework jargon', () => {
  it('renders a subtitle element in the header', () => {
    expect(subtitleMatch).not.toBeNull();
  });

  it('contains none of the jargon strings', () => {
    for (const word of JARGON) {
      expect(subtitle).not.toContain(word);
    }
  });

  it('old jargon subtitle string is gone from the source', () => {
    expect(app).not.toContain('AI 恋爱关系顾问 · Agent Harness');
  });

  it('new subtitle is non-empty and CJK', () => {
    expect(subtitle.trim().length).toBeGreaterThan(0);
    expect(subtitle).toMatch(/[一-鿿]/);
  });
});
