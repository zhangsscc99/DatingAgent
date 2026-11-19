import type { ChatIntent } from '../types';
import { STARTER_ENTRIES } from './starterEntries';

/**
 * P345 — the welcome starter capsules as structural branches. A chip
 * no longer prefills a fixed sentence (that was a dead option — identical
 * to just typing it); it opens a per-intent intake that collects the
 * inputs that branch actually needs, then assembles a real first message
 * the user can still edit before sending.
 */

export interface StarterDef {
  intent: ChatIntent;
  /** Chip label — from the shared STARTER_ENTRIES row. */
  label: string;
  /** The intake's guiding question. */
  question: string;
}

/** P345: every starter intent's intake has exactly one guiding question. */
const INTAKE_QUESTIONS: Record<ChatIntent, string> = {
  profile: '资料里目前最缺哪一块？',
  'chat-coach': '把她最近发来的原话贴上来',
  'date-plan': '在哪座城市、预算多少、第几次见面？',
};

// P355: labels/order come from the shared STARTER_ENTRIES row so the
// first screen and the drawer can never hold a second hardcoded copy.
export const STARTERS: readonly StarterDef[] = STARTER_ENTRIES.flatMap((e) =>
  e.intent
    ? [
        {
          intent: e.intent,
          label: e.label,
          question: INTAKE_QUESTIONS[e.intent],
        },
      ]
    : [],
);

/** 资料优化 intake: which part of the profile is missing. */
export const PROFILE_PARTS = ['照片', '自我介绍', '开场白'] as const;

/** 约会规划 intake: the 第几次约会 select's options. */
export const DATE_ORDINALS = ['第一次', '第二次', '第三次及以上'] as const;

/** Raw intake answers, one slot per branch. */
export interface StarterFields {
  /** profile: the missing profile piece the user picked. */
  missing?: string | null;
  /** chat-coach: her pasted words. */
  herWords?: string;
  /** date-plan: city / budget / which date this is. */
  city?: string;
  budget?: string;
  ordinal?: string;
}

/**
 * Assemble the intake answers into the first user message. Returns null
 * while a required field is still empty — the fill button stays disabled
 * until the branch has what it needs (not just a canned sentence).
 */
export function assembleStarterMessage(
  intent: ChatIntent,
  fields: StarterFields,
): string | null {
  switch (intent) {
    case 'profile': {
      const missing = fields.missing?.trim();
      if (!missing) return null;
      return `帮我优化交友资料——目前资料里最缺的是「${missing}」，想先补这一块。`;
    }
    case 'chat-coach': {
      const words = fields.herWords?.trim();
      if (!words) return null;
      return `她刚发来一句：「${words}」我该怎么接？`;
    }
    case 'date-plan': {
      const city = fields.city?.trim();
      if (!city) return null;
      const budget = fields.budget?.trim() || '不限';
      const ordinal = fields.ordinal?.trim() || DATE_ORDINALS[0];
      return `帮我规划一次约会：城市在${city}，预算${budget}，约会次数：${ordinal}。`;
    }
  }
}
