// One entry point for "ask Claude" with three transports, picked by what the viewer has:
//   1. the user's own API key in this browser (official SDK, browser mode)
//   2. the relay (`POST /ai`, server holds ANTHROPIC_API_KEY)
//   3. the claude.ai artifact `sample` capability (no key needed inside claude.ai)
import Anthropic from '@anthropic-ai/sdk';
import { getSession, expired } from '../auth/core';
import { get, set } from '../store';

export interface AiImage { name: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
export interface AiTurn { role: 'user' | 'assistant'; text: string; images?: AiImage[]; /** PDFs (brand guidelines…), sent as document blocks */ docs?: { name: string; base64: string }[] }
export interface AiRequest { system: string; turns: AiTurn[]; maxTokens?: number; effort?: 'low' | 'medium' | 'high' }

export type AiTransport = 'key' | 'relay' | 'sample' | null;
/** Server-side fallback (to Opus 4.8 when overloaded) is an Opus-only feature; other models reject the field. */
const fallbackOpts = (model: string) => (/^claude-opus-5/.test(model) ? { betas: ['server-side-fallback-2026-06-01'] as const, fallbacks: [{ model: 'claude-opus-4-8' }] } : {}) as Record<string, unknown>;

export const AI_MODELS = [
  { v: 'claude-opus-5-5', label: 'Claude Opus 5.5 (mặc định)' },
  { v: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (nhanh, rẻ hơn)' },
  { v: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (rẻ nhất)' },
];

function toBlocks(t: AiTurn): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const d of t.docs || []) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.base64 }, title: d.name } as Anthropic.ContentBlockParam);
  for (const im of t.images || []) blocks.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } });
  blocks.push({ type: 'text', text: t.text });
  return blocks;
}

function messagesOf(req: AiRequest): Anthropic.MessageParam[] {
  return req.turns.map((t) => ({ role: t.role, content: t.role === 'user' ? toBlocks(t) : t.text }));
}

/** Relay routes that spend money need the signed-in relay account (or the shared relay token). */
export function relayAuth(): Record<string, string> { const ses = getSession(); const s = get().settings; return { ...(ses?.mode === 'relay' ? { Authorization: `Bearer ${ses.token}` } : {}), ...(s.relayToken ? { 'X-Phloem-Token': s.relayToken } : {}) }; }
export function relayUsable(): boolean { const s = get().settings; return !!s.relayUrl.trim() && (getSession()?.mode === 'relay' || !!s.relayToken); }

export async function aiTransport(): Promise<AiTransport> {
  const s = get().settings;
  if (s.anthropicKey.trim() === 'mock') return 'key';
  if (s.anthropicKey.trim()) return 'key';
  if (relayUsable()) {
    try {
      const r = await fetch(s.relayUrl.replace(/\/$/, '') + '/', { headers: s.relayToken ? { 'X-Phloem-Token': s.relayToken } : {} });
      const j = await r.json();
      if (j && j.ai) return 'relay';
    } catch { /* relay down */ }
  }
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (claude && typeof claude.use === 'function') {
    try { const sample = await claude.use('sample'); if (sample) return 'sample'; } catch { /* not granted */ }
  }
  return null;
}

/** Ask Claude; resolves the assistant's text. Throws a readable Vietnamese error when nothing can answer. */
/** Hosted relays on free plans sleep after idle minutes and take 15–60 s to answer the first request. Ping `/` (with
 *  patience) before real calls so they never pay that wake-up inside their own timeout; remembered for 10 minutes. */
let relayAwakeAt = 0, relayAwakeUrl = '';
export async function wakeRelay(url: string, headers: Record<string, string> = {}, onStatus?: (m: string) => void): Promise<boolean> {
  const base = url.replace(/\/$/, ''); if (!base) return false;
  if (relayAwakeUrl === base && Date.now() - relayAwakeAt < 10 * 60_000) return true;
  const waits = [12_000, 30_000, 45_000];
  for (let i = 0; i < waits.length; i++) {
    try {
      const r = await fetch(base + '/', { headers, signal: AbortSignal.timeout(waits[i]) });
      if (r.ok) { relayAwakeAt = Date.now(); relayAwakeUrl = base; return true; }
    } catch { /* asleep or unreachable: try again with more patience */ }
    if (i === 0) onStatus?.('Relay đang thức dậy (gói free ngủ sau 15 phút không dùng), đợi khoảng 30–60 giây…');
  }
  return false;
}

async function askClaude0(req: AiRequest): Promise<string> {
  const s = get().settings;
  const model = s.aiModel || 'claude-opus-5-5';
  const maxTokens = req.maxTokens ?? 16000;
  const t = await aiTransport();
  if (t === 'key' && s.anthropicKey.trim() === 'mock') return mockReply(req);
  if (t === 'key') {
    const client = new Anthropic({ apiKey: s.anthropicKey.trim(), dangerouslyAllowBrowser: true });
    try {
      const res = await client.beta.messages.create({
        model, max_tokens: maxTokens,
        ...fallbackOpts(model),
        output_config: { effort: req.effort ?? 'medium' },
        system: req.system,
        messages: messagesOf(req),
      });
      if (res.stop_reason === 'refusal') throw new Error('Claude từ chối yêu cầu này.');
      return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('API key Anthropic không hợp lệ. Kiểm tra lại trong Cài đặt → AI.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Bị giới hạn tốc độ (429). Thử lại sau vài giây.');
      if (e instanceof Anthropic.APIError) throw new Error(`Claude API lỗi ${e.status}: ${e.message}`);
      throw e;
    }
  }
  if (t === 'relay') {
    await wakeRelay(s.relayUrl, relayAuth());
    const r = await fetch(s.relayUrl.replace(/\/$/, '') + '/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...relayAuth() },
      body: JSON.stringify({ model, max_tokens: maxTokens, effort: req.effort ?? 'medium', system: req.system, messages: messagesOf(req) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw expired();
    if (r.status === 403 && j.code === 'ai_locked') { set({ modal: 'aicode' }); throw new Error(j.error || 'AI cần mã truy cập.'); }
    if (!r.ok) throw new Error(j.error || `Relay /ai trả HTTP ${r.status}`);
    return String(j.text || '');
  }
  if (t === 'sample') {
    const claude = (window as unknown as { claude: { use: (n: string) => Promise<any> } }).claude;
    const sample = await claude.use('sample');
    const limits = await sample.limits().catch(() => ({ images: false }));
    const last = req.turns[req.turns.length - 1];
    const input = req.turns.map((x, i) => ({ role: x.role, content: i === 0 ? `${req.system}\n\n---\n\n${x.text}` : x.text }));
    const images: Blob[] = [];
    if (limits.images && last.images?.length) for (const im of last.images) images.push(b64ToBlob(im.base64, im.mime));
    const r = await sample(input, { modelTier: 'complex', ...(images.length ? { images } : {}) });
    return String(r.text || '');
  }
  throw new Error('Chưa có cách gọi AI. Vào Cài đặt → AI để dán API key Anthropic, hoặc chạy relay với ANTHROPIC_API_KEY.');
}

/** Ask Claude and watch the answer arrive: `onText` gets the WHOLE text so far on every chunk. Resolves the final text.
 *  Streams through the user's key (SDK), the relay (`/ai/stream`, SSE) or claude.ai `sample`; an older relay without the
 *  stream route falls back to one plain `/ai` call. `signal` aborts. */
async function streamClaude0(req: AiRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const s = get().settings;
  const model = s.aiModel || 'claude-opus-5-5';
  const maxTokens = req.maxTokens ?? 16000;
  const t = await aiTransport();
  if (t === 'key' && s.anthropicKey.trim() === 'mock') return mockStream(req, onText, signal);
  if (t === 'key') {
    const client = new Anthropic({ apiKey: s.anthropicKey.trim(), dangerouslyAllowBrowser: true });
    try {
      const st = client.beta.messages.stream({
        model, max_tokens: maxTokens,
        ...fallbackOpts(model),
        output_config: { effort: req.effort ?? 'medium' },
        system: req.system,
        messages: messagesOf(req),
      }, { signal });
      let acc = '';
      st.on('text', (d: string) => { acc += d; onText(acc); });
      const fin = await st.finalMessage();
      if (fin.stop_reason === 'refusal') throw new Error('Claude từ chối yêu cầu này.');
      return fin.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('API key Anthropic không hợp lệ. Kiểm tra lại trong Cài đặt → AI.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Bị giới hạn tốc độ (429). Thử lại sau vài giây.');
      if (e instanceof Anthropic.APIError) throw new Error(`Claude API lỗi ${e.status}: ${e.message}`);
      throw e;
    }
  }
  if (t === 'relay') {
    // A long design stream can be cut by an overloaded model, a rate limit or a dropped connection: try again (up to 2 more
    // times) instead of failing the whole design, and never hand back half a document as if it were finished.
    for (let attempt = 0; ; attempt++) {
      try { return await relayStream(s.relayUrl, model, maxTokens, req, onText, signal); }
      catch (e) {
        const msg = (e as Error).message || '';
        if (signal?.aborted || attempt >= 2 || !/overload|529|429|503|502|500|quá tải|giới hạn|rate|ngắt kết nối|chưa xong|network|failed to fetch|load failed|terminated/i.test(msg)) throw e;
        onText('');
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      }
    }
  }
  if (t === 'sample') {
    const claude = (window as unknown as { claude: { use: (n: string) => Promise<any> } }).claude;
    const sample = await claude.use('sample');
    const limits = await sample.limits().catch(() => ({ images: false }));
    const last = req.turns[req.turns.length - 1];
    const input = req.turns.map((x, i) => ({ role: x.role, content: i === 0 ? `${req.system}\n\n---\n\n${x.text}` : x.text }));
    const images: Blob[] = [];
    if (limits.images && last.images?.length) for (const im of last.images) images.push(b64ToBlob(im.base64, im.mime));
    const r = await sample(input, { modelTier: 'complex', onText: ({ text }: { text: string }) => onText(text), signal, ...(images.length ? { images } : {}) });
    return String(r.text || '');
  }
  throw new Error('Chưa có cách gọi AI. Vào Cài đặt → AI để dán API key Anthropic, hoặc chạy relay với ANTHROPIC_API_KEY.');
}

/** Mock streaming for the QA harness: the mock reply, delivered in chunks. */
async function mockStream(req: AiRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const full = await mockReply(req);
  let acc = '';
  for (let i = 0; i < full.length; i += 400) { if (signal?.aborted) throw new Error('Đã huỷ.'); acc = full.slice(0, i + 400); onText(acc); await new Promise((r) => setTimeout(r, 30)); }
  return full;
}

/** Offline stand-in used by the QA harness (Settings → API key = "mock"). */
async function mockReply(req: AiRequest): Promise<string> {
  await new Promise((r) => setTimeout(r, 600));
  const last = req.turns[req.turns.length - 1]?.text || '';
  if (/Trả lời CHỈ bằng JSON|variants/.test(req.system)) {
    const img = /imageId "([^"]+)"/.exec(last)?.[1] ?? null;
    const mk = (name: string, why: string, palette: string, blocks: unknown[]) => ({ name, why, palette, fields: { campaignName: 'Mock campaign', subject: 'Giảm 30% đến hết Chủ nhật', preheader: 'Mã MOCK30 · freeship toàn quốc' }, blocks });
    return JSON.stringify({ variants: [
      mk('Dải màu nổi bật', 'Promo ngắn ngày cần CTA ngay màn đầu.', 'Coral', [{ kind: 'nav', content: { brand: 'Mock', links: [{ label: 'Shop', url: 'https://example.com/shop' }] } }, { kind: 'hero-band', content: { eyebrow: 'Chỉ 3 ngày', headline: 'Giảm 30% toàn bộ', subhead: 'Đến hết Chủ nhật.', button: { label: 'Mua ngay', url: 'https://example.com/sale' }, image: img } }, { kind: 'products-2', content: { items: [{ name: 'Món 1', price: '171.000₫', url: 'https://example.com/p1', image: img }, { name: 'Món 2', price: '224.000₫', url: 'https://example.com/p2' }] } }, { kind: 'cta', content: { heading: 'Còn 72 giờ', subhead: 'Mỗi mã một lần.', button: { label: 'Xem sale', url: 'https://example.com/sale' } } }, { kind: 'footer', content: { brand: 'Mock' } }]),
      mk('Kể chuyện', 'Khách cũ cần lý do, không chỉ giá.', 'Forest', [{ kind: 'nav', content: { brand: 'Mock' } }, { kind: 'hero', content: { eyebrow: 'Thư từ xưởng', headline: 'Mẻ nung tháng 10 vừa ra lò', subhead: 'Và lần này giảm 30% cho bạn.', button: { label: 'Xem mẻ mới', url: 'https://example.com/new' }, image: img } }, { kind: 'text', content: { eyebrow: 'Câu chuyện', heading: '11 ngày cho một chiếc cốc', body: 'Từ đất đến men, chúng tôi kể lại từng bước.' } }, { kind: 'quote', content: { quote: 'Mua lần hai vì chất lượng.', author: '— Minh Anh' } }, { kind: 'cta', content: { heading: 'Ghé xưởng', subhead: 'Giảm 30% đến Chủ nhật.', button: { label: 'Mua ngay', url: 'https://example.com/sale' } } }, { kind: 'footer', content: { brand: 'Mock' } }]),
      mk('Tối giản', 'Ít chữ, hai sản phẩm, một nút.', 'Mono', [{ kind: 'nav', content: { brand: 'Mock' } }, { kind: 'text', content: { eyebrow: '', heading: 'Giảm 30%. Hết Chủ nhật.', body: 'Hai món bán chạy nhất, giá tốt nhất năm.' } }, { kind: 'products-2', content: { items: [{ name: 'Món 1', price: '171.000₫', url: 'https://example.com/p1', image: img }, { name: 'Món 2', price: '224.000₫', url: 'https://example.com/p2' }] } }, { kind: 'stats', content: { stats: [{ value: '-30%', label: 'đến Chủ nhật' }, { value: '0₫', label: 'phí ship' }, { value: '30 ngày', label: 'đổi trả' }] } }, { kind: 'cta', content: { heading: 'Mua ngay', subhead: 'Mã MOCK30.', button: { label: 'Vào shop', url: 'https://example.com/sale' } } }, { kind: 'footer', content: { brand: 'Mock' } }]),
    ] });
  }
  return 'Đây là câu trả lời giả lập (mock). Gợi ý: subject ngắn hơn, CTA lên trên.\n\n```json\n{"actions":[{"type":"set_subject","value":"Giảm 30% đến hết Chủ nhật"},{"type":"set_preheader","value":"Mã MOCK30 · freeship toàn quốc"}]}\n```';
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Pull the first JSON object/array out of a model reply (tolerates ``` fences and prose around it). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = Math.min(...['{', '['].map((c) => { const i = candidate.indexOf(c); return i < 0 ? Infinity : i; }));
  if (!isFinite(start)) throw new Error('AI không trả về JSON.');
  const open = candidate[start], close = open === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(close);
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/** One streaming call through the relay (SSE: {t} deltas, {done}, {error}). */
async function relayStream(relayUrl: string, model: string, maxTokens: number, req: AiRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
  await wakeRelay(relayUrl, relayAuth());
  const r = await fetch(relayUrl.replace(/\/$/, '') + '/ai/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...relayAuth() }, signal,
    body: JSON.stringify({ model, max_tokens: maxTokens, effort: req.effort ?? 'medium', system: req.system, messages: messagesOf(req) }),
  });
  if (r.status === 404) { const txt = await askClaude(req); onText(txt); return txt; } // relay from before streaming
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({} as Record<string, string>));
    if (r.status === 401) throw expired();
    if (r.status === 403 && j.code === 'ai_locked') { set({ modal: 'aicode' }); throw new Error(j.error || 'AI cần mã truy cập.'); }
    throw new Error(j.error || `Relay /ai/stream trả HTTP ${r.status}`);
  }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', acc = '', done = false;
  while (!done) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue; // keep-alive comment
      const ev = JSON.parse(line.slice(6)) as { t?: string; done?: boolean; error?: string; stop?: string };
      if (ev.error) throw new Error(ev.error);
      if (ev.t) { acc += ev.t; onText(acc); }
      if (ev.done) done = true;
    }
  }
  if (!done) throw new Error(acc ? 'Relay ngắt kết nối giữa chừng (stream chưa xong).' : 'Relay ngắt kết nối giữa chừng. Thử lại.');
  return acc;
}

/** Claude's raw billing / account errors, said plainly (they used to show as "Claude API lỗi 400: {json…}"). */
export function friendlyAiError(msg: string): string {
  if (/credit balance is too low|billing|purchase credits/i.test(msg)) return 'Tài khoản Claude API đã hết tiền (credit). Nạp thêm tại console.anthropic.com → Settings → Billing rồi bấm lại. Việc tạo ảnh/video bằng Google không bị ảnh hưởng.';
  if (/invalid x-api-key|authentication_error|invalid api key/i.test(msg)) return 'API key Claude không hợp lệ hoặc đã bị thu hồi. Kiểm tra ANTHROPIC_API_KEY trên relay (hoặc Cài đặt → AI).';
  if (/overloaded|\b529\b/i.test(msg)) return 'Claude đang quá tải. Thử lại sau 1 phút.';
  if (/rate_limit|\b429\b/.test(msg)) return 'Bị giới hạn tốc độ Claude (429). Thử lại sau 1 phút.';
  return msg;
}
const friendly = (e: unknown) => { const m = (e as Error)?.message || String(e); const f = friendlyAiError(m); return f === m ? e : new Error(f); };
export async function askClaude(req: AiRequest): Promise<string> { try { return await askClaude0(req); } catch (e) { throw friendly(e); } }
export async function streamClaude(req: AiRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<string> { try { return await streamClaude0(req, onText, signal); } catch (e) { throw friendly(e); } }
