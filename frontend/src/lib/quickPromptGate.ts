/**
 * P172: a quick-prompt tap must be a no-op while a reply is in flight —
 * `sendMessage` drops the text when `loading`, so firing the handler would
 * just close the sidebar drawer and silently lose the prompt.
 */
export function canRunQuickPrompt(busy: boolean): boolean {
  return !busy;
}
