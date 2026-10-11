import { useEffect, useRef, useState } from 'preact/hooks';
import type { Node } from '../model/types';
import * as ops from '../model/ops';
import { BLOCKS } from '../model/templates';
import { groupAssets, pageLabel, usedAssetIds } from '../storage/assetGroups';
import { assets } from '../storage/assets';
import { get, set, useStore, toast } from '../store';
import * as A from '../pipeline/actions';
import { Btn, Eyebrow } from './components';
import { Icon, type IconName } from './icons';
import { ask } from './confirm';

const ICON: Record<Node['type'], IconName> = { rect: 'rect', text: 'text', image: 'image', group: 'group' };

export function LeftPanel() {
  const s = useStore();
  return (
    <div class="panel">
      <div class="ptabs">
        <button class={`ptab ${s.leftTab === 'layers' ? 'on' : ''}`} onClick={() => set({ leftTab: 'layers' })}><Icon name="layers" size={13} />Layer</button>
        <button class={`ptab ${s.leftTab === 'blocks' ? 'on' : ''}`} onClick={() => set({ leftTab: 'blocks' })}><Icon name="blocks" size={13} />Block</button>
        <button class={`ptab ${s.leftTab === 'assets' ? 'on' : ''}`} onClick={() => set({ leftTab: 'assets' })}><Icon name="image" size={13} />Ảnh</button>
      </div>
      <div class="pbody">{s.leftTab === 'layers' ? <Layers /> : s.leftTab === 'blocks' ? <Blocks /> : <Assets />}</div>
    </div>
  );
}

function Layers() {
  const s = useStore();
  const doc = A.doc();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const toggle = (id: string) => { const n = new Set(collapsed); n.has(id) ? n.delete(id) : n.add(id); setCollapsed(n); };

  const onDrop = (target: Node, pos: 'before' | 'after') => {
    const from = dragId.current; dragId.current = null; setDropHint(null);
    if (!from || from === target.id) return;
    const d = A.doc();
    const list = d.nodes.slice();
    const fi = list.findIndex((n) => n.id === from), ti = list.findIndex((n) => n.id === target.id);
    if (fi < 0 || ti < 0) return; // only top-level reorder via drag
    const [n] = list.splice(fi, 1);
    let idx = list.findIndex((x) => x.id === target.id);
    // layers list is reversed (top = last). "before" in the list means higher z = after in array.
    idx = pos === 'before' ? idx + 1 : idx;
    list.splice(idx, 0, n);
    A.commit({ ...d, nodes: list });
  };

  const row = (n: Node, depth: number): preact.JSX.Element => {
    const on = s.selection.includes(n.id);
    const isGroup = n.type === 'group';
    const open = isGroup && !collapsed.has(n.id);
    return (
      <div key={n.id}>
        <div class={`layer ${on ? 'on' : ''} ${s.hover === n.id ? 'hov' : ''} ${!n.visible ? 'hidden' : ''} ${dropHint?.id === n.id ? `drop-${dropHint.pos}` : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable={depth === 0}
          onDragStart={(e) => { dragId.current = n.id; e.dataTransfer?.setData('text/plain', n.id); }}
          onDragOver={(e) => { if (depth !== 0 || !dragId.current) return; e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDropHint({ id: n.id, pos: e.clientY < r.top + r.height / 2 ? 'before' : 'after' }); }}
          onDragLeave={() => setDropHint(null)}
          onDrop={(e) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onDrop(n, e.clientY < r.top + r.height / 2 ? 'before' : 'after'); }}
          onClick={(e) => { if (e.shiftKey) A.toggleSelect(n.id); else A.select([n.id]); if (isGroup) set({ enteredGroup: null }); }}
          onDblClick={() => setRenaming(n.id)}
          onMouseEnter={() => set({ hover: n.id })} onMouseLeave={() => set({ hover: null })}>
          <span class={`caret ${open ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); if (isGroup) toggle(n.id); }}>{isGroup && <Icon name="chevron" />}</span>
          <Icon name={ICON[n.type]} class="ico" />
          <span class="nm">
            {renaming === n.id
              ? <input autoFocus value={n.name} onBlur={(e) => { A.updateNode(n.id, { name: (e.target as HTMLInputElement).value || n.name }); setRenaming(null); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} onClick={(e) => e.stopPropagation()} />
              : n.name}
          </span>
          {n.link && <Icon name="link" size={11} style={{ color: 'var(--neon-dim)' }} />}
          {n.block && <span class="tag">block</span>}
          <span class={`acts ${!n.visible || n.locked ? 'show' : ''}`}>
            <button class={n.locked ? 'on' : ''} title={n.locked ? 'Mở khoá' : 'Khoá'} onClick={(e) => { e.stopPropagation(); A.toggleLocked(n.id); }}><Icon name={n.locked ? 'lock' : 'unlock'} /></button>
            <button class={!n.visible ? 'on' : ''} title={n.visible ? 'Ẩn' : 'Hiện'} onClick={(e) => { e.stopPropagation(); A.toggleVisible(n.id); }}><Icon name={n.visible ? 'eye' : 'eyeOff'} /></button>
          </span>
        </div>
        {isGroup && open && n.children.slice().reverse().map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <div class="section">
      <Eyebrow action={{ label: s.selection.length ? 'Bỏ chọn' : 'Chọn tất cả', onClick: () => (s.selection.length ? A.clearSelection() : A.selectAll()) }}>{doc.nodes.length} layer</Eyebrow>
      {doc.nodes.length ? <div class="layers">{doc.nodes.slice().reverse().map((n) => row(n, 0))}</div> : <div class="empty"><div class="big">Chưa có layer</div><div class="small">Thêm block hoặc kéo ảnh vào artboard.</div><Btn sm kind="primary" onClick={() => set({ leftTab: 'blocks' })}>Xem block</Btn></div>}
      <div class="dim small">Kéo thả để đổi thứ tự. Double-click để đổi tên. <span class="kbd">⌘]</span> / <span class="kbd">⌘[</span> lên/xuống.</div>
    </div>
  );
}

const PREVIEWS: Record<string, { x: number; y: number; w: number; h: number; g?: boolean }[]> = {
  nav: [{ x: 6, y: 40, w: 22, h: 20 }, { x: 60, y: 42, w: 10, h: 16 }, { x: 74, y: 42, w: 10, h: 16 }, { x: 88, y: 42, w: 8, h: 16 }],
  hero: [{ x: 0, y: 0, w: 100, h: 50 }, { x: 6, y: 58, w: 60, h: 14 }, { x: 6, y: 78, w: 24, h: 16, g: true }],
  'hero-band': [{ x: 0, y: 0, w: 100, h: 62, g: true }, { x: 6, y: 12, w: 70, h: 16 }, { x: 6, y: 36, w: 24, h: 14 }, { x: 0, y: 66, w: 100, h: 34 }],
  stats: [{ x: 8, y: 30, w: 22, h: 22, g: true }, { x: 39, y: 30, w: 22, h: 22, g: true }, { x: 70, y: 30, w: 22, h: 22, g: true }, { x: 8, y: 60, w: 22, h: 6 }, { x: 39, y: 60, w: 22, h: 6 }, { x: 70, y: 60, w: 22, h: 6 }],
  quote: [{ x: 6, y: 10, w: 88, h: 80 }, { x: 14, y: 18, w: 10, h: 16, g: true }, { x: 14, y: 42, w: 70, h: 8 }, { x: 14, y: 56, w: 60, h: 8 }, { x: 14, y: 72, w: 30, h: 6 }],
  text: [{ x: 6, y: 18, w: 50, h: 14 }, { x: 6, y: 42, w: 88, h: 8 }, { x: 6, y: 56, w: 80, h: 8 }, { x: 6, y: 70, w: 60, h: 8 }],
  cta: [{ x: 36, y: 34, w: 28, h: 30, g: true }],
  'products-2': [{ x: 6, y: 14, w: 41, h: 50 }, { x: 53, y: 14, w: 41, h: 50 }, { x: 6, y: 70, w: 30, h: 8 }, { x: 53, y: 70, w: 30, h: 8 }],
  'products-3': [{ x: 4, y: 14, w: 28, h: 46 }, { x: 36, y: 14, w: 28, h: 46 }, { x: 68, y: 14, w: 28, h: 46 }, { x: 4, y: 66, w: 20, h: 8 }, { x: 36, y: 66, w: 20, h: 8 }, { x: 68, y: 66, w: 20, h: 8 }],
  'feature-row': [{ x: 6, y: 16, w: 40, h: 66 }, { x: 52, y: 20, w: 40, h: 12 }, { x: 52, y: 40, w: 42, h: 8 }, { x: 52, y: 54, w: 30, h: 8 }, { x: 52, y: 70, w: 20, h: 8, g: true }],
  divider: [{ x: 6, y: 48, w: 88, h: 3 }],
  spacer: [],
  footer: [{ x: 30, y: 20, w: 40, h: 10 }, { x: 14, y: 40, w: 72, h: 8 }, { x: 28, y: 60, w: 18, h: 8 }, { x: 54, y: 60, w: 18, h: 8 }],
};

function Blocks() {
  const s = useStore();
  return (
    <div class="section">
      <Eyebrow>Chèn block</Eyebrow>
      <div class="blocks">
        {BLOCKS.map((b) => (
          <button key={b.kind} class="block-tile" onClick={() => A.addBlock(b.kind)} title={`Chèn ${b.name} xuống cuối email`}>
            <div class="pv">{(PREVIEWS[b.kind] || []).map((r, i) => <i key={i} class={r.g ? 'g' : ''} style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />)}</div>
            <div class="nm">{b.name}</div><div class="ds">{b.desc}</div>
          </button>
        ))}
      </div>
      <Eyebrow>Sắp xếp</Eyebrow>
      <div class="row"><Btn sm icon="reflow" onClick={() => A.reflow()} title="Xếp lại các block liền nhau theo thứ tự dọc">Xếp lại block</Btn><Btn sm icon="fit" onClick={() => A.setDocHeightToContent()} title="Chiều cao artboard khớp nội dung">Khớp chiều cao</Btn></div>
      <Eyebrow>Bắt đầu lại</Eyebrow>
      <Btn sm block icon="sparkle" onClick={() => set({ modal: 'templates' })}>Chọn template khác…</Btn>
      <div class="dim small">Block là group có nhãn <span class="tag" style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--neon-dim)', border: '1px solid var(--line-2)', borderRadius: 3, padding: '0 4px' }}>block</span>. Kéo cả block để di chuyển, double-click để vào sửa từng phần.</div>
      {s.project?.mobile ? null : <div class="dim small">Mẹo: tạo bản mobile ở tab Email sau khi xong desktop.</div>}
    </div>
  );
}

function Assets() {
  const s = useStore();
  const [, bump] = useState(0);
  useEffect(() => assets.onChange(() => bump((n) => n + 1)), []);
  const [scope, setScope] = useState<'project' | 'all'>('project');
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const list = assets.all();
  const groups = groupAssets(list, { projectId: s.project?.id ?? null, usedIds: usedAssetIds(s.project), scope, query: q });
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const upload = async (files: FileList | File[]) => { for (const f of Array.from(files)) { if (!f.type.startsWith('image/')) continue; try { await assets.add(f, undefined, { src: { kind: 'upload' } }); } catch (e) { toast(`Không đọc được ${f.name}`, 'err'); } } bump((n) => n + 1); };
  const use = (id: string) => {
    const sel = A.selectedNodes();
    const img = sel.find((n) => n.type === 'image');
    if (img) { A.setImageAsset(img.id, id); toast('Đã thay ảnh cho layer đang chọn.', 'ok'); }
    else { const a = assets.get(id)!; const d = A.doc(); const w = Math.min(d.width, a.w); const h = Math.round(w * (a.h / a.w)); A.commit({ ...ops.insertNodes(d, [{ id: `n_${Date.now().toString(36)}`, type: 'image', name: a.name, x: Math.round((d.width - w) / 2), y: ops.contentHeight(d), w, h, visible: true, locked: false, opacity: 1, link: null, alt: a.name, assetId: id, fit: 'cover', radius: 0, fill: null, overlay: null }]), height: Math.max(d.height, ops.contentHeight(d) + h) }); }
  };
  return (
    <div class="section">
      <div class={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files) void upload(e.dataTransfer.files); }}>
        <Icon name="upload" /> <div>Thả ảnh vào đây hoặc bấm để chọn</div><div class="dim small">PNG, JPG, WebP, GIF · lưu trong trình duyệt</div>
      </div>
      <input ref={input} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) void upload(f); (e.target as HTMLInputElement).value = ''; }} />
      <div class="seg block" style={{ height: 26 }}><button class={scope === 'project' ? 'on' : ''} onClick={() => setScope('project')} title="Ảnh đang dùng, ảnh của dự án này và web đã đọc cho nó" style={{ whiteSpace: 'nowrap' }}>Dự án này</button><button class={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} style={{ whiteSpace: 'nowrap' }}>Tất cả ({list.length})</button></div>
      <input class="in" style={{ height: 26 }} placeholder="Tìm theo tên, website, trang…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.stopPropagation()} />
      {groups.length ? groups.map((g) => (
        <div key={g.key} class="section" style={{ gap: 6 }}>
          <Eyebrow action={{ label: closed[g.key] ? 'Mở' : 'Thu', onClick: () => setClosed((c) => ({ ...c, [g.key]: !c[g.key] })) }}>{g.label} · {g.items.length}</Eyebrow>
          {!closed[g.key] && (
            <div class="asset-grid">
              {g.items.map((a) => (
                <div key={a.id} class="asset" draggable title={`${a.name} · ${a.w}×${a.h} · ${(a.bytes / 1024).toFixed(0)} KB${a.src?.kind === 'web' ? `\nTừ ${a.src.host}${a.src.page || ''}` : ''}\nBấm: dùng cho layer ảnh đang chọn (hoặc thêm mới). Kéo vào email, hoặc thả ra cạnh artboard để xếp tạm.`} onClick={() => use(a.id)} onDragStart={(e) => { e.dataTransfer?.setData('text/phloem-asset', a.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }}>
                  {assets.url(a.id) ? <img src={assets.url(a.id)} alt="" /> : null}
                  <button class="del" title="Xoá khỏi thư viện" onClick={async (e) => { e.stopPropagation(); if (await ask(`Xoá "${a.name}" khỏi thư viện?`)) void assets.remove(a.id).then(() => bump((n) => n + 1)); }}>✕</button>
                  <div class="nm">{pageLabel(a) ? `${pageLabel(a)} · ` : ''}{a.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )) : <div class="dim small">{list.length ? (scope === 'project' ? `Dự án này chưa dùng ảnh nào. Bấm "Tất cả" để xem ${list.length} ảnh trong thư viện.` : 'Không có ảnh khớp tìm kiếm.') : 'Chưa có ảnh. Ảnh cũng có thể dán (⌘V) hoặc kéo thẳng lên artboard.'}</div>}
      {scope === 'project' && groups.length > 0 && shown < list.length && <div class="dim small">Còn {list.length - shown} ảnh khác trong thư viện · <span style={{ cursor: 'pointer', color: 'var(--neon)' }} onClick={() => setScope('all')}>xem tất cả</span></div>}
      <div class="dim small">{s.selection.length ? 'Bấm ảnh để gán vào layer đang chọn.' : 'Chọn một layer ảnh rồi bấm để thay, hoặc bấm để thêm layer mới.'}</div>
    </div>
  );
}
