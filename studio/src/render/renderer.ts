// Canvas renderer: one code path for the editor artboard, project thumbnails and slice export.
import type { Brand, Color, Doc, ImageNode, Node, RectNode, TextNode } from '../model/types';
import { resolveColor } from '../model/types';
import { layoutText } from './textLayout';

export interface ImageSource { image(id: string): HTMLImageElement | ImageBitmap | undefined }

export interface RenderOptions {
  scale: number;
  /** Offset in device pixels where the artboard's (0,0) lands. */
  ox?: number;
  oy?: number;
  /** Draw placeholders (editor) or plain fill (export). */
  editor?: boolean;
  /** Skip these node ids (e.g. while editing text in an overlay). */
  skip?: Set<string>;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (!rad) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function col(c: Color | null | undefined, brand: Brand): string | null { return resolveColor(c, brand); }

function withShadow(ctx: CanvasRenderingContext2D, sh: { blur: number; y: number; color: string; opacity: number } | null | undefined, s: number, draw: () => void) {
  if (!sh || sh.opacity <= 0) { draw(); return; }
  ctx.save();
  const [r, g, b] = hexRgb(sh.color);
  ctx.shadowColor = `rgba(${r},${g},${b},${Math.min(1, sh.opacity)})`; ctx.shadowBlur = sh.blur * s; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = sh.y * s;
  draw();
  ctx.restore();
}

function drawRect(ctx: CanvasRenderingContext2D, n: RectNode, brand: Brand, s: number) {
  const x = n.x * s, y = n.y * s, w = n.w * s, h = n.h * s;
  const fill = col(n.fill, brand);
  if (fill) withShadow(ctx, n.shadow, s, () => { rr(ctx, x, y, w, h, n.radius * s); ctx.fillStyle = fill; ctx.fill(); });
  else if (n.shadow && n.gradient) withShadow(ctx, n.shadow, s, () => { rr(ctx, x, y, w, h, n.radius * s); ctx.fillStyle = col(n.gradient!.from, brand) || '#000'; ctx.fill(); });
  if (n.gradient) {
    const a = ((n.gradient.angle || 0) * Math.PI) / 180;
    const cx = x + w / 2, cy = y + h / 2, len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
    const g = ctx.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
    g.addColorStop(0, col(n.gradient.from, brand) || '#000'); g.addColorStop(1, col(n.gradient.to, brand) || '#000');
    rr(ctx, x, y, w, h, n.radius * s); ctx.fillStyle = g; ctx.fill();
  }
  if (n.stroke && n.stroke.width > 0) {
    const sc = col(n.stroke.color, brand);
    if (sc) { rr(ctx, x + (n.stroke.width * s) / 2, y + (n.stroke.width * s) / 2, w - n.stroke.width * s, h - n.stroke.width * s, Math.max(0, n.radius * s - (n.stroke.width * s) / 2)); ctx.strokeStyle = sc; ctx.lineWidth = n.stroke.width * s; ctx.stroke(); }
  }
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a), B = hexRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function seedOf(id: string): number { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

/** Placeholder "art": a brand-tinted gradient with soft lit shapes, a highlight sweep and a fine grid, so templates look
 *  designed before real photos arrive. Deterministic per node id. */
function drawArt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number, brand: Brand, seed: number, editor: boolean) {
  const r = (k: number) => ((seed >>> (k * 5)) & 31) / 31; // 0..1 pseudo-random per slot
  const light = mix(brand.primary, brand.bg, 0.86), mid = mix(brand.primary, brand.bg, 0.55), deep = mix(brand.primary, brand.accent, 0.35);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, light); g.addColorStop(0.55, mid); g.addColorStop(1, deep);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // soft lit orbs (radial gradients read as blurred shapes)
  for (let i = 0; i < 3; i++) {
    const cx = x + w * (0.15 + 0.7 * r(i)), cy = y + h * (0.2 + 0.6 * r(i + 3)), rad = Math.min(w, h) * (0.22 + 0.3 * r(i + 6));
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const c = i === 2 ? mix(brand.accent, brand.bg, 0.25) : mix(brand.bg, brand.primary, 0.1 + 0.15 * i);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = i === 2 ? 0.55 : 0.75; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
  }
  // diagonal highlight sweep
  ctx.globalAlpha = 0.18;
  const sw = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  sw.addColorStop(0.35, 'rgba(255,255,255,0)'); sw.addColorStop(0.5, 'rgba(255,255,255,0.9)'); sw.addColorStop(0.65, 'rgba(255,255,255,0)');
  ctx.fillStyle = sw; ctx.fillRect(x, y, w, h);
  // thin ring + fine dot grid for texture
  ctx.globalAlpha = 0.22; ctx.strokeStyle = brand.bg; ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.beginPath(); ctx.arc(x + w * (0.7 + 0.2 * r(9)), y + h * (0.3 + 0.3 * r(10)), Math.min(w, h) * 0.28, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.1; ctx.fillStyle = brand.ink;
  const step = 22 * s;
  for (let gx = x + step / 2; gx < x + w; gx += step) for (let gy = y + step / 2; gy < y + h; gy += step) { ctx.beginPath(); ctx.arc(gx, gy, 0.8 * s, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  if (editor && h > 56 * s && w > 120 * s) {
    const label = `Ảnh ${Math.round(w / s)}×${Math.round(h / s)} · kéo ảnh vào`;
    ctx.font = `600 ${11 * s}px Inter, sans-serif`;
    const tw = ctx.measureText(label).width + 16 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, x + w / 2 - tw / 2, y + h / 2 - 11 * s, tw, 22 * s, 11 * s); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
  }
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number, label: string) {
  ctx.save();
  ctx.fillStyle = '#E6EBE7';
  ctx.fillRect(x, y, w, h);
  // diagonal hatch
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1 * s;
  const step = 14 * s;
  ctx.beginPath();
  for (let d = -h; d < w; d += step) { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
  ctx.stroke();
  // icon + label
  const cx = x + w / 2, cy = y + h / 2;
  const sz = Math.min(28 * s, w * 0.3, h * 0.3);
  if (sz > 8) {
    ctx.strokeStyle = '#8A948C'; ctx.lineWidth = 1.5 * s;
    rr(ctx, cx - sz / 2, cy - sz / 2 - 6 * s, sz, sz * 0.8, 3 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - sz / 2 + 4 * s, cy + sz * 0.3 - 6 * s); ctx.lineTo(cx - sz * 0.15, cy - 4 * s); ctx.lineTo(cx + sz * 0.05, cy + sz * 0.1 - 6 * s); ctx.lineTo(cx + sz * 0.2, cy - 2 * s); ctx.lineTo(cx + sz / 2 - 4 * s, cy + sz * 0.3 - 6 * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + sz * 0.22, cy - sz * 0.25 - 6 * s, sz * 0.08, 0, Math.PI * 2); ctx.fillStyle = '#8A948C'; ctx.fill();
    if (h > 60 * s && w > 90 * s) {
      ctx.fillStyle = '#6E786F'; ctx.font = `${11 * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(label, cx, cy + sz * 0.5);
    }
  }
  ctx.restore();
}

function drawImage(ctx: CanvasRenderingContext2D, n: ImageNode, brand: Brand, s: number, src: ImageSource, editor: boolean) {
  const x = n.x * s, y = n.y * s, w = n.w * s, h = n.h * s;
  const img = n.assetId ? src.image(n.assetId) : undefined;
  if (n.shadow) withShadow(ctx, n.shadow, s, () => { rr(ctx, x, y, w, h, n.radius * s); ctx.fillStyle = col(n.fill, brand) || '#ffffff'; ctx.fill(); });
  ctx.save();
  rr(ctx, x, y, w, h, n.radius * s);
  ctx.clip();
  const fill = col(n.fill, brand);
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (img && (img as HTMLImageElement).width) {
    const iw = img.width, ih = img.height;
    let dw = w, dh = h, dx = x, dy = y;
    if (n.fit !== 'fill') {
      const r = n.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      dw = iw * r; dh = ih * r; dx = x + (w - dw) / 2; dy = y + (h - dh) / 2;
    }
    ctx.drawImage(img as CanvasImageSource, dx, dy, dw, dh);
  } else if (!fill) {
    drawArt(ctx, x, y, w, h, s, brand, seedOf(n.id), editor);
  } else if (editor && h > 40 * s && w > 80 * s) {
    drawPlaceholder(ctx, x, y, w, h, s, `Ảnh ${Math.round(n.w)}×${Math.round(n.h)} · kéo ảnh vào`);
  }
  if (n.overlay && n.overlay.opacity > 0) {
    ctx.globalAlpha = n.overlay.opacity;
    if (n.overlay.gradient) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,0)'); g.addColorStop(1, n.overlay.color); ctx.fillStyle = g; }
    else ctx.fillStyle = n.overlay.color;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, n: TextNode, brand: Brand, s: number) {
  const lay = layoutText(n, brand, ctx, s);
  const color = col(n.color, brand) || '#000';
  ctx.save();
  ctx.font = lay.font;
  try { (ctx as any).letterSpacing = `${n.letterSpacing * s}px`; } catch { /* unsupported */ }
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const x = n.x * s, w = n.w * s, h = n.h * s;
  let y0 = n.y * s;
  if (!n.autoHeight) {
    if (n.vAlign === 'middle') y0 += (h - lay.height) / 2;
    else if (n.vAlign === 'bottom') y0 += h - lay.height;
  }
  const ascent = n.fontSize * s * 0.78; // approximate cap baseline inside the line box
  const pad = (lay.lineHeight - n.fontSize * s) / 2;
  lay.lines.forEach((ln, i) => {
    let lx = x;
    if (n.align === 'center') lx = x + (w - ln.width) / 2;
    else if (n.align === 'right') lx = x + w - ln.width;
    const ly = y0 + i * lay.lineHeight + pad + ascent;
    ctx.fillText(ln.text, lx, ly);
    if (n.underline && ln.width) { ctx.fillRect(lx, ly + 2 * s, ln.width, Math.max(1, s)); }
    if (n.strike && ln.width) { ctx.fillRect(lx, ly - n.fontSize * s * 0.3, ln.width, Math.max(1, 1.2 * s)); }
  });
  ctx.restore();
}

export function drawNode(ctx: CanvasRenderingContext2D, n: Node, brand: Brand, s: number, src: ImageSource, editor: boolean, skip?: Set<string>) {
  if (!n.visible || (skip && skip.has(n.id))) return;
  ctx.save();
  if (n.opacity < 1) ctx.globalAlpha *= n.opacity;
  switch (n.type) {
    case 'rect': drawRect(ctx, n, brand, s); break;
    case 'image': drawImage(ctx, n, brand, s, src, editor); break;
    case 'text': drawText(ctx, n, brand, s); break;
    case 'group': for (const c of n.children) drawNode(ctx, c, brand, s, src, editor, skip); break;
  }
  ctx.restore();
}

export function renderDoc(ctx: CanvasRenderingContext2D, doc: Doc, brand: Brand, src: ImageSource, o: RenderOptions) {
  const s = o.scale;
  ctx.save();
  ctx.translate(o.ox ?? 0, o.oy ?? 0);
  ctx.beginPath(); ctx.rect(0, 0, doc.width * s, doc.height * s); ctx.clip();
  const bg = col(doc.bg, brand) || '#ffffff';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, doc.width * s, doc.height * s);
  for (const n of doc.nodes) drawNode(ctx, n, brand, s, src, !!o.editor, o.skip);
  ctx.restore();
}

/** Render the whole doc to an offscreen canvas at `scale`. */
export function renderToCanvas(doc: Doc, brand: Brand, src: ImageSource, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(doc.width * scale));
  c.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = c.getContext('2d')!;
  renderDoc(ctx, doc, brand, src, { scale, editor: false });
  return c;
}

export function thumbnail(doc: Doc, brand: Brand, src: ImageSource, width = 240): string {
  const scale = width / doc.width;
  const c = renderToCanvas({ ...doc, height: Math.min(doc.height, doc.width * 1.6) }, brand, src, scale);
  return c.toDataURL('image/jpeg', 0.8);
}
