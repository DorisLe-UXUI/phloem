// Phloem UI. Runs in the plugin iframe: renders state, talks to the sandbox via bridge, talks to providers via relay.
import type { BlockKind, Check, DraftFile, DraftRecord, ExportedSlice, FrameSummary, Profile, Provider, Settings, Slice, SlicePlan, Suggestion, TemplateKind, ToUI } from '../shared/types';
import { DEFAULT_UTM, newProfile } from '../shared/types';
import { buildEmailHtml, htmlSizeBytes } from '../shared/html';
import { GMAIL_CLIP_BYTES, WEIGHT_ERROR, WEIGHT_WARN } from '../shared/checks';
import { slug } from '../shared/utm';
import { makeZip } from '../shared/zip';
import { utf8Bytes } from '../shared/hash';
import { onMessage, post, waitFor } from './bridge';
import { ApiError, makeCaller, oauthPoll, oauthRefresh, oauthStart, relayHealth, type RelayHealth } from './api/relay';
import { Mailchimp, type McTemplate } from './api/mailchimp';
import { Klaviyo } from './api/klaviyo';
import { bytesToUrl, extOf, finalizeSlices, mimeOf } from './imageops';
import { copyText, downloadBytes } from './clipboard';

declare const __PHLOEM_VERSION__: string;

type Tab = 'export' | 'design' | 'clients' | 'settings';
interface PlanState { plan: SlicePlan; checks: Check[] }
interface Busy { label: string; done: number; total: number }
interface Result { kind: 'draft' | 'html' | 'zip'; text: string; url?: string }

const S = {
  version: '',
  tab: 'export' as Tab,
  frames: [] as FrameSummary[],
  pageFrames: [] as { id: string; name: string; width: number }[],
  activeFrameId: null as string | null,
  plans: {} as Record<string, PlanState>,
  thumbs: {} as Record<string, string>,
  suggestions: {} as Record<string, { suggestions: Suggestion[]; score: number }>,
  profiles: [] as Profile[],
  settings: null as Settings | null,
  editing: null as Profile | null,
  editingNew: false,
  busy: null as Busy | null,
  log: [] as { t: string; k?: 'ok' | 'er' }[],
  htmlMode: 'fragment' as 'fragment' | 'full',
  selectedSlice: null as string | null,
  result: null as Result | null,
  relay: null as RelayHealth | null,
  relayError: '' as string,
  lists: {} as Record<string, { id: string; name: string }[]>,
  templates: {} as Record<string, McTemplate[]>,
  sections: {} as Record<string, string[]>,
  optimizeChanges: null as string[] | null,
  connecting: false,
};

// ---------- tiny DOM helper ----------
type Child = Node | string | number | null | undefined | false | Child[];
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any> | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') (el as any)[k.toLowerCase()] = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'value') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  const add = (c: Child) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(add); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  };
  children.forEach(add);
  return el;
}

function toast(text: string, kind: 'ok' | 'err' | 'info' = 'info') {
  const box = document.getElementById('toasts')!;
  const t = h('div', { class: `toast ${kind}` }, text);
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 260); }, kind === 'err' ? 6000 : 3200);
}

function log(t: string, k?: 'ok' | 'er') { S.log.push({ t, k }); if (S.log.length > 60) S.log.shift(); render(); }

function render() {
  const app = document.getElementById('app')!;
  const active = document.activeElement as HTMLElement | null;
  const focusId = active && active.id ? active.id : null;
  const sel = active && 'selectionStart' in active ? [(active as HTMLInputElement).selectionStart, (active as HTMLInputElement).selectionEnd] : null;
  const scrollTop = app.querySelector('.body')?.scrollTop ?? 0;
  app.replaceChildren(Header(), Tabs(), Body(), Footer());
  const body = app.querySelector('.body');
  if (body) body.scrollTop = scrollTop;
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) { el.focus(); try { if (sel && sel[0] != null) el.setSelectionRange(sel[0]!, sel[1]!); } catch { /* not a text input */ } }
  }
}

// ---------- derived ----------
const activeFrame = () => S.frames.find((f) => f.id === S.activeFrameId) ?? S.frames[0] ?? null;
const activeProfile = () => S.profiles.find((p) => p.id === S.settings?.activeProfileId) ?? null;
const providerName = (p: Provider) => (p === 'mailchimp' ? 'Mailchimp' : 'Klaviyo');
const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); };

// ---------- views ----------
function Logo() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = `<path d="M12 2.5c4 3.2 6.5 7 6.5 11a6.5 6.5 0 0 1-13 0c0-4 2.5-7.8 6.5-11Z" fill="none" stroke="#39ff14" stroke-width="1.6"/><path d="M12 7v13M12 11l-3-2.2M12 14l3-2.2M12 17l-3-2.2" stroke="#39ff14" stroke-width="1.4" stroke-linecap="round"/>`;
  return svg;
}

function Header() {
  const p = activeProfile();
  return h('div', { class: 'hdr' },
    h('div', { class: 'logo' }, Logo(), h('span', { class: 'name' }, 'Phloem'), h('span', { class: 'ver' }, S.version ? `v${S.version}` : '')),
    h('div', { class: 'spacer' }),
    h('label', { class: 'client-pill', title: 'Client đang dùng' },
      h('span', { class: `dot ${p ? '' : 'off'}` }),
      h('span', { class: 't' }, p ? `${p.name} · ${providerName(p.provider)}` : 'Chưa chọn client'),
      h('select', {
        onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v === '__add') { S.tab = 'clients'; startEdit(newProfile('klaviyo', ''), true); } else if (S.settings) { S.settings.activeProfileId = v || null; post({ type: 'save-settings', settings: S.settings }); S.result = null; } render(); },
      },
        h('option', { value: '', selected: !p }, '— chưa chọn —'),
        S.profiles.map((x) => h('option', { value: x.id, selected: p?.id === x.id }, `${x.name} (${providerName(x.provider)})`)),
        h('option', { value: '__add' }, '+ Thêm client…'),
      ),
    ),
  );
}

function Tabs() {
  const f = activeFrame();
  const n = f ? S.plans[f.id]?.checks.filter((c) => c.level !== 'info').length : 0;
  const tabs: [Tab, string, number | undefined][] = [['export', 'Xuất', n || undefined], ['design', 'Thiết kế', undefined], ['clients', 'Client', S.profiles.length || undefined], ['settings', 'Cài đặt', undefined]];
  return h('div', { class: 'tabs' }, tabs.map(([id, label, badge]) => h('button', { class: `tab ${S.tab === id ? 'on' : ''}`, onclick: () => { S.tab = id; render(); if (id === 'design' && f) post({ type: 'get-suggestions', frameId: f.id }); if (id === 'settings') checkRelay(); } }, label, badge ? h('span', { class: 'n' }, String(badge)) : null)));
}

function Body() {
  const view = S.tab === 'export' ? ExportTab() : S.tab === 'design' ? DesignTab() : S.tab === 'clients' ? ClientsTab() : SettingsTab();
  return h('div', { class: `body ${S.busy ? 'busy-root' : ''}` }, view);
}

function Footer() {
  return h('div', { class: 'ftr' }, h('span', { class: 'dot' }), 'Phloem không bao giờ tự gửi. Bạn duyệt và bấm gửi trong ', activeProfile() ? providerName(activeProfile()!.provider) : 'Mailchimp / Klaviyo', '.');
}

// ---- Export tab ----
function ExportTab(): Child {
  const f = activeFrame();
  if (!f) {
    return h('div', { class: 'empty' },
      h('div', { class: 'big' }, 'Chọn một frame email trên canvas'),
      h('div', null, 'Hoặc bắt đầu từ template chuẩn 600px, đã gắn link và alt sẵn.'),
      h('div', { class: 'row wrap', style: { justifyContent: 'center' } },
        h('button', { class: 'btn primary', onclick: () => post({ type: 'insert-template', kind: 'newsletter' }) }, 'Chèn template Newsletter'),
        h('button', { class: 'btn', onclick: () => { S.tab = 'design'; render(); } }, 'Xem tất cả template'),
      ),
    );
  }
  const ps = S.plans[f.id];
  const prof = activeProfile();
  const draft = prof ? f.drafts[prof.id] : undefined;
  return [
    S.frames.length > 1 ? h('div', { class: 'frames' }, h('div', { class: 'eyebrow' }, `${S.frames.length} frame đã chọn`), S.frames.map((x) => h('div', { class: `frame ${x.id === f.id ? 'on' : ''}`, onclick: () => selectFrame(x.id) }, h('span', { class: 'nm grow' }, x.name), h('span', { class: 'sz' }, `${x.width}×${x.height}`), prof && x.drafts[prof.id]?.campaignId ? h('span', { class: 'chip on' }, 'draft') : null))) : null,
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'title grow' }, f.name), h('span', { class: 'mono dim small' }, `${f.width}×${f.height}`), ps ? h('span', { class: 'chip' }, `${ps.plan.slices.length} lát`) : null),
      h('div', { class: 'grid2' },
        Field('Tên campaign', 'f-campaign', f.fields.campaignName, (v) => setField(f, { campaignName: v })),
        Field('Subject', 'f-subject', f.fields.subject, (v) => setField(f, { subject: v }), 'cần khi tạo draft'),
      ),
      Field('Preheader', 'f-preheader', f.fields.preheader, (v) => setField(f, { preheader: v }), 'dòng xem trước'),
      h('div', { class: 'field' },
        h('label', null, 'Frame mobile (tuỳ chọn)', h('span', { class: 'hint' }, 'điện thoại nhận bản này')),
        h('div', { class: 'row' },
          h('select', { class: 'grow', onchange: (e: Event) => setField(f, { mobileFrameId: (e.target as HTMLSelectElement).value || null }) },
            h('option', { value: '', selected: !f.fields.mobileFrameId }, '— không —'),
            S.pageFrames.filter((x) => x.id !== f.id).map((x) => h('option', { value: x.id, selected: f.fields.mobileFrameId === x.id }, `${x.name} (${x.width}px)`)),
          ),
          h('button', { class: 'btn sm', title: 'Nhân bản frame thành 375px', onclick: () => post({ type: 'create-mobile-frame', frameId: f.id }) }, '+ Tạo'),
        ),
      ),
    ),
    Preview(f, ps),
    ps ? Checks(ps.checks) : null,
    Actions(f, prof, draft),
    S.busy || S.log.length ? Progress() : null,
    S.result ? ResultBox(S.result) : null,
  ];
}

function Field(label: string, id: string, value: string, onCommit: (v: string) => void, hint?: string, type = 'text') {
  return h('div', { class: 'field' },
    h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, hint) : null),
    h('input', { id, type, value, onchange: (e: Event) => onCommit((e.target as HTMLInputElement).value) }),
  );
}

function Preview(f: FrameSummary, ps: PlanState | undefined) {
  const url = S.thumbs[f.id];
  if (!ps) return h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Đang phân tích frame…'));
  const { plan } = ps;
  const scale = 100 / plan.width;
  const badKeys = new Set(ps.checks.filter((c) => c.level === 'error' && c.sliceKey).map((c) => c.sliceKey));
  const sel = plan.slices.find((s) => s.key === S.selectedSlice) ?? null;
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('div', { class: 'eyebrow grow' }, 'Lát ảnh'), h('span', { class: 'legend' }, h('span', null, h('i'), 'không link'), h('span', null, h('i', { class: 'l' }), 'có link'))),
    h('div', { class: 'preview' }, h('div', { class: 'canvas' },
      url ? h('img', { src: url, alt: '' }) : h('div', { style: { paddingTop: `${(plan.height / plan.width) * 100}%` } }),
      h('div', { class: 'ov' }, plan.slices.map((s) => h('div', {
        class: `slice ${s.link ? 'link' : ''} ${badKeys.has(s.key) ? 'bad' : ''} ${S.selectedSlice === s.key ? 'on' : ''}`,
        style: { left: `${s.x * scale}%`, top: `${s.y * scale}%`, width: `${s.w * scale}%`, height: `${s.h * scale}%` },
        title: `${s.index + 1}. ${s.label}${s.link ? '\n→ ' + s.link : ''}${s.alt ? '\nalt: ' + s.alt : ''}`,
        onclick: () => { S.selectedSlice = S.selectedSlice === s.key ? null : s.key; render(); },
      }, s.h * scale > 3 && s.w * scale > 8 ? h('span', { class: 'tag' }, String(s.index + 1)) : null))),
    )),
    sel ? SliceEditor(f, sel) : h('div', { class: 'dim small' }, 'Bấm vào một lát để sửa link / alt. Link lấy từ hyperlink, prototype, ', h('span', { class: 'kbd' }, '#link='), ' trong tên layer, hoặc nhập ở đây.'),
  );
}

function SliceEditor(f: FrameSummary, s: Slice) {
  return h('div', { class: 'slice-ed' },
    h('div', { class: 'hd' }, h('span', null, `Lát ${s.index + 1} · ${s.w}×${s.h} · ${s.label}`), s.ownerNodeId ? h('button', { class: 'btn sm ghost', onclick: () => post({ type: 'focus-node', nodeId: s.ownerNodeId! }) }, 'Tới layer') : null),
    Field('Link', `sl-link-${s.key}`, s.link ?? '', (v) => { post({ type: 'set-slice-override', frameId: f.id, key: s.key, link: v.trim() || null }); if (s.ownerNodeId && v.trim()) post({ type: 'set-node-meta', nodeId: s.ownerNodeId, link: v.trim() }); refreshPlan(f.id); }, 'https://… hoặc *|UNSUB|*'),
    Field('Alt text', `sl-alt-${s.key}`, s.alt, (v) => { post({ type: 'set-slice-override', frameId: f.id, key: s.key, alt: v }); if (s.ownerNodeId) post({ type: 'set-node-meta', nodeId: s.ownerNodeId, alt: v }); refreshPlan(f.id); }, 'hiện khi ảnh bị chặn'),
  );
}

function Checks(checks: Check[]) {
  const shown = checks.slice(0, 30);
  if (!checks.length) return h('div', { class: 'checks' }, h('div', { class: 'check ok' }, h('span', { class: 'lv' }, 'OK'), h('span', { class: 'm' }, 'Không có vấn đề: đủ link, đủ alt, kích thước chuẩn.')));
  return h('div', { class: 'checks' },
    h('div', { class: 'eyebrow' }, `Kiểm tra (${checks.length})`),
    shown.map((c) => h('div', { class: `check ${c.level} ${c.nodeId ? 'click' : ''}`, onclick: c.nodeId ? () => post({ type: 'focus-node', nodeId: c.nodeId! }) : undefined, title: c.nodeId ? 'Bấm để tới layer' : '' },
      h('span', { class: 'lv' }, c.level === 'error' ? 'LỖI' : c.level === 'warn' ? 'CHÚ Ý' : 'INFO'), h('span', { class: 'm' }, c.message))),
    checks.length > shown.length ? h('div', { class: 'dim small' }, `… và ${checks.length - shown.length} mục nữa`) : null,
  );
}

function Actions(f: FrameSummary, prof: Profile | null, draft: DraftRecord | undefined) {
  const multi = S.frames.length > 1;
  const disabled = !!S.busy;
  const draftLabel = prof ? (draft?.campaignId ? `Cập nhật draft · ${providerName(prof.provider)}` : `Tạo draft · ${providerName(prof.provider)}`) : 'Tạo draft (chọn client trước)';
  return h('div', { class: 'card glow' },
    multi ? h('div', { class: 'small muted' }, `Sẽ chạy lần lượt ${S.frames.length} frame — mỗi frame một draft riêng. Bạn vẫn làm việc trên canvas trong lúc chờ.`) : null,
    h('button', { class: 'btn primary block', disabled: disabled || !prof, onclick: () => runAll('draft') }, draftLabel, multi ? h('span', { class: 'k' }, `×${S.frames.length}`) : null),
    h('div', { class: 'grid2' },
      h('div', { class: 'split' },
        h('button', { class: 'btn', disabled, onclick: () => runAll('html'), title: S.htmlMode === 'fragment' ? 'Chỉ phần nội dung — dán vào template có brand, header/footer của template giữ nguyên' : 'Trang HTML đầy đủ (doctype, head, preheader)' }, S.htmlMode === 'fragment' ? 'Copy HTML' : 'Copy HTML đầy đủ'),
        h('button', { class: 'btn', disabled, onclick: () => { S.htmlMode = S.htmlMode === 'fragment' ? 'full' : 'fragment'; render(); }, title: 'Đổi: nội dung / trang đầy đủ' }, '⇅'),
      ),
      h('button', { class: 'btn', disabled, onclick: () => runAll('zip'), title: 'HTML + ảnh, tự host' }, 'Tải .zip'),
    ),
    draft?.campaignId ? h('div', { class: 'row small muted' }, h('span', { class: 'grow' }, `Draft đã tạo ${fmtTime(draft.updatedAt)} · ${Object.keys(draft.files).length} ảnh đã upload`), draft.webUrl ? h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); post({ type: 'open-url', url: draft.webUrl! }); } }, `Mở trong ${providerName(draft.provider)} ↗`) : null, h('button', { class: 'btn sm ghost danger', title: 'Quên draft này — lần sau sẽ tạo mới', onclick: () => { if (prof) post({ type: 'save-draft', frameId: f.id, profileId: prof.id, draft: null }); } }, '✕')) : null,
    !prof ? h('div', { class: 'small muted' }, 'Copy HTML cần một client để host ảnh. Chưa có? Dùng ', h('b', null, 'Tải .zip'), ' (ảnh kèm theo) hoặc thêm client ở tab Client.') : null,
  );
}

function Progress() {
  const b = S.busy;
  return h('div', { class: 'card' },
    b ? [h('div', { class: 'row small' }, h('span', { class: 'grow' }, b.label), h('span', { class: 'mono dim' }, b.total ? `${b.done}/${b.total}` : '')), h('div', { class: 'progress' }, h('i', { style: { width: `${b.total ? Math.round((b.done / b.total) * 100) : 15}%` } }))] : null,
    S.log.length ? h('div', { class: 'log' }, S.log.slice(-12).map((l) => h('div', { class: l.k ?? '' }, l.t))) : null,
  );
}

function ResultBox(r: Result) {
  return h('div', { class: 'result' }, h('span', { class: 'ic' }, '✓'), h('span', { class: 'grow' }, r.text), r.url ? h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); post({ type: 'open-url', url: r.url! }); } }, 'Mở ↗') : null);
}

// ---- Design tab ----
const TEMPLATES: { kind: TemplateKind; name: string; desc: string }[] = [
  { kind: 'newsletter', name: 'Newsletter', desc: 'Nav · hero · 2 feature · CTA · footer' },
  { kind: 'product-grid', name: 'Product grid', desc: 'Lưới 3 cột ×2, mỗi ô một link' },
  { kind: 'promo', name: 'Promo / Sale', desc: 'Hero lớn, 2 sản phẩm, CTA' },
  { kind: 'welcome', name: 'Welcome', desc: 'Chào mừng + ưu đãi đầu' },
  { kind: 'cart', name: 'Cart reminder', desc: 'Nhắc giỏ hàng, 2 món' },
  { kind: 'mobile-pair', name: 'Desktop + Mobile', desc: 'Newsletter 600 kèm bản 375' },
];
const BLOCKS: { kind: BlockKind; name: string }[] = [
  { kind: 'nav', name: 'Nav' }, { kind: 'hero', name: 'Hero' }, { kind: 'text', name: 'Text' }, { kind: 'cta', name: 'CTA button' },
  { kind: 'products-2', name: 'Sản phẩm ×2' }, { kind: 'products-3', name: 'Sản phẩm ×3' }, { kind: 'feature-row', name: 'Ảnh + chữ' },
  { kind: 'divider', name: 'Divider' }, { kind: 'spacer', name: 'Spacer' }, { kind: 'footer', name: 'Footer' },
];

function DesignTab(): Child {
  const f = activeFrame();
  const sg = f ? S.suggestions[f.id] : null;
  return [
    f ? h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Gợi ý cho frame này'),
      sg ? [
        h('div', { class: 'score' }, Ring(sg.score), h('div', { class: 'grow' }, h('div', { class: 'title' }, f.name), h('div', { class: 'muted small' }, sg.score >= 90 ? 'Sẵn sàng gửi. Theo luật email, không AI — cùng frame luôn cùng kết quả.' : sg.score >= 70 ? 'Ổn. Vài điểm nên chỉnh trước khi gửi.' : 'Nên sửa các mục “SỬA” trước.'), h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => { S.optimizeChanges = null; post({ type: 'optimize-frame', frameId: f.id }); } }, 'Tối ưu frame'), h('button', { class: 'btn sm ghost', onclick: () => post({ type: 'get-suggestions', frameId: f.id }) }, 'Phân tích lại')))),
        S.optimizeChanges ? h('div', { class: 'check ok' }, h('span', { class: 'lv' }, 'ĐÃ SỬA'), h('span', { class: 'm' }, S.optimizeChanges.length ? S.optimizeChanges.join(' · ') : 'Frame đã chuẩn, không cần đổi gì.')) : null,
        sg.suggestions.map((s) => h('div', { class: `sug ${s.level}` },
          h('span', { class: 'lv' }, s.level === 'fix' ? 'SỬA' : s.level === 'tip' ? 'GỢI Ý' : 'TỐT'),
          h('div', { class: 'grow' }, h('div', { class: 't' }, s.title), h('div', { class: 'd' }, s.detail)),
          s.action && s.level !== 'good' ? h('button', { class: 'btn sm', onclick: () => applySuggestion(f, s) }, actionLabel(s)) : null,
        )),
      ] : h('div', { class: 'muted small' }, 'Đang phân tích…'),
    ) : h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Chọn một frame để nhận gợi ý'), h('div', null, 'Hoặc chèn template bên dưới để bắt đầu đúng chuẩn.')),
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Template email (600px)'),
      h('div', { class: 'tiles' }, TEMPLATES.map((t) => h('button', { class: 'tile', onclick: () => post({ type: 'insert-template', kind: t.kind }) }, h('div', { class: 'ic' }), h('div', { class: 'nm' }, t.name), h('div', { class: 'ds' }, t.desc)))),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, f ? `Chèn block vào “${f.name}”` : 'Block (sẽ tạo frame mới)'),
      h('div', { class: 'row wrap' }, BLOCKS.map((b) => h('button', { class: 'btn sm', onclick: () => post({ type: 'insert-block', frameId: f ? f.id : null, block: b.kind }) }, b.name))),
    ),
    h('details', null,
      h('summary', null, 'Quy ước thiết kế để Phloem hiểu đúng'),
      h('div', { class: 'rules' },
        h('span', { class: 'kbd' }, 'Hyperlink'), h('span', null, 'Gắn link cho chữ bằng ⌘K như bình thường — Phloem đọc được.'),
        h('span', { class: 'kbd' }, 'Prototype'), h('span', null, 'Interaction “Open link” trên bất kỳ layer nào cũng thành link.'),
        h('span', { class: 'kbd' }, '#link=…'), h('span', null, 'Thêm vào tên layer: ', h('i', null, 'Hero #link=https://shop.vn/sale'), '.'),
        h('span', { class: 'kbd' }, '#alt=…'), h('span', null, 'Alt text trong tên layer, hoặc nhập ở tab Xuất. Ảnh có tên riêng dùng tên làm alt.'),
        h('span', { class: 'kbd' }, 'Nhóm'), h('span', null, 'Link trên group/frame áp cho cả vùng. Link con sâu hơn thắng trong vùng của nó.'),
        h('span', { class: 'kbd' }, '600px'), h('span', null, 'Frame 600 rộng, toạ độ nguyên, cùng hàng thì căn cùng đỉnh để ít lát hơn.'),
        h('span', { class: 'kbd' }, 'Merge tag'), h('span', null, h('i', null, '*|UNSUB|*'), ' (Mailchimp) hoặc ', h('i', null, '{% unsubscribe %}'), ' (Klaviyo) được giữ nguyên.'),
      ),
    ),
  ];
}

function actionLabel(s: Suggestion): string {
  switch (s.action?.kind) {
    case 'snap-width': return 'Sửa 600px';
    case 'round-pixels': return 'Làm tròn';
    case 'insert-block': return 'Chèn';
    case 'focus': return 'Xem';
    case 'set-field': return 'Điền';
    case 'create-mobile': return 'Tạo';
    default: return 'Làm';
  }
}

function applySuggestion(f: FrameSummary, s: Suggestion) {
  if (!s.action) return;
  if (s.action.kind === 'set-field') { const field = s.action.field; S.tab = 'export'; render(); setTimeout(() => document.getElementById(field === 'subject' ? 'f-subject' : 'f-preheader')?.focus(), 30); return; }
  post({ type: 'apply-suggestion', frameId: f.id, action: s.action });
}

function Ring(score: number) {
  const r = 26, c = 2 * Math.PI * r;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('width', '64'); svg.setAttribute('height', '64');
  svg.innerHTML = `<circle cx="32" cy="32" r="${r}" fill="none" stroke="#1a2a1e" stroke-width="5"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="#39ff14" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}" style="filter:drop-shadow(0 0 6px rgba(57,255,20,.6))"/>`;
  return h('div', { class: 'ring' }, svg, h('div', { class: 'v' }, String(score)));
}

// ---- Clients tab ----
function ClientsTab(): Child {
  if (S.editing) return ProfileForm(S.editing);
  return [
    h('div', { class: 'row' }, h('div', { class: 'eyebrow grow' }, 'Client / tài khoản'), h('button', { class: 'btn sm primary', onclick: () => startEdit(newProfile('klaviyo', ''), true) }, '+ Thêm')),
    S.profiles.length ? S.profiles.map((p) => h('div', { class: `profile ${S.settings?.activeProfileId === p.id ? 'on' : ''}` },
      h('div', { class: 'row' }, h('span', { class: `badge ${p.provider}` }, providerName(p.provider)), h('span', { class: 'title grow' }, p.name), h('span', { class: 'mono dim small' }, p.auth.type === 'oauth' ? 'OAuth' : 'API key')),
      h('div', { class: 'small muted' }, [p.accountLabel, p.audienceName ? `Audience: ${p.audienceName}` : 'Chưa chọn audience', p.imageFormat === 'JPG' ? `JPG ${p.jpgQuality}` : 'PNG', `${p.scale}x`].filter(Boolean).join(' · ')),
      Object.keys(p.permissions).length ? h('div', { class: 'perm' }, Object.entries(p.permissions).map(([k, v]) => h('span', { class: `chip ${v ? 'on' : 'err'}` }, `${v ? '✓' : '✕'} ${k}`))) : null,
      h('div', { class: 'row' },
        S.settings?.activeProfileId !== p.id ? h('button', { class: 'btn sm', onclick: () => { S.settings!.activeProfileId = p.id; post({ type: 'save-settings', settings: S.settings! }); render(); } }, 'Dùng client này') : h('span', { class: 'chip on' }, 'đang dùng'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn sm ghost', onclick: () => startEdit(p, false) }, 'Sửa'),
        h('button', { class: 'btn sm ghost danger', onclick: () => { if (confirm(`Xoá client "${p.name}"? Draft đã tạo vẫn còn trong ${providerName(p.provider)}.`)) { S.profiles = S.profiles.filter((x) => x.id !== p.id); if (S.settings?.activeProfileId === p.id) { S.settings.activeProfileId = null; post({ type: 'save-settings', settings: S.settings }); } post({ type: 'save-profiles', profiles: S.profiles }); render(); } } }, 'Xoá'),
      ),
    )) : h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Chưa có client nào'), h('div', null, 'Một client = một tài khoản Mailchimp hoặc Klaviyo + audience, UTM, footer mặc định. Freelancer nhiều client thì thêm nhiều.'), h('button', { class: 'btn primary', onclick: () => startEdit(newProfile('klaviyo', ''), true) }, 'Thêm client đầu tiên')),
  ];
}

function startEdit(p: Profile, isNew: boolean) { S.editing = JSON.parse(JSON.stringify(p)); S.editingNew = isNew; S.tab = 'clients'; render(); checkRelay(); }

function ProfileForm(p: Profile): Child {
  const connected = !!p.accountLabel;
  const lists = S.lists[p.id] || [];
  const tpls = S.templates[p.id] || [];
  const canOauth = !!S.relay?.oauth?.[p.provider];
  const setAuthKey = (v: string) => { p.auth = { type: 'apikey', apiKey: v.trim(), dc: p.provider === 'mailchimp' ? v.trim().split('-').pop() : undefined }; p.accountLabel = ''; p.permissions = {}; };
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => { S.editing = null; render(); } }, '← Danh sách'), h('div', { class: 'title grow' }, S.editingNew ? 'Thêm client' : `Sửa “${p.name}”`)),
    h('div', { class: 'grid2' },
      Field('Tên client', 'p-name', p.name, (v) => { p.name = v; }, 'để bạn nhận ra'),
      h('div', { class: 'field' }, h('label', null, 'Nền tảng'), h('div', { class: 'seg' }, (['klaviyo', 'mailchimp'] as Provider[]).map((pr) => h('button', { class: p.provider === pr ? 'on' : '', onclick: () => { p.provider = pr; p.auth = { type: 'apikey', apiKey: '' }; p.accountLabel = ''; p.permissions = {}; p.audienceId = ''; p.audienceName = ''; render(); } }, providerName(pr))))),
    ),
    h('div', { class: 'eyebrow' }, 'Kết nối'),
    p.auth.type === 'oauth'
      ? h('div', { class: 'row' }, h('span', { class: 'chip on grow' }, `OAuth · ${p.auth.accountName || p.accountLabel || 'đã đăng nhập'}`), h('button', { class: 'btn sm ghost', onclick: () => { p.auth = { type: 'apikey', apiKey: '' }; p.accountLabel = ''; render(); } }, 'Ngắt'))
      : [
        h('div', { class: 'field' },
          h('label', { for: 'p-key' }, p.provider === 'mailchimp' ? 'API key Mailchimp' : 'Private API key Klaviyo', h('span', { class: 'hint' }, p.provider === 'mailchimp' ? 'xxxx-us21' : 'pk_…')),
          h('div', { class: 'row' },
            h('input', { id: 'p-key', type: 'password', value: p.auth.apiKey, placeholder: p.provider === 'mailchimp' ? 'Account → Extras → API keys' : 'Settings → API keys → Create private key', oninput: (e: Event) => setAuthKey((e.target as HTMLInputElement).value) }),
            h('button', { class: 'btn', disabled: S.connecting || !p.auth.apiKey, onclick: () => testConnection(p) }, S.connecting ? '…' : 'Kiểm tra'),
          ),
        ),
        h('div', { class: 'row small muted' },
          h('span', { class: 'grow' }, canOauth ? 'Hoặc đăng nhập để dùng đúng quyền đã được cấp — nhiều tài khoản thì mỗi lần đăng nhập chọn một.' : `Đăng nhập ${providerName(p.provider)} (OAuth) cần relay có CLIENT_ID — xem server/.env.example.`),
          h('button', { class: 'btn sm', disabled: !canOauth || S.connecting, onclick: () => connectOAuth(p) }, `Đăng nhập ${providerName(p.provider)}`),
        ),
      ],
    connected ? h('div', { class: 'check ok' }, h('span', { class: 'lv' }, 'OK'), h('span', { class: 'm' }, `Đã kết nối: ${p.accountLabel}`)) : null,
    Object.keys(p.permissions).length ? h('div', { class: 'perm' }, Object.entries(p.permissions).map(([k, v]) => h('span', { class: `chip ${v ? 'on' : 'err'}`, title: v ? 'Được phép' : 'Tài khoản này không có quyền — Phloem sẽ báo rõ khi cần' }, `${v ? '✓' : '✕'} ${k}`))) : null,
    h('div', { class: 'eyebrow' }, 'Mặc định cho client này'),
    h('div', { class: 'field' },
      h('label', null, 'Audience / List', h('span', { class: 'hint' }, 'draft gửi tới')),
      lists.length ? h('select', { onchange: (e: Event) => { const id = (e.target as HTMLSelectElement).value; p.audienceId = id; p.audienceName = lists.find((l) => l.id === id)?.name || ''; } }, h('option', { value: '' }, '— chọn —'), lists.map((l) => h('option', { value: l.id, selected: l.id === p.audienceId }, l.name)))
        : h('div', { class: 'row' }, h('input', { id: 'p-aud', type: 'text', value: p.audienceId, placeholder: connected ? 'Không tải được list — nhập ID' : 'Kiểm tra kết nối để tải danh sách', onchange: (e: Event) => { p.audienceId = (e.target as HTMLInputElement).value.trim(); } })),
    ),
    h('div', { class: 'grid2' },
      Field('From name', 'p-from', p.fromName, (v) => { p.fromName = v; }),
      Field(p.provider === 'klaviyo' ? 'From email' : 'Reply-to', 'p-email', p.provider === 'klaviyo' ? p.fromEmail : p.replyTo, (v) => { if (p.provider === 'klaviyo') p.fromEmail = v; else p.replyTo = v; }, p.provider === 'klaviyo' ? 'sender đã xác minh' : 'bắt buộc'),
    ),
    p.provider === 'mailchimp' ? h('div', { class: 'grid2' },
      h('div', { class: 'field' },
        h('label', null, 'Template có brand', h('span', { class: 'hint' }, 'tuỳ chọn')),
        tpls.length ? h('select', { onchange: async (e: Event) => { p.templateId = (e.target as HTMLSelectElement).value; if (p.templateId) await loadSections(p); render(); } }, h('option', { value: '' }, '— không, dùng HTML đầy đủ —'), tpls.map((t) => h('option', { value: String(t.id), selected: String(t.id) === p.templateId }, t.name)))
          : h('input', { type: 'text', value: p.templateId, placeholder: 'Template ID (hoặc để trống)', onchange: (e: Event) => { p.templateId = (e.target as HTMLInputElement).value.trim(); } }),
      ),
      h('div', { class: 'field' },
        h('label', null, 'Section mc:edit', h('span', { class: 'hint' }, 'nơi chèn nội dung')),
        (S.sections[p.id] || []).length ? h('select', { onchange: (e: Event) => { p.templateSection = (e.target as HTMLSelectElement).value; } }, S.sections[p.id].map((s) => h('option', { value: s, selected: s === p.templateSection }, s))) : h('input', { type: 'text', value: p.templateSection, placeholder: 'body', onchange: (e: Event) => { p.templateSection = (e.target as HTMLInputElement).value.trim() || 'body'; } }),
      ),
    ) : null,
    h('div', { class: 'field' }, h('label', null, 'Mẫu UTM', h('span', { class: 'hint' }, '{provider} {campaign} {frame} {slice} {date} {host}')), h('input', { id: 'p-utm', type: 'text', value: p.utmTemplate, placeholder: DEFAULT_UTM, onchange: (e: Event) => { p.utmTemplate = (e.target as HTMLInputElement).value.trim(); } })),
    h('div', { class: 'field' }, h('label', null, 'Footer HTML riêng', h('span', { class: 'hint' }, 'thêm dưới email; để trống nếu template đã có')), h('textarea', { id: 'p-footer', value: p.footerHtml, placeholder: '<p>Công ty ABC · 123 Lê Lợi · <a href="*|UNSUB|*">Huỷ đăng ký</a></p>', onchange: (e: Event) => { p.footerHtml = (e.target as HTMLTextAreaElement).value; } })),
    h('div', { class: 'grid3' },
      h('div', { class: 'field' }, h('label', null, 'Định dạng ảnh'), h('div', { class: 'seg' }, (['PNG', 'JPG'] as const).map((f) => h('button', { class: p.imageFormat === f ? 'on' : '', onclick: () => { p.imageFormat = f; render(); } }, f)))),
      h('div', { class: 'field' }, h('label', null, 'Độ phân giải'), h('div', { class: 'seg' }, ([1, 2] as const).map((s) => h('button', { class: p.scale === s ? 'on' : '', onclick: () => { p.scale = s; render(); } }, `${s}x`)))),
      Field('JPG quality', 'p-q', String(p.jpgQuality), (v) => { p.jpgQuality = Math.max(40, Math.min(100, Number(v) || 85)); }, '', 'number'),
    ),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onclick: () => saveProfile(p) }, S.editingNew ? 'Lưu client' : 'Lưu thay đổi'),
      h('button', { class: 'btn ghost', onclick: () => { S.editing = null; render(); } }, 'Huỷ'),
    ),
  );
}

function saveProfile(p: Profile) {
  if (!p.name.trim()) p.name = p.accountLabel || providerName(p.provider);
  const idx = S.profiles.findIndex((x) => x.id === p.id);
  if (idx >= 0) S.profiles[idx] = p; else S.profiles.push(p);
  post({ type: 'save-profiles', profiles: S.profiles });
  if (S.settings && (!S.settings.activeProfileId || S.editingNew)) { S.settings.activeProfileId = p.id; post({ type: 'save-settings', settings: S.settings }); }
  S.editing = null;
  toast(`Đã lưu client "${p.name}".`, 'ok');
  render();
}

// ---- Settings tab ----
function SettingsTab(): Child {
  const s = S.settings!;
  const commit = () => post({ type: 'save-settings', settings: s });
  return [
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Relay'),
      h('div', { class: 'small muted' }, 'Mailchimp và Klaviyo không cho trình duyệt gọi thẳng (CORS), nên plugin đi qua một relay nhỏ của bạn: ', h('span', { class: 'kbd' }, 'npm run relay'), ' hoặc deploy thư mục ', h('span', { class: 'kbd' }, 'server/'), '. Relay không lưu key.'),
      h('div', { class: 'row' }, h('input', { id: 's-relay', type: 'url', value: s.relayUrl, placeholder: 'http://localhost:8787', onchange: (e: Event) => { s.relayUrl = (e.target as HTMLInputElement).value.trim(); commit(); checkRelay(); } }), h('button', { class: 'btn', onclick: () => checkRelay(true) }, 'Kiểm tra')),
      Field('Relay token', 's-token', s.relayToken, (v) => { s.relayToken = v; commit(); }, 'nếu relay đặt RELAY_TOKEN', 'password'),
      S.relay ? h('div', { class: 'row wrap' }, h('span', { class: 'chip on' }, '✓ relay ok'), h('span', { class: `chip ${S.relay.oauth.mailchimp ? 'on' : ''}` }, `OAuth Mailchimp ${S.relay.oauth.mailchimp ? 'bật' : 'tắt'}`), h('span', { class: `chip ${S.relay.oauth.klaviyo ? 'on' : ''}` }, `OAuth Klaviyo ${S.relay.oauth.klaviyo ? 'bật' : 'tắt'}`), S.relay.klaviyoRevision ? h('span', { class: 'chip' }, `rev ${S.relay.klaviyoRevision}`) : null) : S.relayError ? h('div', { class: 'check error' }, h('span', { class: 'lv' }, 'LỖI'), h('span', { class: 'm' }, S.relayError)) : null,
    ),
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Cắt lát'),
      Field('Chiều cao lát tối đa (px)', 's-maxh', String(s.maxSliceHeight), (v) => { s.maxSliceHeight = Math.max(300, Math.min(1728, Number(v) || 1500)); commit(); refreshAll(); }, 'Outlook cắt ảnh >1728', 'number'),
      h('label', { class: 'toggle' }, h('span', null, 'Gộp các hàng không link thành một lát', h('div', { class: 'dim small' }, 'Ít ảnh hơn, email nhẹ hơn')), h('input', { type: 'checkbox', checked: s.mergeRows, onchange: (e: Event) => { s.mergeRows = (e.target as HTMLInputElement).checked; commit(); refreshAll(); } })),
      h('label', { class: 'toggle' }, h('span', null, 'Dùng tên layer ảnh làm alt text', h('div', { class: 'dim small' }, 'Bỏ qua tên mặc định như “Rectangle 12”')), h('input', { type: 'checkbox', checked: s.altFromLayerName, onchange: (e: Event) => { s.altFromLayerName = (e.target as HTMLInputElement).checked; commit(); refreshAll(); } })),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Cửa sổ plugin'),
      h('div', { class: 'row' }, h('span', { class: 'grow small muted' }, 'Chiều cao'), h('div', { class: 'seg' }, [560, 680, 820].map((v) => h('button', { class: s.uiHeight === v ? 'on' : '', onclick: () => { s.uiHeight = v; commit(); } }, String(v))))),
    ),
    h('div', { class: 'dim small mono' }, `Phloem v${S.version} · phloem = mạch dẫn của cây: mang đúng thứ lá tạo ra tới nơi cần, không biến đổi.`),
  ];
}

// ---------- actions: frames ----------
function selectFrame(id: string) { S.activeFrameId = id; S.selectedSlice = null; S.result = null; render(); ensurePlan(id); }
function setField(f: FrameSummary, patch: Partial<FrameSummary['fields']>) { Object.assign(f.fields, patch); post({ type: 'set-frame-fields', frameId: f.id, fields: patch }); render(); if ('mobileFrameId' in patch) refreshPlan(f.id); }
function ensurePlan(id: string) { if (!S.plans[id]) post({ type: 'get-plan', frameId: id }); }
function refreshPlan(id: string) { post({ type: 'get-plan', frameId: id }); }
function refreshAll() { for (const f of S.frames) refreshPlan(f.id); }

async function checkRelay(loud = false) {
  if (!S.settings?.relayUrl) { S.relay = null; S.relayError = ''; render(); return; }
  try { S.relay = await relayHealth(S.settings); S.relayError = ''; if (loud) toast('Relay hoạt động.', 'ok'); }
  catch (e) { S.relay = null; S.relayError = `Không kết nối được ${S.settings.relayUrl}: ${(e as Error).message}`; if (loud) toast(S.relayError, 'err'); }
  render();
}

// ---------- providers ----------
async function freshProfile(p: Profile): Promise<Profile> {
  if (p.auth.type === 'oauth' && p.provider === 'klaviyo' && p.auth.refreshToken && p.auth.expiresAt && p.auth.expiresAt < Date.now() + 60_000 && S.settings) {
    const t = await oauthRefresh(S.settings, 'klaviyo', p.auth.refreshToken);
    p.auth = { ...p.auth, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
    post({ type: 'save-profiles', profiles: S.profiles });
  }
  return p;
}

function clientFor(p: Profile) {
  const call = makeCaller(S.settings!, p.provider, p.auth);
  return p.provider === 'mailchimp' ? new Mailchimp(call, p.auth.dc || (p.auth.type === 'apikey' ? p.auth.apiKey.split('-').pop() || '' : '')) : new Klaviyo(call);
}

async function testConnection(p: Profile) {
  S.connecting = true; render();
  try {
    await freshProfile(p);
    const c = clientFor(p);
    if (c instanceof Mailchimp) {
      const acc = await c.account();
      p.accountLabel = `${acc.name} (${acc.email})`;
      p.permissions = await c.permissions();
      try { S.lists[p.id] = await c.lists(); } catch (e) { toast(`Không tải được audiences: ${(e as Error).message}`, 'err'); }
      try { S.templates[p.id] = await c.templates(); if (p.templateId) await loadSections(p); } catch { /* optional */ }
    } else {
      const acc = await c.account();
      p.accountLabel = acc.name + (acc.test ? ' (test)' : '');
      p.permissions = await c.permissions(p.auth.type === 'oauth' ? (p.auth as any).scopes : undefined);
      try { S.lists[p.id] = await c.lists(); } catch (e) { toast(`Không tải được lists: ${(e as Error).message}`, 'err'); }
    }
    if (!p.name.trim()) p.name = p.accountLabel.split(' (')[0];
    toast(`Kết nối OK: ${p.accountLabel}`, 'ok');
  } catch (e) {
    p.accountLabel = '';
    toast((e as Error).message, 'err');
  } finally { S.connecting = false; render(); }
}

async function loadSections(p: Profile) {
  const c = clientFor(p);
  if (c instanceof Mailchimp && p.templateId) {
    try { S.sections[p.id] = await c.templateSections(p.templateId); if (S.sections[p.id].length && !S.sections[p.id].includes(p.templateSection)) p.templateSection = S.sections[p.id][0]; } catch { S.sections[p.id] = []; }
  }
}

async function connectOAuth(p: Profile) {
  if (!S.settings) return;
  S.connecting = true; render();
  try {
    const { sessionId, url } = await oauthStart(S.settings, p.provider);
    post({ type: 'open-url', url });
    toast(`Đã mở trình duyệt. Đăng nhập ${providerName(p.provider)} rồi quay lại đây.`, 'info');
    const started = Date.now();
    while (Date.now() - started < 5 * 60_000) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await oauthPoll(S.settings, sessionId);
      if (r.status === 'pending') continue;
      if (r.status === 'done' && r.auth) {
        p.auth = r.auth;
        p.accountLabel = (r.auth.type === 'oauth' && r.auth.accountName) || providerName(p.provider);
        S.connecting = false;
        await testConnection(p);
        return;
      }
      throw new Error(r.error || (r.status === 'expired' ? 'Phiên đăng nhập hết hạn.' : 'Đăng nhập thất bại.'));
    }
    throw new Error('Quá 5 phút chưa thấy đăng nhập.');
  } catch (e) { toast((e as Error).message, 'err'); }
  finally { S.connecting = false; render(); }
}

// ---------- the pipeline ----------
interface Exported { plan: SlicePlan; slices: ExportedSlice[]; mobile: { plan: SlicePlan; slices: ExportedSlice[] } | null }

async function exportFrame(f: FrameSummary, p: Profile | null): Promise<Exported> {
  const format = p?.imageFormat ?? 'PNG', scale = p?.scale ?? 2, q = p?.jpgQuality ?? 85;
  S.busy = { label: `Cắt & xuất ảnh “${f.name}”…`, done: 0, total: 0 }; render();
  post({ type: 'export', frameIds: [f.id], format, scale, jpgQuality: q });
  const done = await waitFor((m): m is Extract<ToUI, { type: 'export-done' | 'export-error' }> => (m.type === 'export-done' || m.type === 'export-error') && m.frameId === f.id, 10 * 60_000);
  if (done.type === 'export-error') throw new Error(done.message);
  S.busy = { label: 'Nén ảnh…', done: 0, total: 0 }; render();
  const slices = await finalizeSlices(done.slices, format, q);
  const mobile = done.mobile ? { plan: done.mobile.plan, slices: await finalizeSlices(done.mobile.slices, format, q) } : null;
  const bytes = slices.reduce((a, s) => a + s.bytes.length, 0) + (mobile ? mobile.slices.reduce((a, s) => a + s.bytes.length, 0) : 0);
  log(`${slices.length}${mobile ? ` + ${mobile.slices.length} mobile` : ''} lát · ${(bytes / 1024).toFixed(0)} KB (${format} ${scale}x)`);
  if (bytes > WEIGHT_ERROR) log(`Tổng ảnh ${(bytes / 1024 / 1024).toFixed(1)} MB — quá nặng. Đổi sang JPG hoặc 1x trong client.`, 'er');
  else if (bytes > WEIGHT_WARN) log(`Tổng ảnh ${(bytes / 1024).toFixed(0)} KB — nặng, cân nhắc JPG.`);
  return { plan: done.plan, slices, mobile };
}

async function uploadAll(p: Profile, f: FrameSummary, ex: Exported, prev: DraftRecord | null): Promise<{ images: Record<string, string>; mobileImages: Record<string, string>; files: Record<string, DraftFile> }> {
  const c = clientFor(p);
  const files: Record<string, DraftFile> = {};
  const images: Record<string, string> = {}, mobileImages: Record<string, string> = {};
  const all: { key: string; s: ExportedSlice; target: Record<string, string> }[] = [
    ...ex.slices.map((s) => ({ key: s.key, s, target: images })),
    ...(ex.mobile ? ex.mobile.slices.map((s) => ({ key: `m:${s.key}`, s, target: mobileImages })) : []),
  ];
  let reused = 0, uploaded = 0;
  const base = slug(f.fields.campaignName || f.name);
  for (let i = 0; i < all.length; i++) {
    const { key, s, target } = all[i];
    S.busy = { label: `Upload ảnh lên ${providerName(p.provider)}…`, done: i, total: all.length }; render();
    const old = prev?.files[key];
    if (old && old.hash === s.hash && old.url) { files[key] = old; target[s.key] = old.url; reused++; continue; }
    const name = `${base}-${key.replace(':', '-')}-${s.hash.slice(0, 6)}`;
    const up = c instanceof Mailchimp ? await c.uploadFile(`${name}.${extOf(s.format)}`, s.bytes) : await c.uploadImage(name, s.bytes, mimeOf(s.format));
    if (!up.url) throw new Error(`${providerName(p.provider)} không trả về URL ảnh.`);
    files[key] = { id: up.id != null ? String(up.id) : null, url: up.url, hash: s.hash };
    target[s.key] = up.url;
    uploaded++;
    if (old?.id) { if (c instanceof Mailchimp) void c.deleteFile(old.id); else void c.hideImage(old.id); }
  }
  // stale files from a previous run that no longer exist
  if (prev) for (const [k, old] of Object.entries(prev.files)) if (!files[k] && old.id) { if (c instanceof Mailchimp) void c.deleteFile(old.id); else void c.hideImage(old.id); }
  log(`Ảnh: ${uploaded} upload mới, ${reused} dùng lại (không đổi).`, 'ok');
  return { images, mobileImages, files };
}

function htmlFor(f: FrameSummary, p: Profile | null, ex: Exported, images: Record<string, string>, mobileImages: Record<string, string>, mode: 'fragment' | 'full'): string {
  const today = new Date().toISOString().slice(0, 10);
  return buildEmailHtml({
    plan: ex.plan,
    images,
    mobile: ex.mobile ? { plan: ex.mobile.plan, images: mobileImages } : null,
    title: f.fields.subject || f.fields.campaignName || f.name,
    preheader: f.fields.preheader,
    includePreheader: mode === 'full',
    fullDocument: mode === 'full',
    footerHtml: p?.footerHtml || '',
    provider: p?.provider ?? null,
    utm: p?.utmTemplate ? { template: p.utmTemplate, vars: { provider: p.provider, campaign: f.fields.campaignName || f.name, frame: f.name, date: today } } : null,
  });
}

function requireDraftFields(f: FrameSummary, p: Profile) {
  const miss: string[] = [];
  if (!f.fields.subject.trim()) miss.push('Subject');
  if (!p.audienceId) miss.push(`Audience (tab Client → ${p.name})`);
  if (p.provider === 'klaviyo') { if (!p.fromEmail.trim()) miss.push('From email (Klaviyo bắt buộc)'); if (!p.fromName.trim()) miss.push('From name'); }
  if (p.provider === 'mailchimp') { if (!p.fromName.trim()) miss.push('From name'); if (!p.replyTo.trim()) miss.push('Reply-to'); }
  if (miss.length) throw new Error(`Thiếu: ${miss.join(', ')}.`);
}

async function createDraft(f: FrameSummary, p: Profile) {
  requireDraftFields(f, p);
  await freshProfile(p);
  const c = clientFor(p);
  const prev = f.drafts[p.id] ?? null;
  let existing = prev;

  // Is the previous draft still editable?
  if (existing?.campaignId) {
    S.busy = { label: 'Kiểm tra draft cũ…', done: 0, total: 0 }; render();
    if (c instanceof Mailchimp) {
      const camp = await c.getCampaign(existing.campaignId);
      if (!camp || camp.status !== 'save') { log(camp ? `Draft cũ đã ${camp.status} — tạo draft mới.` : 'Draft cũ đã bị xoá — tạo mới.'); existing = { ...existing, campaignId: '' }; }
    } else {
      const camp = await c.getCampaign(existing.campaignId);
      if (!camp || !/draft/i.test(camp.status)) { log(camp ? `Campaign cũ đang ở trạng thái ${camp.status} — tạo draft mới.` : 'Draft cũ đã bị xoá — tạo mới.'); existing = { ...existing, campaignId: '', messageId: undefined }; }
      else if (!existing.messageId && camp.messageId) existing = { ...existing, messageId: camp.messageId };
    }
  }

  const ex = await exportFrame(f, p);
  const { images, mobileImages, files } = await uploadAll(p, f, ex, prev);
  S.busy = { label: existing?.campaignId ? 'Cập nhật draft…' : 'Tạo draft…', done: 0, total: 0 }; render();

  const draft: DraftRecord = { provider: p.provider, profileId: p.id, campaignId: existing?.campaignId || '', templateId: existing?.templateId, messageId: existing?.messageId, webUrl: existing?.webUrl, files, updatedAt: new Date().toISOString() };

  if (c instanceof Mailchimp) {
    const settings = { listId: p.audienceId, subject: f.fields.subject, previewText: f.fields.preheader, title: f.fields.campaignName || f.name, fromName: p.fromName, replyTo: p.replyTo };
    const camp = draft.campaignId ? await c.updateCampaign(draft.campaignId, settings) : await c.createCampaign(settings);
    draft.campaignId = camp.id;
    if (p.templateId) {
      const html = htmlFor(f, p, ex, images, mobileImages, 'fragment');
      await c.setContent(camp.id, { templateId: Number(p.templateId), section: p.templateSection || 'body', html });
      log(`Nội dung chèn vào template ${p.templateId} / section "${p.templateSection || 'body'}" — header/footer giữ nguyên.`);
    } else {
      const html = htmlFor(f, p, ex, images, mobileImages, 'full');
      await c.setContent(camp.id, { html });
      if (htmlSizeBytes(html) > GMAIL_CLIP_BYTES) log('HTML > 102KB — Gmail có thể cắt.', 'er');
    }
    draft.webUrl = c.editUrl(camp);
  } else {
    const html = htmlFor(f, p, ex, images, mobileImages, 'full');
    const tplName = `Phloem · ${f.fields.campaignName || f.name}`;
    if (draft.templateId && (await c.getTemplate(draft.templateId))) await c.updateTemplate(draft.templateId, tplName, html);
    else draft.templateId = await c.createTemplate(tplName, html);
    const msg = { name: f.fields.campaignName || f.name, listId: p.audienceId, subject: f.fields.subject, previewText: f.fields.preheader, fromEmail: p.fromEmail, fromLabel: p.fromName, replyTo: p.replyTo };
    if (draft.campaignId && draft.messageId) {
      await c.updateCampaign(draft.campaignId, msg.name, p.audienceId);
      await c.updateMessage(draft.messageId, msg);
    } else {
      const created = await c.createCampaign(msg);
      draft.campaignId = created.id; draft.messageId = created.messageId;
    }
    await c.assignTemplate(draft.messageId!, draft.templateId);
    draft.webUrl = c.editUrl(draft.campaignId);
    if (htmlSizeBytes(html) > GMAIL_CLIP_BYTES) log('HTML > 102KB — Gmail có thể cắt.', 'er');
  }

  post({ type: 'save-draft', frameId: f.id, profileId: p.id, draft });
  f.drafts[p.id] = draft;
  log(`${existing?.campaignId ? 'Đã cập nhật' : 'Đã tạo'} draft trong ${providerName(p.provider)}.`, 'ok');
  S.result = { kind: 'draft', text: `${existing?.campaignId ? 'Draft đã được cập nhật' : 'Draft đã tạo'} trong ${providerName(p.provider)} — duyệt rồi gửi ở đó.`, url: draft.webUrl };
}

async function copyHtml(f: FrameSummary, p: Profile | null, mode: 'fragment' | 'full') {
  if (!p) throw new Error('Copy HTML cần một client để host ảnh (hoặc dùng Tải .zip).');
  await freshProfile(p);
  const ex = await exportFrame(f, p);
  const prev = f.drafts[p.id] ?? null;
  const { images, mobileImages, files } = await uploadAll(p, f, ex, prev);
  const html = htmlFor(f, p, ex, images, mobileImages, mode);
  const ok = await copyText(html);
  if (!ok) { downloadBytes(`${slug(f.fields.campaignName || f.name)}.html`, utf8Bytes(html), 'text/html'); throw new Error('Không ghi được clipboard — đã tải file .html thay thế.'); }
  const draft: DraftRecord = { ...(prev ?? { provider: p.provider, profileId: p.id, campaignId: '' }), files, updatedAt: new Date().toISOString() };
  post({ type: 'save-draft', frameId: f.id, profileId: p.id, draft });
  f.drafts[p.id] = draft;
  const kb = (htmlSizeBytes(html) / 1024).toFixed(1);
  log(`HTML ${mode === 'fragment' ? 'nội dung' : 'đầy đủ'} ${kb} KB đã vào clipboard.`, 'ok');
  S.result = { kind: 'html', text: mode === 'fragment' ? `Đã copy HTML nội dung (${kb} KB). Dán vào khối Code/HTML trong template có brand của bạn.` : `Đã copy trang HTML đầy đủ (${kb} KB).` };
}

async function downloadZip(f: FrameSummary, p: Profile | null) {
  const ex = await exportFrame(f, p);
  const images: Record<string, string> = {}, mobileImages: Record<string, string> = {};
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const s of ex.slices) { const n = `images/${s.key}.${extOf(s.format)}`; images[s.key] = n; entries.push({ name: n, data: s.bytes }); }
  if (ex.mobile) for (const s of ex.mobile.slices) { const n = `images/mobile-${s.key}.${extOf(s.format)}`; mobileImages[s.key] = n; entries.push({ name: n, data: s.bytes }); }
  const html = htmlFor(f, p, ex, images, mobileImages, 'full');
  entries.unshift({ name: 'index.html', data: utf8Bytes(html) });
  entries.push({ name: 'README.txt', data: utf8Bytes(`Phloem export — ${f.name}\n\nindex.html tham chiếu ảnh tương đối trong images/. Upload images/ lên host của bạn rồi thay "images/" bằng URL tuyệt đối, hoặc dùng Create draft để Phloem upload tự động.\nKhông bao giờ tự gửi: bạn duyệt và bấm gửi.\n`) });
  const zip = makeZip(entries);
  downloadBytes(`${slug(f.fields.campaignName || f.name)}.zip`, zip, 'application/zip');
  log(`Đã tải ${(zip.length / 1024).toFixed(0)} KB (.zip).`, 'ok');
  S.result = { kind: 'zip', text: `Đã tải ${slug(f.fields.campaignName || f.name)}.zip — index.html + ${entries.length - 2} ảnh.` };
}

async function runAll(kind: 'draft' | 'html' | 'zip') {
  if (S.busy) return;
  const frames = S.frames.length ? S.frames : [];
  const p = activeProfile();
  S.log = []; S.result = null;
  const ok: string[] = [], failed: string[] = [];
  for (const f of frames) {
    try {
      if (kind === 'draft') { if (!p) throw new Error('Chọn client trước.'); await createDraft(f, p); }
      else if (kind === 'html') await copyHtml(f, p, S.htmlMode);
      else await downloadZip(f, p);
      ok.push(f.name);
    } catch (e) {
      const msg = e instanceof ApiError && e.isPermission ? `${f.name}: ${e.message}` : `${f.name}: ${(e as Error).message || e}`;
      failed.push(f.name); log(msg, 'er'); toast(msg, 'err');
    }
  }
  S.busy = null;
  if (frames.length > 1) { S.result = { kind, text: `Xong ${ok.length}/${frames.length} frame${failed.length ? ` — lỗi: ${failed.join(', ')}` : ''}.` }; }
  if (ok.length) { post({ type: 'notify', text: kind === 'draft' ? `Phloem: ${ok.length} draft sẵn sàng để duyệt.` : kind === 'html' ? 'Phloem: HTML đã vào clipboard.' : 'Phloem: đã tải .zip.' }); }
  render();
}

// ---------- messages from sandbox ----------
onMessage((m) => {
  switch (m.type) {
    case 'init':
      S.version = m.version; S.frames = m.frames; S.pageFrames = m.pageFrames; S.profiles = m.profiles; S.settings = m.settings;
      S.activeFrameId = m.frames[0]?.id ?? null;
      render(); if (S.activeFrameId) ensurePlan(S.activeFrameId); checkRelay();
      break;
    case 'selection': {
      S.frames = m.frames; S.pageFrames = m.pageFrames;
      if (!S.frames.find((f) => f.id === S.activeFrameId)) { S.activeFrameId = S.frames[0]?.id ?? null; S.selectedSlice = null; S.result = null; }
      for (const f of S.frames) refreshPlan(f.id);
      if (S.tab === 'design' && S.activeFrameId) post({ type: 'get-suggestions', frameId: S.activeFrameId });
      render(); break;
    }
    case 'plan': S.plans[m.frameId] = { plan: m.plan, checks: m.checks }; render(); break;
    case 'thumb': if (S.thumbs[m.frameId]) URL.revokeObjectURL(S.thumbs[m.frameId]); S.thumbs[m.frameId] = bytesToUrl(m.bytes); render(); break;
    case 'suggestions': S.suggestions[m.frameId] = { suggestions: m.suggestions, score: m.score }; render(); break;
    case 'export-progress': if (S.busy) { S.busy = { ...S.busy, done: m.done, total: m.total }; render(); } break;
    case 'profiles': S.profiles = m.profiles; render(); break;
    case 'settings': S.settings = m.settings; render(); break;
    case 'frame': { const i = S.frames.findIndex((f) => f.id === m.frame.id); if (i >= 0) S.frames[i] = m.frame; render(); break; }
    case 'toast': toast(m.text, m.kind); break;
    case 'optimize-done': S.optimizeChanges = m.changes; S.plans[m.frameId] = { ...(S.plans[m.frameId] || { plan: null as any }), checks: m.checks }; refreshPlan(m.frameId); post({ type: 'get-suggestions', frameId: m.frameId }); toast(m.changes.length ? `Đã tối ưu: ${m.changes.join(' · ')}` : 'Frame đã chuẩn.', 'ok'); render(); break;
    case 'export-done': case 'export-error': break; // consumed by waitFor
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void runAll('draft'); }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); void runAll('html'); }
});

render();
post({ type: 'ready' });
