/**
 * Strip control characters from user input before it reaches the LLM or logs.
 * Keeps newlines (\n) and tabs (\t); removes NUL, ESC, other C0/C1 controls and DEL.
 */
export function sanitizeMessage(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g, '');
}
