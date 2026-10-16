// Ứng dụng (Canva-style apps) that draw vector art: QR codes and charts. Both keep their settings on the layer
// (vector.qr / vector.chart) so selecting the layer and opening the app again edits it.
import qrcode from 'qrcode-generator';
import type { ChartSpec, QrSpec } from '../model/types';

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** QR code SVG (error correction M, quiet zone of 2 modules). Square, dot or rounded modules. */
export function qrSvg(spec: QrSpec): { svg: string; size: number } {
  const qr = qrcode(0, 'M');
  qr.addData(unescape(encodeURIComponent(spec.text || ' ')), 'Byte');
  qr.make();
  const n = qr.getModuleCount(), q = 2, S = n + q * 2, cell = 10, W = S * cell;
  let body = spec.bg ? `<rect width="${W}" height="${W}" rx="${spec.style === 'square' ? 0 : cell * 2}" fill="${spec.bg}"/>` : '';
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c) || (spec.style !== 'square' && finder(r, c))) continue;
    const x = (c + q) * cell, y = (r + q) * cell;
    body += spec.style === 'dots' ? `<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${cell * 0.46}"/>` : spec.style === 'rounded' ? `<rect x="${x + 0.5}" y="${y + 0.5}" width="${cell - 1}" height="${cell - 1}" rx="${cell * 0.32}"/>` : `<rect x="${x}" y="${y}" width="${cell + 0.3}" height="${cell + 0.3}"/>`;
  }
  if (spec.style !== 'square') for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const x = (c + q) * cell, y = (r + q) * cell;
    body += `<rect x="${x + cell / 2}" y="${y + cell / 2}" width="${cell * 6}" height="${cell * 6}" rx="${cell * 1.6}" fill="none" stroke="${spec.color}" stroke-width="${cell}"/><rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="${cell * 0.9}"/>`;
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}"><g fill="${spec.color}">${body}</g></svg>`, size: W };
}

/** Lines "Nhãn: 12" (or "Nhãn 12", "Nhãn, 12") → data. */
export function parseChartData(text: string): { label: string; value: number }[] {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(.*?)[\s:,;=|]+(-?[\d.,]+)\s*%?\s*$/.exec(l); return m ? { label: m[1].trim(), value: Number(m[2].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || 0 } : null; }).filter((x): x is { label: string; value: number } => !!x && !!x.label).slice(0, 24);
}

/** Chart SVG at a size: bar, horizontal bar, line, area, pie, donut, progress ring. Uses the spec's colours and ink. */
export function chartSvg(c: ChartSpec, W = 600, H = 400): string {
  const d = c.data.length ? c.data : [{ label: 'A', value: 1 }];
  const col = (i: number) => c.colors[i % c.colors.length] || '#3B82F6';
  const font = `font-family="Inter, Arial, sans-serif"`;
  const fmt = (v: number) => `${Math.round(v * 10) / 10}${c.unit || ''}`;
  const max = Math.max(...d.map((x) => x.value), 0) || 1;
  const title = c.title ? `<text x="${W / 2}" y="30" text-anchor="middle" ${font} font-size="22" font-weight="700" fill="${c.ink}">${esc(c.title)}</text>` : '';
  const top = c.title ? 56 : 20;
  let body = '';
  if (c.kind === 'bar' || c.kind === 'line' || c.kind === 'area') {
    const L = 40, R = W - 20, B = H - 44, T = top + 16, n = d.length, step = (R - L) / n;
    body += `<path d="M${L},${B} H${R}" stroke="${c.ink}" stroke-opacity=".25" stroke-width="2"/>`;
    for (let g = 1; g <= 3; g++) { const y = B - ((B - T) * g) / 3; body += `<path d="M${L},${f(y)} H${R}" stroke="${c.ink}" stroke-opacity=".08"/>`; }
    const pts = d.map((x, i) => [L + step * (i + 0.5), B - ((B - T) * Math.max(0, x.value)) / max]);
    if (c.kind === 'bar') d.forEach((x, i) => { const w = step * 0.62, h = B - pts[i][1]; body += `<rect x="${f(pts[i][0] - w / 2)}" y="${f(pts[i][1])}" width="${f(w)}" height="${f(h)}" rx="${f(Math.min(10, w / 4))}" fill="${col(i)}"/>`; });
    else {
      const path = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])},${f(p[1])}`).join(' ');
      if (c.kind === 'area') body += `<path d="${path} L${f(pts[pts.length - 1][0])},${B} L${f(pts[0][0])},${B}Z" fill="${col(0)}" opacity=".22"/>`;
      body += `<path d="${path}" fill="none" stroke="${col(0)}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` + pts.map((p) => `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="7" fill="#fff" stroke="${col(0)}" stroke-width="4"/>`).join('');
    }
    d.forEach((x, i) => {
      body += `<text x="${f(pts[i][0])}" y="${B + 28}" text-anchor="middle" ${font} font-size="16" fill="${c.ink}" fill-opacity=".75">${esc(x.label.slice(0, 14))}</text>`;
      if (c.showValues) body += `<text x="${f(pts[i][0])}" y="${f(pts[i][1] - 12)}" text-anchor="middle" ${font} font-size="16" font-weight="700" fill="${c.ink}">${esc(fmt(x.value))}</text>`;
    });
  } else if (c.kind === 'hbar') {
    const L = 150, R = W - 70, T = top + 6, B = H - 16, n = d.length, step = (B - T) / n;
    d.forEach((x, i) => {
      const y = T + step * i, h = step * 0.6, w = ((R - L) * Math.max(0, x.value)) / max;
      body += `<text x="${L - 12}" y="${f(y + h * 0.72)}" text-anchor="end" ${font} font-size="16" fill="${c.ink}">${esc(x.label.slice(0, 16))}</text><rect x="${L}" y="${f(y)}" width="${f(R - L)}" height="${f(h)}" rx="${f(h / 2)}" fill="${c.ink}" fill-opacity=".07"/><rect x="${L}" y="${f(y)}" width="${f(Math.max(h, w))}" height="${f(h)}" rx="${f(h / 2)}" fill="${col(i)}"/>`;
      if (c.showValues) body += `<text x="${f(L + Math.max(h, w) + 8)}" y="${f(y + h * 0.72)}" ${font} font-size="16" font-weight="700" fill="${c.ink}">${esc(fmt(x.value))}</text>`;
    });
  } else if (c.kind === 'pie' || c.kind === 'donut') {
    const sum = d.reduce((a, x) => a + Math.max(0, x.value), 0) || 1;
    const cx = W * 0.36, cy = (top + H) / 2, r = Math.min(W * 0.3, (H - top) / 2 - 10), ir = c.kind === 'donut' ? r * 0.58 : 0;
    let a0 = -Math.PI / 2;
    d.forEach((x, i) => {
      const a1 = a0 + (Math.max(0, x.value) / sum) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rr: number, a: number) => `${f(cx + rr * Math.cos(a))},${f(cy + rr * Math.sin(a))}`;
      body += ir ? `<path d="M${p(r, a0)} A${r},${r} 0 ${big} 1 ${p(r, a1)} L${p(ir, a1)} A${ir},${ir} 0 ${big} 0 ${p(ir, a0)}Z" fill="${col(i)}"/>` : `<path d="M${cx},${cy} L${p(r, a0)} A${r},${r} 0 ${big} 1 ${p(r, a1)}Z" fill="${col(i)}"/>`;
      a0 = a1;
    });
    d.slice(0, 8).forEach((x, i) => { const y = top + 24 + i * 32; body += `<rect x="${f(W * 0.7)}" y="${y - 14}" width="18" height="18" rx="5" fill="${col(i)}"/><text x="${f(W * 0.7 + 28)}" y="${y}" ${font} font-size="16" fill="${c.ink}">${esc(x.label.slice(0, 14))}${c.showValues ? ` · ${Math.round((Math.max(0, x.value) / sum) * 100)}%` : ''}</text>`; });
  } else {
    // progress ring: the first value as a percentage
    const v = Math.max(0, Math.min(100, d[0].value)), cx = W / 2, cy = (top + H) / 2, r = Math.min(W, H - top) * 0.36, len = 2 * Math.PI * r;
    body += `<circle cx="${cx}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${c.ink}" stroke-opacity=".1" stroke-width="${f(r * 0.22)}"/><circle cx="${cx}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${col(0)}" stroke-width="${f(r * 0.22)}" stroke-linecap="round" stroke-dasharray="${f((len * v) / 100)} ${f(len)}" transform="rotate(-90 ${cx} ${f(cy)})"/><text x="${cx}" y="${f(cy + r * 0.18)}" text-anchor="middle" ${font} font-size="${f(r * 0.5)}" font-weight="800" fill="${c.ink}">${Math.round(v)}%</text><text x="${cx}" y="${f(cy + r * 0.5)}" text-anchor="middle" ${font} font-size="${f(r * 0.16)}" fill="${c.ink}" fill-opacity=".7">${esc(d[0].label.slice(0, 20))}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${title}${body}</svg>`;
}
