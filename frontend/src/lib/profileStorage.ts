import { isAvatarDataUrl } from './avatar';
import type { UserProfile } from '../types';

const PROFILE_KEY = 'datingAgent.userProfile';
const ONBOARDING_KEY = 'datingAgent.onboardingDone';

const NAME_MAX = 200;
const TEXT_MAX = 1000;
const INTEREST_MAX = 100;
const INTERESTS_COUNT_MAX = 20;
const AGE_MIN = 0;
const AGE_MAX = 150;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clipText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * P160 — self-heal a stored user profile. A corrupted entry (written by an
 * older build or hand-edited, e.g. `{"name":123}`) used to white-screen the
 * app at `hasMinimalProfile`'s `profile?.name?.trim()`. Validates the shape
 * field by field against UserProfile, drops or repairs invalid values, clips
 * over-long strings, and returns null when there is no usable name so the
 * app falls back to onboarding. Never throws, never mutates input.
 */
export function normalizeProfile(raw: unknown): UserProfile | null {
  if (!isRecord(raw)) return null;
  const profile: UserProfile = {};

  if (typeof raw.name === 'string') {
    const name = clipText(raw.name, NAME_MAX);
    if (name) profile.name = name;
  }
  if (typeof raw.goals === 'string') {
    const goals = clipText(raw.goals, TEXT_MAX);
    if (goals) profile.goals = goals;
  }
  if (typeof raw.personality === 'string') {
    const personality = clipText(raw.personality, TEXT_MAX);
    if (personality) profile.personality = personality;
  }
  if (
    typeof raw.age === 'number' &&
    Number.isFinite(raw.age) &&
    raw.age >= AGE_MIN &&
    raw.age <= AGE_MAX
  ) {
    profile.age = raw.age;
  }
  if (Array.isArray(raw.interests)) {
    profile.interests = raw.interests
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => clipText(entry, INTEREST_MAX))
      .filter((entry) => entry.length > 0)
      .slice(0, INTERESTS_COUNT_MAX);
  } else if ('interests' in raw) {
    profile.interests = [];
  }
  // P443 — a stored avatar is only ever a bounded data:image/ URL written
  // by the picker's own compression; anything else (oversized blob,
  // remote URL, hand-edited junk) is dropped like the other bad fields.
  if (isAvatarDataUrl(raw.avatar)) {
    profile.avatar = raw.avatar;
  }

  return profile.name ? profile : null;
}

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  } catch {
    // No storage (SSR/static markup): treat as settled so callers that
    // gate prompts on this never fire where they cannot be dismissed.
    return true;
  }
}

export function markOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_KEY, 'true');
}

export function hasMinimalProfile(profile: UserProfile | null): boolean {
  return (
    typeof profile?.name === 'string' && profile.name.trim().length > 0
  );
}
