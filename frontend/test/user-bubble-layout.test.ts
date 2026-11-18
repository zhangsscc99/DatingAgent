/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P315 — the user's own pink bubble used to carry a gray「你」avatar on
 * its left: `.bubble-row.user` declares `flex-direction: row-reverse`,
 * so the `{isUser && <div className="avatar user-avatar">` sibling that
 * sat AFTER the bubble in JSX order landed visually BEFORE it — a
 * left-side avatar next to a right-aligned bubble. The fix drops the
 * user-side avatar entirely: the pink bubble alone carries identity,
 * the assistant row keeps its heart avatar on the left.
 *
 * No DOM/layout engine ships with this repo (node-env vitest), so the
 * visual order is DERIVED, not measured — same style as
 * desktop-measure.test.ts:
 *
 *   rowSlice   = JSX children of the `<div className="bubble-row…">`
 *   children   = top-level markers in JSX order, each tagged by its
 *                `{isUser && (` / `{!isUser && (` guard (or none)
 *   rendered   = children whose guard admits the branch
 *   visualOrder = flexDirection === 'row-reverse'
 *                 ? [...rendered].reverse() : rendered
 *
 * "avatar left of bubble" then means: an avatar marker at a visualOrder
 * index smaller than the bubble's. The sensitivity test feeds the
 * pre-fix markup through the same derivation and shows it flags the
 * old layout — the check is not vacuous.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const tsx = read('components/MessageBubble.tsx');
const bubbleCss = read('components/MessageBubble.css');
const indexCss = read('index.css');

type Branch = 'user' | 'assistant';
interface RowChild {
  kind: 'avatar' | 'bubble';
  /** which branch the JSX guard admits; null = always rendered */
  guard: Branch | null;
  classList: string;
  index: number;
}

/** Inner JSX of the `<div className="bubble-row…">` element. */
function extractRowChildren(source: string): string {
  const classIdx = source.indexOf('bubble-row');
  if (classIdx < 0) return '';
  const openStart = source.lastIndexOf('<div', classIdx);
  // End of the opening tag = first '>' at curly-brace depth 0.
  let depth = 0;
  let i = openStart;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    else if (source[i] === '>' && depth === 0) break;
  }
  const childrenStart = i + 1;
  // Matching close tag: every inner <div> is balanced, so the first
  // </div> that brings the depth back to 0 closes the row itself.
  let divDepth = 1;
  const tagRe = /<\/?div\b/g;
  tagRe.lastIndex = childrenStart;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(source))) {
    divDepth += m[0][1] === '/' ? -1 : 1;
    if (divDepth === 0) return source.slice(childrenStart, m.index);
  }
  return '';
}

/** Ordered top-level markers (avatar / bubble) inside the row slice. */
function parseRowChildren(rowSlice: string): RowChild[] {
  const guards: { index: number; branch: Branch }[] = [];
  for (const g of rowSlice.matchAll(/\{\s*(!?)\s*isUser\s*&&\s*\(/g)) {
    guards.push({ index: g.index!, branch: g[1] === '!' ? 'assistant' : 'user' });
  }
  const guardFor = (index: number): Branch | null => {
    const before = guards.filter((g) => g.index < index);
    return before.length ? before[before.length - 1].branch : null;
  };
  const children: RowChild[] = [];
  for (const m of rowSlice.matchAll(/className="(avatar[^"]*)"/g)) {
    children.push({
      kind: 'avatar',
      guard: guardFor(m.index!),
      classList: m[1],
      index: m.index!,
    });
  }
  for (const m of rowSlice.matchAll(/className=\{`bubble /g)) {
    children.push({ kind: 'bubble', guard: null, classList: 'bubble', index: m.index! });
  }
  return children.sort((a, b) => a.index - b.index);
}

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

const renderedFor = (branch: Branch, children: RowChild[]) =>
  children.filter((c) => c.guard === null || c.guard === branch);

const visualOrder = (children: RowChild[], flexDirection: string) =>
  flexDirection === 'row-reverse' ? [...children].reverse() : children;

const flexDirectionOf = (selector: string): string =>
  /flex-direction:\s*([\w-]+)/.exec(ruleBody(bubbleCss, selector))?.[1] ?? 'row';

const rowChildren = parseRowChildren(extractRowChildren(tsx));
const userFlex = flexDirectionOf('.bubble-row.user');
const assistantFlex = flexDirectionOf('.bubble-row');

/**
 * The markup as it shipped before this fix — assistant avatar guarded
 * by `{!isUser && (`, the bubble, then `{isUser && (` guarding the gray
 * 「你」avatar AFTER the bubble in JSX order.
 */
const PRE_FIX_ROW = `
      {!isUser && (
        <div className="avatar" aria-hidden="true"><svg /></div>
      )}
      <div className={\`bubble \${isUser ? 'user' : 'assistant'}\`}>
        <div className="bubble-content">hi</div>
      </div>
      {isUser && (
        <div className="avatar user-avatar" aria-hidden="true">
          你
        </div>
      )}
`;

describe('P315 · no gray avatar left of the right-aligned user bubble', () => {
  it('user branch: no avatar sits visually left of the bubble', () => {
    const userVisual = visualOrder(renderedFor('user', rowChildren), userFlex);
    const bubbleIdx = userVisual.findIndex((c) => c.kind === 'bubble');
    expect(bubbleIdx).toBeGreaterThanOrEqual(0);
    // Every marker rendered before the bubble in visual order is a
    // non-avatar sibling — with the element dropped there are none.
    expect(
      userVisual.slice(0, bubbleIdx).some((c) => c.kind === 'avatar'),
    ).toBe(false);
    // Design is unambiguous: the user branch renders no avatar node.
    expect(renderedFor('user', rowChildren).some((c) => c.kind === 'avatar')).toBe(false);
  });

  it('assistant branch: the heart avatar still renders visually LEFT of the bubble', () => {
    const asstVisual = visualOrder(
      renderedFor('assistant', rowChildren),
      assistantFlex,
    );
    expect(asstVisual.length).toBeGreaterThanOrEqual(2);
    expect(asstVisual[0].kind).toBe('avatar');
    expect(asstVisual[0].classList).not.toContain('user-avatar');
    const bubbleIdx = asstVisual.findIndex((c) => c.kind === 'bubble');
    expect(bubbleIdx).toBe(1);
  });

  it('the user row still packs to the right edge', () => {
    const body = ruleBody(bubbleCss, '.bubble-row.user');
    expect(body).toMatch(/align-self:\s*flex-end|justify-content:\s*flex-end/);
    // row-reverse is what made the trailing JSX avatar flip left — the
    // declaration stays; only the avatar left.
    expect(userFlex).toBe('row-reverse');
  });

  it('drops .user-avatar from markup and CSS with no orphan rule', () => {
    expect(tsx).not.toContain('user-avatar');
    expect(bubbleCss).not.toMatch(/\.user-avatar\s*\{/);
    // --user-bg stays declared in index.css (still a valid token).
    expect(indexCss).toMatch(/--user-bg:/);
    // Aria labels unchanged.
    expect(tsx).toContain('你的消息');
    expect(tsx).toContain('DatingAgent 的回复');
  });

  it('sensitivity: the same derivation flags the pre-fix markup', () => {
    const before = parseRowChildren(PRE_FIX_ROW);
    const userVisual = visualOrder(renderedFor('user', before), 'row-reverse');
    // Old layout: bubble then guarded avatar → reversed → avatar lands
    // at index 0, i.e. visually LEFT of the right-aligned bubble.
    expect(userVisual[0].kind).toBe('avatar');
    expect(userVisual.findIndex((c) => c.kind === 'bubble')).toBe(1);
    // …and the post-fix source no longer parses to that shape.
    expect(renderedFor('user', rowChildren).length).toBe(1);
  });
});
