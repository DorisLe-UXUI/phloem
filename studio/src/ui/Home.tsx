import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TemplateKind } from '../../../src/shared/types';
import { BRAND_PRESETS, DEFAULT_BRAND } from '../model/types';
import { makeTemplate, TEMPLATES, templateBrand } from '../model/templates';
import { thumbnail } from '../render/renderer';
import { ensureFonts } from '../render/fonts';
import { assets } from '../storage/assets';
import { set, useStore, toast } from '../store';
import * as A from '../pipeline/actions';
import { Btn } from './components';
import { Icon, Logo } from './icons';
import { ask } from './confirm';

let thumbCache: Record<string, string> | null = null;

const QUICK: { label: string; icon: 'blocks' | 'bolt' | 'mail' | 'text' | 'sparkle'; kind?: TemplateKind; ai?: boolean }[] = [
  { label: 'Template', icon: 'blocks' },
  { label: 'Sản phẩm', icon: 'bolt', kind: 'product-grid' },
  { label: 'Khuyến mãi', icon: 'mail', kind: 'promo' },
  { label: 'Bản tin', icon: 'text', kind: 'newsletter' },
  { label: 'Dựng bằng AI', icon: 'sparkle', ai: true },
];

export function Home() {
  const s = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>(thumbCache || {});
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'new' | 'old' | 'name'>('new');
  useEffect(() => { void A.refreshProjects(); }, []);
  useEffect(() => {
    if (thumbCache) return;
    let alive = true;
    (async () => {
      ensureFonts(TEMPLATES.map((t) => t.brand?.headingFamily || 'Inter'));
      await document.fonts.ready;
      const out: Record<string, string> = {};
      for (const t of TEMPLATES) {
        if (!t.blocks.length) continue;
        const brand = templateBrand(t, DEFAULT_BRAND, BRAND_PRESETS);
        try { out[t.kind] = thumbnail(makeTemplate(t.kind, brand).doc, brand, assets, 280); } catch { /* ignore */ }
        if (!alive) return;
        setThumbs({ ...out });
        await new Promise((r) => setTimeout(r, 0));
      }
      thumbCache = out;
    })();
    return () => { alive = false; };
  }, []);

  const create = async (kind: TemplateKind) => {
    const t = TEMPLATES.find((x) => x.kind === kind)!;
    await A.newProject(t.kind, templateBrand(t, DEFAULT_BRAND, BRAND_PRESETS));
  };

  const projects = useMemo(() => {
    const list = s.projects.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
    return list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'old' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [s.projects, q, sort]);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const trend = TEMPLATES.filter((t) => t.blocks.length && t.tag === 'trend');
  const classic = TEMPLATES.filter((t) => t.blocks.length && t.tag !== 'trend');

  return (
    <div class="home">
      <div class="home-top">
        <Logo size={20} />
        <span class="grow" />
        <Btn kind="ghost" sm icon="figma" onClick={() => set({ modal: 'figma' })}>Import từ Figma</Btn>
        <Btn kind="ghost" sm icon="upload" onClick={() => file.current?.click()}>Mở file .phloem.json</Btn>
        <Btn kind="ghost" sm icon="mail" onClick={() => set({ modal: 'clients' })}>Client</Btn>
        <Btn kind="ghost" sm icon="settings" onClick={() => set({ modal: 'settings' })} title="Cài đặt" />
        <input ref={file} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { try { await A.importProjectJson(f); } catch (err) { toast((err as Error).message, 'err'); } } (e.target as HTMLInputElement).value = ''; }} />
      </div>
      <div class="home-body">
        <div class="hero">
          <div>
            <h1>Thiết kế email. Bấm một nút.<br />Có draft trong <em>Mailchimp</em> hoặc <em>Klaviyo</em>.</h1>
            <p>Phloem là mạch dẫn của cây: mang đúng thứ lá tạo ra tới nơi cần, không biến đổi. Email bạn vẽ ra sao, hộp thư nhận y vậy. Không dựng lại, không bao giờ tự gửi.</p>
          </div>
          <div class="row">
            <Btn kind="primary" icon="plus" onClick={() => set({ modal: 'templates' })}>Email mới</Btn>
            <Btn icon="sparkle" onClick={() => set({ modal: 'ai' })} title="Đưa ảnh + nội dung, AI dựng 3 phương án">Dựng bằng AI</Btn>
          </div>
        </div>

        <section>
          <div class="proj-head">
            <div class="eyebrow">Project của bạn · {s.projects.length}</div>
            <div class="line" />
            <label class="search"><Icon name="zoomIn" size={14} /><input value={q} placeholder="Tìm kiếm project…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>
            <select class="sort" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as 'new' | 'old' | 'name')}>
              <option value="new">Mới nhất</option><option value="old">Cũ nhất</option><option value="name">Theo tên</option>
            </select>
          </div>
          <div class="proj-grid">
            <div class="proj new">
              <div class="plus" onClick={() => set({ modal: 'templates' })} style={{ cursor: 'pointer' }}><div class="circle"><Icon name="plus" /></div><b>Email mới</b><span>từ template hoặc trống</span></div>
              <div class="quick">
                {QUICK.map((x) => <button key={x.label} onClick={() => (x.ai ? set({ modal: 'ai' }) : x.kind ? create(x.kind) : set({ modal: 'templates' }))}><Icon name={x.icon} />{x.label}<Icon name="chevron" class="chev" size={12} /></button>)}
                <button onClick={() => create('blank')}><Icon name="rect" />Từ đầu<Icon name="chevron" class="chev" size={12} /></button>
              </div>
            </div>
            {projects.map((p) => (
              <div key={p.id} class="proj" onClick={() => A.openProject(p.id)}>
                <div class="frame">
                  <div class="dots"><i /><i /><i /></div>
                  {p.thumb ? <img class="shot" src={p.thumb} alt="" /> : <div class="blank" style={{ marginTop: 18 }}><Icon name="mail" size={28} /></div>}
                  {(p.thumbMobile || p.thumb) && <div class="phone"><img src={p.thumbMobile || p.thumb} alt="" /></div>}
                </div>
                <div class="meta">
                  <span class="nm">{p.name}</span>
                  <Btn xs kind="ghost" icon="copy" title="Nhân bản" onClick={(e) => { e.stopPropagation(); void A.duplicateProject(p.id); }} />
                  <Btn xs kind="ghost" icon="download" title="Mở và xuất" onClick={(e) => { e.stopPropagation(); void A.openProject(p.id).then(() => set({ rightTab: 'export' })); }} />
                  <Btn xs kind="ghost" icon="trash" title="Xoá" onClick={async (e) => { e.stopPropagation(); if (await ask(`Xoá "${p.name}"? Không hoàn tác được.`)) void A.deleteProject(p.id); }} />
                  <span class="sub">Chỉnh sửa lần cuối {fmt(p.updatedAt)}</span>
                </div>
                <div class="foot">
                  <span class="prov"><i>{p.provider === 'mailchimp' ? 'M' : p.provider === 'klaviyo' ? 'K' : 'P'}</i>{p.provider === 'mailchimp' ? 'Mailchimp' : p.provider === 'klaviyo' ? 'Klaviyo' : 'Chưa xuất'}</span>
                  <span class="dt"><Icon name="desktop" size={12} />{fmt(p.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div class="eyebrow" style={{ marginBottom: 12 }}>Mẫu theo xu hướng · {trend.length}<span class="act" onClick={() => set({ modal: 'templates' })}>Xem tất cả {TEMPLATES.length - 1} mẫu, đổi bảng màu →</span></div>
          <div class="tpl-strip">
            {trend.map((t) => <TplCard key={t.kind} t={t} thumb={thumbs[t.kind]} onClick={() => create(t.kind)} />)}
          </div>
        </section>
        <section>
          <div class="eyebrow" style={{ marginBottom: 12 }}>Mẫu cơ bản · {classic.length}</div>
          <div class="tpl-strip">
            {classic.map((t) => <TplCard key={t.kind} t={t} thumb={thumbs[t.kind]} onClick={() => create(t.kind)} />)}
            <div class="tpl" onClick={() => create('blank')}><div class="pv blank">600 × trống</div><div class="meta"><div class="nm">Trống</div><div class="ds">Tự dựng từ block</div></div></div>
          </div>
        </section>

        <div class="feature-row">
          <div class="feature"><div class="ic"><Icon name="desktop" /></div><div><div class="t">Thiết kế đúng chuẩn email</div><div class="d">{TEMPLATES.length - 1} mẫu có nội dung thật, 22 block, brand kit với logo riêng, gợi ý theo luật: CTA trên fold, chữ đủ to, tương phản.</div></div><button class="go" onClick={() => set({ modal: 'templates' })}><Icon name="chevron" size={14} /></button></div>
          <div class="feature"><div class="ic"><Icon name="bolt" /></div><div><div class="t">Cắt lát thông minh</div><div class="d">Mỗi vùng link thành một lát ảnh. Lưới sản phẩm dày, chữ đè ảnh, nền ảnh: đều ra đúng như vẽ, ở mọi hộp thư.</div></div><button class="go" onClick={() => set({ modal: 'ai' })}><Icon name="chevron" size={14} /></button></div>
          <div class="feature"><div class="ic"><Icon name="send" /></div><div><div class="t">Draft chứ không gửi</div><div class="d">Tạo hoặc cập nhật đúng bản nháp trong Mailchimp / Klaviyo, hoặc copy HTML dán vào template có brand. Bạn duyệt và bấm gửi.</div></div><button class="go" onClick={() => set({ modal: 'clients' })}><Icon name="chevron" size={14} /></button></div>
        </div>

        <section class="palette-band">
          <div>
            <div class="eyebrow" style={{ marginBottom: 8 }}>Bảng màu thương hiệu</div>
            <div class="small muted" style={{ maxWidth: 460 }}>Mỗi block dùng màu theo token: đổi bảng màu là dải hero, card, nút, giá, footer đổi theo. Logo và tên thương hiệu đặt trong Brand kit, thay vào mọi nav và footer.</div>
          </div>
          <div class="presets">{BRAND_PRESETS.map((p) => <span key={p.name} class="preset" style={{ cursor: 'default' }}><i style={{ background: p.brand.primary, borderColor: p.brand.soft }} />{p.name}</span>)}</div>
        </section>
        <div class="dim small mono" style={{ textAlign: 'center' }}>phloem · mạch dẫn của cây: mang đúng thứ lá tạo ra tới nơi cần, không biến đổi.</div>
      </div>
    </div>
  );
}

function TplCard({ t, thumb, onClick }: { t: (typeof TEMPLATES)[number]; thumb?: string; onClick: () => void }) {
  const preset = BRAND_PRESETS.find((p) => p.name === t.preset);
  return (
    <div class="tpl" onClick={onClick} title={`Tạo email "${t.name}" với bảng màu ${t.preset}`}>
      <div class="pv">{thumb ? <img src={thumb} alt="" /> : <div class="pv-skel" />}</div>
      <div class="meta">
        <div class="row"><div class="nm grow">{t.name}</div>{t.tag && <span class="chip on" style={{ fontSize: 9.5 }}>{t.tag}</span>}<span class="chip" style={{ gap: 5 }}><i style={{ width: 8, height: 8, borderRadius: 4, background: preset?.brand.primary, display: 'inline-block' }} />{t.preset}</span></div>
        <div class="ds">{t.desc}</div>
      </div>
    </div>
  );
}
