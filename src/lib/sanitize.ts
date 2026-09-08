/**
 * Server-side string sanitization helpers.
 * React already HTML-encodes rendered text; these helpers prevent stored
 * control characters, HTML/script fragments, and oversized identifiers
 * from reaching the database.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_OR_STYLE = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAGS = /<\/?[^>]+>/g;
const SCRIPT_LIKE = /javascript\s*:|data\s*:\s*text\/html|vbscript\s*:/gi;

export function sanitizeText(value: string): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, '')
    .replace(SCRIPT_OR_STYLE, '')
    .replace(HTML_TAGS, '')
    .replace(SCRIPT_LIKE, '')
    .trim();
}

export function sanitizeMultiline(value: string): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, '')
    .replace(SCRIPT_OR_STYLE, '')
    .replace(HTML_TAGS, '')
    .replace(SCRIPT_LIKE, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function isSafeDateString(value: string | undefined | null): boolean {
  if (!value) return true;
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.+-Z]+)?$/.test(trimmed)) {
    // Allow other short display dates used by the UI (e.g. 18-May-2026)
    if (trimmed.length <= 32 && !/[<>'"\\]/.test(trimmed)) return true;
    return false;
  }
  const parsed = new Date(trimmed);
  return !Number.isNaN(parsed.getTime());
}
