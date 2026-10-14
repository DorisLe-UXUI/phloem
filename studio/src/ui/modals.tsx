// All modals: templates, brand kit, preview, clients, settings, shortcuts, Figma import.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Profile, Provider, TemplateKind } from '../../../src/shared/types';
import { DEFAULT_UTM, newProfile } from '../../../src/shared/types';
import type { Brand } from '../model/types';
import { BRAND_PRESETS, DEFAULT_BRAND, FONTS, FONT_CAT_LABEL, VIBES } from '../model/types';
import { makeTemplate, TEMPLATES, templateBrand } from '../model/templates';
import { thumbnail } from '../render/renderer';
import { ensureFonts } from '../render/fonts';
import { assets } from '../storage/assets';
import { lightVersionOf } from '../ai/site';
import { db } from '../storage/idb';
import { get, set, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { cache, checkRelay, connectOAuth, loadSections, previewHtml, providerName, removeProfile, saveProfile, testConnection } from '../pipeline/exportFlow';
import { importFromFigma } from '../io/figmaImport';
import { Btn, Eyebrow, Field, Kbd, Modal, Num, Seg, Select, TextArea, TextInput, Toggle, useLocal } from './components';
import { Icon } from './icons';
import { ask, isArtifact } from './confirm';
import { AiModal } from './AiModal';
import { AI_MODELS } from '../ai/client';
import * as auth from '../auth/core';
import { GoogleButton } from './GoogleButton';
import { CatalogModal } from './CatalogModal';

export function Modals() {
  const s = useStore();
  const close = () => set({ modal: null });
  switch (s.modal) {
    case 'templates': return <TemplatesModal onClose={close} />;
    case 'brand': return <BrandModal onClose={close} />;
    case 'preview': return <PreviewModal onClose={close} />;
    case 'clients': return <ClientsModal onClose={close} />;
    case 'settings': return <SettingsModal onClose={close} />;
    case 'shortcuts': return <ShortcutsModal onClose={close} />;
    case 'figma': return <FigmaModal onClose={close} />;
    case 'ai': return <AiModal onClose={close} />;
    case 'auth': return <AuthModal onClose={close} />;
    case 'catalog': return <CatalogModal onClose={close} />;
    default: return null;
  }
}

// ---------------- Templates ----------------
const tplThumbCache = new Map<string, string>();

function TemplatesModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<TemplateKind>('newsletter');
  const [presetName, setPresetName] = useState<string>(TEMPLATES[0].preset || 'Forest');
  const [touched, setTouched] = useState(false);
  const [name, setName] = useState('');
  const brand: Brand = useMemo(() => ({ ...DEFAULT_BRAND, ...(BRAND_PRESETS.find((p) => p.name === presetName)?.brand || {}) }), [presetName]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      ensureFonts(TEMPLATES.map((t) => t.brand?.headingFamily || 'Inter'));
      await document.fonts.ready;
      const out: Record<string, string> = {};
      for (const t of TEMPLATES) {
        if (!t.blocks.length) continue;
        const key = `${presetName}:${t.kind}`;
        if (!tplThumbCache.has(key)) { try { const tb = { ...brand, ...(t.brand || {}) }; tplThumbCache.set(key, thumbnail(makeTemplate(t.kind, tb).doc, tb, assets, 300)); } catch { /* ignore */ } }
        out[t.kind] = tplThumbCache.get(key) || '';
        if (!alive) return;
        setThumbs({ ...out });
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => { alive = false; };
  }, [presetName]);
  const pick = (k: TemplateKind) => { setKind(k); const t = TEMPLATES.find((x) => x.kind === k); if (!touched && t?.preset) setPresetName(t.preset); };
  const create = async () => { onClose(); await A.newProject(kind, brand, name.trim() || undefined); };
  return (
    <Modal title="Email mới" icon="sparkle" onClose={onClose} wide footer={<><span class="grow small muted">Template chỉ là điểm bắt đầu: mọi block, chữ, ảnh đều sửa được.</span><Btn kind="ghost" icon="sparkle" onClick={() => set({ modal: 'ai' })}>Hoặc để AI dựng từ nội dung</Btn><Btn kind="primary" icon="plus" onClick={create}>Tạo email</Btn></>}>
      <div class="row">
        <div class="grow"><Field label="Tên project" hint="tuỳ chọn"><TextInput value={name} onCommit={setName} onInput={setName} placeholder={TEMPLATES.find((t) => t.kind === kind)?.name} /></Field></div>
      </div>
      <Eyebrow action={touched ? { label: 'Theo mẫu', onClick: () => { setTouched(false); const t = TEMPLATES.find((x) => x.kind === kind); if (t?.preset) setPresetName(t.preset); } } : undefined}>Bảng màu · áp cho cả email</Eyebrow>
      <div class="presets">{BRAND_PRESETS.map((p) => <button key={p.name} class={`preset ${p.name === presetName ? 'on' : ''}`} onClick={() => { setPresetName(p.name); setTouched(true); }}><i style={{ background: p.brand.primary, borderColor: p.brand.bg }} />{p.name}</button>)}</div>
      <Eyebrow>Template · {TEMPLATES.length} · <span class="chip on" style={{ fontSize: 10 }}>trend</span> là mẫu theo xu hướng 2026</Eyebrow>
      <div class="tpl-grid">
        {TEMPLATES.map((t) => (
          <div key={t.kind} class={`tpl ${kind === t.kind ? 'on' : ''}`} onClick={() => pick(t.kind)} onDblClick={create}>
            <div class={`pv ${t.blocks.length ? '' : 'blank'}`}>{t.blocks.length ? (thumbs[t.kind] ? <img src={thumbs[t.kind]} alt="" /> : <div class="pv-skel" />) : '600 × trống'}</div>
            <div class="meta"><div class="row"><div class="nm grow">{t.name}</div>{t.tag && <span class="chip on" style={{ fontSize: 9.5 }}>{t.tag}</span>}</div><div class="ds">{t.desc}</div></div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------- Brand ----------------
function BrandModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const b = s.project!.brand;
  const up = (patch: Partial<Brand>) => A.applyBrand(patch);
  const fontOpts = FONTS.map((f) => ({ v: f.family, label: `${f.label} · ${FONT_CAT_LABEL[f.cat]}${f.vi ? '' : ' · không có tiếng Việt'}` }));
  const tokens: { k: keyof Brand; label: string; hint: string }[] = [
    { k: 'primary', label: 'Primary', hint: 'nút, link nổi bật' }, { k: 'accent', label: 'Accent', hint: 'đầu kia của gradient, điểm nhấn' }, { k: 'onPrimary', label: 'Chữ trên primary', hint: 'chữ trong nút' }, { k: 'ink', label: 'Chữ chính', hint: 'tiêu đề, đoạn' }, { k: 'muted', label: 'Chữ phụ', hint: 'mô tả, footer' },
    { k: 'bg', label: 'Nền', hint: 'nền email' }, { k: 'soft', label: 'Nền phụ', hint: 'footer, khối nhấn' }, { k: 'line', label: 'Đường kẻ', hint: 'divider, viền' },
  ];
  return (
    <Modal title="Brand kit" icon="palette" onClose={onClose} footer={<Btn kind="primary" onClick={onClose}>Xong</Btn>}>
      <div class="small muted">Mọi layer dùng token sẽ đổi theo ngay. Layer đặt màu tay giữ nguyên.</div>
      <Eyebrow>Preset</Eyebrow>
      <div class="presets">{BRAND_PRESETS.map((p) => <button key={p.name} class="preset" onClick={() => up(p.brand)}><i style={{ background: p.brand.primary, borderColor: p.brand.bg }} />{p.name}</button>)}</div>
      <Eyebrow>Màu</Eyebrow>
      <div class="grid2">
        {tokens.map((t) => (
          <Field key={t.k} label={t.label} hint={t.hint}>
            <div class="row"><input type="color" class="in" style={{ width: 40, padding: 2 }} value={b[t.k] as string} onInput={(e) => up({ [t.k]: (e.target as HTMLInputElement).value })} /><input class="in mono" value={(b[t.k] as string).toUpperCase()} onChange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) up({ [t.k]: v.startsWith('#') ? v : `#${v}` }); }} /></div>
          </Field>
        ))}
      </div>
      <Eyebrow>Phong cách</Eyebrow>
      <Field label="Vibe" hint="áp cho block thêm mới và mẫu AI">
        <Select value={b.vibe || 'clean'} options={VIBES.map((v) => ({ v: v.v, label: `${v.label} — ${v.hint}` }))} onChange={(v) => up({ vibe: v as Brand['vibe'] })} />
      </Field>
      <Eyebrow>Gradient</Eyebrow>
      <Toggle checked={!!b.gradient} onChange={(v) => up({ gradient: v ? { angle: b.gradient?.angle ?? 135 } : null })} label="Dải màu dùng gradient primary → accent" sub="Áp cho mọi dải nền màu primary: hero band, dark band, CTA to. Tắt là về màu phẳng." />
      {b.gradient && <div class="grid2"><Num label="Góc" value={b.gradient.angle} min={0} max={360} suffix="°" onChange={(v) => up({ gradient: { angle: Math.round(v) } })} /><div class="small muted" style={{ alignSelf: 'end' }}>135° = chéo, 90° = dọc, 0° = ngang</div></div>}
      <Eyebrow>Logo & tên</Eyebrow>
      <div class="row" style={{ alignItems: 'stretch' }}>
        <div style={{ width: 120, height: 64, borderRadius: 8, border: '1px solid var(--line-2)', background: 'repeating-conic-gradient(#1a2a1e 0 25%, #0c120e 0 50%) 0 0 / 14px 14px', display: 'grid', placeItems: 'center', flex: 'none', overflow: 'hidden' }}>
          {b.logoAssetId && assets.url(b.logoAssetId) ? <img src={assets.url(b.logoAssetId)} alt="" style={{ maxWidth: '90%', maxHeight: '80%', objectFit: 'contain' }} /> : <span class="dim small">chưa có logo</span>}
        </div>
        <div class="col grow">
          <Field label="Tên thương hiệu" hint="dùng khi chưa có logo"><TextInput value={b.name} onCommit={(v) => up({ name: v.trim() || 'BRAND' })} /></Field>
          <div class="row">
            <Btn sm icon="upload" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/svg+xml,image/jpeg,image/webp'; i.onchange = async () => { const f = i.files?.[0]; if (!f) return; try { const a = await assets.add(f); const light = await lightVersionOf(f); const l = light ? await assets.add(light, 'logo-light.png') : null; up({ logoAssetId: a.id, logoLightAssetId: l ? l.id : null }); toast(l ? 'Đã thay logo; bản trắng sẽ dùng trên dải tối.' : 'Đã thay logo trong nav và footer.', 'ok'); } catch { toast('Không đọc được ảnh logo.', 'err'); } }; i.click(); }}>Tải logo</Btn>
            {b.logoAssetId && <Btn sm kind="ghost" onClick={() => up({ logoAssetId: null, logoLightAssetId: null })}>Dùng chữ</Btn>}
            <span class="dim small">PNG nền trong suốt, cao ≥ 120px. Logo thay vào mọi block nav/footer.</span>
          </div>
        </div>
      </div>
      <Eyebrow>Chữ</Eyebrow>
      <div class="grid2">
        <Field label="Font nội dung"><Select value={b.fontFamily} options={fontOpts} onChange={(v) => { ensureFonts([v]); up({ fontFamily: v }); }} /></Field>
        <Field label="Font tiêu đề"><Select value={b.headingFamily} options={fontOpts} onChange={(v) => { ensureFonts([v]); up({ headingFamily: v }); }} /></Field>
      </div>
      <div class="dim small">Chữ trong email là ảnh, nên dùng font nào cũng hiển thị đúng ở mọi hộp thư. {FONTS.length} font Google tải tự động; font ghi "không có tiếng Việt" sẽ thiếu dấu.</div>
    </Modal>
  );
}

// ---------------- Preview ----------------
function PreviewModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [imagesOff, setImagesOff] = useState(false);
  const [dark, setDark] = useState(false);
  const revoke = useRef<() => void>(() => undefined);
  useEffect(() => {
    let alive = true;
    previewHtml(s.project!).then((r) => { if (!alive) { r.revoke(); return; } revoke.current = r.revoke; setHtml(r.html); }).catch((e) => setErr((e as Error).message));
    return () => { alive = false; revoke.current(); };
  }, []);
  const shown = useMemo(() => {
    if (!html) return '';
    let h = html;
    if (imagesOff) h = h.replace(/<img ([^>]*?)src="[^"]*"/g, '<img $1 style="display:block;border:1px dashed #bbb;background:#f4f4f4;color:#333;font:12px/1.4 Arial;padding:6px;box-sizing:border-box"');
    return h;
  }, [html, imagesOff]);
  return (
    <Modal title="Xem trước như trong hộp thư" icon="play" onClose={onClose} wide footer={<><span class="grow small muted">Đây là HTML thật sẽ gửi đi, ảnh render tại chỗ. Mailchimp/Klaviyo chỉ thêm header/footer template (nếu có).</span><Btn kind="ghost" onClick={onClose}>Đóng</Btn><Btn kind="primary" icon="send" onClick={() => { onClose(); set({ rightTab: 'export' }); }}>Tới bước xuất</Btn></>}>
      <div class="row">
        <Seg value={device} options={[{ v: 'desktop', icon: 'desktop', label: 'Desktop' }, { v: 'mobile', icon: 'mobile', label: 'iPhone' }]} onChange={setDevice} />
        <Toggle checked={imagesOff} onChange={setImagesOff} label="Chặn ảnh (chỉ alt)" />
        <Toggle checked={dark} onChange={setDark} label="Nền tối" />
        <span class="grow" />
        {html && <span class="chip">{(new Blob([html]).size / 1024).toFixed(1)} KB HTML</span>}
      </div>
      {err && <div class="check error"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
      <div class={`preview-frame ${dark ? 'dark' : ''}`}>
        {html ? <iframe title="preview" srcDoc={shown} style={{ width: device === 'mobile' ? 390 : 700, height: 640 }} sandbox="allow-same-origin" /> : <div class="row" style={{ padding: 40 }}><Icon name="bolt" style={{ color: 'var(--neon)' }} /><span>Đang render lát ảnh…</span></div>}
      </div>
    </Modal>
  );
}

// ---------------- Clients ----------------
function ClientsModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [editing, setEditing] = useState<Profile | null>(null);
  const [isNew, setIsNew] = useState(false);
  useEffect(() => { void checkRelay(); }, []);
  const start = (p: Profile, n: boolean) => { setEditing(JSON.parse(JSON.stringify(p))); setIsNew(n); };
  if (editing) return <ProfileForm p={editing} isNew={isNew} onBack={() => setEditing(null)} onClose={onClose} onChange={(p) => setEditing({ ...p })} />;
  return (
    <Modal title="Client / tài khoản" icon="mail" onClose={onClose} footer={<><span class="grow small muted">Một client = một tài khoản Mailchimp hoặc Klaviyo kèm audience, UTM, footer mặc định.</span><Btn kind="primary" icon="plus" onClick={() => start(newProfile('klaviyo', ''), true)}>Thêm client</Btn></>}>
      {s.profiles.length ? s.profiles.map((p) => (
        <div key={p.id} class={`profile ${s.settings.activeProfileId === p.id ? 'on' : ''}`}>
          <div class="row"><span class={`badge ${p.provider}`}>{providerName(p.provider)}</span><b class="grow">{p.name}</b><span class="mono dim small">{p.auth.type === 'oauth' ? 'OAuth' : 'API key'}</span></div>
          <div class="small muted">{[p.accountLabel, p.audienceName ? `Audience: ${p.audienceName}` : 'Chưa chọn audience', p.imageFormat === 'JPG' ? `JPG ${p.jpgQuality}` : 'PNG', `${p.scale}x`].filter(Boolean).join(' · ')}</div>
          {Object.keys(p.permissions).length ? <div class="perm">{Object.entries(p.permissions).map(([k, v]) => <span key={k} class={`chip ${v ? 'on' : 'err'}`}>{v ? '✓' : '✕'} {k}</span>)}</div> : null}
          <div class="row">
            {s.settings.activeProfileId !== p.id ? <Btn sm onClick={() => set({ settings: { ...s.settings, activeProfileId: p.id } })}>Dùng client này</Btn> : <span class="chip on">đang dùng</span>}
            <span class="grow" />
            <Btn sm kind="ghost" onClick={() => start(p, false)}>Sửa</Btn>
            <Btn sm kind="ghost" class="danger" onClick={async () => { if (await ask(`Xoá client "${p.name}"? Draft đã tạo vẫn còn trong ${providerName(p.provider)}.`)) removeProfile(p.id); }}>Xoá</Btn>
          </div>
        </div>
      )) : <div class="empty"><div class="big">Chưa có client nào</div><div>Freelancer nhiều client thì thêm nhiều. API key chỉ lưu trong trình duyệt này.</div><Btn kind="primary" onClick={() => start(newProfile('klaviyo', ''), true)}>Thêm client đầu tiên</Btn></div>}
    </Modal>
  );
}

function ProfileForm({ p, isNew, onBack, onClose, onChange }: { p: Profile; isNew: boolean; onBack: () => void; onClose: () => void; onChange: (p: Profile) => void }) {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const connected = !!p.accountLabel;
  const lists = cache.lists[p.id] || [];
  const tpls = cache.templates[p.id] || [];
  const canOauth = !!cache.relay?.oauth?.[p.provider];
  const mut = (fn: (p: Profile) => void) => { fn(p); onChange(p); };
  const setKey = (v: string) => mut((x) => { x.auth = { type: 'apikey', apiKey: v.trim(), dc: x.provider === 'mailchimp' ? v.trim().split('-').pop() : undefined }; x.accountLabel = ''; x.permissions = {}; });
  const test = async () => { setBusy(true); try { await testConnection(p); onChange(p); toast(`Kết nối OK: ${p.accountLabel}`, 'ok'); } catch (e) { p.accountLabel = ''; onChange(p); toast((e as Error).message, 'err'); } finally { setBusy(false); } };
  const oauth = async () => { setBusy(true); try { await connectOAuth(p, (np) => { onChange(np); toast(`Đã đăng nhập: ${np.accountLabel}`, 'ok'); }); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); } };
  const save = () => { if (!p.name.trim()) p.name = p.accountLabel || providerName(p.provider); saveProfile(p); toast(`Đã lưu client "${p.name}".`, 'ok'); onBack(); };
  return (
    <Modal title={isNew ? 'Thêm client' : `Sửa “${p.name}”`} icon="mail" onClose={onClose} footer={<><Btn kind="ghost" onClick={onBack}>← Danh sách</Btn><span class="grow" /><Btn kind="primary" onClick={save}>{isNew ? 'Lưu client' : 'Lưu thay đổi'}</Btn></>}>
      <div class="grid2">
        <Field label="Tên client" hint="để bạn nhận ra"><TextInput value={p.name} onCommit={(v) => mut((x) => { x.name = v; })} /></Field>
        <Field label="Nền tảng"><Seg block value={p.provider} options={[{ v: 'klaviyo', label: 'Klaviyo' }, { v: 'mailchimp', label: 'Mailchimp' }]} onChange={(v: Provider) => mut((x) => { x.provider = v; x.auth = { type: 'apikey', apiKey: '' }; x.accountLabel = ''; x.permissions = {}; x.audienceId = ''; x.audienceName = ''; })} /></Field>
      </div>
      <Eyebrow>Kết nối</Eyebrow>
      {p.auth.type === 'oauth' ? (
        <div class="row"><span class="chip on grow">OAuth · {p.auth.accountName || p.accountLabel || 'đã đăng nhập'}</span><Btn sm kind="ghost" onClick={() => mut((x) => { x.auth = { type: 'apikey', apiKey: '' }; x.accountLabel = ''; })}>Ngắt</Btn></div>
      ) : (
        <>
          <Field label={p.provider === 'mailchimp' ? 'API key Mailchimp' : 'Private API key Klaviyo'} hint={p.provider === 'mailchimp' ? 'Account → Extras → API keys · dạng xxxx-us21' : 'Settings → API keys → Create private key · pk_…'}>
            <div class="row"><TextInput type="password" mono value={p.auth.apiKey} onInput={setKey} onCommit={setKey} placeholder={p.provider === 'mailchimp' ? 'xxxxxxxx-us21' : 'pk_xxxxxxxx'} /><Btn disabled={busy || !p.auth.apiKey} onClick={test}>{busy ? '…' : 'Kiểm tra'}</Btn></div>
          </Field>
          <div class="row small muted"><span class="grow">{canOauth ? 'Hoặc đăng nhập để dùng đúng quyền đã được cấp. Nhiều tài khoản: mỗi lần đăng nhập chọn một.' : `Đăng nhập ${providerName(p.provider)} (OAuth) cần relay có CLIENT_ID. Xem server/.env.example.`}</span><Btn sm disabled={!canOauth || busy} onClick={oauth}>Đăng nhập {providerName(p.provider)}</Btn></div>
        </>
      )}
      {connected && <div class="check ok"><span class="lv">OK</span><span class="m">Đã kết nối: {p.accountLabel}</span></div>}
      {Object.keys(p.permissions).length ? <div class="perm">{Object.entries(p.permissions).map(([k, v]) => <span key={k} class={`chip ${v ? 'on' : 'err'}`} title={v ? 'Được phép' : 'Tài khoản không có quyền này'}>{v ? '✓' : '✕'} {k}</span>)}</div> : null}
      <Eyebrow>Mặc định cho client này</Eyebrow>
      <Field label="Audience / List" hint="draft gửi tới">
        {lists.length ? <select class="in" value={p.audienceId} onChange={(e) => { const id = (e.target as HTMLSelectElement).value; mut((x) => { x.audienceId = id; x.audienceName = lists.find((l) => l.id === id)?.name || ''; }); }}><option value="">— chọn —</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          : <TextInput value={p.audienceId} mono placeholder={connected ? 'Không tải được list — nhập ID' : 'Kiểm tra kết nối để tải danh sách'} onCommit={(v) => mut((x) => { x.audienceId = v.trim(); })} />}
      </Field>
      <div class="grid2">
        <Field label="From name"><TextInput value={p.fromName} onCommit={(v) => mut((x) => { x.fromName = v; })} /></Field>
        {p.provider === 'klaviyo' ? <Field label="From email" hint="sender đã xác minh"><TextInput value={p.fromEmail} onCommit={(v) => mut((x) => { x.fromEmail = v; })} /></Field> : <Field label="Reply-to" hint="bắt buộc"><TextInput value={p.replyTo} onCommit={(v) => mut((x) => { x.replyTo = v; })} /></Field>}
      </div>
      {p.provider === 'mailchimp' && (
        <div class="grid2">
          <Field label="Template có brand" hint="tuỳ chọn">
            {tpls.length ? <select class="in" value={p.templateId} onChange={async (e) => { mut((x) => { x.templateId = (e.target as HTMLSelectElement).value; }); if (p.templateId) { await loadSections(p); onChange(p); } }}><option value="">— không, dùng HTML đầy đủ —</option>{tpls.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}</select>
              : <TextInput value={p.templateId} mono placeholder="Template ID (hoặc để trống)" onCommit={(v) => mut((x) => { x.templateId = v.trim(); })} />}
          </Field>
          <Field label="Section mc:edit" hint="nơi chèn nội dung">
            {(cache.sections[p.id] || []).length ? <select class="in" value={p.templateSection} onChange={(e) => mut((x) => { x.templateSection = (e.target as HTMLSelectElement).value; })}>{cache.sections[p.id].map((sec) => <option key={sec} value={sec}>{sec}</option>)}</select>
              : <TextInput value={p.templateSection} mono placeholder="body" onCommit={(v) => mut((x) => { x.templateSection = v.trim() || 'body'; })} />}
          </Field>
        </div>
      )}
      <Field label="Mẫu UTM" hint="{provider} {campaign} {frame} {slice} {date} {host}"><TextInput value={p.utmTemplate} mono placeholder={DEFAULT_UTM} onCommit={(v) => mut((x) => { x.utmTemplate = v.trim(); })} /></Field>
      <Field label="Footer HTML riêng" hint="thêm dưới email; để trống nếu template đã có"><TextArea mono value={p.footerHtml} placeholder='<p>Công ty ABC · 123 Lê Lợi · <a href="*|UNSUB|*">Huỷ đăng ký</a></p>' onCommit={(v) => mut((x) => { x.footerHtml = v; })} /></Field>
      <div class="grid3">
        <Field label="Định dạng ảnh" hint={p.imageFormat === 'JPG' ? 'ảnh → JPG, lát phẳng/chữ vẫn PNG nếu nhỏ hơn' : 'mọi lát PNG (nặng hơn 3–5 lần với ảnh)'}><Seg block value={p.imageFormat} options={[{ v: 'JPG', label: 'JPG thông minh' }, { v: 'PNG', label: 'PNG' }]} onChange={(v) => mut((x) => { x.imageFormat = v; })} /></Field>
        <Field label="Độ phân giải"><Seg block value={p.scale} options={[{ v: 1, label: '1x' }, { v: 2, label: '2x' }]} onChange={(v) => mut((x) => { x.scale = v as 1 | 2; })} /></Field>
        <Field label="JPG quality"><Num value={p.jpgQuality} min={40} max={100} onChange={(v) => mut((x) => { x.jpgQuality = Math.round(v); })} /></Field>
      </div>
      {!s.settings.relayUrl && <div class="check warn"><span class="lv">CHÚ Ý</span><span class="m">Chưa có Relay URL trong Cài đặt. Trình duyệt sẽ chặn gọi thẳng Mailchimp/Klaviyo (CORS).</span></div>}
    </Modal>
  );
}

// ---------------- Settings ----------------
function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const st = s.settings;
  const up = (patch: Partial<typeof st>) => set({ settings: { ...get().settings, ...patch } });
  useEffect(() => { void checkRelay(); }, []);
  const [, bump] = useState(0);
  return (
    <Modal title="Cài đặt" icon="settings" onClose={onClose} footer={<Btn kind="primary" onClick={onClose}>Xong</Btn>}>
      <Eyebrow>Relay</Eyebrow>
      <div class="small muted">Mailchimp và Klaviyo không cho trình duyệt gọi thẳng (CORS), nên Studio đi qua một relay nhỏ của bạn: <Kbd k="npm run relay" /> hoặc deploy thư mục <Kbd k="server/" />. Relay không lưu key.</div>
      <div class="row"><TextInput value={st.relayUrl} mono placeholder="http://localhost:8787" onCommit={(v) => { up({ relayUrl: v.trim() }); void checkRelay(); }} /><Btn onClick={() => checkRelay(true)}>Kiểm tra</Btn></div>
      <Field label="Relay token" hint="nếu relay đặt RELAY_TOKEN"><TextInput type="password" mono value={st.relayToken} onCommit={(v) => up({ relayToken: v })} /></Field>
      {cache.relay ? <div class="row wrap"><span class="chip on">✓ relay ok</span><span class={`chip ${cache.relay.oauth.mailchimp ? 'on' : ''}`}>OAuth Mailchimp {cache.relay.oauth.mailchimp ? 'bật' : 'tắt'}</span><span class={`chip ${cache.relay.oauth.klaviyo ? 'on' : ''}`}>OAuth Klaviyo {cache.relay.oauth.klaviyo ? 'bật' : 'tắt'}</span>{cache.relay.klaviyoRevision && <span class="chip">rev {cache.relay.klaviyoRevision}</span>}</div> : cache.relayError ? <div class="check error"><span class="lv">LỖI</span><span class="m">{cache.relayError}</span></div> : null}
      <Eyebrow>AI</Eyebrow>
      <div class="small muted">Trợ lý và "Dựng 3 phương án" gọi Claude. Ba cách, ưu tiên theo thứ tự: API key của bạn (lưu trong trình duyệt này), relay có <Kbd k="ANTHROPIC_API_KEY" />, hoặc Claude của claude.ai khi mở bản artifact.</div>
      <div class="grid2">
        <Field label="API key Anthropic" hint="sk-ant-… · console.anthropic.com"><TextInput type="password" mono value={st.anthropicKey} placeholder="sk-ant-api03-…" onCommit={(v) => up({ anthropicKey: v.trim() })} /></Field>
        <Field label="Model"><Select value={st.aiModel || 'claude-opus-5-5'} options={AI_MODELS} onChange={(v) => up({ aiModel: v })} /></Field>
      </div>
      <Eyebrow>Cắt lát</Eyebrow>
      <Field label="Chiều cao lát tối đa (px)" hint="Outlook cắt ảnh >1728"><Num value={st.maxSliceHeight} min={300} max={1728} onChange={(v) => up({ maxSliceHeight: Math.round(v) })} /></Field>
      <Toggle checked={st.mergeRows} onChange={(v) => up({ mergeRows: v })} label="Gộp các hàng không link thành một lát" sub="Ít ảnh hơn, email nhẹ hơn" />
      <Eyebrow>Trình soạn</Eyebrow>
      <Toggle checked={st.autosave} onChange={(v) => up({ autosave: v })} label="Tự lưu" sub="Lưu vào trình duyệt sau mỗi thay đổi (⌘S để lưu tay)" />
      <Toggle checked={st.snap} onChange={(v) => up({ snap: v })} label="Bắt dính cạnh / tâm" />
      <Toggle checked={st.grid} onChange={(v) => up({ grid: v })} label="Hiện lưới 24px" />
      <Eyebrow>Dữ liệu</Eyebrow>
      <div class="row"><Btn sm icon="download" disabled={!s.project} onClick={() => A.exportProjectJson()}>Tải project (.phloem.json)</Btn><Btn sm kind="ghost" class="danger" onClick={async () => { if (!(await ask('Xoá toàn bộ ảnh trong thư viện không còn dùng? Project giữ nguyên.', 'Dọn'))) return; const used = new Set<string>(); for (const m of get().projects) { const p = await db.getProject(m.id); if (!p) continue; for (const d of [p.desktop, p.mobile]) if (d) JSON.stringify(d).replace(/"assetId":"([^"]+)"/g, (_m, id) => { used.add(id); return ''; }); } let n = 0; for (const a of assets.all()) if (!used.has(a.id)) { await assets.remove(a.id); n++; } toast(`Đã xoá ${n} ảnh không dùng.`, 'ok'); bump((x) => x + 1); }}>Dọn ảnh không dùng</Btn></div>
      <div class="dim small mono">Phloem Studio · phloem = mạch dẫn của cây: mang đúng thứ lá tạo ra tới nơi cần, không biến đổi.</div>
    </Modal>
  );
}

// ---------------- Shortcuts ----------------
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string[]][] = [
    ['Chọn / Hình / Chữ / Ảnh / Tay', ['V', 'R', 'T', 'I', 'H']], ['Kéo canvas', ['Space', 'drag']], ['Zoom', ['⌘', 'scroll']], ['Vừa màn hình · 100%', ['⌘1', '⌘0']],
    ['Hoàn tác · Làm lại', ['⌘Z', '⇧⌘Z']], ['Lưu', ['⌘S']], ['Nhân bản', ['⌘D']], ['Copy · Cut · Paste', ['⌘C', '⌘X', '⌘V']],
    ['Nhóm · Bỏ nhóm', ['⌘G', '⇧⌘G']], ['Lên · Xuống một lớp', ['⌘]', '⌘[']], ['Lên trên cùng · dưới cùng', ['⌥⌘]', '⌥⌘[']], ['Khoá · Ẩn', ['⇧⌘L', '⇧⌘H']],
    ['Dịch 1px · 10px', ['←↑→↓', '⇧+']], ['Chọn tất cả', ['⌘A']], ['Xoá', ['⌫']], ['Vào nhóm · sửa chữ', ['dbl-click', 'Enter']],
    ['Chọn xuyên nhóm', ['⌘', 'click']], ['Thêm vào vùng chọn', ['⇧', 'click']], ['Giữ tỉ lệ khi resize', ['⇧', 'drag']], ['Tắt bắt dính tạm', ['⌥', 'drag']],
    ['Thoát / bỏ chọn', ['Esc']], ['Tới bước xuất', ['⌘↵']], ['Bảng này', ['?']],
  ];
  return (
    <Modal title="Phím tắt" icon="keyboard" onClose={onClose}>
      <div class="shortcuts">{rows.map(([l, ks]) => <div key={l}><span>{l}</span><span class="ks">{ks.map((k) => <Kbd key={k} k={k} />)}</span></div>)}</div>
    </Modal>
  );
}

// ---------------- Figma import ----------------
function FigmaModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useLocal('phloem.figma.token', '');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const run = async () => {
    setBusy(true); setLogs([]);
    try {
      const p = await importFromFigma(url, token, (m) => setLogs((l) => [...l, m]));
      await db.putProject({ ...p, owner: get().user?.id || '' });
      await A.refreshProjects();
      onClose();
      await A.openProject(p.id);
      toast(`Đã import "${p.name}" (${p.desktop.nodes.length} layer). Kiểm tra lại link/alt.`, 'ok');
    } catch (e) { setLogs((l) => [...l, `Lỗi: ${(e as Error).message}`]); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Import từ Figma" icon="figma" onClose={onClose} footer={<><span class="grow small muted">Chữ, hình chữ nhật, frame màu phẳng thành layer sửa được. Ảnh, vector, hiệu ứng được render thành ảnh.</span><Btn kind="primary" disabled={busy || !token || !url} onClick={run}>{busy ? 'Đang import…' : 'Import'}</Btn></>}>
      <Field label="Personal access token" hint="Figma → Settings → Security → Personal access tokens"><TextInput type="password" mono value={token} onCommit={setToken} onInput={setToken} placeholder="figd_…" /></Field>
      <div class="check info"><span class="lv">QUYỀN</span><span class="m">Khi tạo token, tick <b>File content: Read</b> (bắt buộc) và <b>Dev resources: Read</b> (tuỳ chọn). Token thiếu quyền này sẽ bị Figma trả lỗi 403 "Invalid scope".</span></div>
      <Field label="Link frame" hint="chọn frame email trong Figma → Copy link (có node-id)"><TextInput mono value={url} onCommit={setUrl} onInput={setUrl} placeholder="https://www.figma.com/design/XXXX/Email?node-id=12-34" /></Field>
      <div class="small muted">Token chỉ lưu trong trình duyệt này và gửi thẳng tới api.figma.com. Ảnh render của Figma nằm trên S3 không có CORS, nên cần Relay URL trong Cài đặt để tải về.</div>
      {logs.length > 0 && <div class="log">{logs.map((l, i) => <div key={i} class={l.startsWith('Lỗi') ? 'er' : ''}>{l}</div>)}</div>}
    </Modal>
  );
}


// ---------------- Account ----------------
export function AuthModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<'login' | 'register'>(s.authTab);
  const [f, setF] = useState({ name: '', email: '', password: '', brand: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'local' | 'relay' | 'checking'>('checking');
  useEffect(() => { void auth.detectMode(A.authOpts()).then(setMode); }, [s.settings.relayUrl]);
  const up = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setErr(''); setBusy(true);
    try { if (tab === 'register') await A.signUp(f); else await A.signIn(f); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const reg = tab === 'register';
  return (
    <Modal narrow icon="leaf" title={reg ? 'Tạo tài khoản' : 'Đăng nhập'} onClose={onClose}
      footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" disabled={busy} onClick={submit}>{busy ? 'Đang xử lý…' : reg ? 'Tạo tài khoản' : 'Đăng nhập'}</Btn></>}>
      <div class="seg authtabs">
        <button type="button" class={reg ? 'on' : ''} onClick={() => { setTab('register'); setErr(''); }}>Đăng ký</button>
        <button type="button" class={!reg ? 'on' : ''} onClick={() => { setTab('login'); setErr(''); }}>Đăng nhập</button>
      </div>
      <GoogleButton opts={A.authOpts()} onDone={() => { void A.afterExternalSignIn(); onClose(); }} onError={setErr} />
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} class="props" style={{ gap: 10 }}>
        {reg && <Field label="Tên"><TextInput value={f.name} onInput={up('name')} onCommit={up('name')} placeholder="Tên của bạn" /></Field>}
        <Field label="Email"><TextInput type="email" value={f.email} onInput={up('email')} onCommit={up('email')} placeholder="ban@congty.com" /></Field>
        <Field label="Mật khẩu" hint="≥ 8 ký tự"><TextInput type="password" value={f.password} onInput={up('password')} onCommit={up('password')} placeholder="••••••••" /></Field>
        {reg && <Field label="Tên thương hiệu" hint="tuỳ chọn, điền sẵn vào email mới"><TextInput value={f.brand} onInput={up('brand')} onCommit={up('brand')} placeholder="TERRA" /></Field>}
        <button type="submit" style={{ display: 'none' }} />
      </form>
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
      <div class="dim small">
        {mode === 'checking' ? 'Đang kiểm tra relay…'
          : mode === 'relay' ? 'Tài khoản tạo trên relay của bạn: đăng nhập được từ mọi máy.'
          : 'Chưa có relay: tài khoản lưu trong trình duyệt này. Chạy relay (npm run relay) và đặt Relay URL trong Cài đặt để dùng chung nhiều máy.'}
      </div>
    </Modal>
  );
}
