import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND_PRESETS, DEFAULT_BRAND } from '../model/types';
import { makeTemplate, TEMPLATES } from '../model/templates';
import { thumbnail } from '../render/renderer';
import { assets } from '../storage/assets';
import { set, useStore, toast } from '../store';
import * as A from '../pipeline/actions';
import { Btn } from './components';
import { Icon } from './icons';
import { ask } from './confirm';

let thumbCache: Record<string, string> | null = null;

export function Home() {
  const s = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>(thumbCache || {});
  useEffect(() => { void A.refreshProjects(); }, []);
  useEffect(() => {
    if (thumbCache) return;
    let alive = true;
    (async () => {
      await document.fonts.ready;
      const out: Record<string, string> = {};
      for (const t of TEMPLATES) {
        if (!t.blocks.length) continue;
        const brand = { ...DEFAULT_BRAND, ...(BRAND_PRESETS.find((p) => p.name === t.preset)?.brand || {}) };
        try { out[t.kind] = thumbnail(makeTemplate(t.kind, brand).doc, brand, assets, 280); } catch { /* ignore */ }
        if (!alive) return;
        setThumbs({ ...out });
        await new Promise((r) => setTimeout(r, 0));
      }
      thumbCache = out;
    })();
    return () => { alive = false; };
  }, []);

  const create = async (kind: string) => {
    const t = TEMPLATES.find((x) => x.kind === kind)!;
    const brand = BRAND_PRESETS.find((p) => p.name === t.preset)?.brand;
    await A.newProject(t.kind, brand);
  };

  return (
    <div class="home">
      <div class="home-top">
        <div class="logo"><Icon name="leaf" /><span>Phloem</span><span class="sub">studio</span></div>
        <span class="grow" />
        <Btn kind="ghost" sm icon="figma" onClick={() => set({ modal: 'figma' })}>Import từ Figma</Btn>
        <Btn kind="ghost" sm icon="upload" onClick={() => file.current?.click()}>Mở .phloem.json</Btn>
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
          <div class="eyebrow" style={{ marginBottom: 12 }}>Bắt đầu nhanh · {TEMPLATES.filter((t) => t.blocks.length).length} mẫu<span class="act" onClick={() => set({ modal: 'templates' })}>Xem tất cả, đổi bảng màu →</span></div>
          <div class="tpl-strip">
            {TEMPLATES.filter((t) => t.blocks.length).map((t) => (
              <div key={t.kind} class="tpl" onClick={() => create(t.kind)} title={`Tạo email "${t.name}" với bảng màu ${t.preset}`}>
                <div class="pv">{thumbs[t.kind] ? <img src={thumbs[t.kind]} alt="" /> : <div class="pv-skel" />}</div>
                <div class="meta"><div class="row"><div class="nm grow">{t.name}</div><span class="chip" style={{ gap: 5 }}><i style={{ width: 8, height: 8, borderRadius: 4, background: BRAND_PRESETS.find((p) => p.name === t.preset)?.brand.primary, display: 'inline-block' }} />{t.preset}</span></div><div class="ds">{t.desc}</div></div>
              </div>
            ))}
            <div class="tpl" onClick={() => create('blank')}><div class="pv blank">600 × trống</div><div class="meta"><div class="nm">Trống</div><div class="ds">Tự dựng từ block</div></div></div>
          </div>
        </section>

        <section>
          <div class="eyebrow" style={{ marginBottom: 12 }}>Project của bạn · {s.projects.length}</div>
          {s.projects.length ? (
            <div class="proj-grid">
              {s.projects.map((p) => (
                <div key={p.id} class="proj" onClick={() => A.openProject(p.id)}>
                  <div class="pv">{p.thumb ? <img src={p.thumb} alt="" /> : <div class="blank"><Icon name="mail" size={28} /></div>}</div>
                  <div class="meta">
                    <span class="nm">{p.name}</span>
                    <span class="dt">{new Date(p.updatedAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
                    <Btn xs kind="ghost" icon="copy" title="Nhân bản" onClick={(e) => { e.stopPropagation(); void A.duplicateProject(p.id); }} />
                    <Btn xs kind="ghost" icon="trash" title="Xoá" onClick={async (e) => { e.stopPropagation(); if (await ask(`Xoá "${p.name}"? Không hoàn tác được.`)) void A.deleteProject(p.id); }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="empty" style={{ padding: '22px 16px' }}><div class="big">Chưa có project</div><div>Chọn một mẫu ở trên, dựng bằng AI, hoặc import từ Figma. Mọi thứ lưu trong trình duyệt này.</div></div>
          )}
        </section>

        <section class="palette-band">
          <div>
            <div class="eyebrow" style={{ marginBottom: 8 }}>Bảng màu thương hiệu</div>
            <div class="small muted" style={{ maxWidth: 460 }}>Mỗi block dùng màu theo token: đổi bảng màu là dải hero, card, nút, giá, footer đổi theo. Màu và font chỉnh tay được trong Brand kit.</div>
          </div>
          <div class="presets">{BRAND_PRESETS.map((p) => <span key={p.name} class="preset" style={{ cursor: 'default' }}><i style={{ background: p.brand.primary, borderColor: p.brand.soft }} />{p.name}</span>)}</div>
        </section>

        <div class="feature-row">
          <div class="feature"><div class="t"><Icon name="sparkle" />Thiết kế đúng chuẩn email</div><div class="d">11 mẫu có nội dung thật, 13 block, brand kit, gợi ý theo luật: CTA trên fold, chữ đủ to, tương phản, preheader. AI dựng 3 phương án từ ảnh và nội dung của bạn.</div></div>
          <div class="feature"><div class="t"><Icon name="bolt" />Cắt lát thông minh</div><div class="d">Mỗi vùng link thành một lát ảnh. Lưới sản phẩm dày, chữ đè ảnh, nền ảnh: đều ra đúng như vẽ, ở mọi hộp thư. Xem trước y như Gmail trước khi xuất.</div></div>
          <div class="feature"><div class="t"><Icon name="send" />Draft chứ không gửi</div><div class="d">Tạo hoặc cập nhật đúng bản nháp trong Mailchimp / Klaviyo, hoặc copy HTML dán vào template có brand, hoặc tải zip. Bạn duyệt và bấm gửi.</div></div>
        </div>
        <div class="dim small mono" style={{ textAlign: 'center' }}>phloem · mạch dẫn của cây: mang đúng thứ lá tạo ra tới nơi cần, không biến đổi.</div>
      </div>
    </div>
  );
}
