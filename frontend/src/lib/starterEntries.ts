import type { ChatIntent } from '../types';

/**
 * P355 — the ONE starter-entry list. The welcome block (starter chips on
 * desktop, the joined hint line at ≤768px) and the sidebar「快捷入口」both
 * render from this array, so the two surfaces can never drift apart again:
 * four entries, same order, same copy — the old split (3 capsule labels on
 * the first screen vs 4 drawer buttons) is what this replaces.
 *
 * P220: labels are intent-shaped sentences so they can never be mistaken
 * for the 进阶工具 capability names listed below them in the drawer.
 *
 * `intent` marks the entries that open a P345 intake branch on the first
 * screen; an entry without one is still not a dead option — its `prompt`
 * prefills the composer through the same path the drawer rows use.
 */
export type StarterIconKey = 'profile' | 'chat' | 'calendar' | 'heart';

export interface StarterEntry {
  /** Drawer-row icon (Sidebar's QUICK_ICON_PATHS). */
  iconKey: StarterIconKey;
  /** The one label both surfaces render. */
  label: string;
  /** Ready-to-edit draft the entry drops into the composer. */
  prompt: string;
  /** P345 intake branch; absent → the chip prefills `prompt` directly. */
  intent?: ChatIntent;
}

export const STARTER_ENTRIES: readonly StarterEntry[] = [
  {
    iconKey: 'profile',
    label: '帮我优化资料',
    prompt: '帮我看看交友资料怎么写更有吸引力',
    intent: 'profile',
  },
  {
    iconKey: 'chat',
    label: '她这样回我怎么接',
    prompt: '对方说「周末有什么安排」，我该怎么回复？',
    intent: 'chat-coach',
  },
  {
    iconKey: 'calendar',
    label: '帮我规划第一次约会',
    prompt: '帮我规划一次轻松自然的第一次约会',
    intent: 'date-plan',
  },
  {
    iconKey: 'heart',
    label: '我们合不合适',
    prompt: '我偏内向慢热，对方很外向，分析一下合不合适',
  },
];
