// One entry point for "ask Claude" with three transports, picked by what the viewer has:
//   1. the user's own API key in this browser (official SDK, browser mode)
//   2. the relay (`POST /ai`, server holds ANTHROPIC_API_KEY)
//   3. the claude.ai artifact `sample` capability (no key needed inside claude.ai)
import Anthropic from '@anthropic-ai/sdk';
import { get } from '../store';

export interface AiImage { name: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
export interface AiTurn { role: 'user' | 'assistant'; text: string; images?: AiImage[] }
export interface AiRequest { system: string; turns: AiTurn[]; maxTokens?: number; effort?: 'low' | 'medium' | 'high' }

export type AiTransport = 'key' | 'relay' | 'sample' | null;

export const AI_MODELS = [
  { v: 'claude-opus-5-5', label: 'Claude Opus 5.5 (mặc định)' },
  { v: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (nhanh, rẻ hơn)' },
  { v: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (rẻ nhất)' },
];

function toBlocks(t: AiTurn): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const im of t.images || []) blocks.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } });
  blocks.push({ type: 'text', text: t.text });
  return blocks;
}

function messagesOf(req: AiRequest): Anthropic.MessageParam[] {
  return req.turns.map((t) => ({ role: t.role, content: t.role === 'user' ? toBlocks(t) : t.text }));
}

export async function aiTransport(): Promise<AiTransport> {
  const s = get().settings;
  if (s.anthropicKey.trim() === 'mock') return 'key';
  if (s.anthropicKey.trim()) return 'key';
  if (s.relayUrl.trim()) {
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
export async function askClaude(req: AiRequest): Promise<string> {
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
        betas: ['server-side-fallback-2026-06-01'],
        fallbacks: [{ model: 'claude-opus-4-8' }],
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
    const r = await fetch(s.relayUrl.replace(/\/$/, '') + '/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(s.relayToken ? { 'X-Phloem-Token': s.relayToken } : {}) },
      body: JSON.stringify({ model, max_tokens: maxTokens, effort: req.effort ?? 'medium', system: req.system, messages: messagesOf(req) }),
    });
    const j = await r.json().catch(() => ({}));
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
