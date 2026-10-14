// Chat assistant with knowledge of the open project. Replies in Vietnamese; concrete edits come back as actions.
import type { BlockKind } from '../../../src/shared/types';
import type { Project } from '../model/types';
import { flat } from '../model/ops';
import { BLOCKS } from '../model/templates';
import { askClaude, extractJson } from './client';

export type Action =
  | { type: 'set_subject'; value: string }
  | { type: 'set_preheader'; value: string }
  | { type: 'set_campaign_name'; value: string }
  | { type: 'set_text'; name: string; value: string }
  | { type: 'add_block'; kind: BlockKind }
  | { type: 'set_palette'; value: string };

export interface ChatMsg { role: 'user' | 'assistant'; text: string; actions?: Action[] }

export function projectContext(p: Project | null): string {
  if (!p) return 'Chưa mở project nào.';
  const d = p.desktop;
  const lines: string[] = [];
  lines.push(`Project "${p.name}" · campaign "${p.fields.campaignName}" · subject "${p.fields.subject}" · preheader "${p.fields.preheader}"`);
  lines.push(`Artboard ${d.width}×${d.height}, ${d.nodes.length} block${p.mobile ? ', có bản mobile' : ''}. Brand: primary ${p.brand.primary}, font ${p.brand.fontFamily}.`);
  for (const n of d.nodes) {
    const texts = flat(n.type === 'group' ? n.children : [n]).filter((x) => x.type === 'text').map((x) => `${x.name}: "${(x as { text: string }).text.slice(0, 80)}"`);
    lines.push(`- ${n.block ? `[${n.block}] ` : ''}${n.name}${n.link ? ` (link ${n.link})` : ''}: ${texts.slice(0, 6).join(' | ')}`);
  }
  return lines.join('\n');
}

const SYSTEM = `Bạn là trợ lý thiết kế email trong Phloem Email (web app thiết kế email, cắt lát thành HTML chuẩn mọi hộp thư, tạo draft Mailchimp/Klaviyo). Trả lời bằng tiếng Việt, ngắn gọn, thực tế, như một art director có kinh nghiệm email marketing. Không chào hỏi dài dòng.

Bạn biết:
- Email là ảnh cắt lát: chữ phải ≥15px ở 600px để đọc được trên điện thoại; mỗi vùng link thành một lát ảnh; nên có 1 CTA chính trên fold; subject 30–55 ký tự; preheader 40–90 ký tự nối tiếp subject; Gmail cắt HTML >102KB; Outlook cắt ảnh cao >1728px; ảnh placeholder cần thay trước khi gửi.
- Các block Phloem: ${BLOCKS.map((b) => `${b.kind} (${b.name})`).join(', ')}.
- Bảng màu có sẵn: Forest, Coral, Ocean, Sunset, Plum, Mint, Royal, Mono, Linen, Neon, Midnight, Candy, Sky, Lavender.
- Brand kit có tên thương hiệu và logo (Brand kit → Tải logo) thay cho chữ BRAND trong nav/footer.

Khi đề xuất thay đổi cụ thể mà app có thể áp dụng, kết thúc câu trả lời bằng một khối \`\`\`json chứa {"actions":[...]} với các action:
- {"type":"set_subject","value":"…"} · {"type":"set_preheader","value":"…"} · {"type":"set_campaign_name","value":"…"}
- {"type":"set_text","name":"<tên layer chữ trong ngữ cảnh, ví dụ Headline>","value":"…"} (đổi nội dung một đoạn chữ hiện có)
- {"type":"add_block","kind":"<kind>"} · {"type":"set_palette","value":"<tên bảng màu>"}
Chỉ thêm khối json khi có action thật; tối đa 6 action. Khi người dùng hỏi chung, trả lời bình thường không kèm json.`;

export async function chatReply(history: ChatMsg[], project: Project | null): Promise<ChatMsg> {
  const ctx = projectContext(project);
  const turns = history.map((m, i) => ({ role: m.role, text: i === history.length - 1 && m.role === 'user' ? `[Ngữ cảnh project hiện tại]\n${ctx}\n\n[Câu hỏi]\n${m.text}` : m.text }));
  const text = await askClaude({ system: SYSTEM, turns, maxTokens: 4000, effort: 'low' });
  let actions: Action[] | undefined;
  let shown = text;
  const m = /```json\s*([\s\S]*?)```/i.exec(text);
  if (m) {
    try { const j = extractJson<{ actions?: Action[] }>(m[0]); if (Array.isArray(j.actions)) actions = j.actions.slice(0, 6); shown = text.replace(m[0], '').trim(); } catch { /* keep text */ }
  }
  return { role: 'assistant', text: shown, actions };
}
