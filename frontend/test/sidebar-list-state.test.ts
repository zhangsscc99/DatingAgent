/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  nextEditingIdAfterSessionsChange,
  nextFilterQueryAfterSessionsChange,
} from '../src/lib/sidebarListState';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P164 — sidebar list-state reconciliation. The pure helpers decide whether
 * the locally held filterQuery/editingId survive a recentSessions change
 * (delete, 清空全部, cross-tab sync); source guards lock in that Sidebar
 * actually wires them through a signature-keyed effect and that the helper
 * reuses the shared sessionFilter matcher instead of duplicating it.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const session = (id: string, title: string, updatedAt: number): StoredChatSession => ({
  id,
  title,
  updatedAt,
  messages: [{ id: `${id}-u`, role: 'user', content: title } satisfies ChatMessage],
});

const SESSIONS: StoredChatSession[] = [
  session('s1', '周末Cat约会', 300),
  session('s2', 'The Restaurant chat', 200),
  session('s3', '资料建议', 100),
];

describe('P164 · sidebar list-state reconciliation', () => {
  describe('source guards', () => {
    it('Sidebar reconciles both states through a sessionsKey-keyed effect', () => {
      const sidebar = read('components/Sidebar.tsx');
      expect(sidebar).toContain('nextFilterQueryAfterSessionsChange');
      expect(sidebar).toContain('nextEditingIdAfterSessionsChange');
      expect(sidebar).toContain('setFilterQuery(');
      expect(sidebar).toContain('setEditingId(null)');
      expect(sidebar).toContain('setEditingValue(');
      // Effect is keyed on an id:title signature, not on every render.
      expect(sidebar).toContain('sessionsKey');
      expect(sidebar).toContain('useMemo');
      expect(sidebar).toContain('}, [sessionsKey])');
    });

    it('helper module imports the shared matcher and stays React-free', () => {
      const helper = read('lib/sidebarListState.ts');
      expect(helper).toContain("from './sessionFilter'");
      expect(helper).not.toMatch(/from ['"]react['"]/);
    });
  });

  describe('nextFilterQueryAfterSessionsChange', () => {
    it('preserves a query that still matches at least one session', () => {
      expect(nextFilterQueryAfterSessionsChange('cat', SESSIONS)).toBe('cat');
      expect(nextFilterQueryAfterSessionsChange('约会', SESSIONS)).toBe('约会');
    });

    it('preserves the query when only a non-matching session was deleted', () => {
      const withoutS2 = SESSIONS.filter((s) => s.id !== 's2');
      expect(nextFilterQueryAfterSessionsChange('约会', withoutS2)).toBe('约会');
    });

    it('clears the query when the only matching session is deleted', () => {
      const withoutS1 = SESSIONS.filter((s) => s.id !== 's1');
      // 'cat' only matched s1; 'restaurant' still matches s2.
      expect(nextFilterQueryAfterSessionsChange('cat', withoutS1)).toBe('');
      expect(nextFilterQueryAfterSessionsChange('restaurant', withoutS1)).toBe(
        'restaurant',
      );
    });

    it('clears the query after 清空全部 empties the list', () => {
      expect(nextFilterQueryAfterSessionsChange('cat', [])).toBe('');
    });

    it('returns the verbatim query (whitespace kept) while it still matches', () => {
      expect(nextFilterQueryAfterSessionsChange('  约会  ', SESSIONS)).toBe(
        '  约会  ',
      );
    });

    it('keeps an empty/whitespace query while sessions exist', () => {
      expect(nextFilterQueryAfterSessionsChange('', SESSIONS)).toBe('');
      expect(nextFilterQueryAfterSessionsChange('   ', SESSIONS)).toBe('   ');
    });

    it('does not mutate the session list', () => {
      const before = [...SESSIONS];
      nextFilterQueryAfterSessionsChange('zzz', SESSIONS);
      expect(SESSIONS).toEqual(before);
    });
  });

  describe('nextEditingIdAfterSessionsChange', () => {
    it('keeps the editing id while its row still exists', () => {
      expect(nextEditingIdAfterSessionsChange('s2', SESSIONS)).toBe('s2');
    });

    it('keeps the id when the row was renamed (id survives, title changed)', () => {
      const renamed = SESSIONS.map((s) =>
        s.id === 's2' ? { ...s, title: ' renamed ' } : s,
      );
      expect(nextEditingIdAfterSessionsChange('s2', renamed)).toBe('s2');
    });

    it('drops the id when its row was deleted', () => {
      const withoutS2 = SESSIONS.filter((s) => s.id !== 's2');
      expect(nextEditingIdAfterSessionsChange('s2', withoutS2)).toBeNull();
    });

    it('drops the id when the list is emptied', () => {
      expect(nextEditingIdAfterSessionsChange('s2', [])).toBeNull();
    });

    it('stays null when no rename is in progress', () => {
      expect(nextEditingIdAfterSessionsChange(null, SESSIONS)).toBeNull();
      expect(nextEditingIdAfterSessionsChange(null, [])).toBeNull();
    });
  });
});
