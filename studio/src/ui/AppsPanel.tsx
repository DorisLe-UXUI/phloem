// "Ứng dụng" tab (Canva's Apps): QR code, charts, AI translate, bulk create from a sheet, templates.
import { useMemo, useState } from 'preact/hooks';
import type { ChartSpec, Doc, ImageNode, Node, Project, QrSpec, TextNode } from '../model/types';
import { uid } from '../model/types';
import * as ops from '../model/ops';
import * as A from '../pipeline/actions';
import { get, set, toast, useStore } from '../store';
import { chartSvg, parseChartData, qrSvg } from '../design/apps';
import { vec } from '../design/elements';
import { vectorAsset } from '../design/vector';
import { askClaude, relayAuth } from '../ai/client';
import { ask } from './confirm';
import { Btn, Eyebrow } from './components';
import { Icon, type IconName } from './icons';

type App = 'qr' | 'chart' | 'translate' | 'bulk' | 'templates';
const APPS: { v: App; label: string; icon: IconName; desc: string }[] = [
  { v: 'qr', label: 'Mã QR', icon: 'grid', desc: 'Link, số điện thoại, Wi-Fi… thành mã QR theo màu thương hiệu' },
  { v: 'chart', label: 'Biểu đồ', icon: 'blocks', desc: 'Cột, đường, tròn, vành khuyên, tiến độ; sửa số liệu được' },
  { v: 'translate', label: 'Dịch thiết kế', icon: 'text', desc: 'AI dịch mọi chữ sang ngôn ngữ khác, giữ bố cục' },
  { v: 'bulk', label: 'Tạo hàng loạt', icon: 'layers', desc: 'Một mẫu + bảng dữ liệu → nhiều thiết kế' },
  { v: 'templates', label: 'Mẫu', icon: 'image', desc: 'Lưu thiết kế làm mẫu, dùng lại cho bài khác' },
];

export function AppsPanel() {
  const [app, setApp] = useState<App | null>(null);
  if (!app) return (
    <div class="section apps">
      <Eyebrow>Ứng dụng</Eyebrow>
      <div class="app-grid">{APPS.map((a) => <button key={a.v} class="app-card" onClick={() => setApp(a.v)}><Icon name={a.icon} size={20} /><b>{a.label}</b><span>{a.desc}</span></button>)}</div>
    </div>
  );
  return (
    <div class="section apps">
      <button class="app-back" onClick={() => setApp(null)}><Icon name="chevron" size={12} /> Ứng dụng · {APPS.find((a) => a.v === app)!.label}</button>
      {app === 'qr' ? <QrApp /> : app === 'chart' ? <ChartApp /> : app === 'translate' ? <TranslateApp /> : app === 'bulk' ? <BulkApp /> : <TemplatesApp />}
    </div>
  );
}

/** The one selected image layer, when it was made by this app (so the app edits it instead of adding a new one). */
function selectedVector<K extends 'qr' | 'chart'>(key: K): ImageNode | null {
  const s = get(); if (s.selection.length !== 1) return null;
  const n = ops.findNode(A.doc(), s.selection[0]);
  return n && n.type === 'image' && n.vector?.[key] ? n : null;
}
async function placeVector(name: string, svg: string, w: number, h: number, extra: Partial<ImageNode['vector']>, existing: ImageNode | null) {
  if (existing) {
    const a = await vectorAsset(svg, existing.w, existing.h, name, null);
    A.updateNode(existing.id, { assetId: a.id, vector: { ...existing.vector!, svg, ...extra } } as Partial<Node>);
    return;
  }
  const at = A.viewCenter();
  const n = await vec(name, svg, Math.round(at.x - w / 2), Math.round(at.y - h / 2), w, h, null, 'graphic');
  A.insertLayers([{ ...n, fit: 'contain', vector: { ...n.vector!, ...extra } } as ImageNode]);
}

function brandColors(): string[] {
  const b = get().project?.brand;
  const c = (x: unknown) => (typeof x === 'string' && /^#/.test(x) ? x : null);
  return [c(b?.primary), c(b?.accent), c(b?.ink), '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'].filter((x): x is string => !!x);
}

function QrApp() {
  useStore();
  const cur = selectedVector('qr');
  const cols = brandColors();
  const [spec, setSpec] = useState<QrSpec>(() => cur?.vector?.qr || { text: 'https://', color: cols[2] || '#111111', bg: '#FFFFFF', style: 'rounded' });
  const preview = useMemo(() => { try { return qrSvg(spec).svg; } catch { return ''; } }, [spec]);
  const go = async () => { if (spec.text.trim().length < 2) { toast('Nhập nội dung cho mã QR.', 'err'); return; } const { svg } = qrSvg(spec); await placeVector('Mã QR', svg, 220, 220, { qr: spec }, cur); toast(cur ? 'Đã cập nhật mã QR.' : 'Đã chèn mã QR. Quét thử bằng điện thoại trước khi đăng.', 'ok'); };
  return (
    <div class="col" style={{ gap: 8 }}>
      <textarea class="in" rows={2} value={spec.text} placeholder="https://… · tel:0901… · WIFI:T:WPA;S:Ten;P:matkhau;;" onInput={(e) => setSpec({ ...spec, text: (e.target as HTMLTextAreaElement).value })} onKeyDown={(e) => e.stopPropagation()} />
      <div class="row wrap" style={{ gap: 4 }}>{cols.map((c) => <button key={c} class={`swatch ${spec.color === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => setSpec({ ...spec, color: c })} />)}<input type="color" value={spec.color} onInput={(e) => setSpec({ ...spec, color: (e.target as HTMLInputElement).value })} title="Màu khác" /></div>
      <div class="seg block">{(['square', 'rounded', 'dots'] as const).map((st) => <button key={st} class={spec.style === st ? 'on' : ''} onClick={() => setSpec({ ...spec, style: st })}>{st === 'square' ? 'Vuông' : st === 'rounded' ? 'Bo tròn' : 'Chấm'}</button>)}</div>
      <label class="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!spec.bg} onChange={(e) => setSpec({ ...spec, bg: (e.target as HTMLInputElement).checked ? '#FFFFFF' : null })} />Nền trắng (dễ quét hơn trên nền tối)</label>
      {preview && <div class="app-preview" dangerouslySetInnerHTML={{ __html: preview }} />}
      <Btn kind="primary" icon="plus" onClick={() => void go()}>{cur ? 'Cập nhật mã QR đang chọn' : 'Chèn mã QR'}</Btn>
    </div>
  );
}

function ChartApp() {
  useStore();
  const cur = selectedVector('chart');
  const cols = brandColors();
  const init: ChartSpec = cur?.vector?.chart || { kind: 'bar', data: [{ label: 'T1', value: 42 }, { label: 'T2', value: 58 }, { label: 'T3', value: 73 }, { label: 'T4', value: 91 }], colors: cols, ink: '#1F2937', showValues: true, title: '', unit: '' };
  const [spec, setSpec] = useState<ChartSpec>(init);
  const [text, setText] = useState(init.data.map((x) => `${x.label}: ${x.value}`).join('\n'));
  const upd = (p: Partial<ChartSpec>) => setSpec((s) => ({ ...s, ...p }));
  const preview = useMemo(() => chartSvg(spec, 600, 400), [spec]);
  const go = async () => { if (!spec.data.length) { toast('Nhập số liệu, mỗi dòng "Nhãn: số".', 'err'); return; } await placeVector(spec.title || 'Biểu đồ', chartSvg(spec, 600, 400), 480, 320, { chart: spec }, cur); toast(cur ? 'Đã cập nhật biểu đồ.' : 'Đã chèn biểu đồ. Chọn nó rồi mở lại Biểu đồ để sửa số.', 'ok'); };
  return (
    <div class="col" style={{ gap: 8 }}>
      <div class="dp-cats">{([['bar', 'Cột'], ['hbar', 'Thanh ngang'], ['line', 'Đường'], ['area', 'Vùng'], ['pie', 'Tròn'], ['donut', 'Vành khuyên'], ['progress', 'Tiến độ %']] as const).map(([k, l]) => <button key={k} class={`chip ${spec.kind === k ? 'on' : ''}`} onClick={() => upd({ kind: k })}>{l}</button>)}</div>
      <input class="in" placeholder="Tiêu đề (không bắt buộc)" value={spec.title || ''} onInput={(e) => upd({ title: (e.target as HTMLInputElement).value })} onKeyDown={(e) => e.stopPropagation()} />
      <textarea class="in mono" rows={6} value={text} placeholder={'Mỗi dòng một mục, ví dụ:\nTháng 1: 120\nTháng 2: 180'} onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; setText(v); upd({ data: parseChartData(v) }); }} onKeyDown={(e) => e.stopPropagation()} />
      <div class="row" style={{ gap: 6 }}>
        <input class="in" style={{ width: 70 }} placeholder="Đơn vị" value={spec.unit || ''} onInput={(e) => upd({ unit: (e.target as HTMLInputElement).value })} onKeyDown={(e) => e.stopPropagation()} />
        <label class="row small" style={{ gap: 4 }}><input type="checkbox" checked={spec.showValues} onChange={(e) => upd({ showValues: (e.target as HTMLInputElement).checked })} />Hiện số</label>
        <label class="row small" style={{ gap: 4 }}><input type="checkbox" checked={spec.ink === '#FFFFFF'} onChange={(e) => upd({ ink: (e.target as HTMLInputElement).checked ? '#FFFFFF' : '#1F2937' })} />Chữ trắng</label>
      </div>
      <div class="app-preview chart" style={{ background: spec.ink === '#FFFFFF' ? '#1F2937' : '#fff' }} dangerouslySetInnerHTML={{ __html: preview }} />
      <Btn kind="primary" icon="plus" onClick={() => void go()}>{cur ? 'Cập nhật biểu đồ đang chọn' : 'Chèn biểu đồ'}</Btn>
    </div>
  );
}

const LANGS = [['en', 'Tiếng Anh'], ['vi', 'Tiếng Việt'], ['ja', 'Tiếng Nhật'], ['ko', 'Tiếng Hàn'], ['zh', 'Tiếng Trung (giản thể)'], ['th', 'Tiếng Thái'], ['fr', 'Tiếng Pháp'], ['es', 'Tiếng Tây Ban Nha'], ['de', 'Tiếng Đức'], ['id', 'Tiếng Indonesia']] as const;
function TranslateApp() {
  const [lang, setLang] = useState<string>('en');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const d = A.doc(); const texts = ops.flat(d.nodes).filter((n): n is TextNode => n.type === 'text' && !!n.text.trim());
    if (!texts.length) { toast('Thiết kế chưa có chữ nào để dịch.', 'err'); return; }
    setBusy(true);
    try {
      const name = LANGS.find((l) => l[0] === lang)?.[1] || lang;
      const out = await askClaude({ system: `You translate the words of a marketing design into ${name} (${lang}). Keep brand and product names, URLs, @handles, #hashtags, prices and numbers as they are. Keep line breaks. Stay about as long as the original so the layout still fits; natural, persuasive marketing language for that market. Reply with JSON only: {"id":"translation", ...} for every id given.`, turns: [{ role: 'user', text: JSON.stringify(Object.fromEntries(texts.map((t) => [t.id, t.text]))) }], maxTokens: 6000, effort: 'low' });
      const map = JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]) as Record<string, string>;
      let n = 0;
      A.commit(ops.mapNodes(A.doc(), (x) => (x.type === 'text' && typeof map[x.id] === 'string' && map[x.id].trim() ? (n++, A.fixTextHeight({ ...x, text: map[x.id] })) : x)));
      toast(`Đã dịch ${n} đoạn chữ sang ${name}. ⌘Z để hoàn tác.`, 'ok');
    } catch (e) { toast(`Không dịch được: ${(e as Error).message}`, 'err'); }
    finally { setBusy(false); }
  };
  return (
    <div class="col" style={{ gap: 8 }}>
      <span class="small muted">AI dịch mọi lớp chữ của thiết kế đang mở, giữ tên thương hiệu, link, hashtag, giá. Muốn giữ bản gốc: nhân bản thiết kế trước (Trang chủ → ⧉).</span>
      <select class="in" value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value)}>{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <Btn kind="primary" icon="sparkle" disabled={busy} onClick={() => void run()}>{busy ? 'AI đang dịch…' : 'Dịch thiết kế'}</Btn>
    </div>
  );
}

/** Rows of a pasted table (tab, comma or semicolon separated; first row = column names). */
function parseTable(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0]?.includes('\t') ? '\t' : lines[0]?.includes(';') ? ';' : ',';
  return lines.map((l) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; });
}
function BulkApp() {
  const s = useStore();
  const fields = useMemo(() => [...new Set(ops.flat(A.doc().nodes).flatMap((n) => (n.type === 'text' ? [...n.text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]) : [])))], [s.project?.updatedAt, s.selection.length]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const loadSheet = async () => {
    const link = text.trim(); if (!/docs\.google\.com\/spreadsheets/.test(link)) return false;
    const { sheetCsvUrl } = await import('../catalog/catalog');
    const relay = (get().settings.relayUrl || '').replace(/\/$/, '');
    const r = await fetch(`${relay}/csv`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...relayAuth() }, body: JSON.stringify({ url: sheetCsvUrl(link) || link }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Không đọc được Sheet (chia sẻ "Bất kỳ ai có đường liên kết").');
    setText(String(j.text || '')); return true;
  };
  const rows = parseTable(text);
  const head = rows[0] || []; const data = rows.slice(1);
  const missing = fields.filter((f) => !head.some((h) => h.toLowerCase() === f.toLowerCase()));
  const run = async () => {
    try {
      if (await loadSheet()) return;
      if (!fields.length) { toast('Gõ {{tên_cột}} vào các lớp chữ của thiết kế, ví dụ {{ten}} hay {{gia}}.', 'err'); return; }
      if (!data.length) { toast('Dán bảng dữ liệu (dòng đầu là tên cột).', 'err'); return; }
      if (!(await ask(`Tạo ${data.length} thiết kế từ mẫu này?`, 'Tạo', false))) return;
      const p = get().project!; const { db } = await import('../storage/idb'); const { cloud } = await import('../storage/sync'); const { thumbnail } = await import('../render/renderer'); const { assets } = await import('../storage/assets');
      const idx = (f: string) => head.findIndex((h) => h.toLowerCase() === f.toLowerCase());
      for (let i = 0; i < data.length; i++) {
        setBusy(`Đang tạo ${i + 1}/${data.length}…`);
        const row = data[i]; const fill = (t: string) => t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, f) => { const k = idx(f); return k >= 0 ? row[k] || '' : _m; });
        const doc: Doc = ops.mapNodes(structuredClone(A.doc()), (n) => (n.type === 'text' ? A.fixTextHeight({ ...n, text: fill(n.text) }) : n));
        const now = new Date().toISOString();
        const np: Project = { ...structuredClone(p), id: uid('p'), name: `${p.name} · ${row[0] || i + 1}`.slice(0, 90), createdAt: now, updatedAt: now, desktop: doc, mobile: null, rowRef: undefined, template: false, design: null };
        let thumb: string | undefined; try { thumb = thumbnail(doc, p.brand, assets, 360, doc.height / doc.width); } catch { /* fonts */ }
        const stored = { ...np, thumb, owner: get().user?.id || '' };
        await db.putProject(stored as Project); cloud.pushProjectSoon(stored as Project);
      }
      await A.refreshProjects();
      toast(`Đã tạo ${data.length} thiết kế${p.kind === 'design' ? ' (ở Thiết kế → Thiết kế khác, và trên canvas)' : ''}.`, 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(''); }
  };
  return (
    <div class="col" style={{ gap: 8 }}>
      <span class="small muted">1. Gõ <code>{'{{tên_cột}}'}</code> vào chữ của thiết kế (ví dụ <code>{'{{ten_san_pham}}'}</code>, <code>{'{{gia}}'}</code>). 2. Dán bảng (copy từ Excel / Google Sheets, dòng đầu là tên cột) hoặc link Google Sheet. 3. Bấm Tạo.</span>
      <div class="small">Trường trong thiết kế: {fields.length ? fields.map((f) => <code key={f} style={{ marginRight: 4 }}>{f}</code>) : <i class="dim">chưa có</i>}</div>
      <textarea class="in mono" rows={6} value={text} placeholder={'ten_san_pham\tgia\nMáy khoan\t1.290.000đ\nMáy mài\t890.000đ'} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => e.stopPropagation()} />
      {data.length > 0 && <span class="small">{data.length} dòng dữ liệu{missing.length ? ` · thiếu cột: ${missing.join(', ')}` : ' · đủ cột'}</span>}
      <Btn kind="primary" icon="layers" disabled={!!busy} onClick={() => void run()}>{busy || (/docs\.google\.com\/spreadsheets/.test(text) ? 'Đọc Google Sheet' : `Tạo ${data.length || ''} thiết kế`)}</Btn>
    </div>
  );
}

function TemplatesApp() {
  const s = useStore();
  const p = s.project!;
  const kind = p.kind === 'design' ? 'design' : 'email';
  const list = s.projects.filter((m) => m.template && (m.kind === 'design' ? 'design' : 'email') === kind);
  const save = async () => { A.patchProject({ template: !p.template }); await A.saveProject(); await A.refreshProjects(); toast(p.template ? 'Đã bỏ khỏi Mẫu.' : 'Đã lưu làm mẫu. Mở thiết kế khác → Ứng dụng → Mẫu để dùng.', 'ok'); };
  const use = async (id: string) => {
    if (!(await ask('Thay nội dung thiết kế đang mở bằng mẫu này? ⌘Z để hoàn tác.', 'Dùng mẫu', false))) return;
    const { db } = await import('../storage/idb'); const t = await db.getProject(id); if (!t) return;
    const { resizeDoc } = await import('../mkt/designs');
    const cur = A.doc();
    A.commit(t.desktop.width === cur.width && t.desktop.height === cur.height ? structuredClone(t.desktop) : resizeDoc(structuredClone(t.desktop), cur.width, cur.height));
    toast('Đã dùng mẫu. Sửa chữ và ảnh cho bài này.', 'ok');
  };
  return (
    <div class="col" style={{ gap: 8 }}>
      <Btn kind={p.template ? 'ghost' : 'primary'} icon="plus" onClick={() => void save()}>{p.template ? 'Bỏ thiết kế này khỏi Mẫu' : 'Lưu thiết kế này làm mẫu'}</Btn>
      <Eyebrow>Mẫu của bạn · {list.length}</Eyebrow>
      {!list.length && <span class="dim small">Chưa có mẫu. Mở một thiết kế đẹp và bấm "Lưu làm mẫu".</span>}
      <div class="asset-grid">{list.filter((m) => m.id !== p.id).map((m) => <button key={m.id} class="asset" title={`${m.name} · bấm để dùng`} onClick={() => void use(m.id)}>{m.thumb ? <img src={m.thumb} alt={m.name} /> : null}<div class="nm">{m.name}</div></button>)}</div>
    </div>
  );
}
