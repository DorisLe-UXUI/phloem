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
import { ask, isArtifact } from './confirm';

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
  useEffect(() => { void A.loadEmailClients(); }, [s.user?.id]);
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

  const [newClient, setNewClient] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const client = s.clients.find((c) => c.id === s.clientFilter) || null;
  const filed = (p: { clientId?: string }) => !!p.clientId && s.clients.some((c) => c.id === p.clientId);
  const countOf = (id: string | null) => s.projects.filter((p) => (id ? p.clientId === id : !filed(p))).length;
  const projects = useMemo(() => {
    const list = s.projects.filter((p) => (!s.clientFilter || (s.clientFilter === '-' ? !p.clientId || !s.clients.some((c) => c.id === p.clientId) : p.clientId === s.clientFilter)) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
    return list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'old' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [s.projects, s.clientFilter, s.clients, q, sort]);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const trend = TEMPLATES.filter((t) => t.blocks.length && t.tag === 'trend');
  const classic = TEMPLATES.filter((t) => t.blocks.length && t.tag !== 'trend');

  return (
    <div class="home">
      <div class="home-top">
        <Logo size={20} onClick={isArtifact() ? undefined : () => { location.href = '../'; }} />
        {!isArtifact() && <a class="btn ghost sm" href="../" title="Về trang giới thiệu"><Icon name="external" /> Trang giới thiệu</a>}
        <span class="grow" />
        {s.user && (s.sync.state === 'off'
          ? <span class="chip" title="Tài khoản trên trình duyệt này. Chạy relay để đồng bộ nhiều máy.">Trên máy này</span>
          : <span class={`chip ${s.sync.state === 'error' ? 'err' : s.sync.state === 'idle' ? 'on' : ''}`} title={s.sync.msg || 'Đồng bộ với relay'} onClick={() => void A.syncNow()} style={{ cursor: 'pointer' }}>{s.sync.state === 'syncing' ? 'Đang đồng bộ…' : s.sync.state === 'error' ? 'Lỗi đồng bộ · thử lại' : `Đồng bộ ✓ ${s.sync.at ? new Date(s.sync.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}`}</span>)}
        {s.user ? (
          <div class="acct" title={s.user.email}>
            <div class="avatar">{(s.user.name || '?').trim().slice(0, 1).toUpperCase()}</div>
            <div class="who"><b>{s.user.name}</b><span>{s.user.brand || s.user.email}</span></div>
            {s.user.admin ? <><Btn kind="ghost" sm icon="grid" onClick={() => set({ route: { name: 'admin' } })} title="Người dùng, project, ảnh, sao lưu trên relay">Database</Btn><Btn kind="ghost" sm icon="sparkle" onClick={() => set({ modal: 'aiadmin' })} title="Duyệt yêu cầu và tạo mã dùng AI">Quản lý AI</Btn></>
              : !s.user.ai && s.sync.state !== 'off' ? <Btn kind="ghost" sm icon="sparkle" onClick={() => set({ modal: 'aicode' })} title="AI cần mã từ quản trị viên">Mở khoá AI</Btn> : null}
            <Btn kind="ghost" sm onClick={() => void A.signOut()}>Đăng xuất</Btn>
          </div>
        ) : (
          <>
            <Btn kind="ghost" sm onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập</Btn>
            <Btn kind="primary" sm icon="leaf" onClick={() => set({ modal: 'auth', authTab: 'register' })}>Đăng ký</Btn>
          </>
        )}
        <span class="sep" />
        <Btn kind="ghost" sm icon="grid" onClick={() => set({ route: { name: 'audience' } })} title="Danh bạ, form đăng ký, chuỗi tự động, báo cáo">Khán giả</Btn>
        <Btn kind="ghost" sm icon="blocks" onClick={() => set({ modal: 'catalog' })} title="Nhập sản phẩm từ Sheet/CSV/Shopify, AI gợi ý nên đẩy gì">Kho hàng{s.catalog.length ? ` · ${s.catalog.length}` : ''}</Btn>
        <Btn kind="ghost" sm icon="figma" onClick={() => set({ modal: 'figma' })}>Import từ Figma</Btn>
        <Btn kind="ghost" sm icon="upload" onClick={() => file.current?.click()}>Mở file .phloem.json</Btn>
        <Btn kind="ghost" sm icon="mail" onClick={() => set({ modal: 'clients' })}>Client</Btn>
        <Btn kind="ghost" sm icon="settings" onClick={() => set({ modal: 'settings' })} title="Cài đặt" />
        <input ref={file} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { try { await A.importProjectJson(f); } catch (err) { toast((err as Error).message, 'err'); } } (e.target as HTMLInputElement).value = ''; }} />
      </div>
      <div class="home-body">
        {s.user?.adminPending && (
          <div class="claim"><Icon name="lock" /><span class="grow">Email này là admin. Bấm <b>Continue with Google</b> một lần (cùng email) để mở <b>Database</b> và <b>Quản lý AI</b>. Google xác minh email để không ai giả mạo được quyền admin.</span><Btn sm kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Xác minh bằng Google</Btn></div>
        )}
        {s.user && s.guestProjects > 0 && (
          <div class="claim"><Icon name="info" /><span class="grow">Có {s.guestProjects} email được tạo khi chưa đăng nhập trên máy này.</span><Btn sm kind="primary" onClick={() => void A.claimGuestProjects()}>Chuyển vào tài khoản</Btn></div>
        )}
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
          <div class="client-bar">
            <span class="eyebrow" style={{ margin: 0 }}>Khách hàng</span>
            <button class={`cl ${!s.clientFilter ? 'on' : ''}`} onClick={() => set({ clientFilter: null })}>Tất cả<i>{s.projects.length}</i></button>
            {s.clients.map((c) => (
              <button key={c.id} class={`cl ${s.clientFilter === c.id ? 'on' : ''}`} onClick={() => set({ clientFilter: c.id })} onDblClick={() => void A.openBoard(c.id)} title="Bấm đúp để mở bảng email của khách này">
                <span class="dot" style={{ background: A.clientColor(c) }} />{c.name}<i>{countOf(c.id)}</i>
              </button>
            ))}
            {s.clients.length > 0 && countOf(null) > 0 && <button class={`cl ${s.clientFilter === '-' ? 'on' : ''}`} onClick={() => set({ clientFilter: '-' })}>Chưa gán<i>{countOf(null)}</i></button>}
            {newClient === null
              ? <button class="cl add" onClick={() => setNewClient('')}><Icon name="plus" size={12} />Khách hàng</button>
              : <input class="cl-input" autoFocus value={newClient} placeholder="Tên khách hàng, Enter để tạo" onInput={(e) => setNewClient((e.target as HTMLInputElement).value)} onBlur={() => { if (!newClient.trim()) setNewClient(null); }} onKeyDown={(e) => { if (e.key === 'Enter' && newClient.trim()) { const n = newClient; setNewClient(null); void A.addClient(n).then(() => toast('Đã tạo khách hàng (dùng chung với Phloem MKT). Email mới tạo lúc này thuộc khách này.', 'ok')).catch((err) => toast((err as Error).message, 'err')); } if (e.key === 'Escape') setNewClient(null); }} />}
          </div>
          {client && (
            <div class="client-head">
              <span class="dot" style={{ background: A.clientColor(client) }} />
              {renaming === client.id
                ? <input class="cl-input" autoFocus defaultValue={client.name} onBlur={(e) => { void A.renameClient(client.id, (e.target as HTMLInputElement).value).catch((err) => toast((err as Error).message, 'err')); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                : <b onClick={() => setRenaming(client.id)} title="Bấm để đổi tên">{client.name}</b>}
              <span class="dim small">{countOf(client.id)} email · mọi email của khách nằm chung một bảng, bấm vào email nào để sửa / gửi / xuất email đó</span>
              <span class="grow" />
              <Btn sm kind="primary" icon="grid" onClick={() => void A.openBoard(client.id)}>Mở bảng email</Btn>
              <Btn sm icon="plus" onClick={() => set({ modal: 'templates' })}>Email mới</Btn>
              <Btn sm icon="sparkle" onClick={() => set({ modal: 'ai' })}>Dựng bằng AI</Btn>
              <Btn sm icon="mail" onClick={() => set({ route: { name: 'audience' } })} title="Danh bạ, form đăng ký, chuỗi tự động của khách này">Khán giả</Btn>
              {!isArtifact() && <a class="btn ghost sm" href={`../mkt/#/c/${encodeURIComponent(client.id)}/overview`} title="Thương hiệu, kế hoạch, thành viên, xoá khách: trong Phloem MKT"><Icon name="external" /> Mở trong MKT</a>}
            </div>
          )}
          <div class="proj-head">
            <div class="eyebrow">{client ? `Email của ${client.name}` : s.clientFilter === '-' ? 'Email chưa gán khách' : 'Project của bạn'} · {projects.length}</div>
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
                  {s.clients.length > 0 ? (
                    <select class="cl-move" style={{ borderLeft: `3px solid ${p.clientId && s.clients.some((c) => c.id === p.clientId) ? A.clientColor(s.clients.find((c) => c.id === p.clientId)) : 'var(--line-2)'}` }} title="Chuyển email sang khách hàng" value={p.clientId && s.clients.some((c) => c.id === p.clientId) ? p.clientId : ''} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); void A.setProjectClient(p.id, (e.target as HTMLSelectElement).value || null); }}>
                      <option value="">Chưa gán khách</option>
                      {s.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  ) : <span class="dt"><Icon name="desktop" size={12} />{fmt(p.updatedAt)}</span>}
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
          <div class="feature"><div class="ic"><Icon name="desktop" /></div><div><div class="t">Thiết kế đúng chuẩn email</div><div class="d">{TEMPLATES.length - 1} mẫu có nội dung thật, 42 block, brand kit với logo riêng, gợi ý theo luật: CTA trên fold, chữ đủ to, tương phản.</div></div><button class="go" onClick={() => set({ modal: 'templates' })}><Icon name="chevron" size={14} /></button></div>
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
