/**
 * P443 — optional profile avatar. The image never leaves the device: the
 * picker compresses a local File into a data URL (≤ AVATAR_MAX_BYTES) that
 * is persisted inside `datingAgent.userProfile.avatar` — no upload service.
 * Profiles without an avatar fall back to a coloured block carrying the
 * nickname's first letter.
 */

/** Stored data URL must decode to at most this many bytes. */
export const AVATAR_MAX_BYTES = 200 * 1024;

/** Longest edge of the compressed image, in CSS pixels. */
export const AVATAR_MAX_DIM = 256;

/** A base64 data URL inflates its payload by 4/3 plus a small prefix. */
export const AVATAR_DATAURL_MAX_CHARS =
  Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 64;

export function isAvatarDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('data:image/') &&
    value.length <= AVATAR_DATAURL_MAX_CHARS
  );
}

/** First letter of the trimmed nickname, used by the fallback block. */
export function avatarInitial(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?';
}

const AVATAR_PALETTE = [
  '#d81b74',
  '#7c4dff',
  '#00897b',
  '#f4511e',
  '#3949ab',
  '#c0a33e',
  '#5e35b1',
  '#039be5',
];

/** Deterministic nickname → colour so the fallback block stays stable. */
export function avatarColor(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  let hash = 0;
  for (const ch of trimmed) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function readAsDataUrl(file: File): Promise<string> {
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('avatar: read failed'));
      reader.readAsDataURL(file);
    });
  }
  // Node / test environments without FileReader still expose arrayBuffer.
  return file.arrayBuffer().then((buf) => bytesToDataUrl(new Uint8Array(buf), file.type || 'image/png'));
}

function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Browser-only shrink path: draw the file into a canvas at progressively
 * smaller edges/qualities until the JPEG fits the byte cap. Returns null
 * where canvas image decode is unavailable (tests, ancient browsers).
 */
async function shrinkToDataUrl(file: File): Promise<string | null> {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof Image === 'undefined'
  ) {
    return null;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('avatar: decode failed'));
      el.src = objectUrl;
    });
    const sourceW = img.naturalWidth || img.width;
    const sourceH = img.naturalHeight || img.height;
    if (!sourceW || !sourceH) return null;
    for (const edge of [AVATAR_MAX_DIM, 192, 128]) {
      const scale = Math.min(1, edge / Math.max(sourceW, sourceH));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceW * scale));
      canvas.height = Math.max(1, Math.round(sourceH * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrlByteLength(dataUrl) <= AVATAR_MAX_BYTES) return dataUrl;
      }
    }
    // Smallest attempt still over the cap — keep it rather than nothing.
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 96 / Math.max(sourceW, sourceH));
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(sourceH * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * File → ≤200KB data URL. Files already under the cap are read verbatim;
 * larger images go through the canvas shrink. Rejects non-image types and
 * images that cannot be squeezed under the cap without canvas support.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('avatar: not an image');
  }
  if (file.size <= AVATAR_MAX_BYTES) {
    const dataUrl = await readAsDataUrl(file);
    if (isAvatarDataUrl(dataUrl)) return dataUrl;
  }
  const shrunk = await shrinkToDataUrl(file);
  if (shrunk && isAvatarDataUrl(shrunk)) return shrunk;
  throw new Error('avatar: image too large');
}
