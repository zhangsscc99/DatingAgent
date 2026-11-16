/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../src/types';
import {
  hasMinimalProfile,
  loadProfile,
  normalizeProfile,
  saveProfile,
} from '../src/lib/profileStorage';

/**
 * P160 — user profile self-heal. `loadProfile()` used to `JSON.parse` into
 * `UserProfile` unchecked, so a hand-edited or stale `{"name":123}` record
 * made `hasMinimalProfile()` throw a TypeError at `profile?.name?.trim()`
 * and white-screened the first screen with no recovery path. Normalization
 * must validate field by field, never throw, and return null (fall back to
 * onboarding) when no usable name survives.
 */

const PROFILE_KEY = 'datingAgent.userProfile';

let store: Map<string, string>;

describe('P160 · stored profile normalization', () => {
  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([{ name: 123 }, null, 42, 'hello', true, [1, 2], undefined])(
    'non-conforming input %j yields null without throwing',
    (input) => {
      let result: UserProfile | null | undefined;
      expect(() => {
        result = normalizeProfile(input);
      }).not.toThrow();
      expect(result).toBeNull();
    },
  );

  it.each(['null', '"42"', '42', '""', '"[]"', '[]', '"hello"', 'true', '{{{oops'])(
    'a stored payload of %s loads as null without throwing',
    (payload) => {
      store.set(PROFILE_KEY, payload);
      let profile: UserProfile | null | undefined;
      expect(() => {
        profile = loadProfile();
      }).not.toThrow();
      expect(profile).toBeNull();
    },
  );

  it('returns null for an empty stored value and for a missing key', () => {
    expect(loadProfile()).toBeNull();
    store.set(PROFILE_KEY, '');
    expect(loadProfile()).toBeNull();
  });

  it('preserves a valid full profile with no data loss', () => {
    const good: UserProfile = {
      name: '小明',
      age: 28,
      interests: ['音乐', '旅行'],
      goals: '认真恋爱',
      personality: '开朗外向',
    };
    store.set(PROFILE_KEY, JSON.stringify(good));
    expect(loadProfile()).toEqual(good);
    expect(normalizeProfile({ ...good })).toEqual(good);
  });

  it('round-trips through saveProfile unchanged', () => {
    const profile: UserProfile = { name: '阿花', age: 30, interests: ['读书'] };
    saveProfile(profile);
    expect(loadProfile()).toEqual(profile);
  });

  it('trims and clips name to 200 chars and free-text fields to 1000', () => {
    const result = normalizeProfile({
      name: `  ${'名'.repeat(300)}  `,
      goals: 'g'.repeat(1500),
      personality: `  ${'p'.repeat(1200)}`,
    });
    expect(result?.name).toHaveLength(200);
    expect(result?.goals).toHaveLength(1000);
    expect(result?.personality).toHaveLength(1000);
    expect(result?.name?.startsWith('名')).toBe(true);
  });

  it('returns null when name is missing, blank, or whitespace-only', () => {
    expect(normalizeProfile({ age: 30, goals: 'x' })).toBeNull();
    expect(normalizeProfile({ name: '   ' })).toBeNull();
    expect(normalizeProfile({ name: '' })).toBeNull();
  });

  it('keeps non-string name from corrupting the profile: falls back to null', () => {
    expect(normalizeProfile({ name: 123 })).toBeNull();
    expect(normalizeProfile({ name: ['x'] })).toBeNull();
    expect(normalizeProfile({ name: { value: 'x' } })).toBeNull();
  });

  it('normalizes interests to a clean string array', () => {
    expect(normalizeProfile({ name: 'a', interests: 'music' })?.interests).toEqual([]);
    expect(normalizeProfile({ name: 'a', interests: [1, 2] })?.interests).toEqual([]);
    expect(
      normalizeProfile({ name: 'a', interests: [' 音乐 ', 7, '', null, '旅行'] })?.interests,
    ).toEqual(['音乐', '旅行']);
    expect(normalizeProfile({ name: 'a' })?.interests).toBeUndefined();
  });

  it('clips each interest entry and caps the list length', () => {
    const long = normalizeProfile({ name: 'a', interests: ['i'.repeat(150)] });
    expect(long?.interests?.[0]).toHaveLength(100);
    const many = normalizeProfile({
      name: 'a',
      interests: Array.from({ length: 30 }, (_, i) => `tag${i}`),
    });
    expect(many?.interests).toHaveLength(20);
    expect(many?.interests?.[19]).toBe('tag19');
  });

  it('drops age that is not a finite in-range number', () => {
    expect(normalizeProfile({ name: 'a', age: '30' })?.age).toBeUndefined();
    expect(normalizeProfile({ name: 'a', age: NaN })?.age).toBeUndefined();
    expect(normalizeProfile({ name: 'a', age: Infinity })?.age).toBeUndefined();
    expect(normalizeProfile({ name: 'a', age: 200 })?.age).toBeUndefined();
    expect(normalizeProfile({ name: 'a', age: -5 })?.age).toBeUndefined();
    expect(normalizeProfile({ name: 'a', age: 30 })?.age).toBe(30);
  });

  it('drops non-string goals/personality instead of keeping junk', () => {
    const result = normalizeProfile({ name: 'a', goals: 42, personality: ['x'] });
    expect(result).toEqual({ name: 'a' });
  });

  it('does not mutate its input', () => {
    const raw = { name: ' a ', interests: [' x ', 1] };
    normalizeProfile(raw);
    expect(raw).toEqual({ name: ' a ', interests: [' x ', 1] });
  });

  it('loadProfile heals a corrupted record and hasMinimalProfile never throws', () => {
    store.set(PROFILE_KEY, '{"name":123}');
    let profile: UserProfile | null | undefined;
    let minimal: boolean | undefined;
    expect(() => {
      profile = loadProfile();
      minimal = hasMinimalProfile(profile ?? null);
    }).not.toThrow();
    expect(profile).toBeNull();
    expect(minimal).toBe(false);
  });

  it('hasMinimalProfile is defensive against a corrupted shape', () => {
    const corrupted = { name: 123 } as unknown as UserProfile;
    expect(() => hasMinimalProfile(corrupted)).not.toThrow();
    expect(hasMinimalProfile(corrupted)).toBe(false);
    expect(hasMinimalProfile(null)).toBe(false);
    expect(hasMinimalProfile({ name: '  ' })).toBe(false);
    expect(hasMinimalProfile({ name: 'ok' })).toBe(true);
  });
});
