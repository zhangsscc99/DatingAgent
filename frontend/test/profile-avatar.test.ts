/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AVATAR_DATAURL_MAX_CHARS,
  AVATAR_MAX_BYTES,
  avatarColor,
  avatarInitial,
  fileToAvatarDataUrl,
  isAvatarDataUrl,
} from '../src/lib/avatar';
import { loadProfile, normalizeProfile, saveProfile } from '../src/lib/profileStorage';
import ProfileOnboarding from '../src/components/ProfileOnboarding';
import Sidebar from '../src/components/Sidebar';
import type { UserProfile } from '../src/types';

/**
 * P443 — the walkthrough checklist entry 「完善个人资料（上传头像）」 could not
 * run: the profile form had zero `input[type=file]`, and the sidebar card
 * was nickname+age text only. The fix adds an optional avatar field
 * (local File → ≤200KB data URL stored at datingAgent.userProfile.avatar,
 * no upload service), a circular avatar in the sidebar profile card and
 * the hero greeting, and a nickname-initial colour block as the unset
 * fallback.
 */

const PROFILE_KEY = 'datingAgent.userProfile';
const TINY_PNG_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('P443 · avatar storage normalization', () => {
  it('keeps a valid data:image/ avatar through normalize + save/load round-trip', () => {
    const profile = normalizeProfile({ name: '阿明', avatar: TINY_PNG_URL });
    expect(profile?.avatar).toBe(TINY_PNG_URL);
    saveProfile(profile!);
    const reloaded = loadProfile();
    expect(reloaded?.avatar).toBe(TINY_PNG_URL);
    expect(store.get(PROFILE_KEY)).toContain('data:image/png');
  });

  it.each([
    'https://example.com/a.png',
    'data:text/html;base64,PHN2Zz4=',
    `data:image/png;base64,${'A'.repeat(AVATAR_DATAURL_MAX_CHARS)}`,
    123,
    { src: 'x' },
  ])('drops a non-conforming avatar value %j', (avatar) => {
    const profile = normalizeProfile({ name: '阿明', avatar });
    expect(profile?.avatar).toBeUndefined();
  });

  it('isAvatarDataUrl bounds both scheme and size', () => {
    expect(isAvatarDataUrl(TINY_PNG_URL)).toBe(true);
    expect(isAvatarDataUrl('data:image/gif;base64,AA')).toBe(true);
    expect(isAvatarDataUrl('data:application/json;base64,AA')).toBe(false);
    expect(isAvatarDataUrl('x'.repeat(AVATAR_DATAURL_MAX_CHARS + 1))).toBe(false);
  });
});

describe('P443 · avatar fallback helpers', () => {
  it('avatarInitial takes the first trimmed grapheme, upper-cased', () => {
    expect(avatarInitial('  阿明 ')).toBe('阿');
    expect(avatarInitial('bob')).toBe('B');
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial(undefined)).toBe('?');
  });

  it('avatarColor is deterministic and inside the palette', () => {
    expect(avatarColor('阿明')).toBe(avatarColor('阿明'));
    expect(avatarColor('阿明')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('P443 · file → data URL compression', () => {
  it('reads a ≤200KB image verbatim as a data URL', async () => {
    const bytes = new Uint8Array(1024).fill(7);
    const file = new File([bytes], 'a.png', { type: 'image/png' });
    const dataUrl = await fileToAvatarDataUrl(file);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(isAvatarDataUrl(dataUrl)).toBe(true);
  });

  it('rejects non-image files', async () => {
    const file = new File([new Uint8Array(16)], 'a.txt', { type: 'text/plain' });
    await expect(fileToAvatarDataUrl(file)).rejects.toThrow();
  });

  it('an oversized image that cannot be canvas-shrunk (no DOM) rejects instead of storing raw', async () => {
    const file = new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    await expect(fileToAvatarDataUrl(file)).rejects.toThrow();
  });
});

describe('P443 · profile form exposes an avatar file input', () => {
  const noop = () => {};

  it('the 完善资料 dialog renders input[type=file] with image accept', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileOnboarding, {
        open: true,
        initialProfile: { name: '阿明' } as UserProfile,
        onSave: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('avatar-preview');
  });

  it('shows the stored avatar in the preview and offers removal', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileOnboarding, {
        open: true,
        initialProfile: { name: '阿明', avatar: TINY_PNG_URL } as UserProfile,
        onSave: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain(`src="${TINY_PNG_URL}"`);
    expect(html).toContain('移除');
  });
});

describe('P443 · sidebar profile card renders the avatar circle', () => {
  const baseProps = {
    tools: [],
    onQuickPrompt: () => {},
    onNewChat: () => {},
  };

  it('a profile with an avatar renders a non-empty <img> in .profile-avatar', () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        ...baseProps,
        profile: { name: '阿明', avatar: TINY_PNG_URL },
      }),
    );
    const block = html.match(/class="profile-avatar"[\s\S]*?<\/span>/)?.[0] ?? '';
    expect(block).toContain('<img');
    expect(block).toContain(TINY_PNG_URL);
  });

  it('a profile without an avatar falls back to the nickname-initial block', () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        ...baseProps,
        profile: { name: '阿明' },
      }),
    );
    expect(html).toContain('avatar-fallback');
    expect(html).toContain('阿');
  });
});
