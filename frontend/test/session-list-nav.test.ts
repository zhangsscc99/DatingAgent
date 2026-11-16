/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  nextSessionIndex,
  sessionNavDirection,
} from '../src/lib/sessionListNav';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('nextSessionIndex', () => {
  it('moves down in the middle of the list', () => {
    expect(nextSessionIndex(1, 4, 1)).toBe(2);
  });

  it('moves up in the middle of the list', () => {
    expect(nextSessionIndex(2, 4, -1)).toBe(1);
  });

  it('stops at the top boundary (no wrap)', () => {
    expect(nextSessionIndex(0, 4, -1)).toBe(-1);
  });

  it('stops at the bottom boundary (no wrap)', () => {
    expect(nextSessionIndex(3, 4, 1)).toBe(-1);
  });

  it('never moves in a single-item list', () => {
    expect(nextSessionIndex(0, 1, 1)).toBe(-1);
    expect(nextSessionIndex(0, 1, -1)).toBe(-1);
  });

  it('never moves in an empty list', () => {
    expect(nextSessionIndex(0, 0, 1)).toBe(-1);
    expect(nextSessionIndex(0, 0, -1)).toBe(-1);
  });

  it('rejects an out-of-range current index', () => {
    expect(nextSessionIndex(-1, 3, 1)).toBe(-1);
    expect(nextSessionIndex(3, 3, -1)).toBe(-1);
  });
});

describe('sessionNavDirection', () => {
  it('maps ArrowDown to +1 and ArrowUp to -1', () => {
    expect(sessionNavDirection('ArrowDown')).toBe(1);
    expect(sessionNavDirection('ArrowUp')).toBe(-1);
  });

  it('ignores other keys', () => {
    expect(sessionNavDirection('Enter')).toBeNull();
    expect(sessionNavDirection('Tab')).toBeNull();
    expect(sessionNavDirection('ArrowLeft')).toBeNull();
  });
});

describe('Sidebar.tsx wiring (source-level)', () => {
  const src = readFileSync(join(SRC, 'components', 'Sidebar.tsx'), 'utf8');

  it('handles ArrowDown/ArrowUp on recent-chat items', () => {
    expect(src).toContain('handleSessionItemKeyDown');
    expect(src).toMatch(/recent-chat-item.*\n[\s\S]*?onKeyDown=\{handleSessionItemKeyDown\}/);
    expect(src).toContain('.recent-chat-item');
    expect(src).toContain('preventDefault');
  });
});
