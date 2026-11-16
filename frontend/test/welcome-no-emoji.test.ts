/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P200 — welcome/onboarding emoji-free contract. vitest runs in the node
 * environment (same as sidebar-no-emoji.test.ts), so these source guards
 * lock the rendered markup: the ChatWindow welcome card and the
 * ProfileOnboarding dialog carry no Extended_Pictographic code points,
 * the three capability cards keep their original count and order, and the
 * onboarding title text is unchanged. Emoji the user typed are untouched —
 * this only covers our own decoration.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const chatWindow = read('components/ChatWindow.tsx');
const onboarding = read('components/ProfileOnboarding.tsx');
const EMOJI = /\p{Extended_Pictographic}/u;

const welcomeBlock = chatWindow.slice(
  chatWindow.indexOf('className="welcome animate-in"'),
  chatWindow.indexOf('renderedMessages.map'),
);

describe('P200 · welcome card and onboarding have no emoji decoration', () => {
  it('the welcome card block contains no emoji code points', () => {
    expect(welcomeBlock.length).toBeGreaterThan(0);
    expect(EMOJI.test(welcomeBlock)).toBe(false);
    expect(welcomeBlock).not.toContain('className="welcome-icon"');
  });

  it('the onboarding dialog source contains no emoji code points', () => {
    expect(EMOJI.test(onboarding)).toBe(false);
    expect(onboarding).not.toContain('profile-icon');
  });

  it('keeps the three capability cards in the original order', () => {
    const labels = [...welcomeBlock.matchAll(/<strong>([^<]+)<\/strong>/g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual(['Tool-calling Loop', '真诚沟通', '结构化输出']);
    expect(welcomeBlock.match(/className="feature"/g)).toHaveLength(3);
  });

  it('replaces the capability icons with restrained currentColor-stroke SVGs', () => {
    expect(welcomeBlock).toContain('<FeatureIcon iconKey=');
    expect(welcomeBlock.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(chatWindow).toContain('stroke="currentColor"');
    expect(chatWindow).toContain('aria-hidden="true"');
  });

  it('keeps the onboarding title text unchanged', () => {
    expect(onboarding).toContain('id="profile-title">完善你的资料</h2>');
  });
});
