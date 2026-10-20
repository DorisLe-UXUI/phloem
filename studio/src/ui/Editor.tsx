import { useEffect, useRef, useState } from 'preact/hooks';
import { get, isMobile, set, toast, useStore, type Tool } from '../store';
import * as ops from '../model/ops';
import * as A from '../pipeline/actions';
import { activeProfile, providerName } from '../pipeline/exportFlow';
import { CanvasView } from './CanvasView';
import { LeftPanel } from './LeftPanel';
import { resetBoardLayout } from './board';
import { RightPanel } from './RightPanel';
import { Btn } from './components';
import { Icon, Logo, type IconName } from './icons';

const zoomEvt = (kind: string, value?: number) => window.dispatchEvent(new CustomEvent('phloem-zoom', { detail: { kind, value } }));

export function Editor() {
  const s = useStore();
  useEffect(() => { const h = (e: KeyboardEvent) => keys(e); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (get().dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, []);
  useEffect(() => { if (get().project) A.remeasureAll(); }, [s.fontsLoaded]);
  // Paste an image from the clipboard (screenshot, copied photo): onto the selected image layer, else as a new layer.
  useEffect(() => {
    const h = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (get().modal) return; // the open modal (AI composer…) handles its own paste
      const cd = e.clipboardData;
      const files = Array.from(cd?.files || []).filter((f) => f.type.startsWith('image/'));
      // Copied from a web page / another app: an <img> in the HTML or a bare image link.
      const urls: string[] = [];
      if (!files.length && cd) {
        const html = cd.getData('text/html') || '';
        for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) if (/^https?:\/\//i.test(m[1])) urls.push(m[1]);
        const txt = (cd.getData('text/plain') || '').trim();
        if (!urls.length && /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i.test(txt)) urls.push(txt);
      }
      if (!files.length && !urls.length) { if (get().clipboard) { e.preventDefault(); A.pasteClipboard(); } return; }
      e.preventDefault();
      const sel = get().selection; const d = A.doc();
      const target = sel.length === 1 ? ops.findNode(d, sel[0]) : null;
      const intoImage = target && target.type === 'image' ? target.id : undefined;
      let n = 0;
      for (const f of files) { if (intoImage && n === 0) await A.addImageFile(f, undefined, intoImage, { kind: 'paste' }); else await A.addImageFileToScraps(f, undefined, { kind: 'paste' }); n++; }
      for (const u of urls.slice(0, 6)) { const id = await A.addImageUrl(u); if (!id) continue; if (intoImage && n === 0) A.placeAsset(id, undefined, intoImage); else A.addScrap(id); n++; }
      if (!n) { toast('Không lấy được ảnh từ clipboard (link bị chặn?). Thử lưu ảnh rồi kéo vào.', 'err'); return; }
      toast(intoImage ? 'Đã thay ảnh cho layer đang chọn.' : n === 1 ? 'Ảnh nằm cạnh email — kéo vào mail để dùng.' : `${n} ảnh nằm cạnh email — kéo vào mail để dùng.`, 'ok');
    };
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, []);
  // side panels can be put away (remembered) for a bigger canvas; ⌘\ toggles both, like Figma's hide UI
  const [hide, setHide] = useState<{ left: boolean; right: boolean }>(() => { try { return JSON.parse(localStorage.getItem('phloem.panels') || '') || { left: false, right: false }; } catch { return { left: false, right: false }; } });
  const toggle = (side: 'left' | 'right' | 'both') => setHide((h) => { const n = side === 'both' ? (h.left || h.right ? { left: false, right: false } : { left: true, right: true }) : { ...h, [side]: !h[side] }; try { localStorage.setItem('phloem.panels', JSON.stringify(n)); } catch { /* private mode */ } return n; });
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggle('both'); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  // side panels are as wide as you drag them (remembered); double-click the edge for the default width
  useEffect(() => { try { const w = JSON.parse(localStorage.getItem('phloem.panelW') || '{}'); if (w.left) document.documentElement.style.setProperty('--left', `${w.left}px`); if (w.right) document.documentElement.style.setProperty('--right', `${w.right}px`); } catch { /* defaults */ } }, []);
  const dragEdge = (side: 'left' | 'right') => (e: PointerEvent) => {
    e.preventDefault();
    const ws = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const [min, max] = side === 'left' ? [200, 520] : [280, 760];
    let last = 0;
    const move = (ev: PointerEvent) => { last = Math.round(Math.min(max, Math.max(min, side === 'left' ? ev.clientX - ws.left : ws.right - ev.clientX))); document.documentElement.style.setProperty(`--${side}`, `${last}px`); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); if (last) { try { const w = JSON.parse(localStorage.getItem('phloem.panelW') || '{}'); localStorage.setItem('phloem.panelW', JSON.stringify({ ...w, [side]: last })); } catch { /* ignore */ } } };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const resetEdge = (side: 'left' | 'right') => { document.documentElement.style.removeProperty(`--${side}`); try { const w = JSON.parse(localStorage.getItem('phloem.panelW') || '{}'); delete w[side]; localStorage.setItem('phloem.panelW', JSON.stringify(w)); } catch { /* ignore */ } };
  // phone: asking for a right-panel tab (Xuất, AI, Email…) also slides that sheet up
  const firstTab = useRef(true);
  useEffect(() => { if (firstTab.current) { firstTab.current = false; return; } if (isMobile()) set({ mobilePane: 'right' }); }, [s.rightTab]);
  if (!s.project) return null;
  const p = s.project;
  return (
    <div class="app">
      <TopBar />
      <div class={`workspace ${hide.left ? 'hide-left' : ''} ${hide.right ? 'hide-right' : ''}`}>
        <LeftPanel />
        <CanvasView />
        <RightPanel />
        {!hide.left && <div class="ws-size l" onPointerDown={dragEdge('left')} onDblClick={() => resetEdge('left')} title="Kéo để đổi độ rộng · bấm đúp: mặc định" />}
        {!hide.right && <div class="ws-size r" onPointerDown={dragEdge('right')} onDblClick={() => resetEdge('right')} title="Kéo để đổi độ rộng · bấm đúp: mặc định" />}
        <button class="ws-tog l" onClick={() => toggle('left')} title={hide.left ? 'Mở panel trái (⌘\\ ẩn/hiện cả hai)' : 'Cất panel trái'} aria-label={hide.left ? 'Mở panel trái' : 'Cất panel trái'}>{hide.left ? '›' : '‹'}</button>
        <button class="ws-tog r" onClick={() => toggle('right')} title={hide.right ? 'Mở panel phải' : 'Cất panel phải'} aria-label={hide.right ? 'Mở panel phải' : 'Cất panel phải'}>{hide.right ? '‹' : '›'}</button>
      </div>
      <MobileBar />
      <div class="statusbar">
        <span class={`dot ${s.dirty ? 'dirty' : ''}`} />
        <span>{s.dirty ? 'đang sửa…' : s.savedAt ? `đã lưu ${new Date(s.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'chưa lưu'}</span>
        <span>{Math.round(s.zoom * 100)}%</span>
        <span>{s.selection.length ? `${s.selection.length} layer đang chọn` : `${(s.variant === 'mobile' && p.mobile ? p.mobile : p.desktop).nodes.length} layer`}</span>
        <span class="grow" />
        <span>{p.kind === 'design' ? `Phloem Design · ${p.desktop.width}×${p.desktop.height} · không bao giờ tự đăng` : `Phloem không bao giờ tự gửi · bạn duyệt và bấm gửi trong ${activeProfile() ? providerName(activeProfile()!.provider) : 'Mailchimp / Klaviyo'}`}</span>
        <span style={{ cursor: 'pointer' }} onClick={() => set({ modal: 'shortcuts' })}>? phím tắt</span>
      </div>
    </div>
  );
}

function MobileBar() {
  const s = useStore();
  const go = (pane: 'left' | 'canvas' | 'right') => set({ mobilePane: pane !== 'canvas' && s.mobilePane === pane ? 'canvas' : pane });
  return (
    <div class="mobilebar">
      <button class={s.mobilePane === 'left' ? 'on' : ''} onClick={() => go('left')}><Icon name="layers" />Lớp · Ảnh</button>
      <button class={s.mobilePane === 'canvas' ? 'on' : ''} onClick={() => go('canvas')}><Icon name="select" />Canvas</button>
      <button class={s.mobilePane === 'right' ? 'on' : ''} onClick={() => go('right')}><Icon name="settings" />Chỉnh · Xuất</button>
    </div>
  );
}

function TopBar() {
  const s = useStore();
  const p = s.project!;
  const prof = activeProfile();
  const tools: { t: Tool; icon: IconName; k: string; title: string }[] = [
    { t: 'select', icon: 'select', k: 'V', title: 'Chọn / di chuyển (V)' }, { t: 'rect', icon: 'rect', k: 'R', title: 'Hình chữ nhật (R)' }, { t: 'text', icon: 'text', k: 'T', title: 'Chữ (T)' }, { t: 'image', icon: 'image', k: 'I', title: 'Ảnh (I)' }, { t: 'hand', icon: 'hand', k: 'H', title: 'Kéo canvas (H / giữ Space)' },
  ];
  return (
    <div class="topbar">
      <div class="l">
        <Logo size={18} mod={p.kind === 'design' ? 'design' : 'email'} onClick={() => A.goHome()} />
        <Btn kind="ghost" sm icon="home" title="Project" onClick={() => A.goHome()} />
        <input class="pname grow" value={p.name} onChange={(e) => A.renameProject((e.target as HTMLInputElement).value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} title="Tên project" />
      </div>
      <div class="c">
        <div class="tools">{tools.map((t) => <button key={t.t} class={`tool ${s.tool === t.t ? 'on' : ''}`} title={t.title} onClick={() => set({ tool: t.t })}><Icon name={t.icon} /><span class="k">{t.k}</span></button>)}</div>
        <div class="row" style={{ gap: 2 }}><Btn kind="ghost" sm icon="undo" title="Hoàn tác (⌘Z)" onClick={() => A.undo()} /><Btn kind="ghost" sm icon="redo" title="Làm lại (⇧⌘Z)" onClick={() => A.redo()} /></div>
        <div class="zoomc"><button class="tool" title="Thu nhỏ (⌘−)" onClick={() => zoomEvt('out')}><Icon name="zoomOut" /></button><span class="z" title="100% (⌘0)" onClick={() => zoomEvt('reset')}>{Math.round(s.zoom * 100)}%</span><button class="tool" title="Phóng to (⌘+)" onClick={() => zoomEvt('in')}><Icon name="zoomIn" /></button><button class="tool" title="Vừa màn hình (⌘1)" onClick={() => zoomEvt('fit')}><Icon name="fit" /></button><button class="tool" title="Xem tất cả: mọi khung và ảnh nháp (⇧1)" onClick={() => zoomEvt('all')}><Icon name="grid" /></button>{s.project?.kind === 'design' && s.project.clientId && <button class="tool" title="Xếp gọn: đưa các bài đã kéo về bố cục theo ngày đăng" onClick={() => { resetBoardLayout(s.project!.clientId!); set({}); zoomEvt('all'); }}><Icon name="blocks" /></button>}</div>
        <div class="variant" style={{ marginRight: 6 }}>
          <button class={s.playing ? 'on' : ''} title="Xem thử chuyển động (các layer có 'Chuyển động'); khi xuất, lát đó thành GIF động" onClick={() => set({ playing: !s.playing })}><Icon name="play" size={13} />{s.playing ? 'Đang phát' : 'Phát'}</button>
        </div>
        {p.kind === 'design' ? <div class="variant"><button class="on" title="Khổ thiết kế. Đổi cỡ thần kỳ ở tab Xuất ảnh."><Icon name="fit" size={13} />{p.size?.label || 'Thiết kế'}<span class="k">{p.desktop.width}×{p.desktop.height}</span></button></div> : <div class="variant">
          <button class={s.variant === 'desktop' ? 'on' : ''} onClick={() => A.setVariant('desktop')}><Icon name="desktop" size={13} />Desktop<span class="k">{p.desktop.width}</span></button>
          {p.mobile ? <button class={s.variant === 'mobile' ? 'on' : ''} onClick={() => A.setVariant('mobile')}><Icon name="mobile" size={13} />Mobile<span class="k">{p.mobile.width}</span></button> : <button title="Tạo bản mobile 375px" onClick={() => A.createMobileVariant()}><Icon name="plus" size={13} />Mobile</button>}
        </div>}
      </div>
      <div class="r">
        {p.kind === 'design' ? <Btn kind="primary" sm icon="download" onClick={() => set({ rightTab: 'export', mobilePane: 'right' })}>Xuất ảnh</Btn> : <>
        <Btn kind="ghost" sm icon="sparkle" title="Trợ lý AI / dựng 3 phương án" onClick={() => set({ rightTab: 'ai', mobilePane: 'right' })}>AI</Btn>
        <Btn kind="ghost" sm icon="play" title="Xem trước" onClick={() => set({ modal: 'preview' })}>Xem trước</Btn>
        <label class="client-pill" title="Client đang dùng">
          <span class={`dot ${prof ? '' : 'off'}`} /><span class="t">{prof ? `${prof.name}` : 'Chưa chọn client'}</span>
          <select value={prof?.id || ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v === '__add') set({ modal: 'clients' }); else set({ settings: { ...s.settings, activeProfileId: v || null } }); }}>
            <option value="">— chưa chọn —</option>
            {s.profiles.map((x) => <option key={x.id} value={x.id}>{x.name} ({providerName(x.provider)})</option>)}
            <option value="__add">+ Quản lý client…</option>
          </select>
        </label>
        <Btn kind="primary" sm icon="send" onClick={() => set({ rightTab: 'export', mobilePane: 'right' })}>Xuất</Btn>
        </>}
        <Btn kind="ghost" sm icon="settings" title="Cài đặt" onClick={() => set({ modal: 'settings' })} />
      </div>
    </div>
  );
}

function keys(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const st = get();
  if (st.modal || !st.project) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod && k === 'z') { stop(); if (e.shiftKey) A.redo(); else A.undo(); return; }
  if (mod && k === 'y') { stop(); A.redo(); return; }
  if (mod && k === 's') { stop(); void A.saveProject(); return; }
  if (mod && k === 'd') { stop(); A.duplicateSelection(); return; }
  if (mod && k === 'g') { stop(); if (e.shiftKey) A.ungroupSelection(); else A.groupSelection(); return; }
  if (mod && k === 'a') { stop(); A.selectAll(); return; }
  if (mod && k === 'c') { stop(); A.copySelection(); return; }
  if (mod && k === 'x') { stop(); A.cutSelection(); return; }
  if (mod && k === 'v') return; // handled by the window 'paste' event (images from anywhere, else internal layers)
  if (mod && k === ']') { stop(); A.reorderSelection(e.altKey ? 'top' : 'up'); return; }
  if (mod && k === '[') { stop(); A.reorderSelection(e.altKey ? 'bottom' : 'down'); return; }
  if (mod && e.shiftKey && k === 'l') { stop(); st.selection.forEach(A.toggleLocked); return; }
  if (mod && e.shiftKey && k === 'h') { stop(); st.selection.forEach(A.toggleVisible); return; }
  if (mod && (k === '=' || k === '+')) { stop(); zoomEvt('in'); return; }
  if (mod && k === '-') { stop(); zoomEvt('out'); return; }
  if (mod && k === '0') { stop(); zoomEvt('reset'); return; }
  if (mod && k === '1') { stop(); zoomEvt('fit'); return; }
  if (!mod && e.shiftKey && (e.code === 'Digit1' || k === '!')) { stop(); zoomEvt('all'); return; }
  if (mod && k === 'enter') { stop(); set({ rightTab: 'export' }); return; }
  if (mod) return;
  if (k === 'delete' || k === 'backspace') { stop(); A.deleteSelection(); return; }
  if (k === 'escape') { stop(); if (st.editingText) set({ editingText: null }); else if (st.cropping) set({ cropping: null }); else if (st.cutting) set({ cutting: null }); else if (st.scrapSel) set({ scrapSel: null }); else if (st.selection.length) A.clearSelection(); else if (st.enteredGroup) set({ enteredGroup: null }); else set({ tool: 'select' }); return; }
  if (k.startsWith('arrow')) { stop(); const d = e.shiftKey ? 10 : 1; A.nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0); return; }
  if (k === 'v') set({ tool: 'select' }); else if (k === 'r') set({ tool: 'rect' }); else if (k === 't') set({ tool: 'text' }); else if (k === 'i') set({ tool: 'image' }); else if (k === 'h') set({ tool: 'hand' });
  else if (k === '?') set({ modal: 'shortcuts' });
  else if (k === 'enter' && st.selection.length === 1) { const n = A.selectedNodes()[0]; if (n?.type === 'text') { stop(); set({ editingText: n.id }); } else if (n?.type === 'group' && n.children.length) { stop(); set({ enteredGroup: n.id, selection: [n.children[n.children.length - 1].id] }); } }
}
