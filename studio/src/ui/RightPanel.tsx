import { useEffect, useState } from 'preact/hooks';
import type { Check, Suggestion } from '../../../src/shared/types';
import type { ImageNode, Node, RectNode, TextNode, GroupNode } from '../model/types';
import { FONTS } from '../model/types';
import * as ops from '../model/ops';
import { assets } from '../storage/assets';
import { set, useStore } from '../store';
import * as A from '../pipeline/actions';
import { activeProfile, providerName, runExport } from '../pipeline/exportFlow';
import { ensureFont } from '../render/fonts';
import { Btn, ColorInput, Eyebrow, Field, Num, Ring, Seg, Select, TextArea, TextInput, Toggle, Progress } from './components';
import { Icon } from './icons';
import { ask, isArtifact } from './confirm';
import { AiPanel } from './AiPanel';

export function RightPanel() {
  const s = useStore();
  const a = A.analyze();
  const issues = a ? a.checks.filter((c) => c.level !== 'info').length : 0;
  return (
    <div class="panel right">
      <div class="ptabs">
        <button class={`ptab ${s.rightTab === 'design' ? 'on' : ''}`} onClick={() => set({ rightTab: 'design' })}>Thiết kế</button>
        <button class={`ptab ${s.rightTab === 'email' ? 'on' : ''}`} onClick={() => set({ rightTab: 'email' })}>Email{issues ? <span class="n">{issues}</span> : null}</button>
        <button class={`ptab ${s.rightTab === 'export' ? 'on' : ''}`} onClick={() => set({ rightTab: 'export' })}>Xuất</button>
        <button class={`ptab ${s.rightTab === 'ai' ? 'on' : ''}`} onClick={() => set({ rightTab: 'ai' })} title="Trợ lý AI và dựng 3 phương án"><Icon name="sparkle" size={13} />AI</button>
      </div>
      <div class="pbody">{s.rightTab === 'design' ? <DesignTab /> : s.rightTab === 'email' ? <EmailTab /> : s.rightTab === 'export' ? <ExportTab /> : <AiPanel />}</div>
    </div>
  );
}

// ---------------- Design ----------------
function DesignTab() {
  const nodes = A.selectedNodes();
  if (!nodes.length) return <ArtboardProps />;
  if (nodes.length > 1) return <MultiProps nodes={nodes} />;
  return <NodeProps n={nodes[0]} />;
}

function ArtboardProps() {
  const s = useStore();
  const d = A.doc(); const b = s.project!.brand;
  return (
    <div class="props">
      <div class="prop-h"><Icon name={s.variant === 'mobile' ? 'mobile' : 'desktop'} class="ico" /><b class="grow">Artboard {s.variant === 'mobile' ? 'mobile' : 'desktop'}</b></div>
      <div class="grid2">
        <Num label="W" value={d.width} min={320} max={800} onChange={(v) => A.commit(ops.setDocWidth(d, Math.round(v)))} suffix="px" title="Chiều rộng (600 chuẩn email)" />
        <Num label="H" value={d.height} min={100} max={10000} onChange={(v) => A.setDocProps({ height: Math.round(v) })} suffix="px" />
      </div>
      <Field label="Nền"><ColorInput value={d.bg} brand={b} onChange={(c) => A.setDocProps({ bg: c || '#ffffff' })} /></Field>
      <div class="row"><Btn sm icon="fit" onClick={() => A.setDocHeightToContent()}>Khớp nội dung</Btn><Btn sm icon="reflow" onClick={() => A.reflow()}>Xếp lại block</Btn></div>
      <Eyebrow action={{ label: 'Chỉnh', onClick: () => set({ modal: 'brand' }) }}>Brand kit</Eyebrow>
      <div class="row wrap">
        {(['primary', 'ink', 'muted', 'bg', 'soft', 'line'] as const).map((t) => <span key={t} class="chip" title={t} style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: b[t], display: 'inline-block', border: '1px solid rgba(255,255,255,.15)' }} />{t}</span>)}
      </div>
      <div class="small muted">Font: <b>{b.fontFamily}</b>{b.headingFamily !== b.fontFamily ? <> · tiêu đề <b>{b.headingFamily}</b></> : null}</div>
      <Eyebrow>Lưới & bắt dính</Eyebrow>
      <Toggle checked={s.settings.snap} onChange={(v) => set({ settings: { ...s.settings, snap: v } })} label="Bắt dính cạnh / tâm" sub="Giữ ⌥ để tắt tạm" />
      <Toggle checked={s.settings.grid} onChange={(v) => set({ settings: { ...s.settings, grid: v } })} label="Hiện lưới 24px" />
      <div class="dim small">Chọn một layer để sửa thuộc tính. <span class="kbd">⌘A</span> chọn tất cả.</div>
    </div>
  );
}

function MultiProps({ nodes }: { nodes: Node[] }) {
  return (
    <div class="props">
      <div class="prop-h"><Icon name="group" class="ico" /><b class="grow">{nodes.length} layer</b></div>
      <Eyebrow>Căn chỉnh</Eyebrow>
      <AlignRow />
      <div class="row"><Btn sm block icon="group" onClick={() => A.groupSelection()}>Nhóm (⌘G)</Btn><Btn sm block icon="copy" onClick={() => A.duplicateSelection()}>Nhân bản</Btn></div>
      <Eyebrow>Chung</Eyebrow>
      <Field label="Link cho tất cả" hint="https://…"><TextInput value={commonValue(nodes, (n) => n.link || '')} placeholder="https://…" onCommit={(v) => A.updateSelected((n) => ({ ...n, link: v.trim() || null }))} /></Field>
      <Num label="Mờ" value={Math.round(nodes[0].opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => A.updateSelected((n) => ({ ...n, opacity: v / 100 }))} />
      <Btn sm block kind="danger" icon="trash" onClick={() => A.deleteSelection()}>Xoá {nodes.length} layer</Btn>
    </div>
  );
}

function commonValue(nodes: Node[], f: (n: Node) => string): string { const v = f(nodes[0]); return nodes.every((n) => f(n) === v) ? v : ''; }

function AlignRow() {
  return (
    <div class="col">
      <div class="aligns">
        <Btn sm icon="alignL" title="Căn trái" onClick={() => A.alignSelection('left')} /><Btn sm icon="alignC" title="Căn giữa ngang" onClick={() => A.alignSelection('hcenter')} /><Btn sm icon="alignR" title="Căn phải" onClick={() => A.alignSelection('right')} />
        <Btn sm icon="alignT" title="Căn trên" onClick={() => A.alignSelection('top')} /><Btn sm icon="alignM" title="Căn giữa dọc" onClick={() => A.alignSelection('vcenter')} /><Btn sm icon="alignB" title="Căn dưới" onClick={() => A.alignSelection('bottom')} />
      </div>
      <div class="row"><Btn sm block icon="distH" title="Dàn đều ngang" onClick={() => A.distributeSelection('h')}>Dàn ngang</Btn><Btn sm block icon="distV" title="Dàn đều dọc" onClick={() => A.distributeSelection('v')}>Dàn dọc</Btn></div>
    </div>
  );
}

function NodeProps({ n }: { n: Node }) {
  const bb = ops.bounds(n);
  const up = (patch: Partial<Node>) => A.updateNode(n.id, patch);
  const setRect = (r: Partial<ops.Rect>) => A.commit(ops.resizeTo(A.doc(), n.id, { ...bb, ...r }, false));
  return (
    <div class="props">
      <div class="prop-h"><Icon name={n.type === 'group' ? 'group' : n.type} class="ico" /><TextInput value={n.name} onCommit={(v) => up({ name: v || n.name })} /></div>
      <div class="grid2">
        <Num label="X" value={bb.x} onChange={(v) => A.commit(ops.moveBy(A.doc(), [n.id], Math.round(v) - bb.x, 0))} />
        <Num label="Y" value={bb.y} onChange={(v) => A.commit(ops.moveBy(A.doc(), [n.id], 0, Math.round(v) - bb.y))} />
        <Num label="W" value={bb.w} min={1} onChange={(v) => setRect({ w: Math.round(v) })} />
        <Num label="H" value={bb.h} min={1} disabled={n.type === 'text' && n.autoHeight} onChange={(v) => setRect({ h: Math.round(v) })} title={n.type === 'text' && n.autoHeight ? 'Tự theo nội dung' : ''} />
      </div>
      <div class="grid2">
        <Num label="Mờ" value={Math.round(n.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => up({ opacity: v / 100 })} />
        {n.type === 'rect' || n.type === 'image' ? <Num label="Bo" value={n.radius} min={0} suffix="px" onChange={(v) => up({ radius: Math.round(v) } as Partial<Node>)} /> : <div />}
      </div>
      <Eyebrow>Căn</Eyebrow>
      <AlignRow />
      {n.type === 'text' && <TextProps n={n} />}
      {n.type === 'rect' && <RectProps n={n} />}
      {n.type === 'image' && <ImageProps n={n} />}
      {n.type === 'group' && (
        <div class="section">
          <Eyebrow>Nhóm</Eyebrow>
          <div class="small muted">{n.children.length} layer con{n.block ? ` · block "${n.block}"` : ''}. Double-click trên artboard để sửa bên trong.</div>
          <Btn sm icon="group" onClick={() => A.ungroupSelection()}>Bỏ nhóm (⇧⌘G)</Btn>
        </div>
      )}
      {n.type === 'group' && <BlockBg g={n} />}
      <Eyebrow>Email</Eyebrow>
      <Field label="Link" hint={n.link ? 'cả vùng này là 1 link' : 'https:// · mailto: · *|UNSUB|*'}><TextInput value={n.link || ''} mono placeholder="https://…" onCommit={(v) => up({ link: v.trim() || null })} /></Field>
      <Field label="Alt text" hint="hiện khi ảnh bị chặn"><TextInput value={n.alt} placeholder={n.type === 'text' ? 'mặc định: nội dung chữ' : 'mô tả ảnh'} onCommit={(v) => up({ alt: v })} /></Field>
      <Eyebrow>Thứ tự</Eyebrow>
      <div class="grid4">
        <Btn xs icon="up" title="Lên trên (⌘])" onClick={() => A.reorderSelection('up')} /><Btn xs icon="down" title="Xuống dưới (⌘[)" onClick={() => A.reorderSelection('down')} />
        <Btn xs icon={n.locked ? 'lock' : 'unlock'} on={n.locked} title="Khoá" onClick={() => A.toggleLocked(n.id)} /><Btn xs icon={n.visible ? 'eye' : 'eyeOff'} on={!n.visible} title="Ẩn/hiện" onClick={() => A.toggleVisible(n.id)} />
      </div>
      <div class="row"><Btn sm block icon="copy" onClick={() => A.duplicateSelection()}>Nhân bản</Btn><Btn sm block kind="danger" icon="trash" onClick={() => A.deleteSelection()}>Xoá</Btn></div>
    </div>
  );
}

function TextProps({ n }: { n: TextNode }) {
  const s = useStore(); const b = s.project!.brand;
  const up = (patch: Partial<TextNode>) => A.patchTextFlow(n.id, patch);
  const fontOpts = [{ v: 'brand', label: `Brand (${b.fontFamily})` }, { v: 'heading', label: `Tiêu đề (${b.headingFamily})` }, ...FONTS.map((f) => ({ v: f.family, label: f.label }))];
  return (
    <div class="section">
      <Eyebrow>Chữ</Eyebrow>
      <TextArea class="textarea-text" value={n.text} rows={3} onCommit={(v) => up({ text: v })} onInput={(v) => A.patchTextFlow(n.id, { text: v }, false)} />
      <Select value={n.fontFamily} options={fontOpts} onChange={(v) => { ensureFont(v); up({ fontFamily: v }); }} />
      <div class="grid2">
        <Num label="Cỡ" value={n.fontSize} min={6} max={200} suffix="px" onChange={(v) => up({ fontSize: v })} />
        <Select value={String(n.fontWeight)} options={[['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extrabold']].map(([v, l]) => ({ v, label: l }))} onChange={(v) => up({ fontWeight: Number(v) })} />
      </div>
      <div class="grid2">
        <Num label="LH" value={n.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => up({ lineHeight: v })} title="Line height (x cỡ chữ)" />
        <Num label="LS" value={n.letterSpacing} min={-5} max={20} step={0.1} suffix="px" onChange={(v) => up({ letterSpacing: v })} title="Letter spacing" />
      </div>
      <div class="row">
        <Seg value={n.align} options={[{ v: 'left', icon: 'alignL', title: 'Trái' }, { v: 'center', icon: 'alignC', title: 'Giữa' }, { v: 'right', icon: 'alignR', title: 'Phải' }]} onChange={(v) => up({ align: v })} />
        <div class="seg"><button class={n.italic ? 'on' : ''} title="Nghiêng" onClick={() => up({ italic: !n.italic })}><Icon name="italic" /></button><button class={n.underline ? 'on' : ''} title="Gạch chân" onClick={() => up({ underline: !n.underline })}><Icon name="underline" /></button><button class={n.strike ? 'on' : ''} title="Gạch ngang (giá cũ)" onClick={() => up({ strike: !n.strike })}><span style={{ textDecoration: 'line-through', fontWeight: 700 }}>S</span></button></div>
      </div>
      <Field label="Màu chữ"><ColorInput value={n.color} brand={b} onChange={(c) => up({ color: c || '#000000' })} /></Field>
      <Toggle checked={n.autoHeight} onChange={(v) => up({ autoHeight: v })} label="Chiều cao tự theo nội dung" />
      {!n.autoHeight && <Seg block value={n.vAlign} options={[{ v: 'top', label: 'Trên' }, { v: 'middle', label: 'Giữa' }, { v: 'bottom', label: 'Dưới' }]} onChange={(v) => up({ vAlign: v })} />}
      <Eyebrow>Hiệu ứng 3D</Eyebrow>
      <div class="row">
        <div class="grow"><Select value={(n.effect?.kind || 'none') as 'none' | 'extrude' | 'neon' | 'outline' | 'shadow'} options={[{ v: 'none', label: 'Không' }, { v: 'extrude', label: 'Đùn khối 3D' }, { v: 'neon', label: 'Neon phát sáng' }, { v: 'outline', label: 'Chữ rỗng viền' }, { v: 'shadow', label: 'Bóng dài' }]} onChange={(v) => up({ effect: v === 'none' ? null : { kind: v, depth: n.effect?.depth, angle: n.effect?.angle, color: n.effect?.color } })} /></div>
        {n.effect && (n.effect.kind === 'extrude' || n.effect.kind === 'shadow') && <div style={{ width: 86 }}><Num label="Sâu" value={n.effect.depth ?? (n.effect.kind === 'shadow' ? 18 : 7)} min={1} max={40} suffix="px" onChange={(v) => up({ effect: { ...n.effect!, depth: v } })} /></div>}
      </div>
      {n.effect && <Field label="Màu hiệu ứng" hint="trống = tự đậm hơn chữ"><ColorInput value={n.effect.color ?? null} brand={b} allowNone onChange={(c) => up({ effect: { ...n.effect!, color: c ?? undefined } })} /></Field>}
    </div>
  );
}

function RectProps({ n }: { n: RectNode }) {
  const s = useStore(); const b = s.project!.brand;
  const up = (patch: Partial<RectNode>) => A.updateNode(n.id, patch as Partial<Node>);
  return (
    <div class="section">
      <Eyebrow>Hình</Eyebrow>
      <Field label="Nền"><ColorInput value={n.fill} brand={b} allowNone onChange={(c) => up({ fill: c })} /></Field>
      <Toggle checked={!!n.gradient} onChange={(v) => up({ gradient: v ? { from: { token: 'primary' }, to: { token: 'accent' }, angle: 135 } : null })} label="Gradient primary → accent" sub="Đổi hai màu trong Brand kit" />
      {n.gradient && <div class="grid2"><Field label="Từ"><ColorInput value={n.gradient.from} brand={b} onChange={(c) => up({ gradient: { ...n.gradient!, from: c || '#000000' } })} /></Field><Field label="Đến"><ColorInput value={n.gradient.to} brand={b} onChange={(c) => up({ gradient: { ...n.gradient!, to: c || '#000000' } })} /></Field></div>}
      {n.gradient && <Num label="Góc gradient" value={n.gradient.angle} min={0} max={360} suffix="°" onChange={(v) => up({ gradient: { ...n.gradient!, angle: Math.round(v) } })} />}
      <Field label="Viền">
        <div class="row">
          <div class="grow"><ColorInput value={n.stroke?.color ?? null} brand={b} allowNone onChange={(c) => up({ stroke: c ? { color: c, width: n.stroke?.width || 1 } : null })} /></div>
          <div style={{ width: 80 }}><Num label="W" value={n.stroke?.width ?? 0} min={0} max={40} onChange={(v) => up({ stroke: v > 0 ? { color: n.stroke?.color ?? { token: 'line' }, width: v } : null })} /></div>
        </div>
      </Field>
    </div>
  );
}

function ImageProps({ n }: { n: ImageNode }) {
  const s = useStore(); const b = s.project!.brand;
  const up = (patch: Partial<ImageNode>) => A.updateNode(n.id, patch as Partial<Node>);
  const a = n.assetId ? assets.get(n.assetId) : undefined;
  const [, bump] = useState(0);
  useEffect(() => assets.onChange(() => bump((x) => x + 1)), []);
  const pick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const f = i.files?.[0]; if (f) { const na = await assets.add(f); up({ assetId: na.id, alt: n.alt || na.name.replace(/\.[a-z0-9]+$/i, '') }); } }; i.click(); };
  return (
    <div class="section">
      <Eyebrow>Ảnh</Eyebrow>
      <div class="row" style={{ alignItems: 'stretch' }}>
        <div style={{ width: 72, height: 72, borderRadius: 6, overflow: 'hidden', background: '#070b09', border: '1px solid var(--line-2)', flex: 'none', display: 'grid', placeItems: 'center' }}>
          {a && assets.url(a.id) ? <img src={assets.url(a.id)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : <Icon name="image" style={{ color: 'var(--dim)' }} />}
        </div>
        <div class="col grow" style={{ justifyContent: 'center' }}>
          <div class="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a ? `${a.name}` : 'Chưa có ảnh'}</div>
          {a && <div class="dim small mono">{a.w}×{a.h} · {(a.bytes / 1024).toFixed(0)} KB</div>}
          <div class="row"><Btn xs icon="upload" onClick={pick}>Tải ảnh</Btn><Btn xs onClick={() => set({ leftTab: 'assets' })}>Thư viện</Btn>{a && <Btn xs kind="ghost" onClick={() => up({ assetId: null })}>Bỏ</Btn>}</div>
        </div>
      </div>
      <Seg block value={n.fit} options={[{ v: 'cover', label: 'Cover' }, { v: 'contain', label: 'Contain' }, { v: 'fill', label: 'Kéo giãn' }]} onChange={(v) => up({ fit: v })} />
      <Field label="Nền sau ảnh"><ColorInput value={n.fill} brand={b} allowNone onChange={(c) => up({ fill: c })} /></Field>
      <Field label="Phủ màu" hint="làm tối ảnh để chữ nổi">
        <div class="row">
          <div class="grow"><ColorInput value={n.overlay?.color ?? null} brand={b} allowNone onChange={(c) => up({ overlay: c ? { color: typeof c === 'string' ? c : b[c.token], opacity: n.overlay?.opacity ?? 0.35 } : null })} /></div>
          <div style={{ width: 80 }}><Num label="%" value={Math.round((n.overlay?.opacity ?? 0) * 100)} min={0} max={100} onChange={(v) => up({ overlay: { color: n.overlay?.color || '#000000', opacity: v / 100 } })} /></div>
        </div>
      </Field>
      {a && (
        <>
          <Eyebrow>Tách nền & cắt</Eyebrow>
          <div class="row wrap" style={{ gap: 4 }}>
            <Btn xs icon="sparkle" onClick={() => void A.cutoutLayer(n.id, 'auto')} title="Bỏ nền trắng / xám caro / nền phẳng nối với mép ảnh, cắt gọn về vật thể">Xoá nền</Btn>
            <Btn xs onClick={() => void A.cutoutLayer(n.id, 'ai')} title="Mô hình AI tách vật thể khỏi nền phức tạp (tải ~40 MB lần đầu)">Xoá nền AI</Btn>
            <Btn xs onClick={() => void A.splitAssetToScraps(a.id)} title="Ảnh gộp nhiều vật thể trên nền trắng → tách thành từng PNG nền trong, xếp cạnh artboard">Tách từng ảnh</Btn>
            <Btn xs kind={s.cutting === n.id ? 'primary' : undefined} onClick={() => set({ cutting: s.cutting === n.id ? null : n.id, cropping: null })} title="Kéo chọn một vùng trên ảnh để tách thành layer riêng">{s.cutting === n.id ? 'Đang cắt vùng · Esc' : 'Cắt vùng'}</Btn>
          </div>
        </>
      )}
      <Eyebrow action={{ label: s.cropping === n.id ? 'Đang cắt · Esc' : 'Cắt ảnh', onClick: () => set({ cropping: s.cropping === n.id ? null : n.id }) }}>Khung & vị trí</Eyebrow>
      <div class="row">
        <div class="grow"><Num label="Zoom" value={Math.round((n.crop?.zoom ?? 1) * 100)} min={100} max={600} step={5} suffix="%" onChange={(v) => up({ crop: { zoom: Math.max(1, v / 100), fx: n.crop?.fx ?? 0.5, fy: n.crop?.fy ?? 0.5 } })} /></div>
        <div class="grow"><Num label="Xoay" value={n.rotate ?? 0} min={-180} max={180} suffix="°" onChange={(v) => up({ rotate: v || 0 })} /></div>
      </div>
      <div class="row" style={{ gap: 6 }}>
        <div class="grid3" style={{ gap: 3, width: 78, flex: 'none' }}>
          {[0, 0.5, 1].flatMap((fy) => [0, 0.5, 1].map((fx) => <button key={`${fx}${fy}`} class={`btn xs ${(n.crop?.fx ?? 0.5) === fx && (n.crop?.fy ?? 0.5) === fy ? 'on' : ''}`} style={{ height: 22, padding: 0 }} title="Điểm nhìn" onClick={() => up({ crop: { zoom: n.crop?.zoom ?? 1, fx, fy } })}>·</button>))}
        </div>
        <div class="col grow" style={{ gap: 4 }}>
          <div class="row"><Btn xs onClick={() => up({ flipX: !n.flipX })} title="Lật ngang">Lật ↔</Btn><Btn xs onClick={() => up({ flipY: !n.flipY })} title="Lật dọc">Lật ↕</Btn><Btn xs kind="ghost" onClick={() => up({ crop: null, flipX: false, flipY: false, rotate: 0 })}>Đặt lại</Btn></div>
          <div class="dim small">Double-click ảnh trên canvas: kéo để dời, lăn chuột để zoom.</div>
        </div>
      </div>
      <Eyebrow>Hiệu ứng 3D</Eyebrow>
      <div class="row">
        <div class="grow"><Num label="Nghiêng ↔" value={n.tilt?.ry ?? 0} min={-30} max={30} suffix="°" onChange={(v) => up({ tilt: v || n.tilt?.rx ? { rx: n.tilt?.rx ?? 0, ry: v } : null })} /></div>
        <div class="grow"><Num label="Nghiêng ↕" value={n.tilt?.rx ?? 0} min={-30} max={30} suffix="°" onChange={(v) => up({ tilt: v || n.tilt?.ry ? { rx: v, ry: n.tilt?.ry ?? 0 } : null })} /></div>
      </div>
      <Toggle checked={!!n.floatShadow} onChange={(v) => up({ floatShadow: v })} label="Bóng nổi dưới ảnh" sub="cho ảnh tách nền trông như đang bay" />
      {a && (a.w < n.w * 2 || a.h < n.h * 2) && <div class="check warn"><span class="lv">CHÚ Ý</span><span class="m">Ảnh gốc {a.w}×{a.h} nhỏ hơn 2× khung ({n.w * 2}×{n.h * 2}) — có thể mờ trên màn Retina.</span></div>}
    </div>
  );
}

// ---------------- Email ----------------
function EmailTab() {
  const s = useStore();
  const p = s.project!;
  const a = A.analyze();
  const [changes, setChanges] = useState<string[] | null>(null);
  const setField = (k: keyof typeof p.fields, v: string) => A.patchProject({ fields: { ...p.fields, [k]: v } });
  return (
    <div class="props">
      <Eyebrow>Thông tin email</Eyebrow>
      <Field label="Tên campaign" for="f-campaignName"><TextInput id="f-campaignName" value={p.fields.campaignName} onCommit={(v) => setField('campaignName', v)} /></Field>
      <Field label="Subject" for="f-subject" hint={`${p.fields.subject.length} ký tự`}><TextInput id="f-subject" value={p.fields.subject} placeholder="30–50 ký tự, nói thẳng lợi ích" onCommit={(v) => setField('subject', v)} /></Field>
      <Field label="Preheader" for="f-preheader" hint="dòng xem trước"><TextInput id="f-preheader" value={p.fields.preheader} placeholder="Nối tiếp subject, 40–90 ký tự" onCommit={(v) => setField('preheader', v)} /></Field>
      <Eyebrow>Bản mobile</Eyebrow>
      {p.mobile ? (
        <div class="row"><span class="chip on">375px</span><span class="grow small muted">Điện thoại nhận bản này, desktop nhận bản 600.</span><Btn xs onClick={() => A.setVariant(s.variant === 'mobile' ? 'desktop' : 'mobile')}>{s.variant === 'mobile' ? 'Về desktop' : 'Mở'}</Btn><Btn xs kind="danger" onClick={async () => { if (await ask('Xoá bản mobile?')) A.deleteMobileVariant(); }}>Xoá</Btn></div>
      ) : (
        <div class="row"><span class="grow small muted">Không bắt buộc — bản 600 vẫn tự thu nhỏ trên điện thoại.</span><Btn sm icon="mobile" onClick={() => A.createMobileVariant()}>Tạo</Btn></div>
      )}
      {a && (
        <>
          <Eyebrow action={{ label: 'Tối ưu', onClick: () => setChanges(A.optimize()) }}>Gợi ý · điểm {a.score}</Eyebrow>
          <div class="score"><Ring score={a.score} /><div class="grow small muted">{a.score >= 90 ? 'Sẵn sàng gửi. Luật cố định, không AI: cùng thiết kế luôn cùng kết quả.' : a.score >= 70 ? 'Ổn. Vài điểm nên chỉnh trước khi gửi.' : 'Nên sửa các mục “SỬA” trước.'}</div></div>
          {changes && <div class="check ok"><span class="lv">ĐÃ SỬA</span><span class="m">{changes.length ? changes.join(' · ') : 'Artboard đã chuẩn, không cần đổi gì.'}</span></div>}
          <div class="col" style={{ gap: 4 }}>{a.suggestions.map((g) => <SuggestionRow key={g.id} g={g} />)}</div>
          <Eyebrow>Kiểm tra trước khi xuất ({a.checks.length})</Eyebrow>
          <div class="checks">
            {a.checks.length ? a.checks.slice(0, 30).map((c, i) => <CheckRow key={i} c={c} />) : <div class="check ok"><span class="lv">OK</span><span class="m">Đủ link, đủ alt, kích thước chuẩn.</span></div>}
          </div>
          <div class="dim small">{a.plan.slices.length} lát ảnh sẽ được cắt. Bấm vào mục có layer để chọn layer đó.</div>
        </>
      )}
    </div>
  );
}

function SuggestionRow({ g }: { g: Suggestion }) {
  const label = g.action?.kind === 'snap-width' ? 'Sửa' : g.action?.kind === 'round-pixels' ? 'Làm tròn' : g.action?.kind === 'insert-block' ? 'Chèn' : g.action?.kind === 'focus' ? 'Xem' : g.action?.kind === 'set-field' ? 'Điền' : g.action?.kind === 'create-mobile' ? 'Tạo' : 'Làm';
  return (
    <div class={`sug ${g.level}`}>
      <span class="lv">{g.level === 'fix' ? 'SỬA' : g.level === 'tip' ? 'GỢI Ý' : 'TỐT'}</span>
      <div class="grow"><div class="t">{g.title}</div><div class="d">{g.detail}</div></div>
      {g.action && g.level !== 'good' && <Btn xs onClick={() => A.applySuggestion(g.action!)}>{label}</Btn>}
    </div>
  );
}

function CheckRow({ c }: { c: Check }) {
  return (
    <div class={`check ${c.level} ${c.nodeId ? 'click' : ''}`} onClick={c.nodeId ? () => { A.select([c.nodeId!]); set({ rightTab: 'design' }); } : undefined}>
      <span class="lv">{c.level === 'error' ? 'LỖI' : c.level === 'warn' ? 'CHÚ Ý' : 'INFO'}</span><span class="m">{c.message}</span>
    </div>
  );
}

// ---------------- Export ----------------
interface DraftLite { campaignId: string; webUrl?: string; updatedAt: string; files: Record<string, unknown>; provider: 'mailchimp' | 'klaviyo' }

function ExportTab() {
  const s = useStore();
  const p = s.project!;
  const prof = activeProfile();
  const [mode, setMode] = useState<'fragment' | 'full'>('fragment');
  const draft = prof ? (p.drafts as Record<string, DraftLite>)[prof.id] : undefined;
  const busy = !!s.busy;
  const art = isArtifact();
  return (
    <div class="props">
      {art && <div class="check info"><span class="lv">ONLINE</span><span class="m">Bản chạy trên claude.ai không gọi được Mailchimp/Klaviyo (trình duyệt khoá mạng ra ngoài). Ở đây dùng <b>Xem trước</b> và <b>Tải .zip</b>; để tạo draft, chạy Studio local hoặc deploy kèm relay (xem README).</span></div>}
      <Eyebrow action={{ label: 'Quản lý', onClick: () => set({ modal: 'clients' }) }}>Client</Eyebrow>
      <select class="in" value={prof?.id || ''} onChange={(e) => set({ settings: { ...s.settings, activeProfileId: (e.target as HTMLSelectElement).value || null } })}>
        <option value="">— chưa chọn client —</option>
        {s.profiles.map((x) => <option key={x.id} value={x.id}>{x.name} · {providerName(x.provider)}</option>)}
      </select>
      {prof ? <div class="small muted">{prof.accountLabel || 'Chưa kiểm tra kết nối'} · {prof.audienceName || 'chưa chọn audience'} · {prof.imageFormat} {prof.scale}x</div> : <div class="small muted">Thêm client để tạo draft hoặc host ảnh cho Copy HTML. Tải .zip không cần client.</div>}
      <div class="card glow">
        <Btn kind="primary" block icon="send" disabled={busy || !prof || art} onClick={() => runExport('draft')}>{prof ? (draft?.campaignId ? `Cập nhật draft · ${providerName(prof.provider)}` : `Tạo draft · ${providerName(prof.provider)}`) : 'Tạo draft (chọn client)'}</Btn>
        <div class="grid2">
          <div class="split"><Btn disabled={busy || art} icon="copy" onClick={() => runExport('html', mode)} title={mode === 'fragment' ? 'Chỉ nội dung — dán vào template có brand' : 'Trang HTML đầy đủ'}>{mode === 'fragment' ? 'Copy HTML' : 'HTML đầy đủ'}</Btn><Btn disabled={busy} onClick={() => setMode(mode === 'fragment' ? 'full' : 'fragment')} title="Đổi: nội dung / trang đầy đủ">⇅</Btn></div>
          <Btn disabled={busy} icon="download" onClick={() => runExport('zip')}>Tải .zip</Btn>
        </div>
        <Btn sm block icon="play" disabled={busy} onClick={() => set({ modal: 'preview' })}>Xem trước như trong hộp thư</Btn>
        {draft?.campaignId && <div class="row small muted"><span class="grow">Draft {new Date(draft.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} · {Object.keys(draft.files).length} ảnh</span>{draft.webUrl && <a href={draft.webUrl} target="_blank" rel="noopener">Mở ↗</a>}<Btn xs kind="ghost" title="Quên draft — lần sau tạo mới" onClick={() => { if (prof) A.patchProject({ drafts: Object.fromEntries(Object.entries(p.drafts).filter(([k]) => k !== prof.id)) }); }}>✕</Btn></div>}
      </div>
      {(s.busy || s.log.length > 0) && (
        <div class="card">
          {s.busy && <><div class="row small"><span class="grow">{s.busy.label}</span><span class="mono dim">{s.busy.total ? `${s.busy.done}/${s.busy.total}` : ''}</span></div><Progress done={s.busy.done} total={s.busy.total} /></>}
          {s.log.length > 0 && <div class="log">{s.log.slice(-12).map((l, i) => <div key={i} class={l.k || ''}>{l.t}</div>)}</div>}
        </div>
      )}
      {s.result && <div class="result"><span class="ic">✓</span><span class="grow">{s.result.text}</span>{s.result.url && <a href={s.result.url} target="_blank" rel="noopener">Mở ↗</a>}</div>}
      <Eyebrow>Cách hoạt động</Eyebrow>
      <div class="small muted">Email được cắt thành lát ảnh theo vùng link, upload lên {prof ? providerName(prof.provider) : 'nền tảng'}, rồi ghép thành HTML bảng chuẩn mọi hộp thư. Bấm lại sau khi sửa: cập nhật đúng draft cũ, ảnh không đổi không upload lại.</div>
      <div class="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--neon)', boxShadow: '0 0 8px var(--neon)', display: 'inline-block' }} />Phloem không bao giờ tự gửi. Bạn duyệt và bấm gửi trong {prof ? providerName(prof.provider) : 'Mailchimp / Klaviyo'}.</div>
    </div>
  );
}


/** Background of a block group: the full-width band rect inside it. Lets spacers, dividers and any band change colour,
 *  gradient and opacity without entering the group. */
function BlockBg({ g }: { g: GroupNode }) {
  const s = useStore(); const b = s.project!.brand;
  const band = g.children.find((c): c is RectNode => c.type === 'rect' && c.w >= g.w - 2) ?? null;
  if (!band) return null;
  const up = (patch: Partial<RectNode>) => A.updateNode(band.id, patch as Partial<Node>);
  return (
    <div class="section">
      <Eyebrow>Nền block</Eyebrow>
      <Field label="Màu nền" hint={g.block === 'spacer' ? 'khoảng trống: đổi màu hoặc để trong suốt' : 'dải nền của block'}><ColorInput value={band.fill} brand={b} allowNone onChange={(c) => up({ fill: c })} /></Field>
      <Toggle checked={!!band.gradient} onChange={(v) => up({ gradient: v ? { from: { token: 'primary' }, to: { token: 'accent' }, angle: b.gradient?.angle ?? 135 } : null })} label="Gradient" sub="primary → accent, đổi được hai đầu" />
      {band.gradient && <div class="grid2"><Field label="Từ"><ColorInput value={band.gradient.from} brand={b} onChange={(c) => up({ gradient: { ...band.gradient!, from: c || '#000000' } })} /></Field><Field label="Đến"><ColorInput value={band.gradient.to} brand={b} onChange={(c) => up({ gradient: { ...band.gradient!, to: c || '#000000' } })} /></Field></div>}
      <div class="grid2">
        {band.gradient ? <Num label="Góc" value={band.gradient.angle} min={0} max={360} suffix="°" onChange={(v) => up({ gradient: { ...band.gradient!, angle: Math.round(v) } })} /> : <div />}
        <Num label="Mờ nền" value={Math.round(band.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => up({ opacity: v / 100 })} />
      </div>
    </div>
  );
}
