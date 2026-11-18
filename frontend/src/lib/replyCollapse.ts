/**
 * P217 — long assistant replies collapse to a preview with a
 * 「展开全文 / 收起」 toggle at the bottom of the bubble. A nervous
 * question used to come back as a ~3000-character listicle; the preview
 * keeps the first screen readable while the full text stays one click away.
 *
 * P301 — a second, tighter rule: even under the character limit, a reply
 * made of more than 3 non-empty paragraphs previews only its first three
 * behind a 「展开更多」 toggle. The 「回答适中」 tier used to return four
 * dense paragraphs that overflowed a phone screen.
 */

/** Replies at or under this length never collapse on characters alone. */
export const REPLY_COLLAPSE_CHARS = 800;

/** Replies with more non-empty paragraphs than this collapse to a preview. */
export const REPLY_COLLAPSE_PARAGRAPHS = 3;

/**
 * Split a reply into its non-empty Markdown blocks. Blank lines inside a
 * fenced code block do not count as breaks, so a ``` fence is always kept
 * inside one block — splitting mid-fence would leave the preview with a
 * dangling opener that react-markdown swallows as unclosed code.
 */
function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    if (current.some((line) => line.trim() !== '')) {
      paragraphs.push(current.join('\n'));
    }
    current = [];
  };
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === '') {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return paragraphs;
}

/** Non-empty paragraph count; a fenced code block counts as one paragraph. */
export function paragraphCount(text: string): number {
  return splitParagraphs(text).length;
}

/**
 * Paragraph-level preview: the first `maxParagraphs` non-empty blocks,
 * joined the same way they appeared. Fences, blockquotes and headings stay
 * whole. Returns the input untouched when it already fits.
 */
export function collapseByParagraphs(
  text: string,
  maxParagraphs = REPLY_COLLAPSE_PARAGRAPHS,
): string {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length <= maxParagraphs) return text;
  return paragraphs.slice(0, maxParagraphs).join('\n\n');
}

/**
 * Which rule triggered the collapse. 'paragraphs' renders a 「展开更多」
 * toggle; 'chars' keeps the original 「展开全文」 wording. The paragraph
 * rule wins when both fire — a many-paragraph reply reads long regardless
 * of its raw character count.
 */
export function replyCollapseReason(
  content: string,
  charLimit = REPLY_COLLAPSE_CHARS,
  maxParagraphs = REPLY_COLLAPSE_PARAGRAPHS,
): 'paragraphs' | 'chars' | null {
  if (paragraphCount(content) > maxParagraphs) return 'paragraphs';
  if (content.length > charLimit) return 'chars';
  return null;
}

/** Only settled assistant replies past either limit collapse. */
export function shouldCollapseReply(content: string, limit = REPLY_COLLAPSE_CHARS): boolean {
  return replyCollapseReason(content, limit) !== null;
}

/**
 * Truncated preview shown while collapsed: a >3-paragraph reply shows only
 * its first three blocks, and whatever remains still gets backed off to
 * the character limit — cut near a line boundary so we do not slice
 * mid-sentence, and never ending inside an unclosed ``` fence (a dangling
 * fence would make react-markdown swallow the rest of the preview).
 */
export function collapseReplyPreview(content: string, limit = REPLY_COLLAPSE_CHARS): string {
  if (!shouldCollapseReply(content, limit)) return content;
  let slice =
    paragraphCount(content) > REPLY_COLLAPSE_PARAGRAPHS
      ? collapseByParagraphs(content)
      : content;
  if (slice.length > limit) {
    slice = slice.slice(0, limit);
    const lastBreak = slice.lastIndexOf('\n');
    if (lastBreak > limit - Math.floor(limit / 6)) {
      slice = slice.slice(0, lastBreak);
    }
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
