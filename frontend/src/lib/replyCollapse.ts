/**
 * P217 — long assistant replies collapse to a preview with a
 * 「展开全文 / 收起」 toggle at the bottom of the bubble. A nervous
 * question used to come back as a ~3000-character listicle; the preview
 * keeps the first screen readable while the full text stays one click away.
 */

/** Replies at or under this length render exactly as before — no toggle. */
export const REPLY_COLLAPSE_CHARS = 800;

/** Only settled assistant replies past the limit collapse. */
export function shouldCollapseReply(content: string, limit = REPLY_COLLAPSE_CHARS): boolean {
  return content.length > limit;
}

/**
 * Truncated preview shown while collapsed: the first `limit` characters,
 * backed off to a nearby line boundary so we do not cut mid-sentence, and
 * never ending inside an unclosed ``` fence (a dangling fence would make
 * react-markdown swallow the rest of the preview).
 */
export function collapseReplyPreview(content: string, limit = REPLY_COLLAPSE_CHARS): string {
  if (!shouldCollapseReply(content, limit)) return content;
  let slice = content.slice(0, limit);
  const lastBreak = slice.lastIndexOf('\n');
  if (lastBreak > limit - Math.floor(limit / 6)) {
    slice = slice.slice(0, lastBreak);
  }
  const fences = slice.match(/```/g);
  if (fences && fences.length % 2 === 1) {
    slice = slice.slice(0, slice.lastIndexOf('```'));
  }
  return slice.replace(/[\s>*#`|-]+$/, '') + '…';
}

/** What the bubble renders: preview while collapsed, full text when expanded. */
export function visibleReplyContent(
  content: string,
  expanded: boolean,
  limit = REPLY_COLLAPSE_CHARS,
): string {
  return expanded ? content : collapseReplyPreview(content, limit);
}
