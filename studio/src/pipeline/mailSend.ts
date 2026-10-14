// "Gửi bằng email thường": for people without Mailchimp/Klaviyo.
//  • Gmail / Google Workspace: OAuth popup (gmail.send) → the message is sent straight from the browser by Gmail's API,
//    slices embedded as cid: images (nothing to host). One message per recipient, after an explicit confirmation.
//  • Any other client: a .eml file; Outlook opens it as a draft (X-Unsent), Apple Mail / Thunderbird can "send again".
import { buildMime, parseRecipients, plainText, replaceMergeTags, address, uniqueCids, type MimePart } from '../../../src/shared/mime';
import type { Profile } from '../../../src/shared/types';
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

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** A few lines of REAL text under the image slices: who sent it and how to stop it. An email that is only pictures is
 *  the strongest spam signal Gmail sees; this also gives every recipient a visible way out. */
function textFooter(p: Project, sender: string, senderName: string): { html: string; text: string } {
  const vi = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i.test(`${p.fields.subject} ${p.fields.preheader}`);
  const name = senderName || p.brand.name || sender;
  const site = p.brand.links?.website || '';
  const unsub = `mailto:${sender}?subject=${encodeURIComponent(vi ? 'Huỷ đăng ký' : 'Unsubscribe')}`;
  const a = (href: string, t: string) => `<a href="${esc(href)}" style="color:#8a8a8a;text-decoration:underline;">${esc(t)}</a>`;
  const host = (() => { try { return site ? new URL(site).hostname.replace(/^www\./, '') : ''; } catch { return ''; } })();
  const html = vi
    ? `Bạn nhận email này từ <b>${esc(name)}</b> (${esc(sender)}).<br>Không muốn nhận nữa? ${a(unsub, 'Huỷ đăng ký')}${host ? ` · ${a(site, host)}` : ''}`
    : `You are receiving this email from <b>${esc(name)}</b> (${esc(sender)}).<br>Don't want these emails? ${a(unsub, 'Unsubscribe')}${host ? ` · ${a(site, host)}` : ''}`;
  const text = vi ? `Bạn nhận email này từ ${name} (${sender}). Huỷ đăng ký: trả lời email này với tiêu đề "Huỷ đăng ký".` : `You are receiving this email from ${name} (${sender}). To unsubscribe, reply with the subject "Unsubscribe".`;
  return { html, text };
}

/** Build the email once: HTML with cid: images + the image parts + a plain-text twin (+ a live-text footer when sent). */
async function compose(p: Project, sender: string, senderName = '') {
  const ex = await exportProject(p, null);
  const parts: MimePart[] = [];
  const images: Record<string, string> = {}, mobileImages: Record<string, string> = {};
  for (const s of ex.slices) { const cid = `${s.key}@phloem`; images[s.key] = `cid:${cid}`; parts.push({ cid, filename: `${s.key}.${extOf(s.format)}`, mime: mimeOf(s.format), bytes: s.bytes }); }
  if (ex.mobile) for (const s of ex.mobile.slices) { const cid = `m-${s.key}@phloem`; mobileImages[s.key] = `cid:${cid}`; parts.push({ cid, filename: `m-${s.key}.${extOf(s.format)}`, mime: mimeOf(s.format), bytes: s.bytes }); }
  const foot = sender ? textFooter(p, sender, senderName) : null;
  const u = uniqueCids(replaceMergeTags(htmlFor(p, foot ? ({ footerHtml: foot.html } as Profile) : null, ex, images, mobileImages, 'full'), sender), parts);
  const html = u.html;
  const text = plainText(p.fields.preheader || '', ex.plan.slices.map((s) => ({ alt: s.alt, link: s.link }))) + (foot ? `\n\n${foot.text}` : '');
  const kb = Math.round((u.parts.reduce((a, x) => a + x.bytes.length, 0) + html.length) / 1024);
  return { html, text, parts: u.parts, kb, subject: p.fields.subject || p.fields.campaignName || p.name };
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

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
/** Set after a connect where the user left "send email on your behalf" unticked: the next connect shows the consent
 *  screen again instead of silently reusing the old (send-less) grant. */
let needConsent = false;

/** Google popup asking for "send email on your behalf" (+ who you are, to fill From). Token lives in memory only. */
export async function connectGmail(): Promise<GmailAccount> {
  const info = await relayInfo();
  const clientId = info?.google;
  if (!clientId) throw new Error('Chưa cấu hình Google cho relay (GOOGLE_CLIENT_ID).');
  await loadGis();
  const g = (window as unknown as { google?: any }).google;
  const token: { access_token: string; expires_in: number; scope?: string } = await new Promise((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: `openid email profile ${SEND_SCOPE}`, prompt: needConsent ? 'consent' : '', include_granted_scopes: true,
      callback: (r: { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }) => (r.access_token ? resolve(r as { access_token: string; expires_in: number; scope?: string }) : reject(new Error(r.error_description || r.error || 'Google từ chối'))),
      error_callback: (e: { type?: string; message?: string }) => reject(new Error(e?.type === 'popup_closed' ? 'Đã đóng cửa sổ Google.' : e?.message || 'Không mở được cửa sổ Google (trình duyệt chặn popup?)')),
    });
    client.requestAccessToken();
  });
  // Google's consent screen lists "Send email on your behalf" as a checkbox that starts unticked: without it every send fails
  const granted = (() => { try { return g.accounts.oauth2.hasGrantedAllScopes(token, SEND_SCOPE); } catch { return (token.scope || '').split(/\s+/).includes(SEND_SCOPE); } })();
  if (!granted) { needConsent = true; throw new Error('Bạn chưa tích ô "Gửi email thay mặt bạn" (Send email on your behalf) trong cửa sổ Google. Bấm Kết nối Gmail lại và tích ô đó.'); }
  needConsent = false;
  const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  if (!me.email) throw new Error('Google không trả về địa chỉ email.');
  gmail = { email: String(me.email), name: String(me.name || ''), token: token.access_token, expiresAt: Date.now() + (token.expires_in || 3600) * 1000 };
  set({});
  return gmail;
}
export function disconnectGmail() { const t = gmail?.token; gmail = null; set({}); if (t) { try { (window as unknown as { google?: any }).google?.accounts?.oauth2?.revoke(t, () => {}); } catch { /* ignore */ } } }

/** base64url of the MIME bytes (the Gmail JSON API's `raw`). */
function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendOne(acc: GmailAccount, raw: string) {
  // The JSON endpoint answers errors with CORS headers, so the browser shows Gmail's real reason. The media-upload endpoint
  // drops them on errors and every failure surfaced as a bare "Failed to fetch"; it is only used past the JSON size limit.
  const big = raw.length > 4_500_000;
  let r: Response;
  try {
    r = big
      ? await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', { method: 'POST', headers: { Authorization: `Bearer ${acc.token}`, 'Content-Type': 'message/rfc822' }, body: raw })
      : await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${acc.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(raw) }) });
  } catch {
    throw new Error(location.hostname.endsWith('claude.ai') || location.protocol === 'blob:' ? 'Bản trong claude.ai không gọi được Gmail. Mở bản web dorisle-uxui.github.io/phloem/studio để gửi.' : 'Không gọi được Gmail (mất mạng, hoặc tiện ích chặn quảng cáo/VPN chặn googleapis.com). Thử lại.');
  }
  if (r.ok) return;
  const j = await r.json().catch(() => ({}));
  const msg = j?.error?.message || `HTTP ${r.status}`;
  if (r.status === 401) { gmail = null; throw new Error('Phiên Gmail hết hạn. Bấm Kết nối Gmail lại.'); }
  if (r.status === 403 && /insufficient|scope/i.test(msg)) { gmail = null; needConsent = true; throw new Error('Google chưa cho quyền gửi email. Bấm Kết nối Gmail lại và tích ô "Gửi email thay mặt bạn".'); }
  if (r.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error('Gmail API chưa bật cho dự án Google Cloud của relay.');
  if (r.status === 429 || /limit|quota/i.test(msg)) throw new Error(`Gmail báo vượt giới hạn gửi (${msg}). Gmail cá nhân ~500 thư/ngày, Workspace ~2.000.`);
  throw new Error(`Gmail: ${msg}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Send queue: 1 to 10,000 recipients from a regular Gmail. Gmail caps recipients per day (~500 for @gmail.com,
// ~2,000 for Google Workspace), so the queue sends one personal message per recipient at Gmail's pace, stops at the
// daily cap and resumes from where it stopped the next day. Progress is saved in this browser; nobody gets it twice.
export const MAX_RECIPIENTS = 10_000;
export interface MailQueue {
  id: string; projectId: string; from: string; subject: string; createdAt: string;
  recipients: string[]; cursor: number; sent: number; failed: { email: string; error: string }[];
  /** messages sent per local day (YYYY-MM-DD) from this account, for the daily cap */
  days: Record<string, number>; dailyCap: number;
  status: 'ready' | 'sending' | 'paused' | 'capped' | 'auth' | 'done';
}
const qKey = (projectId: string) => `phloem.mailq.${projectId}`;
const dayKey = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
export function loadQueue(projectId: string): MailQueue | null { try { const q = JSON.parse(localStorage.getItem(qKey(projectId)) || 'null'); return q && Array.isArray(q.recipients) ? q : null; } catch { return null; } }
function saveQueue(q: MailQueue | null, projectId: string) {
  try { if (q) localStorage.setItem(qKey(projectId), JSON.stringify(q)); else localStorage.removeItem(qKey(projectId)); } catch { /* storage full: progress still lives in memory for this run */ }
  set({});
}
export function clearQueue(projectId: string) { stopFlag = true; saveQueue(null, projectId); }
/** Gmail's documented ceilings: consumer accounts ~500 recipients/day, Workspace ~2,000. */
export function defaultCap(from: string): number { return /@(gmail|googlemail)\.com$/i.test(from) ? 450 : 1800; }
export function sentToday(q: MailQueue): number { return q.days[dayKey()] || 0; }

/** Background tabs throttle page timers to once a minute; a worker's timers are not, so the queue keeps its pace. */
let ticker: Worker | null = null; let tickId = 0; const waiting = new Map<number, () => void>();
function sleep(ms: number): Promise<void> {
  try {
    if (!ticker) { ticker = new Worker(URL.createObjectURL(new Blob(['onmessage=(e)=>setTimeout(()=>postMessage(e.data[0]),e.data[1])'], { type: 'text/javascript' }))); ticker.onmessage = (e) => { const f = waiting.get(e.data); if (f) { waiting.delete(e.data); f(); } }; }
    const id = ++tickId; return new Promise((r) => { waiting.set(id, r); ticker!.postMessage([id, ms]); });
  } catch { return new Promise((r) => setTimeout(r, ms)); }
}

let stopFlag = false; let running = false;
export const queueRunning = () => running;
export function pauseQueue() { stopFlag = true; }

/** Create (or replace) the queue for this email and start sending, after a confirmation. */
export async function startQueue(p: Project, recipientsRaw: string, suppressRaw = '', cap?: number) {
  const acc = gmailAccount(); if (!acc) throw new Error('Kết nối Gmail trước.');
  if (!p.fields.subject.trim()) throw new Error('Điền Subject ở tab Email trước khi gửi.');
  const skip = new Set(parseRecipients(suppressRaw));
  const list = parseRecipients(recipientsRaw).filter((e) => !skip.has(e));
  if (!list.length) throw new Error('Chưa có địa chỉ người nhận hợp lệ.');
  if (list.length > MAX_RECIPIENTS) throw new Error(`Tối đa ${MAX_RECIPIENTS.toLocaleString('vi-VN')} người mỗi chiến dịch (đang có ${list.length.toLocaleString('vi-VN')}).`);
  const dailyCap = Math.max(1, Math.min(cap || defaultCap(acc.email), 2000));
  const days = Math.ceil(list.length / dailyCap);
  const warn = list.length > dailyCap ? `\n\nGmail chỉ cho khoảng ${dailyCap.toLocaleString('vi-VN')} thư/ngày với tài khoản này, nên ${list.length.toLocaleString('vi-VN')} người sẽ được gửi trong khoảng ${days} ngày: mỗi ngày bấm "Tiếp tục gửi", app gửi tiếp từ chỗ dừng.` : '';
  if (!(await ask(`Gửi "${p.fields.subject}" từ ${acc.email} tới ${list.length.toLocaleString('vi-VN')} người?${skip.size ? ` (đã loại ${skip.size} địa chỉ huỷ đăng ký)` : ''}\n\nMỗi người nhận một email riêng, khoảng 1 thư/giây. Giữ tab này mở trong lúc gửi (làm việc tab khác vẫn được).${warn}\n\nKhông thu hồi được thư đã gửi.`, `Bắt đầu gửi ${list.length.toLocaleString('vi-VN')} email`, true))) return;
  const old = loadQueue(p.id);
  const q: MailQueue = { id: `q_${Date.now().toString(36)}`, projectId: p.id, from: acc.email, subject: p.fields.subject, createdAt: new Date().toISOString(), recipients: list, cursor: 0, sent: 0, failed: [], days: old && old.from === acc.email ? old.days : {}, dailyCap, status: 'ready' };
  saveQueue(q, p.id);
  await runQueue(p);
}

/** Send from the cursor until done, paused, out of today's cap, or the Gmail token needs a fresh consent. */
export async function runQueue(p: Project) {
  if (running) return;
  let q = loadQueue(p.id); if (!q) throw new Error('Chưa có chiến dịch.');
  const acc = gmailAccount();
  if (!acc) { q.status = 'auth'; saveQueue(q, p.id); throw new Error('Phiên Gmail hết hạn (1 giờ). Bấm Kết nối Gmail rồi Tiếp tục gửi.'); }
  if (acc.email !== q.from) throw new Error(`Chiến dịch này gửi từ ${q.from}; đang kết nối ${acc.email}. Kết nối đúng tài khoản.`);
  running = true; stopFlag = false;
  set({ busy: { label: `Đang gửi qua Gmail · ${q.subject}`, done: q.cursor, total: q.recipients.length } });
  try {
    const m = await compose(p, acc.email, acc.name);
    q.status = 'sending'; saveQueue(q, p.id);
    while (q.cursor < q.recipients.length) {
      if (stopFlag) { q.status = 'paused'; break; }
      if (sentToday(q) >= q.dailyCap) { q.status = 'capped'; break; }
      if (!gmailAccount()) { q.status = 'auth'; break; }
      const to = q.recipients[q.cursor];
      const raw = buildMime({ html: m.html, text: m.text, subject: m.subject, from: address(acc.name, acc.email), to, listUnsubscribe: `mailto:${acc.email}?subject=Unsubscribe`, parts: m.parts });
      try {
        await sendOne(acc, raw);
        q.sent++; q.days[dayKey()] = sentToday(q) + 1;
      } catch (e) {
        const msg = (e as Error).message;
        if (/giới hạn/.test(msg)) { q.status = 'capped'; break; } // Gmail said stop for today: retry this recipient tomorrow
        if (/hết hạn|chưa cho quyền/.test(msg)) { q.status = 'auth'; break; }
        q.failed.push({ email: to, error: msg.slice(0, 160) });
      }
      q.cursor++;
      if (q.cursor % 10 === 0 || q.cursor === q.recipients.length) saveQueue(q, p.id);
      set({ busy: { label: `Đang gửi qua Gmail · ${q.subject}`, done: q.cursor, total: q.recipients.length } });
      await sleep(900); // Gmail allows ~2 sends/s per user; stay well under it
    }
    if (q.cursor >= q.recipients.length) q.status = 'done';
    saveQueue(q, p.id);
    const left = q.recipients.length - q.cursor;
    if (q.status === 'done') { log(`Gmail: xong chiến dịch — ${q.sent} đã gửi, ${q.failed.length} lỗi.`, 'ok'); toast(`Đã gửi xong ${q.sent.toLocaleString('vi-VN')} email.`, 'ok'); }
    else if (q.status === 'capped') { log(`Gmail: đã gửi ${sentToday(q)} thư hôm nay (giới hạn ${q.dailyCap}). Còn ${left} người — mai bấm Tiếp tục gửi.`, 'ok'); toast(`Đủ hạn mức hôm nay. Còn ${left.toLocaleString('vi-VN')} người, mai gửi tiếp.`, 'ok'); }
    else if (q.status === 'auth') toast('Phiên Gmail hết hạn. Bấm Kết nối Gmail rồi Tiếp tục gửi.', 'err');
    else if (q.status === 'paused') toast(`Đã tạm dừng. Còn ${left.toLocaleString('vi-VN')} người.`, 'ok');
  } finally { running = false; set({ busy: null }); }
}

/** One test message to yourself. */
export async function sendTest(p: Project) {
  const acc = gmailAccount(); if (!acc) throw new Error('Kết nối Gmail trước.');
  set({ busy: { label: 'Gửi thử…', done: 0, total: 1 } });
  try {
    const m = await compose(p, acc.email, acc.name);
    await sendOne(acc, buildMime({ html: m.html, text: m.text, subject: `[Thử] ${m.subject}`, from: address(acc.name, acc.email), to: acc.email, listUnsubscribe: `mailto:${acc.email}?subject=Unsubscribe`, parts: m.parts }));
    set({ result: { text: `Đã gửi thử tới ${acc.email} (${m.kb} KB, ${m.parts.length} ảnh nhúng). Mở hộp thư để kiểm tra.` } });
    toast('Đã gửi thử.', 'ok');
  } finally { set({ busy: null }); }
}
export { parseRecipients };
