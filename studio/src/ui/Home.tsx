import { useEffect, useRef } from 'preact/hooks';
import { set, useStore, toast } from '../store';
import * as A from '../pipeline/actions';
import { Btn } from './components';
import { Icon } from './icons';
import { ask } from './confirm';

export function Home() {
  const s = useStore();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void A.refreshProjects(); }, []);
  return (
    <div class="home">
      <div class="home-top">
        <div class="logo"><Icon name="leaf" /><span>Phloem</span><span class="sub">studio</span></div>
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
            <p>Phloem là mạch dẫn của cây: mang đúng thứ lá tạo ra tới nơi cần, không biến đổi. Email bạn vẽ ra sao, hộp thư nhận y vậy. Không AI, không dựng lại, không bao giờ tự gửi.</p>
          </div>
          <div class="row"><Btn kind="primary" icon="plus" onClick={() => set({ modal: 'templates' })}>Email mới</Btn></div>
        </div>
        <div>
          <div class="eyebrow" style={{ marginBottom: 12 }}>Project của bạn · {s.projects.length}</div>
          <div class="proj-grid">
            <div class="proj new" onClick={() => set({ modal: 'templates' })}><Icon name="plus" /><b>Email mới</b><span class="small">từ template hoặc trống</span></div>
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
        </div>
        <div class="feature-row">
          <div class="feature"><div class="t"><Icon name="sparkle" />Thiết kế đúng chuẩn email</div><div class="d">Template 600px, block chèn nhanh, brand kit, gợi ý theo luật: CTA trên fold, chữ đủ to, tương phản, preheader.</div></div>
          <div class="feature"><div class="t"><Icon name="bolt" />Cắt lát thông minh</div><div class="d">Mỗi vùng link thành một lát ảnh. Lưới sản phẩm dày, chữ đè ảnh, nền ảnh: đều ra đúng như vẽ, ở mọi hộp thư.</div></div>
          <div class="feature"><div class="t"><Icon name="send" />Draft chứ không gửi</div><div class="d">Tạo hoặc cập nhật đúng bản nháp trong Mailchimp / Klaviyo, hoặc copy HTML dán vào template có brand. Bạn duyệt và bấm gửi.</div></div>
        </div>
      </div>
    </div>
  );
}
