// "Dựng bằng AI": images + copy in, three rendered variants out, pick one.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND_PRESETS, DEFAULT_BRAND, type Brand } from '../model/types';
import { thumbnail } from '../render/renderer';
import { assets } from '../storage/assets';
import { get, set, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { brandForPalette, generateVariants, variantToDoc, type GenInput, type Variant } from '../ai/generate';
import { aiTransport, type AiTransport } from '../ai/client';
import { Btn, Eyebrow, Field, Modal, Select, TextArea, TextInput } from './components';
import { Icon } from './icons';
import { ask } from './confirm';

const GOALS = [
  { v: 'promo', label: 'Khuyến mãi / sale' }, { v: 'newsletter', label: 'Newsletter định kỳ' }, { v: 'launch', label: 'Ra mắt sản phẩm' },
  { v: 'welcome', label: 'Chào mừng người mới' }, { v: 'event', label: 'Mời sự kiện' }, { v: 'cart', label: 'Nhắc giỏ hàng' },
  { v: 'digest', label: 'Bản tin biên tập' }, { v: 'reengagement', label: 'Kéo khách quay lại' }, { v: 'other', label: 'Khác' },
];
const TONES = [{ v: 'thân thiện, gần gũi', label: 'Thân thiện' }, { v: 'sang trọng, tối giản', label: 'Sang trọng' }, { v: 'sôi nổi, thúc giục', label: 'Sôi nổi' }, { v: 'chuyên nghiệp, rõ ràng', label: 'Chuyên nghiệp' }];

const LS = 'phloem.ai.form';

export function AiModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [form, setForm] = useState<GenInput>(() => {
    const base: GenInput = { goal: 'promo', brandName: '', brief: '', content: '', tone: TONES[0].v, imageIds: [], palette: 'auto' };
    try { const saved = JSON.parse(localStorage.getItem(LS) || '{}') as Partial<GenInput>; return { ...base, ...saved, imageIds: [] }; } catch { return base; }
  });
  const [transport, setTransport] = useState<AiTransport | 'checking'>('checking');
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [, bump] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void aiTransport().then(setTransport); return assets.onChange(() => bump((n) => n + 1)); }, []);
  const upd = (patch: Partial<GenInput>) => setForm((f) => { const n = { ...f, ...patch }; try { localStorage.setItem(LS, JSON.stringify({ ...n, imageIds: [] })); } catch { /* ignore */ } return n; });
  const toggleImg = (id: string) => upd({ imageIds: form.imageIds.includes(id) ? form.imageIds.filter((x) => x !== id) : [...form.imageIds, id] });

  const run = async () => {
    setBusy(true); setErr(''); setVariants([]); setThumbs([]);
    try {
      await document.fonts.ready;
      const vs = await generateVariants(form);
      setVariants(vs);
      setThumbs(vs.map((v) => { try { return thumbnail(variantToDoc(v, brandForPalette(v.palette)), brandForPalette(v.palette), assets, 320); } catch { return ''; } }));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const use = async (v: Variant) => {
    const brand: Brand = brandForPalette(v.palette, get().project?.brand ?? DEFAULT_BRAND);
    const doc = variantToDoc(v, brand);
    if (s.project) {
      if (!(await ask(`Thay toàn bộ nội dung "${s.project.name}" bằng phương án "${v.name}"? Có thể hoàn tác bằng ⌘Z.`, 'Thay', false))) return;
      A.commit(doc);
      A.patchProject({ brand, fields: v.fields });
      set({ selection: [], modal: null });
      toast(`Đã áp dụng "${v.name}". Chỉnh tiếp trên canvas.`, 'ok');
    } else {
      onClose();
      await A.newProject('blank', brand, v.fields.campaignName || v.name);
      A.commit(doc, false);
      A.patchProject({ fields: v.fields });
      toast(`Đã tạo project từ "${v.name}".`, 'ok');
    }
  };

  const all = assets.all();
  return (
    <Modal title="Dựng bằng AI" icon="sparkle" onClose={onClose} wide
      footer={<>
        <span class="grow small muted">{transport === 'checking' ? 'Đang kiểm tra AI…' : transport === 'key' ? 'Dùng API key của bạn' : transport === 'relay' ? 'Dùng qua relay' : transport === 'sample' ? 'Dùng Claude của claude.ai' : 'Chưa có AI: vào Cài đặt → AI'}</span>
        {!transport || transport === null ? <Btn kind="ghost" onClick={() => set({ modal: 'settings' })}>Cài đặt AI</Btn> : null}
        <Btn kind="primary" icon="sparkle" disabled={busy || transport === 'checking' || transport === null} onClick={run}>{busy ? 'Đang dựng 3 phương án…' : variants.length ? 'Dựng lại' : 'Dựng 3 phương án'}</Btn>
      </>}>
      <div class="small muted">Đưa ảnh và nội dung thô. AI sắp xếp thành 3 phương án khác nhau bằng block của Phloem, bạn chọn một rồi chỉnh tiếp. Chữ, ảnh, màu đều sửa được sau đó.</div>
      <div class="grid3">
        <Field label="Loại email"><Select value={form.goal} options={GOALS} onChange={(v) => upd({ goal: v })} /></Field>
        <Field label="Thương hiệu"><TextInput value={form.brandName} placeholder="Terra" onCommit={(v) => upd({ brandName: v })} onInput={(v) => upd({ brandName: v })} /></Field>
        <Field label="Giọng điệu"><Select value={form.tone} options={TONES} onChange={(v) => upd({ tone: v })} /></Field>
      </div>
      <Field label="Email này để làm gì? Gửi cho ai?" hint="brief"><TextArea rows={2} value={form.brief} placeholder="Sale cuối tuần 30% cho khách cũ, muốn họ quay lại mua đồ gốm trước Tết…" onCommit={(v) => upd({ brief: v })} onInput={(v) => upd({ brief: v })} /></Field>
      <Field label="Nội dung thô" hint="tiêu đề, sản phẩm, giá, link, ngày, chính sách… dán thoải mái"><TextArea rows={6} value={form.content} placeholder={'Cốc men tro 300ml 245.000₫ → 171.000₫ https://terra.vn/p/coc\nĐĩa ăn 24cm 320.000₫ → 224.000₫\nFreeship toàn quốc, đổi trả 30 ngày\nMã TERRA30 đến hết Chủ nhật 19/10'} onCommit={(v) => upd({ content: v })} onInput={(v) => upd({ content: v })} /></Field>
      <Eyebrow action={{ label: '+ Tải ảnh', onClick: () => file.current?.click() }}>Ảnh ({form.imageIds.length} đã chọn)</Eyebrow>
      <input ref={file} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={async (e) => { const fs = Array.from((e.target as HTMLInputElement).files || []); const ids: string[] = []; for (const f of fs) { try { ids.push((await assets.add(f)).id); } catch { /* skip */ } } upd({ imageIds: [...form.imageIds, ...ids] }); (e.target as HTMLInputElement).value = ''; }} />
      {all.length ? (
        <div class="asset-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {all.map((a) => (
            <div key={a.id} class={`asset ${form.imageIds.includes(a.id) ? 'on' : ''}`} style={form.imageIds.includes(a.id) ? { outline: '2px solid var(--neon)', outlineOffset: -2 } : {}} title={a.name} onClick={() => toggleImg(a.id)}>
              {assets.url(a.id) ? <img src={assets.url(a.id)} alt="" /> : null}
              {form.imageIds.includes(a.id) && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--neon)', color: 'var(--neon-ink)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{form.imageIds.indexOf(a.id) + 1}</span>}
            </div>
          ))}
        </div>
      ) : <div class="dropzone" onClick={() => file.current?.click()}><Icon name="upload" /> <div>Chưa có ảnh. Bấm để tải lên, hoặc bỏ qua: AI sẽ để placeholder.</div></div>}
      <Eyebrow>Bảng màu</Eyebrow>
      <div class="presets">
        <button class={`preset ${form.palette === 'auto' ? 'on' : ''}`} onClick={() => upd({ palette: 'auto' })}><Icon name="sparkle" size={14} />AI chọn</button>
        {BRAND_PRESETS.map((p) => <button key={p.name} class={`preset ${form.palette === p.name ? 'on' : ''}`} onClick={() => upd({ palette: p.name })}><i style={{ background: p.brand.primary, borderColor: p.brand.bg }} />{p.name}</button>)}
      </div>
      {err && <div class="check error"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
      {busy && <div class="card"><div class="row"><Icon name="bolt" style={{ color: 'var(--neon)' }} /><b class="grow">AI đang đọc nội dung và ảnh, dựng 3 phương án…</b></div><div class="progress"><i class="indet" /></div><div class="dim small">Thường mất 20–60 giây. Kết quả là block Phloem thật, không phải ảnh mockup.</div></div>}
      {variants.length > 0 && (
        <>
          <Eyebrow>3 phương án</Eyebrow>
          <div class="tpl-grid">
            {variants.map((v, i) => (
              <div key={i} class="tpl">
                <div class="pv" style={{ aspectRatio: '3 / 3.2' }}>{thumbs[i] ? <img src={thumbs[i]} alt="" /> : null}</div>
                <div class="meta">
                  <div class="row"><div class="nm grow">{v.name}</div><span class="chip">{v.palette}</span></div>
                  <div class="ds">{v.why}</div>
                  <div class="ds mono" style={{ marginTop: 4 }}>{v.blocks.map((b) => b.kind).join(' · ')}</div>
                  <div class="row" style={{ marginTop: 8 }}><Btn sm kind="primary" block onClick={() => use(v)}>{s.project ? 'Dùng, thay nội dung hiện tại' : 'Tạo project từ mẫu này'}</Btn></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
