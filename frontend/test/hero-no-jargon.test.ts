/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ChatWindow from '../src/components/ChatWindow';

/**
 * P229 — the home empty state is the first screen a dating user sees, yet
 * it used to greet them with 「基于 Agent Harness 架构驱动」 and three
 * capability cards titled 「Tool-calling Loop / 真诚沟通 / 结构化输出」 —
 * framework jargon meaningless outside an engineering README. The hero
 * subtitle is now a human positioning line and the cards describe user
 * benefits. These guards pin both the rendered markup and the source so
 * the jargon cannot regress, and the three-card structure stays intact.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindow = readFileSync(join(SRC, 'components', 'ChatWindow.tsx'), 'utf8');

const welcomeBlock = chatWindow.slice(
  chatWindow.indexOf('className="welcome animate-in"'),
  chatWindow.indexOf('renderedMessages.map'),
);

const JARGON = ['Agent Harness', 'Tool-calling', 'SSE', 'TypeScript', '结构化输出'];
const CARD_TITLES = ['帮你把话说到点上', '真诚沟通', '约会前把安排想清楚'];

function renderEmptyState() {
  return renderToStaticMarkup(
    createElement(ChatWindow, {
      messages: [],
      loading: false,
      onSend: () => {},
    }),
  );
}

describe('P229 · empty-state hero copy carries no framework jargon', () => {
  it('renders none of the jargon strings in the empty-state markup', () => {
    const html = renderEmptyState();
    expect(html).toContain('class="welcome animate-in"');
    for (const word of JARGON) {
      expect(html).not.toContain(word);
    }
  });

  it('leaves no jargon in the welcome block source either', () => {
    expect(welcomeBlock.length).toBeGreaterThan(0);
    for (const word of JARGON) {
      expect(welcomeBlock).not.toContain(word);
    }
  });

  it('renders the hero subtitle as a human positioning line', () => {
    const html = renderEmptyState();
    expect(html).toContain('你好，我是 DatingAgent');
    expect(html).toContain('懂分寸的恋爱顾问');
    expect(html).not.toContain('架构驱动');
  });

  it('still renders three capability cards with their new titles in order', () => {
    const html = renderEmptyState();
    const titles = [...html.matchAll(/<strong>([^<]+)<\/strong>/g)].map(
      (m) => m[1],
    );
    expect(titles).toEqual(CARD_TITLES);
    expect(html.match(/class="feature"/g)).toHaveLength(3);
  });
});
