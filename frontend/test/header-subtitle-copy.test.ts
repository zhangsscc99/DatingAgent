/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P232 — the visible subtitle under the header title once rendered
 * 「AI 恋爱关系顾问 · Agent Harness」: framework vocabulary meaningless
 * to a dating user (the <title> and server HTML were already clean).
 *
 * P415 — the human positioning line that replaced it
 * (「先听你说完，再给具体建议」) duplicated the hero's promise word for
 * word on the desktop empty state, so the subtitle is gone for good: the
 * header wordmark carries the brand name only, and the single surviving
 * copy of the promise lives in the hero. These guards pin the source so
 * neither the jargon nor a second copy of the promise can regress into
 * the header.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const appCss = readFileSync(join(SRC, 'App.css'), 'utf8');

const subtitleMatch = app.match(/className="subtitle"/);

describe('P232/P415 · header wordmark carries no subtitle', () => {
  it('renders no .subtitle element in the header', () => {
    expect(subtitleMatch).toBeNull();
    expect(app).not.toMatch(/<p className="subtitle">/);
  });

  it('the hero’s promise line does not appear in the header source', () => {
    expect(app).not.toContain('先听你说完');
    expect(app).not.toContain('先听你说完，再给具体建议');
  });

  it('old jargon subtitle string is gone from the source', () => {
    expect(app).not.toContain('AI 恋爱关系顾问 · Agent Harness');
  });

  it('the orphaned .subtitle rules are gone from the stylesheet', () => {
    expect(appCss).not.toMatch(/\.subtitle\s*\{/);
  });
});
