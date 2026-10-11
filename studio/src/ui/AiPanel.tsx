// Right-panel "AI" tab: chat about the open email, apply suggested edits, jump to the 3-variant composer.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Node, TextNode } from '../model/types';
import * as ops from '../model/ops';
import { get, set, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { aiTransport, type AiTransport } from '../ai/client';
import { chatReply, type Action, type ChatMsg } from '../ai/chat';
import { brandForPalette } from '../ai/generate';
import { Btn, Eyebrow } from './components';
import { Icon } from './icons';

const QUICK = [
  { label: 'Viết 5 subject', q: 'Viết 5 subject line (30–55 ký tự) và 5 preheader tương ứng cho email này. Chọn 1 bộ tốt nhất làm action.' },
  { label: 'Rút gọn chữ', q: 'Các đoạn chữ trong email có dài không? Rút gọn những đoạn dài thành 1–2 câu, giữ ý chính, và đưa thành action set_text.' },
  { label: 'Kiểm tra email', q: 'Đánh giá email này theo chuẩn email marketing: cấu trúc, CTA, độ dài, chữ, màu. Chỉ ra 3 điều nên sửa ngay.' },
  { label: 'CTA mạnh hơn', q: 'Đề xuất lời kêu gọi hành động mạnh hơn cho các nút trong email và đưa thành action set_text cho từng nút.' },
];

const chatStore: { msgs: ChatMsg[] } = { msgs: [] };

export function AiPanel() {
  const s = useStore();
  const [msgs, setMsgs] = useState<ChatMsg[]>(chatStore.msgs);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [transport, setTransport] = useState<AiTransport | 'checking'>('checking');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { void aiTransport().then(setTransport); }, [s.settings.anthropicKey, s.settings.relayUrl]);
  useEffect(() => { chatStore.msgs = msgs; listRef.current?.scrollTo({ top: 1e9 }); }, [msgs]);

  const send = async (text: string) => {
    const q = text.trim(); if (!q || busy) return;
    const next = [...msgs, { role: 'user' as const, text: q }];
    setMsgs(next); setInput(''); setBusy(true);
    try { const reply = await chatReply(next, get().project); setMsgs([...next, reply]); }
    catch (e) { setMsgs([...next, { role: 'assistant', text: `Lỗi: ${(e as Error).message}` }]); }
    finally { setBusy(false); }
  };

  return (
    <div class="props" style={{ height: '100%' }}>
      <div class="card glow">
        <div class="row"><Icon name="sparkle" style={{ color: 'var(--neon)' }} /><b class="grow">Dựng bằng AI</b></div>
        <div class="small muted">Đưa ảnh + nội dung thô, AI xếp thành 3 phương án bằng block Phloem. Bạn chọn một rồi chỉnh tiếp.</div>
        <Btn kind="primary" block icon="sparkle" onClick={() => set({ modal: 'ai' })}>Dựng 3 phương án từ nội dung</Btn>
      </div>
      <Eyebrow action={msgs.length ? { label: 'Xoá chat', onClick: () => setMsgs([]) } : undefined}>Trợ lý</Eyebrow>
      {transport === null && <div class="check warn"><span class="lv">CHƯA CÓ AI</span><span class="m">Dán API key Anthropic trong <a href="#" onClick={(e) => { e.preventDefault(); set({ modal: 'settings' }); }}>Cài đặt → AI</a>, hoặc chạy relay có ANTHROPIC_API_KEY.</span></div>}
      <div class="row wrap">{QUICK.map((q) => <Btn key={q.label} xs disabled={busy || transport === null} onClick={() => send(q.q)}>{q.label}</Btn>)}</div>
      <div class="chat" ref={listRef}>
        {msgs.length === 0 && <div class="dim small">Hỏi về email đang mở: subject, bố cục, màu, copy… Trợ lý thấy cấu trúc và chữ trong email của bạn.</div>}
        {msgs.map((m, i) => (
          <div key={i} class={`msg ${m.role}`}>
            <div class="bubble">{m.text}</div>
            {m.actions && m.actions.length > 0 && <div class="acts">{m.actions.map((a, j) => <Btn key={j} xs icon="check" onClick={() => applyAction(a)}>{actionLabel(a)}</Btn>)}{m.actions.length > 1 && <Btn xs kind="primary" onClick={() => m.actions!.forEach(applyAction)}>Áp dụng tất cả</Btn>}</div>}
          </div>
        ))}
        {busy && <div class="msg assistant"><div class="bubble dim">Đang nghĩ…</div></div>}
      </div>
      <div class="chat-input">
        <textarea class="in" rows={2} value={input} placeholder="Hỏi trợ lý… (Enter để gửi, Shift+Enter xuống dòng)" disabled={transport === null}
          onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
        <Btn kind="primary" icon="send" disabled={busy || !input.trim() || transport === null} onClick={() => send(input)} title="Gửi" />
      </div>
    </div>
  );
}

function actionLabel(a: Action): string {
  switch (a.type) {
    case 'set_subject': return `Subject: ${a.value.slice(0, 40)}`;
    case 'set_preheader': return `Preheader: ${a.value.slice(0, 40)}`;
    case 'set_campaign_name': return `Tên campaign: ${a.value.slice(0, 30)}`;
    case 'set_text': return `${a.name}: ${a.value.slice(0, 36)}`;
    case 'add_block': return `+ block ${a.kind}`;
    case 'set_palette': return `Bảng màu ${a.value}`;
  }
}

export function applyAction(a: Action) {
  const p = get().project;
  if (!p) { toast('Mở một project trước.', 'err'); return; }
  switch (a.type) {
    case 'set_subject': A.patchProject({ fields: { ...p.fields, subject: a.value } }); break;
    case 'set_preheader': A.patchProject({ fields: { ...p.fields, preheader: a.value } }); break;
    case 'set_campaign_name': A.patchProject({ fields: { ...p.fields, campaignName: a.value } }); break;
    case 'set_text': {
      const d = A.doc();
      const target = ops.flat(d.nodes).find((n): n is TextNode => n.type === 'text' && n.name.toLowerCase() === a.name.toLowerCase())
        ?? ops.flat(d.nodes).find((n): n is TextNode => n.type === 'text' && n.name.toLowerCase().includes(a.name.toLowerCase()));
      if (!target) { toast(`Không tìm thấy layer chữ "${a.name}".`, 'err'); return; }
      A.patchTextFlow(target.id, { text: a.value } as Partial<TextNode>);
      A.select([target.id]);
      break;
    }
    case 'add_block': A.addBlock(a.kind); break;
    case 'set_palette': A.applyBrand(brandForPalette(a.value, p.brand)); break;
  }
  toast('Đã áp dụng.', 'ok');
}

export type { Node };
