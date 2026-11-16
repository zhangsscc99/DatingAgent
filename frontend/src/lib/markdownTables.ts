/**
 * P197 — react-markdown renders without remark-gfm, so a `|---|` separator
 * row collapses every table row into one paragraph of raw pipes. The backend
 * LLM emits GFM pipe tables, so we downgrade them to plain bullet lists here
 * (label = first cell bolded) before ReactMarkdown sees them.
 *
 * Pure / streaming-safe: a header with no separator yet returns unchanged.
 */

const SEPARATOR_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

/** Remove decorative emoji + VS16/ZWJ from a first-column cell, keep the text. */
export function stripCellEmoji(cell: string): string {
  return cell.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
}

/** Strip `inline code` spans so their pipes can't fake a table row. */
function dropInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, '');
}

/**
 * Split a pipe-table row into cells. Leading/trailing pipes are dropped,
 * `\|` escapes are preserved and never split a cell.
 */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isSeparatorRow(line: string): boolean {
  return line.includes('-') && SEPARATOR_RE.test(line);
}

function isHeaderCandidate(line: string): boolean {
  return dropInlineCode(line).includes('|');
}

/** Body rows are non-blank lines whose pipes sit outside inline code. */
function isBodyRow(line: string): boolean {
  return line.trim().length > 0 && isHeaderCandidate(line);
}

/** Render one body row as `- **label**：rest` (` · ` joins 3+ columns). */
function rowToBullet(cells: string[], columns: number): string {
  const padded = cells.slice(0, columns);
  while (padded.length < columns) padded.push('');
  const extras = cells.slice(columns);
  const label = stripCellEmoji(padded[0]).replace(/\*\*/g, '').trim();
  const rest = [...padded.slice(1), ...extras];
  const joiner = columns <= 2 ? '：' : ' · ';
  const restText = rest
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .join(joiner);
  if (label.length === 0) return restText ? `- ${restText}` : '-';
  return restText ? `- **${label}**：${restText}` : `- **${label}**`;
}

export function normalizeMarkdownTables(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (
      !inFence &&
      i + 1 < lines.length &&
      isHeaderCandidate(line) &&
      isSeparatorRow(lines[i + 1])
    ) {
      const header = splitTableRow(line);
      if (header.length >= 2) {
        const columns = header.length;
        let j = i + 2;
        const bullets: string[] = [];
        while (j < lines.length && isBodyRow(lines[j])) {
          bullets.push(rowToBullet(splitTableRow(lines[j]), columns));
          j++;
        }
        out.push(...bullets);
        i = j;
        continue;
      }
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}
