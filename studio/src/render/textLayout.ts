// Word-wrapping text layout on Canvas 2D, shared by the editor view, thumbnails and export (single source of truth).
import type { Brand, TextNode } from '../model/types';

export interface Line { text: string; width: number }
export interface TextLayout { lines: Line[]; lineHeight: number; height: number; font: string }

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d')!;
  }
  return measureCtx;
}

const GENERIC: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Georgia: 'Georgia, "Times New Roman", serif',
  'Courier New': '"Courier New", Courier, monospace',
};

export function fontStack(family: string): string {
  if (GENERIC[family]) return GENERIC[family];
  return `"${family}", Inter, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

export function fontString(n: Pick<TextNode, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic'>, brand: Brand, scale = 1): string {
  const fam = n.fontFamily === 'brand' ? brand.fontFamily : n.fontFamily === 'heading' ? brand.headingFamily : n.fontFamily;
  return `${n.italic ? 'italic ' : ''}${n.fontWeight} ${n.fontSize * scale}px ${fontStack(fam)}`;
}

export function layoutText(n: TextNode, brand: Brand, ctx: CanvasRenderingContext2D = mctx(), scale = 1): TextLayout {
  const font = fontString(n, brand, scale);
  ctx.font = font;
  let native = false;
  try { (ctx as any).letterSpacing = `${n.letterSpacing * scale}px`; native = typeof (ctx as any).letterSpacing === 'string'; } catch { /* unsupported */ }
  const maxW = Math.max(1, n.w * scale);
  const lines: Line[] = [];
  // Chrome ≥ 99 applies ctx.letterSpacing inside measureText; older engines need the manual add.
  const measure = (s: string) => ctx.measureText(s).width + (!native && n.letterSpacing ? n.letterSpacing * scale * s.length : 0);
  for (const para of n.text.split('\n')) {
    if (!para) { lines.push({ text: '', width: 0 }); continue; }
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (cur && measure(test) > maxW && !/^\s+$/.test(w)) {
        lines.push({ text: cur.replace(/\s+$/, ''), width: measure(cur.replace(/\s+$/, '')) });
        cur = /^\s+$/.test(w) ? '' : w;
        // very long word: hard break by characters
        while (measure(cur) > maxW && cur.length > 1) {
          let cut = cur.length - 1;
          while (cut > 1 && measure(cur.slice(0, cut)) > maxW) cut--;
          lines.push({ text: cur.slice(0, cut), width: measure(cur.slice(0, cut)) });
          cur = cur.slice(cut);
        }
      } else cur = test;
    }
    lines.push({ text: cur.replace(/\s+$/, ''), width: measure(cur.replace(/\s+$/, '')) });
  }
  const lineHeight = n.fontSize * n.lineHeight * scale;
  return { lines, lineHeight, height: lines.length * lineHeight, font };
}

export function textHeight(n: TextNode, brand: Brand): number {
  return Math.ceil(layoutText(n, brand).height);
}
