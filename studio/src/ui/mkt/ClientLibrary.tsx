// Kho ảnh của một khách: ảnh tải lên, ảnh lấy từ website, ảnh AI tạo. Dùng trong tab Thiết kế của khách và trong editor.
import { useEffect, useRef, useState } from 'preact/hooks';
import { assets } from '../../storage/assets';
import { get, toast } from '../../store';
import { artDirect, clientImages, generateImage } from '../../mkt/designs';
import { Btn } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';

let imageAi: string | null | undefined; // provider the relay offers ('cloudflare' | 'google' | 'openai'), checked once
async function relayImageAi(): Promise<string | null> {
  if (imageAi !== undefined) return imageAi ?? null;
  try { const r = await fetch(`${get().settings.relayUrl.replace(/\/$/, '')}/`, { signal: AbortSignal.timeout(60_000) }); const j = await r.json(); imageAi = j.imageAi || null; } catch { imageAi = null; }
  return imageAi ?? null;
}

export function ClientLibrary({ clientId, onUse, big }: { clientId: string; onUse?: (id: string) => void; big?: boolean }) {
  const [, bump] = useState(0);
  useEffect(() => assets.onChange(() => bump((n) => n + 1)), []);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<'1:1' | '3:4' | '9:16' | '16:9'>('1:1');
  const [pro, setPro] = useState(true);
  const [provider, setProvider] = useState<string | null | undefined>(imageAi);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { void relayImageAi().then(setProvider); }, []);
  const list = clientImages(clientId);
  const upload = async (files: FileList | File[]) => {
    const fs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    for (let i = 0; i < fs.length; i++) { setBusy(`Đang tải ${i + 1}/${fs.length}…`); try { await assets.add(fs[i], fs[i].name, { src: { kind: 'upload' }, client: clientId, project: null }); } catch { toast(`Không đọc được ${fs[i].name}`, 'err'); } }
    setBusy(''); if (fs.length) toast(`Đã thêm ${fs.length} ảnh vào kho của khách.`, 'ok');
  };
  const gen = async () => {
    if (!prompt.trim()) { toast('Mô tả ảnh cần tạo.', 'err'); return; }
    try {
      const client = pro ? get().clients.find((c) => c.id === clientId) || null : null;
      if (client) setBusy('Art director đang viết prompt…');
      const p = client ? await artDirect(client, prompt.trim(), aspect) : prompt.trim();
      setBusy('AI đang vẽ ảnh (10–40 giây)…');
      const id = await generateImage(clientId, p, aspect); toast('Đã tạo ảnh, nằm đầu kho ảnh.', 'ok'); setPrompt(''); onUse && !big && onUse(id); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(''); }
  };
  return (
    <div class={`mk-lib ${big ? 'big' : ''}`}>
      <div class={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files) void upload(e.dataTransfer.files); }} role="button" tabIndex={0} aria-label="Tải ảnh lên kho của khách">
        <Icon name="upload" /> <div>{busy || 'Thả ảnh của khách vào đây hoặc bấm để chọn'}</div><div class="dim small">Logo, ảnh sản phẩm, ảnh chụp, bài cũ · chỉ khách này thấy</div>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) void upload(f); (e.target as HTMLInputElement).value = ''; }} />
      <div class="mk-gen">
        <div class="row" style={{ gap: 6 }}><Icon name="sparkle" size={14} /><b class="small">Tạo ảnh bằng AI</b><span class="grow" />{provider === undefined ? null : provider ? <span class="chip on">{provider === 'cloudflare' ? 'FLUX free → Nano Banana Lite' : provider === 'google' ? 'Nano Banana 2 Lite' : 'OpenAI'}</span> : <span class="chip warn" title="Thêm CF_AI_TOKEN hoặc GEMINI_API_KEY vào relay (Render → Environment)">chưa có key</span>}</div>
        <textarea class="in" rows={2} value={prompt} placeholder="VD: ly cà phê sữa đá trên bàn gỗ, nắng sớm, phong cách ảnh quảng cáo, không chữ" onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Mô tả ảnh cần tạo" />
        <div class="row" style={{ gap: 6 }}>
          <div class="seg">{(['1:1', '3:4', '9:16', '16:9'] as const).map((a) => <button key={a} class={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>{a}</button>)}</div>
          <span class="grow" />
          <button class={`chip ${pro ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setPro(!pro)} title="AI viết lại mô tả thành prompt chuẩn quảng cáo: bố cục, ánh sáng, ống kính, màu thương hiệu">{pro ? '✓ ' : ''}Prompt xịn</button>
          <Btn sm icon="sparkle" disabled={!!busy || !provider} onClick={() => void gen()} title={provider ? 'Tạo ảnh, lưu vào kho của khách' : 'Relay chưa có key tạo ảnh'}>Tạo ảnh</Btn>
        </div>
      </div>
      {list.length ? (
        <div class="asset-grid">
          {list.map((a) => (
            <div key={a.id} class="asset" draggable title={`${a.name} · ${a.w}×${a.h}${onUse ? '\nBấm để dùng trong thiết kế' : ''}`} onClick={() => onUse?.(a.id)} onDragStart={(e) => { e.dataTransfer?.setData('text/phloem-asset', a.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }}>
              {assets.url(a.id) ? <img src={assets.url(a.id)} alt={a.name} loading="lazy" /> : null}
              <button class="del" title="Xoá khỏi kho của khách" aria-label={`Xoá ${a.name}`} onClick={async (e) => { e.stopPropagation(); if (await ask(`Xoá "${a.name}" khỏi kho ảnh?`)) void assets.remove(a.id); }}>✕</button>
              <div class="nm">{a.src?.kind === 'ai' ? 'AI · ' : a.src?.kind === 'logo' ? 'Logo · ' : ''}{a.name}</div>
            </div>
          ))}
        </div>
      ) : <div class="dim small">Kho ảnh của khách đang trống. Tải ảnh lên, tạo ảnh bằng AI, hoặc lên brand book từ website (logo và ảnh trên web tự vào đây).</div>}
    </div>
  );
}
