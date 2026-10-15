// Table-based email HTML builder. Deterministic: same plan + same URLs -> same HTML.
import type { LiveText, Provider, Slice, SlicePlan } from './types';
import { applyUtm, type UtmVars } from './utm';
import { utf8Bytes } from './hash';

export interface HtmlInput {
  plan: SlicePlan;
  /** slice key -> hosted image URL (or relative path for the zip export). */
  images: Record<string, string>;
  mobile?: { plan: SlicePlan; images: Record<string, string>; cellBg?: Record<string, string> } | null;
  /** slice key -> edge colour; painted on the slice's cell so seams between slices never show the page behind. */
  cellBg?: Record<string, string>;
  title: string;
  preheader: string;
  /** Include the hidden preheader div. Off when pasting into a brand template that already has one. */
  includePreheader: boolean;
  /** Full document (doctype/head) vs. fragment to paste into a template. */
  fullDocument: boolean;
  footerHtml?: string;
  bgColor?: string | null;
  utm?: { template: string; vars: Omit<UtmVars, 'slice' | 'host'> } | null;
  provider?: Provider | null;
  lang?: string;
  /** Web-font stylesheets for live-text slices (Apple Mail / iOS use them; others fall back to the safe font). */
  fontLinks?: string[];
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Spaces and non-ASCII in an href break ESP click-tracking rewrites; percent-encode only those (never re-encode an encoded URL). */
export function safeHref(u: string): string { return u.replace(/ /g, '%20').replace(/[^\x21-\x7E]/g, (c) => encodeURIComponent(c)); }
/** utm_content for a slice: what the reader clicked ("mua-ngay", "giam-30"), not its grid position. */
function sliceLabel(s: Slice): string { const a = (s.alt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); return a || s.key; }
function hrefFor(link: string, sliceKey: string, inp: HtmlInput): string {
  return safeHref(inp.utm ? applyUtm(link, inp.utm.template, { ...inp.utm.vars, slice: sliceKey }) : link);
}
/** A flat #rrggbb for bgcolor= attributes and JPG flattening: rgba() composited over white, #rgb expanded, anything else white. */
export function solidHex(c: string | null | undefined): string {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s); if (m) return `#${m[1].split('').map((x) => x + x).join('')}`.toLowerCase();
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) { if (!m[2]) return `#${m[1]}`.toLowerCase(); const a = parseInt(m[2], 16) / 255; const n = parseInt(m[1], 16); return over([(n >> 16) & 255, (n >> 8) & 255, n & 255], a); }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) { let a = m[4] === undefined ? 1 : parseFloat(m[4]); if (m[4] && m[4].endsWith('%')) a /= 100; return over([+m[1], +m[2], +m[3]], Math.max(0, Math.min(1, a))); }
  return '#ffffff';
}
function over(rgb: number[], a: number): string { return '#' + rgb.map((v) => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join(''); }
/** Outlook's Word engine ignores max-width and stretches width:100% tables across the pane: a fixed-width ghost table pins them. */
const msoOpen = (W: number) => `<!--[if mso]><table role="presentation" width="${W}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`;
const msoClose = `<!--[if mso]></td></tr></table><![endif]-->`;

function imgTag(src: string, w: number, h: number, alt: string, cls: string, fluid: boolean): string {
  const style = fluid
    ? `display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:${w}px;height:auto;`
    : `display:block;border:0;outline:none;text-decoration:none;`;
  return `<img src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" class="${cls}" style="${style}" />`;
}

/** A live-text cell: each paragraph placed with padding at its design position. Rows stack, so a fallback font that
 *  wraps differently only makes the cell taller, never overlaps anything. */
function liveTd(s: Slice, t: LiveText, href: string | null, widthAttr = '', widthCss = ''): string {
  const bg = solidHex(t.bg);
  const runs = [...t.runs].sort((a, b) => a.y - b.y || a.x - b.x);
  if (!runs.length) return `<td${widthAttr} align="left" valign="top" bgcolor="${bg}" height="${Math.round(s.h)}" style="padding:0;margin:0;${widthCss}height:${Math.round(s.h)}px;line-height:0;font-size:0;background-color:${bg};">&nbsp;</td>`;
  // runs on one baseline (a bold lead-in, a coloured word) share a line: one div, a span per run
  const lines: (typeof runs)[] = [];
  for (const r of runs) { const l = lines.find((ln) => Math.abs(ln[0].y - r.y) < Math.max(ln[0].size, r.size) * 0.5); if (l) l.push(r); else lines.push([r]); }
  let y = 0;
  const out = lines.map((ln) => {
    ln.sort((a, b) => a.x - b.x);
    const first = ln[0], last = ln[ln.length - 1];
    const lineY = Math.min(...ln.map((r) => r.y)), lineBottom = Math.max(...ln.map((r) => r.y + r.h));
    const top = Math.max(0, Math.round(lineY - y));
    const left = Math.max(0, Math.round(first.x)), right = Math.max(0, Math.round(s.w - (last.x + last.w)));
    const size = Math.max(...ln.map((r) => r.size));
    const lh = Math.max(1, Math.round(Math.max(...ln.map((r) => r.size * r.lineHeight))));
    const runCss = (r: (typeof runs)[number]) => `font-family:${r.font.replace(/"/g, "'")};font-size:${r.size}px;font-weight:${r.weight};${r.italic ? 'font-style:italic;' : ''}color:${solidHex(r.color)};${r.letterSpacing ? `letter-spacing:${r.letterSpacing}px;` : ''}`;
    const piece = (r: (typeof runs)[number], i: number) => {
      const body = esc(r.text).replace(/\n/g, '<br />');
      const gap = i > 0 && r.x - (ln[i - 1].x + ln[i - 1].w) > 1 && !/^\s/.test(r.text) && !/\s$/.test(ln[i - 1].text) ? ' ' : '';
      const color = solidHex(r.color);
      const inner = href ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="color:${color};text-decoration:${r.underline ? 'underline' : 'none'};">${body}</a>` : body;
      return ln.length === 1 ? inner : `${gap}<span style="${runCss(r)}${r.underline && !href ? 'text-decoration:underline;' : ''}">${inner}</span>`;
    };
    const css = `margin:0;padding:${top}px ${right}px 0 ${left}px;${runCss(first).replace(/font-size:[^;]+;/, `font-size:${size}px;`)}line-height:${lh}px;mso-line-height-rule:exactly;text-align:${first.align};${ln.length === 1 && first.underline && !href ? 'text-decoration:underline;' : ''}`;
    y = Math.max(y, lineBottom);
    return `<div style="${css}">${ln.map(piece).join('')}</div>`;
  });
  const bottom = Math.max(0, Math.round(s.h - y));
  return `<td${widthAttr} align="left" valign="top" bgcolor="${bg}" style="padding:0 0 ${bottom}px 0;margin:0;${widthCss}background-color:${bg};">${out.join('')}</td>`;
}

function renderPlan(plan: SlicePlan, images: Record<string, string>, inp: HtmlInput, cls: string, cellBg: Record<string, string> = {}): string {
  const W = plan.width;
  const rows: string[] = [];
  // a cell painted in its slice's edge colour: sub-pixel seams (125%/150% zoom, scaled clients) stay invisible
  const paint = (key: string) => { const c = cellBg[key]; return c && /^#[0-9a-f]{6}$/i.test(c) ? { attr: ` bgcolor="${c}"`, css: `background-color:${c};` } : { attr: '', css: '' }; };
  for (const row of plan.rows) {
    if (row.cells.length === 1) {
      const s = row.cells[0];
      if (s.text) { rows.push(`<tr>${liveTd(s, s.text, s.link ? hrefFor(s.link, sliceLabel(s), inp) : null)}</tr>`); continue; }
      const src = images[s.key] ?? '';
      let inner = imgTag(src, s.w, s.h, s.alt, `${cls}-img`, true);
      if (s.link) inner = `<a href="${esc(hrefFor(s.link, sliceLabel(s), inp))}" target="_blank" rel="noopener" style="display:block;text-decoration:none;">${inner}</a>`;
      const p = paint(s.key);
      rows.push(`<tr><td align="left" valign="top"${p.attr} style="padding:0;margin:0;line-height:0;font-size:0;${p.css}">${inner}</td></tr>`);
      continue;
    }
    // multi-column row: nested table, proportional widths so columns stay aligned when fluid
    const tds = row.cells.map((s) => {
      const pct = Math.round((s.w / W) * 10000) / 100;
      if (s.text) return liveTd(s, s.text, s.link ? hrefFor(s.link, sliceLabel(s), inp) : null, ` width="${pct}%"`, `width:${pct}%;`);
      const src = images[s.key] ?? '';
      let inner = imgTag(src, s.w, s.h, s.alt, `${cls}-img`, true);
      if (s.link) inner = `<a href="${esc(hrefFor(s.link, sliceLabel(s), inp))}" target="_blank" rel="noopener" style="display:block;text-decoration:none;">${inner}</a>`;
      const p = paint(s.key);
      return `<td width="${pct}%" align="left" valign="top"${p.attr} style="padding:0;margin:0;line-height:0;font-size:0;width:${pct}%;${p.css}">${inner}</td>`;
    });
    rows.push(
      `<tr><td style="padding:0;margin:0;line-height:0;font-size:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tr>${tds.join('')}</tr></table></td></tr>`,
    );
  }
  return `${msoOpen(W)}<table role="presentation" class="${cls}" width="${W}" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:${W}px;border-collapse:collapse;margin:0 auto;">${rows.join('')}</table>${msoClose}`;
}

export function buildEmailHtml(inp: HtmlInput): string {
  const { plan } = inp;
  const W = plan.width;
  const parts: string[] = [];

  if (inp.includePreheader && inp.preheader.trim()) {
    const pad = '&nbsp;&zwnj;'.repeat(40);
    parts.push(
      `<div class="ph-preheader" style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:transparent;">${esc(inp.preheader.trim())}${pad}</div>`,
    );
  }

  const hasMobile = !!(inp.mobile && inp.mobile.plan.slices.length);
  const desktop = renderPlan(plan, inp.images, inp, hasMobile ? 'ph-desktop' : 'ph-main', inp.cellBg);
  parts.push(desktop);

  if (hasMobile && inp.mobile) {
    const mob = renderPlan(inp.mobile.plan, inp.mobile.images, inp, 'ph-mobile', inp.mobile.cellBg);
    parts.push(
      `<!--[if !mso]><!--><div class="ph-mobile-wrap" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${mob}</div><!--<![endif]-->`,
    );
  }

  if (inp.footerHtml && inp.footerHtml.trim()) {
    parts.push(
      `${msoOpen(W)}<table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:${W}px;border-collapse:collapse;margin:0 auto;"><tr><td style="padding:16px 24px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8a8a8a;text-align:center;">${inp.footerHtml}</td></tr></table>${msoClose}`,
    );
  }

  const style = `<style type="text/css">
  .ph-main-img,.ph-desktop-img,.ph-mobile-img{-ms-interpolation-mode:bicubic;}
  @media only screen and (max-width:${W}px){
    .ph-main,.ph-desktop,.ph-mobile{width:100%!important;max-width:100%!important;}
    .ph-main-img,.ph-desktop-img,.ph-mobile-img{max-width:100%!important;}
    ${hasMobile ? `.ph-desktop{display:none!important;max-height:0!important;overflow:hidden!important;}
    .ph-mobile-wrap,.ph-mobile{display:block!important;max-height:none!important;overflow:visible!important;}` : ''}
  }
</style>`;

  const bg = solidHex(inp.bgColor || '#ffffff');
  const body = `<!-- Phloem: generated from Figma frame "${esc(plan.frameName)}" (${W}×${plan.height}). ${plan.slices.length} slices. Never auto-sent. -->
${style}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;border-collapse:collapse;background-color:${bg};"><tr><td align="center" valign="top" style="padding:0;">
${parts.join('\n')}
</td></tr></table>`;

  if (!inp.fullDocument) return body;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="${inp.lang || 'vi'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<title>${esc(inp.title)}</title>
${inp.fontLinks && inp.fontLinks.length ? `<!--[if !mso]><!-->${inp.fontLinks.map((u) => `<link href="${esc(u)}" rel="stylesheet" type="text/css" />`).join('')}<!--<![endif]-->` : ''}
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style type="text/css">body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}body{margin:0!important;padding:0!important;width:100%!important;}</style>
</head>
<body style="margin:0;padding:0;background-color:${bg};">
${body}
</body>
</html>`;
}

export function htmlSizeBytes(html: string): number {
  return utf8Bytes(html).length;
}
