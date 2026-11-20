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
  // P337: the welcome block also carries the `.hero` balance-hook class.
  chatWindow.indexOf('className="welcome hero animate-in"'),
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

  it('drops the passive capability cards — the shared hero CTA leads instead (P380)', () => {
    // P380 removed the three explanation cards from every width: the
    // one obvious action is the shared primary button; the starter
    // chips stay as the secondary entries.
    expect(welcomeBlock).not.toContain('className="feature"');
    expect(welcomeBlock).not.toContain('帮你把话说到点上');
    expect(welcomeBlock).not.toContain('约会前把安排想清楚');
    expect(welcomeBlock).toContain('className="hero-cta-primary"');
    expect(welcomeBlock).toContain('data-testid="hero-primary-cta"');
    // P413: the starter pill row left the welcome block — the surviving
    // secondary group maps the shared example prompts instead.
    expect(welcomeBlock).toContain('HERO_EXAMPLE_PROMPTS.map');
  });

  it('keeps the restrained currentColor-stroke icon on the example cards', () => {
    // The FeatureIcon set went away with the cards (P380); the hero
    // example-card send glyph keeps the same restrained style.
    expect(welcomeBlock).not.toContain('FeatureIcon');
    expect(welcomeBlock.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(chatWindow).toContain('stroke="currentColor"');
    expect(chatWindow).toContain('aria-hidden="true"');
  });

  it('keeps the onboarding title text unchanged', () => {
    expect(onboarding).toContain('id="profile-title">完善你的资料</h2>');
  });
});
