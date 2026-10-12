// The artboard: canvas rendering + all pointer interactions (select, move, resize, marquee, draw, pan, zoom, text edit, drop).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Doc, GroupNode, Node, TextNode } from '../model/types';
import { resolveColor } from '../model/types';
import * as ops from '../model/ops';
import { animCycle, imageDrawRect, renderDoc } from '../render/renderer';
import { fontString } from '../render/textLayout';
import { assets } from '../storage/assets';
import { get, history, set, subscribe, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { Btn } from './components';
import { Icon } from './icons';

type Mode = { kind: 'idle' } | { kind: 'pinch'; d0: number; z0: number; c0: { x: number; y: number }; pan0: { x: number; y: number } } | { kind: 'pan'; sx: number; sy: number; px: number; py: number } | { kind: 'move'; sx: number; sy: number; base: Doc; ids: string[]; moved: boolean } | { kind: 'resize'; handle: number; base: Doc; ids: string[]; start: ops.Rect; sx: number; sy: number } | { kind: 'marquee'; sx: number; sy: number; cur: { x: number; y: number }; additive: boolean } | { kind: 'draw'; sx: number; sy: number; cur: { x: number; y: number } }
  // dragging a pasteboard image; `inside` = pointer over the artboard, `over` = image layer that would be replaced
  | { kind: 'scrap'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; inside: boolean; over: string | null }
  // crop mode: dragging pans the photo inside its frame
  | { kind: 'crop'; id: string; sx: number; sy: number; fx: number; fy: number; base: Doc; moved: boolean }
  | { kind: 'cut'; id: string; sx: number; sy: number; cur: { x: number; y: number } };

function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
}

const HANDLE = 7;
const CURSORS = ['nw-resize', 'n-resize', 'ne-resize', 'e-resize', 'se-resize', 'sw-resize', 's-resize', 'w-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

function handlesOf(r: ops.Rect): { x: number; y: number }[] {
  return [
    { x: r.x, y: r.y }, { x: r.x + r.w / 2, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h / 2 },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x + r.w / 2, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x, y: r.y + r.h / 2 },
  ];
}

export function CanvasView() {
  const s = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mode = useRef<Mode>({ kind: 'idle' });
  const touches = useRef(new Map<number, { x: number; y: number }>()); // live touch points (pinch)
  const guides = useRef<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const space = useRef(false);
  const [dropping, setDropping] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingPoint = useRef<{ x: number; y: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // autofocus is unreliable for dynamically inserted elements: focus explicitly and put the caret at the end
  useEffect(() => { const ta = taRef.current; if (s.editingText && ta) { ta.focus(); const l = ta.value.length; try { ta.setSelectionRange(l, l); } catch { /* ignore */ } } }, [s.editingText]);

  const docOf = () => A.doc();
  const toDoc = (cx: number, cy: number) => { const st = get(); return { x: (cx - st.pan.x) / st.zoom, y: (cy - st.pan.y) / st.zoom }; };
  const local = (e: PointerEvent | MouseEvent | DragEvent) => { const r = wrap.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ----- drawing -----
  const draw = () => {
    const c = canvas.current, w = wrap.current;
    if (!c || !w) return;
    const st = get();
    if (!st.project) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = w.clientWidth, ch = w.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const doc = docOf(), z = st.zoom, px = st.pan.x, py = st.pan.y;
    // artboard shadow + glow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#000'; ctx.fillRect(px, py, doc.width * z, doc.height * z);
    ctx.restore();
    const cycle = st.playing ? animCycle(doc.nodes) : 0;
    const t = st.playing && cycle > 0 ? ((performance.now() - playStart.current) / 1000) % cycle : undefined;
    renderDoc(ctx, doc, st.project.brand, assets, { scale: z, ox: px, oy: py, editor: true, skip: st.editingText ? new Set([st.editingText]) : undefined, t });
    // label
    ctx.font = '600 11px JetBrains Mono, monospace'; ctx.fillStyle = '#5d7265'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${st.variant === 'mobile' ? 'Mobile' : 'Desktop'} · ${doc.width} × ${doc.height}`, px, py - 6);
    // crop mode: ghost the parts of the photo that fall outside the frame
    if (st.cropping) {
      const n = ops.findNode(doc, st.cropping);
      if (n && n.type === 'image' && n.assetId) {
        const img = assets.image(n.assetId);
        const r = { x: px + n.x * z, y: py + n.y * z, w: n.w * z, h: n.h * z };
        if (img && img.width) {
          const d = imageDrawRect(n, img.width, img.height);
          ctx.save(); ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.rect(px - 4000, py - 4000, 8000, 8000); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip('evenodd');
          ctx.drawImage(img, r.x + d.dx * z, r.y + d.dy * z, d.dw * z, d.dh * z);
          ctx.restore();
          ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(57,255,20,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(r.x + d.dx * z + 0.5, r.y + d.dy * z + 0.5, d.dw * z, d.dh * z); ctx.restore();
        }
        ctx.save(); ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.restore();
        const hint = `Cắt ảnh · kéo để dời · lăn chuột để zoom (${Math.round((n.crop?.zoom ?? 1) * 100)}%) · Esc xong`;
        ctx.font = '600 11px JetBrains Mono, monospace'; const tw = ctx.measureText(hint).width + 16;
        ctx.fillStyle = '#39ff14'; ctx.fillRect(r.x + r.w / 2 - tw / 2, r.y - 26, tw, 20); ctx.fillStyle = '#04140a'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(hint, r.x + r.w / 2, r.y - 16); ctx.textAlign = 'left';
      }
    }
    // pasteboard: images parked beside the artboard
    const mm = mode.current;
    if (st.scraps.length) {
      for (const sc of st.scraps) {
        const r = { x: px + sc.x * z, y: py + sc.y * z, w: sc.w * z, h: sc.h * z };
        const img = assets.image(sc.assetId);
        const dragging = mm.kind === 'scrap' && mm.id === sc.id;
        ctx.save();
        if (dragging && mm.inside) ctx.globalAlpha = 0.75;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8; ctx.fillStyle = '#0d1210'; rrPath(ctx, r.x, r.y, r.w, r.h, 6 * z); ctx.fill(); ctx.restore();
        ctx.save(); rrPath(ctx, r.x, r.y, r.w, r.h, 6 * z); ctx.clip();
        if (img && img.width) ctx.drawImage(img, r.x, r.y, r.w, r.h);
        else { ctx.fillStyle = '#1a2420'; ctx.fillRect(r.x, r.y, r.w, r.h); }
        ctx.restore();
        const selected = st.scrapSel === sc.id;
        ctx.setLineDash(selected || dragging ? [] : [4, 3]); ctx.strokeStyle = selected || dragging ? '#39ff14' : 'rgba(57,255,20,0.5)'; ctx.lineWidth = selected ? 1.5 : 1;
        rrPath(ctx, r.x + 0.5, r.y + 0.5, r.w, r.h, 6 * z); ctx.stroke(); ctx.setLineDash([]);
        if (z >= 0.3 && r.w > 60) { const a = assets.get(sc.assetId); ctx.font = '600 10px JetBrains Mono, monospace'; ctx.fillStyle = selected ? '#39ff14' : '#5d7265'; ctx.textBaseline = 'bottom'; ctx.fillText(a ? `${a.w}×${a.h} · kéo vào mail` : 'ảnh', r.x, r.y - 4); }
        ctx.restore();
      }
      if (mm.kind === 'scrap' && mm.inside) {
        ctx.save(); ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2; ctx.shadowColor = '#39ff14'; ctx.shadowBlur = 16; ctx.strokeRect(px + 1, py + 1, doc.width * z - 2, doc.height * z - 2); ctx.restore();
        if (mm.over) { const t = ops.findNode(doc, mm.over); if (t) { const b = ops.bounds(t); ctx.save(); ctx.fillStyle = 'rgba(57,255,20,0.18)'; ctx.fillRect(px + b.x * z, py + b.y * z, b.w * z, b.h * z); ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2; ctx.strokeRect(px + b.x * z, py + b.y * z, b.w * z, b.h * z); ctx.restore(); } }
      }
    }
    // grid
    if (st.settings.grid && z >= 0.5) {
      ctx.save(); ctx.beginPath(); ctx.rect(px, py, doc.width * z, doc.height * z); ctx.clip();
      ctx.strokeStyle = 'rgba(57,255,20,0.09)'; ctx.lineWidth = 1;
      for (let gx = 0; gx <= doc.width; gx += 24) { ctx.beginPath(); ctx.moveTo(px + gx * z + 0.5, py); ctx.lineTo(px + gx * z + 0.5, py + doc.height * z); ctx.stroke(); }
      for (let gy = 0; gy <= doc.height; gy += 24) { ctx.beginPath(); ctx.moveTo(px, py + gy * z + 0.5); ctx.lineTo(px + doc.width * z, py + gy * z + 0.5); ctx.stroke(); }
      ctx.restore();
    }
    const rectOf = (r: ops.Rect) => ({ x: px + r.x * z, y: py + r.y * z, w: r.w * z, h: r.h * z });
    // hover
    if (st.hover && !st.selection.includes(st.hover)) {
      const n = ops.findNode(doc, st.hover);
      if (n) { const r = rectOf(ops.bounds(n)); ctx.strokeStyle = 'rgba(57,255,20,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h); }
    }
    // entered group
    if (st.enteredGroup) { const g = ops.findNode(doc, st.enteredGroup); if (g) { const r = rectOf(ops.bounds(g)); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(57,255,20,0.45)'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h); ctx.setLineDash([]); } }
    // selection
    const sel = ops.selectionBounds(doc, st.selection);
    if (sel && !st.editingText) {
      for (const id of st.selection) { const n = ops.findNode(doc, id); if (!n) continue; const r = rectOf(ops.bounds(n)); ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h); }
      const r = rectOf(sel);
      if (st.selection.length > 1) { ctx.setLineDash([3, 3]); ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h); ctx.setLineDash([]); }
      for (const hd of handlesOf(r)) { ctx.fillStyle = '#060908'; ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.rect(hd.x - HANDLE / 2, hd.y - HANDLE / 2, HANDLE, HANDLE); ctx.fill(); ctx.stroke(); }
      // size label
      const label = `${Math.round(sel.w)} × ${Math.round(sel.h)}`;
      ctx.font = '600 10px JetBrains Mono, monospace'; const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = '#39ff14'; ctx.fillRect(r.x + r.w / 2 - tw / 2, r.y + r.h + 6, tw, 16);
      ctx.fillStyle = '#04140a'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(label, r.x + r.w / 2, r.y + r.h + 14); ctx.textAlign = 'left';
    }
    // guides
    ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 1;
    for (const gx of guides.current.v) { ctx.beginPath(); ctx.moveTo(px + gx * z + 0.5, 0); ctx.lineTo(px + gx * z + 0.5, ch); ctx.stroke(); }
    for (const gy of guides.current.h) { ctx.beginPath(); ctx.moveTo(0, py + gy * z + 0.5); ctx.lineTo(cw, py + gy * z + 0.5); ctx.stroke(); }
    // marquee / draw preview
    const m = mode.current;
    if (st.cutting && m.kind !== 'cut') {
      const n = ops.findNode(doc, st.cutting);
      if (n) { const r = rectOf(ops.bounds(n)); ctx.save(); ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.setLineDash([]); const hint = 'Cắt vùng · kéo chọn phần ảnh muốn tách · Esc huỷ'; ctx.font = '600 11px JetBrains Mono, monospace'; const tw = ctx.measureText(hint).width + 16; ctx.fillStyle = '#ffc53d'; ctx.fillRect(r.x + r.w / 2 - tw / 2, r.y - 26, tw, 20); ctx.fillStyle = '#1a1200'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(hint, r.x + r.w / 2, r.y - 16); ctx.textAlign = 'left'; ctx.restore(); }
    }
    if (m.kind === 'marquee' || m.kind === 'draw' || m.kind === 'cut') {
      const x1 = Math.min(m.sx, m.cur.x), y1 = Math.min(m.sy, m.cur.y), x2 = Math.max(m.sx, m.cur.x), y2 = Math.max(m.sy, m.cur.y);
      const r = rectOf({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      ctx.fillStyle = 'rgba(57,255,20,0.08)'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = m.kind === 'cut' ? '#ffc53d' : '#39ff14'; ctx.setLineDash(m.kind === 'draw' ? [] : [4, 3]); ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h); ctx.setLineDash([]);
    }
  };

  const playStart = useRef(0);
  useEffect(() => {
    if (!s.playing) return;
    playStart.current = performance.now();
    let raf = 0; const loop = () => { draw(); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [s.playing]);
  useEffect(() => {
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    const off = subscribe(schedule);
    const offAssets = assets.onChange(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap.current!);
    schedule();
    return () => { off(); offAssets(); ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  // fit on first mount / project change
  useEffect(() => { zoomFit(); }, [s.project?.id, s.variant]);

  function zoomFit() {
    const w = wrap.current; if (!w) return;
    const doc = docOf();
    const cw = w.clientWidth, ch = w.clientHeight;
    const z = Math.min(1.5, Math.max(0.1, Math.min((cw - 80) / doc.width, (ch - 80) / doc.height)));
    set({ zoom: Math.round(z * 100) / 100, pan: { x: Math.round((cw - doc.width * z) / 2), y: Math.round(Math.max(30, (ch - doc.height * z) / 2)) } });
  }

  // expose zoom helpers to the topbar through the store (small hack: window event)
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: 'fit' | 'in' | 'out' | 'reset' | 'set'; value?: number };
      const w = wrap.current; if (!w) return;
      const cw = w.clientWidth, ch = w.clientHeight;
      const st = get();
      if (d.kind === 'fit') return zoomFit();
      const target = d.kind === 'in' ? st.zoom * 1.25 : d.kind === 'out' ? st.zoom / 1.25 : d.kind === 'reset' ? 1 : d.value!;
      zoomAt(Math.min(8, Math.max(0.1, target)), cw / 2, ch / 2);
    };
    window.addEventListener('phloem-zoom', h);
    return () => window.removeEventListener('phloem-zoom', h);
  }, []);

  function zoomAt(z: number, cx: number, cy: number) {
    const st = get();
    const dx = (cx - st.pan.x) / st.zoom, dy = (cy - st.pan.y) / st.zoom;
    set({ zoom: Math.round(z * 1000) / 1000, pan: { x: cx - dx * z, y: cy - dy * z } });
  }

  // ----- hit helpers -----
  function handleAt(x: number, y: number): number {
    const st = get(); const sel = ops.selectionBounds(docOf(), st.selection);
    if (!sel || st.editingText) return -1;
    const tol = (HANDLE + 4) / 2 / st.zoom;
    const hs = handlesOf(sel);
    for (let i = 0; i < hs.length; i++) if (Math.abs(hs[i].x - x) <= tol && Math.abs(hs[i].y - y) <= tol) return i;
    return -1;
  }
  function hitScrap(x: number, y: number) { const list = get().scraps; for (let i = list.length - 1; i >= 0; i--) { const sc = list[i]; if (x >= sc.x && x <= sc.x + sc.w && y >= sc.y && y <= sc.y + sc.h) return sc; } return null; }
  function insideArtboard(x: number, y: number) { const d = docOf(); return x >= 0 && x <= d.width && y >= 0 && y <= Math.max(d.height, ops.contentHeight(d)) + 40; }
  function hit(x: number, y: number, deep: boolean): Node | null {
    const st = get(); const doc = docOf();
    const within = st.enteredGroup ? (ops.findNode(doc, st.enteredGroup) as GroupNode | null) : null;
    if (within && ops.containsPt(ops.bounds(within), x, y)) { const n = ops.hitTest(doc, x, y, within, deep); if (n) return n; }
    return ops.hitTest(doc, x, y, null, deep);
  }

  // ----- snapping -----
  function snapDelta(moving: ops.Rect, excludeIds: string[]): { dx: number; dy: number } {
    const st = get(); guides.current = { v: [], h: [] };
    if (!st.settings.snap) return { dx: 0, dy: 0 };
    const doc = docOf(); const th = 6 / st.zoom;
    const xs = [0, doc.width / 2, doc.width], ys = [0, doc.height / 2, doc.height];
    for (const n of doc.nodes) { if (excludeIds.includes(n.id) || !n.visible) continue; const b = ops.bounds(n); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
    const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w], my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
    let bx: { d: number; g: number } | null = null, by: { d: number; g: number } | null = null;
    for (const a of mx) for (const b of xs) { const d = b - a; if (Math.abs(d) <= th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, g: b }; }
    for (const a of my) for (const b of ys) { const d = b - a; if (Math.abs(d) <= th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, g: b }; }
    if (bx) guides.current.v = [bx.g]; if (by) guides.current.h = [by.g];
    return { dx: bx ? bx.d : 0, dy: by ? by.d : 0 };
  }

  // ----- pointer events -----
  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) return;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, local(e));
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]; const st0 = get();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        wrap.current!.classList.remove('panning');
        mode.current = { kind: 'pinch', d0: Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)), z0: st0.zoom, c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, pan0: { ...st0.pan } };
        return;
      }
      if (touches.current.size > 2) return;
      if (get().mobilePane !== 'canvas') set({ mobilePane: 'canvas' });
    }
    wrap.current!.focus();
    setCtxMenu(null);
    const st = get(); const p = local(e); const d = toDoc(p.x, p.y);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (st.editingText) { set({ editingText: null }); }
    if (e.button === 1 || space.current || st.tool === 'hand') { mode.current = { kind: 'pan', sx: p.x, sy: p.y, px: st.pan.x, py: st.pan.y }; wrap.current!.classList.add('panning'); return; }
    if (st.tool === 'rect') { mode.current = { kind: 'draw', sx: d.x, sy: d.y, cur: d }; return; }
    if (st.tool === 'text') { A.addText(Math.round(d.x), Math.round(d.y)); return; }
    if (st.tool === 'image') { pendingPoint.current = d; fileInput.current?.click(); set({ tool: 'select' }); return; }
    // select tool
    const hIdx = handleAt(d.x, d.y);
    if (hIdx >= 0) { const sel = ops.selectionBounds(docOf(), st.selection)!; mode.current = { kind: 'resize', handle: hIdx, base: docOf(), ids: st.selection.slice(), start: sel, sx: d.x, sy: d.y }; return; }
    if (st.cutting) {
      const cn = ops.findNode(docOf(), st.cutting);
      if (cn && cn.type === 'image' && ops.containsPt(ops.bounds(cn), d.x, d.y)) { mode.current = { kind: 'cut', id: cn.id, sx: d.x, sy: d.y, cur: d }; return; }
      set({ cutting: null });
    }
    if (st.cropping) {
      const cn = ops.findNode(docOf(), st.cropping);
      if (cn && cn.type === 'image' && ops.containsPt(ops.bounds(cn), d.x, d.y)) { mode.current = { kind: 'crop', id: cn.id, sx: d.x, sy: d.y, fx: cn.crop?.fx ?? 0.5, fy: cn.crop?.fy ?? 0.5, base: docOf(), moved: false }; return; }
      set({ cropping: null }); // clicked elsewhere: leave crop mode and continue as a normal click
    }
    const sc = hitScrap(d.x, d.y);
    if (sc) { set({ scrapSel: sc.id, selection: [], hover: null }); mode.current = { kind: 'scrap', id: sc.id, sx: d.x, sy: d.y, ox: sc.x, oy: sc.y, moved: false, inside: false, over: null }; return; }
    if (st.scrapSel) set({ scrapSel: null });
    const n = hit(d.x, d.y, e.metaKey || e.ctrlKey);
    if (n) {
      let ids = st.selection;
      if (e.shiftKey) { A.toggleSelect(n.id); ids = get().selection; }
      else if (!st.selection.includes(n.id)) { A.select([n.id]); ids = [n.id]; }
      mode.current = { kind: 'move', sx: d.x, sy: d.y, base: docOf(), ids: ids.slice(), moved: false };
    } else {
      if (!e.shiftKey) { A.clearSelection(); }
      if (e.pointerType === 'touch') { mode.current = { kind: 'pan', sx: p.x, sy: p.y, px: st.pan.x, py: st.pan.y }; return; } // a finger on empty space pans
      mode.current = { kind: 'marquee', sx: d.x, sy: d.y, cur: d, additive: e.shiftKey };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const st = get(); const p = local(e); const d = toDoc(p.x, p.y); const m = mode.current;
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, p);
    if (m.kind === 'pinch') {
      if (touches.current.size < 2) return;
      const [a, b] = [...touches.current.values()];
      const d1 = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)); const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = Math.min(8, Math.max(0.1, (m.z0 * d1) / m.d0));
      set({ zoom: Math.round(z * 1000) / 1000, pan: { x: c.x - ((m.c0.x - m.pan0.x) / m.z0) * z, y: c.y - ((m.c0.y - m.pan0.y) / m.z0) * z } });
      return;
    }
    if (m.kind === 'idle') {
      if (st.tool === 'select') {
        const hIdx = handleAt(d.x, d.y);
        wrap.current!.style.cursor = hIdx >= 0 ? CURSORS[hIdx] : hitScrap(d.x, d.y) ? 'grab' : '';
        const n = hit(d.x, d.y, e.metaKey || e.ctrlKey);
        const hv = n ? n.id : null;
        if (hv !== st.hover) set({ hover: hv });
      }
      return;
    }
    if (m.kind === 'pan') { set({ pan: { x: m.px + (p.x - m.sx), y: m.py + (p.y - m.sy) } }); return; }
    if (m.kind === 'crop') {
      const n = ops.findNode(m.base, m.id);
      if (!n || n.type !== 'image' || !n.assetId) return;
      const img = assets.image(n.assetId); if (!img || !img.width) return;
      const r = imageDrawRect(n, img.width, img.height);
      const dx = d.x - m.sx, dy = d.y - m.sy;
      if (!m.moved && Math.hypot(dx * st.zoom, dy * st.zoom) < 2) return;
      if (!m.moved) { m.moved = true; history.push(m.base); }
      // moving the photo by dx means the focal point shifts by dx / (slack); when the photo is smaller than the frame it slides freely
      const slackX = n.w - r.dw, slackY = n.h - r.dh;
      const fx = slackX ? Math.max(0, Math.min(1, m.fx + dx / slackX)) : m.fx;
      const fy = slackY ? Math.max(0, Math.min(1, m.fy + dy / slackY)) : m.fy;
      A.commit(ops.updateNode(m.base, m.id, { crop: { zoom: n.crop?.zoom ?? 1, fx, fy } } as Partial<Node>), false);
      wrap.current!.style.cursor = 'grabbing';
      return;
    }
    if (m.kind === 'scrap') {
      const dx = d.x - m.sx, dy = d.y - m.sy;
      if (!m.moved && Math.hypot(dx * st.zoom, dy * st.zoom) < 3) return;
      m.moved = true;
      m.inside = insideArtboard(d.x, d.y);
      const t = m.inside ? hit(d.x, d.y, true) : null;
      m.over = t && t.type === 'image' && e.altKey ? t.id : null;
      wrap.current!.style.cursor = 'grabbing';
      A.moveScrap(m.id, m.ox + dx, m.oy + dy);
      return;
    }
    if (m.kind === 'marquee' || m.kind === 'draw' || m.kind === 'cut') { m.cur = d; set({}); return; }
    if (m.kind === 'move') {
      let dx = d.x - m.sx, dy = d.y - m.sy;
      if (!m.moved && Math.hypot(dx * st.zoom, dy * st.zoom) < 3) return;
      if (!m.moved) { m.moved = true; history.push(m.base); }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sel = ops.selectionBounds(m.base, m.ids)!;
      const moving = { x: sel.x + dx, y: sel.y + dy, w: sel.w, h: sel.h };
      const sn = e.altKey ? { dx: 0, dy: 0 } : snapDelta(moving, m.ids);
      A.commit(ops.moveBy(m.base, m.ids, Math.round(dx + sn.dx), Math.round(dy + sn.dy)), false);
      return;
    }
    if (m.kind === 'resize') {
      const dx = d.x - m.sx, dy = d.y - m.sy; const s0 = m.start;
      let x = s0.x, y = s0.y, w = s0.w, h = s0.h;
      const hI = m.handle;
      if ([0, 6, 7].includes(hI)) { x = s0.x + dx; w = s0.w - dx; }
      if ([2, 3, 4].includes(hI)) { w = s0.w + dx; }
      if ([0, 1, 2].includes(hI)) { y = s0.y + dy; h = s0.h - dy; }
      if ([4, 5, 6].includes(hI)) { h = s0.h + dy; }
      if (e.shiftKey && [0, 2, 4, 6].includes(hI)) { const r = s0.w / s0.h; if (Math.abs(w / s0.w) > Math.abs(h / s0.h)) { h = w / r; if ([0, 2].includes(hI)) y = s0.y + s0.h - h; } else { w = h * r; if ([0, 6].includes(hI)) x = s0.x + s0.w - w; } }
      if (w < 1) { x = x + w - 1; w = 1; } if (h < 1) { y = y + h - 1; h = 1; }
      const to = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      if (!(m as any).pushed) { (m as any).pushed = true; history.push(m.base); }
      let next = m.base;
      for (const id of m.ids) {
        const n = ops.findNode(m.base, id); if (!n) continue;
        const b = ops.bounds(n);
        const nr = m.ids.length === 1 ? to : { x: to.x + ((b.x - s0.x) / s0.w) * to.w, y: to.y + ((b.y - s0.y) / s0.h) * to.h, w: (b.w / s0.w) * to.w, h: (b.h / s0.h) * to.h };
        next = ops.resizeTo(next, id, nr, !(n.type === 'text' && n.autoHeight && m.ids.length === 1 && [3, 7].includes(hI)));
      }
      next = ops.mapNodes(next, A.fixTextHeight);
      A.commit(next, false);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') touches.current.delete(e.pointerId);
    if (mode.current.kind === 'pinch') { if (touches.current.size < 2) mode.current = { kind: 'idle' }; return; }
    const m = mode.current; const p = local(e); const d = toDoc(p.x, p.y);
    wrap.current!.classList.remove('panning');
    guides.current = { v: [], h: [] };
    if (m.kind === 'marquee') {
      const r = { x: Math.min(m.sx, d.x), y: Math.min(m.sy, d.y), w: Math.abs(d.x - m.sx), h: Math.abs(d.y - m.sy) };
      if (r.w > 2 || r.h > 2) { const ids = ops.nodesInRect(docOf(), r); A.select(ids, m.additive); }
    } else if (m.kind === 'draw') {
      const r = { x: Math.min(m.sx, d.x), y: Math.min(m.sy, d.y), w: Math.abs(d.x - m.sx), h: Math.abs(d.y - m.sy) };
      if (r.w > 2 && r.h > 2) A.addRect(r); else A.addRect({ x: d.x - 60, y: d.y - 40, w: 120, h: 80 });
    } else if (m.kind === 'move' && m.moved) {
      A.commit(ops.roundAll(docOf()), false);
    } else if (m.kind === 'scrap' && m.moved) {
      wrap.current!.style.cursor = '';
      if (insideArtboard(d.x, d.y)) { const t = hit(d.x, d.y, true); const top = t ? ops.topLevelOf(docOf(), t.id) : null; A.scrapIntoDoc(m.id, t && t.type === 'image' && e.altKey ? t.id : undefined, top && top.type === 'group' && top.id !== t?.id ? top.id : undefined); }
    } else if (m.kind === 'crop') {
      wrap.current!.style.cursor = '';
    } else if (m.kind === 'cut') {
      const n = ops.findNode(docOf(), m.id); const b = n ? ops.bounds(n) : null;
      const r = { x: Math.min(m.sx, d.x), y: Math.min(m.sy, d.y), w: Math.abs(d.x - m.sx), h: Math.abs(d.y - m.sy) };
      if (b && r.w > 4 && r.h > 4) { const x1 = Math.max(b.x, r.x), y1 = Math.max(b.y, r.y), x2 = Math.min(b.x + b.w, r.x + r.w), y2 = Math.min(b.y + b.h, r.y + r.h); if (x2 > x1 && y2 > y1) void A.cutRegion(m.id, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }); }
    }
    mode.current = { kind: 'idle' };
    set({});
  };

  const onDblClick = (e: MouseEvent) => {
    const p = local(e); const d = toDoc(p.x, p.y); const st = get();
    const n = hit(d.x, d.y, false);
    if (n && n.type === 'group') { const inner = ops.hitTest(docOf(), d.x, d.y, n, false); set({ enteredGroup: n.id, selection: inner ? [inner.id] : [n.id] }); return; }
    if (n && n.type === 'text') { if (!st.selection.includes(n.id)) A.select([n.id]); history.push(docOf()); set({ editingText: n.id }); return; }
    if (n && n.type === 'image' && n.assetId) { A.select([n.id]); set({ cropping: n.id }); return; }
    if (!n) set({ enteredGroup: null });
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const st = get(); const p = local(e);
    if (st.cropping && !(e.ctrlKey || e.metaKey)) { A.zoomCrop(st.cropping, Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0012)); return; }
    if (e.ctrlKey || e.metaKey) { const z = Math.min(8, Math.max(0.1, st.zoom * Math.exp(-e.deltaY * 0.0022))); zoomAt(z, p.x, p.y); }
    else set({ pan: { x: st.pan.x - e.deltaX, y: st.pan.y - e.deltaY } });
  };

  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !isTyping(e)) { space.current = true; wrap.current?.classList.add('tool-hand'); } };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; if (get().tool !== 'hand') wrap.current?.classList.remove('tool-hand'); } };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  // ----- drop files -----
  const onDrop = async (e: DragEvent) => {
    e.preventDefault(); setDropping(false);
    const p = local(e); const d = toDoc(p.x, p.y);
    const outside = !insideArtboard(d.x, d.y);
    const target = outside ? null : hit(d.x, d.y, true);
    const assetId = e.dataTransfer?.getData('text/phloem-asset');
    if (assetId) { if (outside) A.addScrap(assetId, d); else A.placeAsset(assetId, d, target && target.type === 'image' ? target.id : undefined); return; }
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    let i = 0;
    for (const f of files) { if (outside) await A.addImageFileToScraps(f, { x: d.x + i * 24, y: d.y + i * 24 }); else await A.addImageFile(f, d, target && target.type === 'image' ? target.id : undefined); i++; }
    if (outside) toast(files.length === 1 ? 'Ảnh nằm cạnh email — kéo vào mail để dùng.' : `${files.length} ảnh nằm cạnh email — kéo vào mail để dùng.`, 'ok');
  };

  // ----- text editing overlay -----
  const editing = s.editingText ? (ops.findNode(docOf(), s.editingText) as TextNode | null) : null;
  const doc = docOf();
  const brand = s.project!.brand;

  return (
    <div ref={wrap} tabIndex={0} class={`canvas-wrap tool-${s.tool} ${dropping ? 'dropping' : ''}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDblClick={onDblClick} onWheel={onWheel}
      onContextMenu={(e) => { e.preventDefault(); const p = local(e); const d = toDoc(p.x, p.y); const n = hit(d.x, d.y, false); if (n && !get().selection.includes(n.id)) A.select([n.id]); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      onDragOver={(e) => { e.preventDefault(); if (!dropping) setDropping(true); }} onDragLeave={() => setDropping(false)} onDrop={onDrop}
      onPointerLeave={() => { if (get().hover) set({ hover: null }); }}>
      <canvas ref={canvas} class="board" />
      {editing && (
        <textarea class="text-editor" ref={taRef}
          style={{
            left: s.pan.x + editing.x * s.zoom, top: s.pan.y + editing.y * s.zoom, width: editing.w * s.zoom, height: Math.max(editing.h, editing.fontSize * editing.lineHeight) * s.zoom,
            font: fontString(editing, brand, s.zoom), lineHeight: `${editing.fontSize * editing.lineHeight * s.zoom}px`, color: resolveColor(editing.color, brand) || '#000', textAlign: editing.align,
            letterSpacing: `${editing.letterSpacing * s.zoom}px`, textDecoration: editing.underline ? 'underline' : 'none',
          }}
          value={editing.text}
          onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; A.patchTextFlow(editing.id, { text: v }, false); }}
          onBlur={() => set({ editingText: null })}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { (e.target as HTMLTextAreaElement).blur(); } }}
          onPointerDown={(e) => e.stopPropagation()} />
      )}
      {!doc.nodes.length && !s.editingText && (
        <div class="canvas-empty"><div onPointerDown={(e) => e.stopPropagation()}>
          <Icon name="sparkle" size={28} style={{ color: 'var(--neon)' }} />
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>Artboard trống</div>
          <div class="small">Chèn block từ panel trái, dán (⌘V) hoặc kéo ảnh vào, hoặc nhấn <span class="kbd">T</span> để gõ chữ. Ảnh dán sẽ nằm cạnh artboard, kéo vào mail khi cần.</div>
          <div class="row"><Btn kind="primary" sm onClick={() => A.addBlock('hero')}>+ Hero</Btn><Btn sm onClick={() => set({ leftTab: 'blocks' })}>Xem block</Btn></div>
        </div></div>
      )}
      <input ref={fileInput} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={async (e) => { const files = Array.from((e.target as HTMLInputElement).files || []); const at = pendingPoint.current || undefined; for (const f of files) await A.addImageFile(f, at); (e.target as HTMLInputElement).value = ''; pendingPoint.current = null; }} />
      {s.cropping && (() => { const n = ops.findNode(doc, s.cropping); if (!n || n.type !== 'image') return null; return (
        <div class="crop-bar" style={{ left: s.pan.x + (n.x + n.w / 2) * s.zoom, top: s.pan.y + (n.y + n.h) * s.zoom + 10 }} onPointerDown={(e) => e.stopPropagation()}>
          <Btn xs onClick={() => A.zoomCrop(n.id, 1 / 1.2)} title="Thu nhỏ">−</Btn>
          <span class="mono small" style={{ minWidth: 44, textAlign: 'center' }}>{Math.round((n.crop?.zoom ?? 1) * 100)}%</span>
          <Btn xs onClick={() => A.zoomCrop(n.id, 1.2)} title="Phóng to">+</Btn>
          <Btn xs onClick={() => A.updateNode(n.id, { crop: null } as Partial<Node>)}>Vừa khung</Btn>
          <Btn xs onClick={() => A.updateNode(n.id, { flipX: !n.flipX } as Partial<Node>)}>Lật ↔</Btn>
          <Btn xs onClick={() => A.updateNode(n.id, { flipY: !n.flipY } as Partial<Node>)}>Lật ↕</Btn>
          <Btn xs kind="primary" onClick={() => set({ cropping: null })}>Xong</Btn>
        </div>
      ); })()}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />}
      {s.busy && <div class="busy-overlay"><div class="box"><div class="row"><Icon name="bolt" style={{ color: 'var(--neon)' }} /><b class="grow">{s.busy.label}</b><span class="mono dim small">{s.busy.total ? `${s.busy.done}/${s.busy.total}` : ''}</span></div><div class="progress"><i class={s.busy.total ? '' : 'indet'} style={{ width: s.busy.total ? `${Math.round((s.busy.done / s.busy.total) * 100)}%` : '30%' }} /></div></div></div>}
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const st = useStore();
  const has = st.selection.length > 0;
  const one = st.selection.length === 1;
  const n = one ? ops.findNode(A.doc(), st.selection[0]) : null;
  useEffect(() => { const off = () => onClose(); window.addEventListener('pointerdown', off, { once: true }); return () => window.removeEventListener('pointerdown', off); }, []);
  const item = (label: string, k: string, fn: () => void, dis = false) => <button disabled={dis} onPointerDown={(e) => e.stopPropagation()} onClick={() => { fn(); onClose(); }}>{label}<span class="k">{k}</span></button>;
  return (
    <div class="ctx" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 320) }}>
      {item('Copy', '⌘C', A.copySelection, !has)}
      {item('Paste', '⌘V', A.pasteClipboard, !st.clipboard)}
      {item('Nhân bản', '⌘D', A.duplicateSelection, !has)}
      {item('Xoá', '⌫', A.deleteSelection, !has)}
      <hr />
      {item('Nhóm', '⌘G', A.groupSelection, st.selection.length < 2)}
      {item('Bỏ nhóm', '⇧⌘G', A.ungroupSelection, !n || n.type !== 'group')}
      <hr />
      {item('Đưa lên trên', '⌘]', () => A.reorderSelection('up'), !has)}
      {item('Đưa xuống dưới', '⌘[', () => A.reorderSelection('down'), !has)}
      {item('Lên trên cùng', '⌥⌘]', () => A.reorderSelection('top'), !has)}
      {item('Xuống dưới cùng', '⌥⌘[', () => A.reorderSelection('bottom'), !has)}
      <hr />
      {item(n && n.locked ? 'Mở khoá' : 'Khoá', '⇧⌘L', () => st.selection.forEach(A.toggleLocked), !has)}
      {item(n && !n.visible ? 'Hiện' : 'Ẩn', '⇧⌘H', () => st.selection.forEach(A.toggleVisible), !has)}
    </div>
  );
}
