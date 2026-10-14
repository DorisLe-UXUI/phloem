// "Gửi bằng email thường": for people without Mailchimp/Klaviyo.
//  • Gmail / Google Workspace: OAuth popup (gmail.send) → the message is sent straight from the browser by Gmail's API,
//    slices embedded as cid: images (nothing to host). One message per recipient, after an explicit confirmation.
//  • Any other client: a .eml file; Outlook opens it as a draft (X-Unsent), Apple Mail / Thunderbird can "send again".
import { buildMime, parseRecipients, plainText, replaceMergeTags, address, type MimePart } from '../../../src/shared/mime';
import { slug } from '../../../src/shared/utm';
import { downloadBytes } from '../../../src/ui/clipboard';
import { mimeOf, extOf } from '../../../src/ui/imageops';
import { utf8Bytes } from '../../../src/shared/hash';
import type { Project } from '../model/types';
import { get, set, toast, log } from '../store';
import { exportProject, htmlFor } from './exportFlow';
import { loadGis } from '../ui/GoogleButton';
import { relayInfo } from '../auth/core';
import { ask } from '../ui/confirm';

export interface GmailAccount { email: string; name: string; token: string; expiresAt: number }
let gmail: GmailAccount | null = null;
export const gmailAccount = () => (gmail && gmail.expiresAt > Date.now() + 30_000 ? gmail : null);

/** Build the email once: HTML with cid: images + the image parts + a plain-text twin. */
async function compose(p: Project, sender: string) {
  const ex = await exportProject(p, null);
  const parts: MimePart[] = [];
  const images: Record<string, string> = {}, mobileImages: Record<string, string> = {};
  for (const s of ex.slices) { const cid = `${s.key}@phloem`; images[s.key] = `cid:${cid}`; parts.push({ cid, filename: `${s.key}.${extOf(s.format)}`, mime: mimeOf(s.format), bytes: s.bytes }); }
  if (ex.mobile) for (const s of ex.mobile.slices) { const cid = `m-${s.key}@phloem`; mobileImages[s.key] = `cid:${cid}`; parts.push({ cid, filename: `m-${s.key}.${extOf(s.format)}`, mime: mimeOf(s.format), bytes: s.bytes }); }
  const html = replaceMergeTags(htmlFor(p, null, ex, images, mobileImages, 'full'), sender);
  const text = plainText(p.fields.preheader || '', ex.plan.slices.map((s) => ({ alt: s.alt, link: s.link })));
  const kb = Math.round((parts.reduce((a, x) => a + x.bytes.length, 0) + html.length) / 1024);
  return { html, text, parts, kb, subject: p.fields.subject || p.fields.campaignName || p.name };
}

export async function downloadEml(p: Project) {
  set({ busy: { label: 'Đóng gói .eml…', done: 0, total: 0 } });
  try {
    const m = await compose(p, '');
    const eml = buildMime({ html: m.html, text: m.text, subject: m.subject, parts: m.parts, draft: true });
    await downloadBytes(`${slug(p.fields.campaignName || p.name)}.eml`, utf8Bytes(eml), 'message/rfc822');
    log(`Đã tải .eml (${m.kb} KB, ${m.parts.length} ảnh nhúng). Outlook mở thành bản nháp; Apple Mail/Thunderbird: Gửi lại.`, 'ok');
    set({ result: { text: 'Đã tải .eml — mở bằng Outlook / Apple Mail / Thunderbird, điền người nhận rồi gửi.' } });
  } catch (e) { toast((e as Error).message, 'err'); }
  finally { set({ busy: null }); }
}

/** Google popup asking for "send email on your behalf" (+ who you are, to fill From). Token lives in memory only. */
export async function connectGmail(): Promise<GmailAccount> {
  const info = await relayInfo();
  const clientId = info?.google;
  if (!clientId) throw new Error('Chưa cấu hình Google cho relay (GOOGLE_CLIENT_ID).');
  await loadGis();
  const g = (window as unknown as { google?: any }).google;
  const token: { access_token: string; expires_in: number } = await new Promise((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: 'openid email profile https://www.googleapis.com/auth/gmail.send', prompt: '',
      callback: (r: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => (r.access_token ? resolve(r as { access_token: string; expires_in: number }) : reject(new Error(r.error_description || r.error || 'Google từ chối'))),
      error_callback: (e: { type?: string; message?: string }) => reject(new Error(e?.type === 'popup_closed' ? 'Đã đóng cửa sổ Google.' : e?.message || 'Không mở được cửa sổ Google (trình duyệt chặn popup?)')),
    });
    client.requestAccessToken();
  });
  const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  if (!me.email) throw new Error('Google không trả về địa chỉ email.');
  gmail = { email: String(me.email), name: String(me.name || ''), token: token.access_token, expiresAt: Date.now() + (token.expires_in || 3600) * 1000 };
  set({});
  return gmail;
}
export function disconnectGmail() { const t = gmail?.token; gmail = null; set({}); if (t) { try { (window as unknown as { google?: any }).google?.accounts?.oauth2?.revoke(t, () => {}); } catch { /* ignore */ } } }

async function sendOne(acc: GmailAccount, raw: string) {
  const r = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', { method: 'POST', headers: { Authorization: `Bearer ${acc.token}`, 'Content-Type': 'message/rfc822' }, body: raw });
  if (r.ok) return;
  const j = await r.json().catch(() => ({}));
  const msg = j?.error?.message || `HTTP ${r.status}`;
  if (r.status === 401) { gmail = null; throw new Error('Phiên Gmail hết hạn. Bấm Kết nối Gmail lại.'); }
  if (r.status === 403 && /insufficient|scope/i.test(msg)) throw new Error('Google chưa cho quyền gửi email. Kết nối lại và tick "Gửi email thay bạn".');
  if (r.status === 429 || /limit|quota/i.test(msg)) throw new Error(`Gmail báo vượt giới hạn gửi (${msg}). Gmail cá nhân ~500 thư/ngày, Workspace ~2.000.`);
  throw new Error(`Gmail: ${msg}`);
}

const MAX_PER_RUN = 100;
/** Send to the pasted recipients (or to yourself when `test`), one personal message each, after a confirmation. */
export async function sendWithGmail(p: Project, recipientsRaw: string, test = false) {
  const acc = gmailAccount(); if (!acc) throw new Error('Kết nối Gmail trước.');
  const list = test ? [acc.email] : parseRecipients(recipientsRaw);
  if (!list.length) throw new Error('Chưa có địa chỉ người nhận hợp lệ.');
  if (list.length > MAX_PER_RUN) throw new Error(`Tối đa ${MAX_PER_RUN} người mỗi lần gửi (đang có ${list.length}). Danh sách lớn nên dùng Mailchimp/Klaviyo.`);
  if (!p.fields.subject.trim() && !test) throw new Error('Điền Subject ở tab Email trước khi gửi.');
  if (!test && !(await ask(`Gửi "${p.fields.subject}" từ ${acc.email} tới ${list.length} người?\n\n${list.slice(0, 8).join(', ')}${list.length > 8 ? `… (+${list.length - 8})` : ''}\n\nMỗi người nhận một email riêng. Không thu hồi được sau khi gửi.`, `Gửi ${list.length} email`, true))) return;
  set({ busy: { label: test ? 'Gửi thử…' : 'Đang gửi qua Gmail…', done: 0, total: list.length } });
  let sent = 0; const failed: string[] = [];
  try {
    const m = await compose(p, acc.email);
    for (const to of list) {
      const raw = buildMime({ html: m.html, text: m.text, subject: test ? `[Thử] ${m.subject}` : m.subject, from: address(acc.name, acc.email), to, listUnsubscribe: `mailto:${acc.email}?subject=Unsubscribe`, parts: m.parts });
      try { await sendOne(acc, raw); sent++; } catch (e) { failed.push(`${to}: ${(e as Error).message}`); if (/hết hạn|giới hạn|chưa cho quyền/.test((e as Error).message)) break; }
      set({ busy: { label: test ? 'Gửi thử…' : 'Đang gửi qua Gmail…', done: sent + failed.length, total: list.length } });
      await new Promise((r) => setTimeout(r, 350)); // gentle on Gmail's per-second limits
    }
    log(`Gmail: đã gửi ${sent}/${list.length} email (${m.kb} KB mỗi email, ${m.parts.length} ảnh nhúng).`, sent === list.length ? 'ok' : 'er');
    for (const f of failed.slice(0, 5)) log(f, 'er');
    set({ result: { text: test ? `Đã gửi thử tới ${acc.email}. Mở hộp thư để kiểm tra.` : `Đã gửi ${sent}/${list.length} email từ ${acc.email}.` } });
    if (failed.length) toast(`${failed.length} email lỗi — xem nhật ký bên dưới.`, 'err'); else toast(test ? 'Đã gửi thử.' : `Đã gửi ${sent} email.`, 'ok');
  } finally { set({ busy: null }); }
}
export { parseRecipients };
