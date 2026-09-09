import type { UserProfile } from '../types';

const PROFILE_KEY = 'datingAgent.userProfile';
const ONBOARDING_KEY = 'datingAgent.onboardingDone';

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function isOnboardingComplete(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
}

export function markOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_KEY, 'true');
}

export function hasMinimalProfile(profile: UserProfile | null): boolean {
  return Boolean(profile?.name?.trim());
}
