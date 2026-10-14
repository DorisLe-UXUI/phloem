// RFC 5322 / 2045 message with inline (cid:) images: the email works in any client without hosting the slices
// anywhere. Used for "Gửi bằng Gmail" (Gmail API upload) and "Tải .eml" (Outlook opens X-Unsent messages as drafts).
import { toBase64, utf8Bytes } from './hash';

export interface MimePart { cid: string; filename: string; mime: string; bytes: Uint8Array }
export interface MimeInput {
  html: string; text: string; subject: string;
  from?: string; to?: string; listUnsubscribe?: string;
  /** Outlook opens the file as an unsent draft (compose window) instead of a received message. */
  draft?: boolean;
  parts: MimePart[];
  boundarySeed?: string;
}

const CRLF = '\r\n';
const wrap = (b64: string) => b64.replace(/.{1,76}/g, (l) => l + CRLF).trimEnd();
/** Encoded-word for non-ASCII header values (subjects, display names). */
export function headerValue(v: string): string { return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${toBase64(utf8Bytes(v))}?=`; }
/** "Name <a@b.c>" with an encoded display name when needed. */
export function address(name: string, email: string): string { return name ? `${headerValue(name.replace(/["\r\n]/g, ''))} <${email}>` : email; }

export function buildMime(m: MimeInput): string {
  const seed = (m.boundarySeed || Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/gi, '');
  const rel = `phl_rel_${seed}`, alt = `phl_alt_${seed}`;
  const head: string[] = [];
  if (m.from) head.push(`From: ${m.from}`);
  if (m.to) head.push(`To: ${m.to}`);
  head.push(`Subject: ${headerValue(m.subject || '(không tiêu đề)')}`, 'MIME-Version: 1.0');
  if (m.listUnsubscribe) head.push(`List-Unsubscribe: <${m.listUnsubscribe}>`);
  if (m.draft) head.push('X-Unsent: 1');
  head.push(`Content-Type: multipart/related; boundary="${rel}"; type="multipart/alternative"`);
  const body: string[] = [
    `--${rel}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(toBase64(utf8Bytes(m.text || ''))),
    `--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(toBase64(utf8Bytes(m.html))),
    `--${alt}--`,
  ];
  for (const p of m.parts) {
    body.push(`--${rel}`, `Content-Type: ${p.mime}; name="${p.filename}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${p.cid}>`, `Content-Disposition: inline; filename="${p.filename}"`, '', wrap(toBase64(p.bytes)));
  }
  body.push(`--${rel}--`, '');
  return head.join(CRLF) + CRLF + CRLF + body.join(CRLF);
}

/** Gmail shows an inline (cid:) image only at its FIRST reference; later <img src="cid:x"> of the same part come out as
 *  broken images. Identical slices (flat colour strips, repeated gutters) share one key, so every repeat reference gets
 *  its own copy of the part under a new Content-ID. Parts nothing references are dropped. */
export function uniqueCids(html: string, parts: MimePart[]): { html: string; parts: MimePart[] } {
  const byCid = new Map(parts.map((p) => [p.cid, p]));
  const seen = new Map<string, number>();
  const out: MimePart[] = [];
  const next = html.replace(/cid:([^"'\s)>]+)/g, (m, cid: string) => {
    const part = byCid.get(cid); if (!part) return m;
    const n = (seen.get(cid) || 0) + 1; seen.set(cid, n);
    if (n === 1) { out.push(part); return m; }
    const at = cid.lastIndexOf('@');
    const copy = at > 0 ? `${cid.slice(0, at)}-r${n}${cid.slice(at)}` : `${cid}-r${n}`;
    const dot = part.filename.lastIndexOf('.');
    out.push({ ...part, cid: copy, filename: dot > 0 ? `${part.filename.slice(0, dot)}-r${n}${part.filename.slice(dot)}` : `${part.filename}-r${n}` });
    return `cid:${copy}`;
  });
  return { html: next, parts: out };
}

/** Merge tags only an ESP understands become mailto links to the sender (unsubscribe / preferences by reply). */
export function replaceMergeTags(html: string, sender: string): string {
  const unsub = sender ? `mailto:${sender}?subject=${encodeURIComponent('Huỷ đăng ký / Unsubscribe')}` : '#';
  const prefs = sender ? `mailto:${sender}?subject=${encodeURIComponent('Cập nhật thông tin / Update preferences')}` : '#';
  return html.replace(/\*\|UNSUB\|\*/g, unsub).replace(/\*\|UPDATE_PROFILE\|\*/g, prefs).replace(/\*\|[A-Z_:]+\|\*/g, '').replace(/\{\{\s*(unsubscribe_url|manage_preferences_url)\s*\}\}/g, unsub);
}

/** Plain-text twin: preheader, the slices' alt texts in reading order and their links (spam filters and screen readers). */
export function plainText(preheader: string, slices: { alt: string; link: string | null }[]): string {
  const lines = [preheader.trim()].filter(Boolean);
  for (const s of slices) { const a = (s.alt || '').trim(); if (a) lines.push(a); if (s.link && !/^\*\|/.test(s.link)) lines.push(`→ ${s.link}`); }
  return lines.join('\n\n');
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Recipients pasted in any shape (lines, commas, "Name <a@b>") → unique lowercase addresses. */
export function parseRecipients(raw: string): string[] { return [...new Set((String(raw).match(EMAIL_RE) || []).map((e) => e.toLowerCase()))]; }
