// Procedural graphics: backgrounds, patterns, glossy 3D shapes and decorative frames drawn as SVG from a palette and a
// seed. Every (generator × palette × seed) is a different piece, so the library is effectively endless, recolours
// to the brand, and costs no downloads. The AI designer can ask for them too (<img data-gfx="waves" …>).

export type GenGroup = 'bg' | 'pattern' | 'shape3d' | 'deco';
export interface GenDef { id: string; label: string; group: GenGroup; w: number; h: number; make: (p: string[], seed: number, w: number, h: number) => string }

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f = (n: number) => (Math.round(n * 10) / 10).toString();
const svg = (w: number, h: number, body: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const hex = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(c); const n = m ? parseInt(m[1], 16) : 0x888888; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function mix(a: string, b: string, t: number): string { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
const shadeC = (c: string, t: number) => (t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#000000', -t));
/** Palette: [background, colour 1, colour 2, colour 3, ink]. */
const P = (p: string[], i: number) => p[Math.min(p.length - 1, i)] || '#888888';

/** Smooth closed blob through n jittered points around (cx, cy). */
function blobPath(r: () => number, cx: number, cy: number, rad: number, n = 7, jitter = 0.32): string {
  const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const rr = rad * (1 - jitter / 2 + r() * jitter); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) d += `M${f(p1[0])},${f(p1[1])}`;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}
/** Smooth open curve through points, closed down to the bottom edge (for waves). */
function wavePath(pts: number[][], h: number): string {
  let d = `M0,${h} L${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2; d += ` C${f(mx)},${f(a[1])} ${f(mx)},${f(b[1])} ${f(b[0])},${f(b[1])}`; }
  return d + ` L${f(pts[pts.length - 1][0])},${h} Z`;
}

export const GENERATORS: GenDef[] = [
  // ---------- backgrounds ----------
  { id: 'waves', label: 'Sóng nhiều lớp', group: 'bg', w: 600, h: 300, make: (p, s, w, h) => {
    const r = rng(s); const n = 4; let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`;
    for (let i = 0; i < n; i++) { const base = h * (0.32 + i * 0.17); const k = 4 + Math.floor(r() * 3); const pts = Array.from({ length: k + 1 }, (_, j) => [(w / k) * j, base + (r() - 0.5) * h * 0.22]); body += `<path d="${wavePath(pts, h)}" fill="${mix(P(p, 1), P(p, 2), i / (n - 1))}" opacity="${f(0.55 + (i / n) * 0.45)}"/>`; }
    return svg(w, h, body);
  } },
  { id: 'peaks', label: 'Núi lớp', group: 'bg', w: 600, h: 300, make: (p, s, w, h) => {
    const r = rng(s); let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`;
    for (let i = 0; i < 4; i++) { const base = h * (0.4 + i * 0.15); const k = 5 + Math.floor(r() * 4); let d = `M0,${h} L0,${f(base)}`; for (let j = 1; j <= k; j++) d += ` L${f((w / k) * (j - 0.5))},${f(base - r() * h * 0.28)} L${f((w / k) * j)},${f(base + (r() - 0.5) * 10)}`; d += ` L${w},${h} Z`; body += `<path d="${d}" fill="${mix(P(p, 1), P(p, 3), i / 3)}"/>`; }
    return svg(w, h, body);
  } },
  { id: 'blobs', label: 'Blob nổi', group: 'bg', w: 600, h: 320, make: (p, s, w, h) => {
    const r = rng(s); let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`;
    for (let i = 0; i < 4; i++) body += `<path d="${blobPath(r, w * (0.1 + r() * 0.8), h * (0.15 + r() * 0.7), Math.min(w, h) * (0.18 + r() * 0.3), 7)}" fill="${P(p, 1 + (i % 3))}" opacity="${f(0.7 + r() * 0.3)}"/>`;
    return svg(w, h, body);
  } },
  { id: 'blur', label: 'Gradient mờ', group: 'bg', w: 600, h: 360, make: (p, s, w, h) => {
    const r = rng(s); const b = Math.round(Math.min(w, h) / 5);
    let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/><g filter="url(#b)">`;
    for (let i = 0; i < 4; i++) body += `<circle cx="${f(w * r())}" cy="${f(h * r())}" r="${f(Math.min(w, h) * (0.28 + r() * 0.25))}" fill="${P(p, 1 + (i % 3))}" opacity="${f(0.75 + r() * 0.25)}"/>`;
    return svg(w, h, body + '</g>', `<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${b}"/></filter>`);
  } },
  { id: 'aurora', label: 'Cực quang', group: 'bg', w: 600, h: 320, make: (p, s, w, h) => {
    const r = rng(s); let defs = ''; let body = `<rect width="${w}" height="${h}" fill="${P(p, 4)}"/>`;
    for (let i = 0; i < 3; i++) { defs += `<radialGradient id="a${i}" cx="${f(0.2 + r() * 0.6)}" cy="${f(0.2 + r() * 0.6)}" r="${f(0.5 + r() * 0.3)}"><stop offset="0" stop-color="${P(p, 1 + i)}" stop-opacity=".95"/><stop offset="1" stop-color="${P(p, 1 + i)}" stop-opacity="0"/></radialGradient>`; body += `<rect width="${w}" height="${h}" fill="url(#a${i})"/>`; }
    return svg(w, h, body, defs);
  } },
  { id: 'lowpoly', label: 'Low-poly', group: 'bg', w: 600, h: 300, make: (p, s, w, h) => {
    const r = rng(s); const cols = 9, rows = 5; const pts: number[][][] = [];
    for (let y = 0; y <= rows; y++) { pts.push([]); for (let x = 0; x <= cols; x++) pts[y].push([(w / cols) * x + (x > 0 && x < cols ? (r() - 0.5) * (w / cols) * 0.7 : 0), (h / rows) * y + (y > 0 && y < rows ? (r() - 0.5) * (h / rows) * 0.7 : 0)]); }
    let body = '';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = pts[y][x], b = pts[y][x + 1], c = pts[y + 1][x], d = pts[y + 1][x + 1];
      const t = (x / cols) * 0.6 + (y / rows) * 0.4;
      const base = mix(P(p, 1), P(p, 2), t);
      body += `<polygon points="${f(a[0])},${f(a[1])} ${f(b[0])},${f(b[1])} ${f(c[0])},${f(c[1])}" fill="${shadeC(base, (r() - 0.5) * 0.25)}" stroke="${shadeC(base, 0)}" stroke-width=".5"/>`;
      body += `<polygon points="${f(b[0])},${f(b[1])} ${f(d[0])},${f(d[1])} ${f(c[0])},${f(c[1])}" fill="${shadeC(base, (r() - 0.5) * 0.25)}" stroke="${shadeC(base, 0)}" stroke-width=".5"/>`;
    }
    return svg(w, h, body);
  } },
  { id: 'sunburst', label: 'Nắng toả', group: 'bg', w: 600, h: 400, make: (p, s, w, h) => {
    const r = rng(s); const n = 16 + Math.floor(r() * 3) * 4; const cx = w * (0.3 + r() * 0.4), cy = h * (0.35 + r() * 0.4), R = Math.hypot(w, h);
    let body = `<rect width="${w}" height="${h}" fill="${P(p, 1)}"/>`;
    for (let i = 0; i < n; i += 2) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; body += `<path d="M${f(cx)},${f(cy)} L${f(cx + Math.cos(a0) * R)},${f(cy + Math.sin(a0) * R)} L${f(cx + Math.cos(a1) * R)},${f(cy + Math.sin(a1) * R)}Z" fill="${P(p, 2)}" opacity=".55"/>`; }
    return svg(w, h, body + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(Math.min(w, h) * 0.12)}" fill="${P(p, 3)}"/>`);
  } },
  { id: 'steps', label: 'Bậc thang', group: 'bg', w: 600, h: 260, make: (p, s, w, h) => {
    const r = rng(s); let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`;
    for (let i = 0; i < 5; i++) { const y0 = h * (0.3 + i * 0.14); let d = `M0,${h} L0,${f(y0)}`; let x = 0; while (x < w) { const sw = 40 + r() * 90; const yy = y0 + (r() - 0.5) * 40; d += ` L${f(x)},${f(yy)} L${f(Math.min(w, x + sw))},${f(yy)}`; x += sw; } d += ` L${w},${h}Z`; body += `<path d="${d}" fill="${mix(P(p, 1), P(p, 2), i / 4)}"/>`; }
    return svg(w, h, body);
  } },
  { id: 'topo', label: 'Đường đồng mức', group: 'bg', w: 600, h: 320, make: (p, s, w, h) => {
    const r = rng(s); let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`;
    for (let k = 0; k < 2; k++) { const cx = w * (0.2 + r() * 0.6), cy = h * (0.2 + r() * 0.6); const seed = Math.floor(r() * 1e6); for (let i = 1; i <= 9; i++) { const rr = rng(seed); body += `<path d="${blobPath(rr, cx, cy, i * Math.min(w, h) * 0.07, 9, 0.3)}" fill="none" stroke="${P(p, 1 + k)}" stroke-width="1.6" opacity="${f(0.35 + (i / 9) * 0.5)}"/>`; } }
    return svg(w, h, body);
  } },
  { id: 'grain', label: 'Gradient hạt', group: 'bg', w: 600, h: 300, make: (p, s, w, h) => svg(w, h, `<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" filter="url(#n)" opacity=".28"/>`, `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${P(p, 1)}"/><stop offset=".55" stop-color="${P(p, 2)}"/><stop offset="1" stop-color="${P(p, 3)}"/></linearGradient><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${f(0.7 + (s % 5) * 0.1)}" numOctaves="3" seed="${s % 97}"/><feColorMatrix type="saturate" values="0"/></filter>`) },
  // ---------- patterns ----------
  { id: 'dots', label: 'Chấm bi', group: 'pattern', w: 600, h: 240, make: (p, s, w, h) => { const g = 14 + (s % 4) * 6; return svg(w, h, `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/><rect width="${w}" height="${h}" fill="url(#d)"/>`, `<pattern id="d" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><circle cx="${g / 2}" cy="${g / 2}" r="${f(g * 0.16)}" fill="${P(p, 1)}"/></pattern>`); } },
  { id: 'grid', label: 'Lưới kẻ', group: 'pattern', w: 600, h: 240, make: (p, s, w, h) => { const g = 20 + (s % 4) * 8; return svg(w, h, `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/><rect width="${w}" height="${h}" fill="url(#g)"/>`, `<pattern id="g" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M${g} 0 L0 0 0 ${g}" fill="none" stroke="${P(p, 1)}" stroke-width="1" opacity=".5"/></pattern>`); } },
  { id: 'stripes', label: 'Sọc chéo', group: 'pattern', w: 600, h: 240, make: (p, s, w, h) => { const g = 12 + (s % 4) * 8; return svg(w, h, `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/><rect width="${w}" height="${h}" fill="url(#s)"/>`, `<pattern id="s" width="${g}" height="${g}" patternUnits="userSpaceOnUse" patternTransform="rotate(${[45, -45, 30, 60][s % 4]})"><rect width="${g / 2}" height="${g}" fill="${P(p, 1)}"/></pattern>`); } },
  { id: 'checker', label: 'Caro', group: 'pattern', w: 600, h: 240, make: (p, s, w, h) => { const g = 24 + (s % 3) * 12; return svg(w, h, `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/><rect width="${w}" height="${h}" fill="url(#c)"/>`, `<pattern id="c" width="${g * 2}" height="${g * 2}" patternUnits="userSpaceOnUse"><rect width="${g}" height="${g}" fill="${P(p, 1)}"/><rect x="${g}" y="${g}" width="${g}" height="${g}" fill="${P(p, 1)}"/></pattern>`); } },
  { id: 'zigzag', label: 'Zigzag', group: 'pattern', w: 600, h: 240, make: (p, s, w, h) => { const g = 24 + (s % 3) * 8; return svg(w, h, `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/><rect width="${w}" height="${h}" fill="url(#z)"/>`, `<pattern id="z" width="${g}" height="${g / 2}" patternUnits="userSpaceOnUse"><path d="M0 ${g / 2} L${g / 2} 0 L${g} ${g / 2}" fill="none" stroke="${P(p, 1)}" stroke-width="3"/></pattern>`); } },
  { id: 'plus', label: 'Dấu cộng', group: 'pattern', w: 600, h: 240, make: (p, s, w, h) => { const g = 28 + (s % 3) * 8; return svg(w, h, `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/><rect width="${w}" height="${h}" fill="url(#p)"/>`, `<pattern id="p" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M${g / 2} ${g * 0.3} V${g * 0.7} M${g * 0.3} ${g / 2} H${g * 0.7}" stroke="${P(p, 1)}" stroke-width="2.5" stroke-linecap="round"/></pattern>`); } },
  { id: 'rings', label: 'Vòng đồng tâm', group: 'pattern', w: 600, h: 300, make: (p, s, w, h) => { const r = rng(s); const cx = r() < 0.5 ? 0 : w, cy = r() < 0.5 ? 0 : h; let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`; for (let i = 1; i < 18; i++) body += `<circle cx="${cx}" cy="${cy}" r="${i * 34}" fill="none" stroke="${P(p, 1 + (i % 2))}" stroke-width="${i % 3 ? 2 : 6}" opacity=".7"/>`; return svg(w, h, body); } },
  { id: 'halftone', label: 'Halftone', group: 'pattern', w: 600, h: 260, make: (p, s, w, h) => { const g = 14; let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`; const ang = (s % 4) * 0.5; for (let y = 0; y < h + g; y += g) for (let x = 0; x < w + g; x += g) { const t = Math.max(0, Math.min(1, (x * Math.cos(ang) + y * Math.sin(ang)) / (w * Math.cos(ang) + h * Math.sin(ang) || 1))); body += `<circle cx="${x}" cy="${y}" r="${f(0.6 + t * g * 0.45)}" fill="${P(p, 1)}"/>`; } return svg(w, h, body); } },
  { id: 'memphis', label: 'Memphis', group: 'pattern', w: 600, h: 300, make: (p, s, w, h) => {
    const r = rng(s); let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`;
    for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, c = P(p, 1 + (i % 3)), rot = Math.round(r() * 360), k = i % 5;
      body += k === 0 ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(5 + r() * 9)}" fill="${c}"/>` : k === 1 ? `<polygon transform="rotate(${rot} ${f(x)} ${f(y)})" points="${f(x)},${f(y - 12)} ${f(x + 11)},${f(y + 8)} ${f(x - 11)},${f(y + 8)}" fill="none" stroke="${c}" stroke-width="3"/>` : k === 2 ? `<path transform="rotate(${rot} ${f(x)} ${f(y)})" d="M${f(x - 18)},${f(y)} q6,-10 12,0 t12,0 t12,0" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>` : k === 3 ? `<rect transform="rotate(${rot} ${f(x)} ${f(y)})" x="${f(x - 3)}" y="${f(y - 12)}" width="6" height="24" rx="3" fill="${c}"/>` : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(8 + r() * 8)}" fill="none" stroke="${c}" stroke-width="3"/>`; }
    return svg(w, h, body);
  } },
  { id: 'confetti', label: 'Confetti', group: 'pattern', w: 600, h: 260, make: (p, s, w, h) => { const r = rng(s); let body = `<rect width="${w}" height="${h}" fill="${P(p, 0)}"/>`; for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h, c = P(p, 1 + (i % 3)); body += i % 3 === 0 ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(2 + r() * 3)}" fill="${c}"/>` : `<rect transform="rotate(${Math.round(r() * 180)} ${f(x)} ${f(y)})" x="${f(x - 2)}" y="${f(y - 6)}" width="4" height="12" rx="1" fill="${c}"/>`; } return svg(w, h, body); } },
  { id: 'sparkles', label: 'Kim tuyến', group: 'pattern', w: 600, h: 260, make: (p, s, w, h) => { const r = rng(s); let body = `<rect width="${w}" height="${h}" fill="${P(p, 4)}"/>`; for (let i = 0; i < 28; i++) { const x = r() * w, y = r() * h, k = 3 + r() * (i % 6 ? 6 : 16); body += `<path d="M${f(x)},${f(y - k)} C${f(x + k * 0.12)},${f(y - k * 0.12)} ${f(x + k * 0.12)},${f(y - k * 0.12)} ${f(x + k)},${f(y)} C${f(x + k * 0.12)},${f(y + k * 0.12)} ${f(x + k * 0.12)},${f(y + k * 0.12)} ${f(x)},${f(y + k)} C${f(x - k * 0.12)},${f(y + k * 0.12)} ${f(x - k * 0.12)},${f(y + k * 0.12)} ${f(x - k)},${f(y)} C${f(x - k * 0.12)},${f(y - k * 0.12)} ${f(x - k * 0.12)},${f(y - k * 0.12)} ${f(x)},${f(y - k)}Z" fill="${P(p, 1 + (i % 3))}" opacity="${f(0.5 + r() * 0.5)}"/>`; } return svg(w, h, body); } },
  // ---------- glossy 3D shapes ----------
  { id: 'sphere', label: 'Cầu 3D', group: 'shape3d', w: 220, h: 220, make: (p, s, w, h) => { const c = P(p, 1 + (s % 3)); return svg(w, h, `<ellipse cx="${w / 2}" cy="${h * 0.93}" rx="${w * 0.32}" ry="${h * 0.04}" fill="#000" opacity=".18"/><circle cx="${w / 2}" cy="${h * 0.46}" r="${w * 0.42}" fill="url(#s)"/><ellipse cx="${w * 0.38}" cy="${h * 0.28}" rx="${w * 0.13}" ry="${h * 0.08}" fill="#fff" opacity=".55" transform="rotate(-30 ${w * 0.38} ${h * 0.28})"/>`, `<radialGradient id="s" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="${shadeC(c, 0.55)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${shadeC(c, -0.45)}"/></radialGradient>`); } },
  { id: 'capsule', label: 'Viên nhộng 3D', group: 'shape3d', w: 260, h: 140, make: (p, s, w, h) => { const c = P(p, 1 + (s % 3)); return svg(w, h, `<rect x="${w * 0.06}" y="${h * 0.12}" width="${w * 0.88}" height="${h * 0.68}" rx="${h * 0.34}" fill="url(#c)"/><rect x="${w * 0.14}" y="${h * 0.2}" width="${w * 0.6}" height="${h * 0.13}" rx="${h * 0.065}" fill="#fff" opacity=".45"/><ellipse cx="${w / 2}" cy="${h * 0.92}" rx="${w * 0.36}" ry="${h * 0.05}" fill="#000" opacity=".15"/>`, `<linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shadeC(c, 0.45)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${shadeC(c, -0.4)}"/></linearGradient>`); } },
  { id: 'cube', label: 'Khối lập phương', group: 'shape3d', w: 220, h: 240, make: (p, s, w, h) => { const c = P(p, 1 + (s % 3)); const cx = w / 2, t = h * 0.12, m = h * 0.38, b = h * 0.88, l = w * 0.1, r = w * 0.9; return svg(w, h, `<polygon points="${cx},${t} ${r},${f(t + (m - t) / 2 + 6)} ${cx},${m + 12} ${l},${f(t + (m - t) / 2 + 6)}" fill="${shadeC(c, 0.35)}"/><polygon points="${l},${f(t + (m - t) / 2 + 6)} ${cx},${m + 12} ${cx},${b} ${l},${f(b - (m - t) / 2 - 6)}" fill="${c}"/><polygon points="${r},${f(t + (m - t) / 2 + 6)} ${cx},${m + 12} ${cx},${b} ${r},${f(b - (m - t) / 2 - 6)}" fill="${shadeC(c, -0.3)}"/>`); } },
  { id: 'torus', label: 'Vòng xuyến 3D', group: 'shape3d', w: 240, h: 240, make: (p, s, w, h) => { const c = P(p, 1 + (s % 3)); return svg(w, h, `<circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.33}" fill="none" stroke="url(#t)" stroke-width="${w * 0.2}"/><path d="M${w * 0.24},${h * 0.36} A${w * 0.33},${w * 0.33} 0 0 1 ${w * 0.5},${h * 0.17}" fill="none" stroke="#fff" stroke-width="${w * 0.035}" stroke-linecap="round" opacity=".5"/>`, `<linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shadeC(c, 0.45)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${shadeC(c, -0.45)}"/></linearGradient>`); } },
  { id: 'cylinder', label: 'Trụ 3D', group: 'shape3d', w: 200, h: 260, make: (p, s, w, h) => { const c = P(p, 1 + (s % 3)); const rx = w * 0.4, ry = h * 0.08; return svg(w, h, `<path d="M${w / 2 - rx},${h * 0.18} V${h * 0.82} A${rx},${ry} 0 0 0 ${w / 2 + rx},${h * 0.82} V${h * 0.18}Z" fill="url(#y)"/><ellipse cx="${w / 2}" cy="${h * 0.18}" rx="${rx}" ry="${ry}" fill="${shadeC(c, 0.4)}"/>`, `<linearGradient id="y" x1="0" x2="1"><stop offset="0" stop-color="${shadeC(c, -0.3)}"/><stop offset=".35" stop-color="${shadeC(c, 0.25)}"/><stop offset="1" stop-color="${shadeC(c, -0.45)}"/></linearGradient>`); } },
  { id: 'pyramid', label: 'Kim tự tháp', group: 'shape3d', w: 240, h: 220, make: (p, s, w, h) => { const c = P(p, 1 + (s % 3)); return svg(w, h, `<polygon points="${w * 0.48},${h * 0.08} ${w * 0.08},${h * 0.86} ${w * 0.58},${h * 0.94}" fill="${shadeC(c, 0.25)}"/><polygon points="${w * 0.48},${h * 0.08} ${w * 0.58},${h * 0.94} ${w * 0.94},${h * 0.76}" fill="${shadeC(c, -0.35)}"/>`); } },
  // ---------- decorative ----------
  { id: 'frame-scallop', label: 'Khung răng cưa', group: 'deco', w: 300, h: 300, make: (p, s, w, h) => { const n = 22 + (s % 4) * 4; let d = ''; const cx = w / 2, cy = h / 2, R = w * 0.44, b = w * 0.04; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a); if (!i) d += `M${f(x)},${f(y)}`; else { const am = ((i - 0.5) / n) * Math.PI * 2; d += ` Q${f(cx + (R + b * 2) * Math.cos(am))},${f(cy + (R + b * 2) * Math.sin(am))} ${f(x)},${f(y)}`; } } return svg(w, h, `<path d="${d}Z" fill="${P(p, 1)}"/><circle cx="${cx}" cy="${cy}" r="${R * 0.86}" fill="none" stroke="${P(p, 0)}" stroke-width="2" stroke-dasharray="4 6"/>`); } },
  { id: 'arch-frame', label: 'Khung vòm', group: 'deco', w: 240, h: 320, make: (p, s, w, h) => svg(w, h, `<path d="M${w * 0.06},${h * 0.98} V${w * 0.5} A${w * 0.44},${w * 0.44} 0 0 1 ${w * 0.94},${w * 0.5} V${h * 0.98}Z" fill="none" stroke="${P(p, 1)}" stroke-width="5"/><path d="M${w * 0.13},${h * 0.98} V${w * 0.5} A${w * 0.37},${w * 0.37} 0 0 1 ${w * 0.87},${w * 0.5} V${h * 0.98}" fill="none" stroke="${P(p, 2)}" stroke-width="2"/>`) },
  { id: 'wavy-frame', label: 'Khung lượn sóng', group: 'deco', w: 400, h: 260, make: (p, s, w, h) => { const k = 10 + (s % 3) * 2; let d = `M10,10`; for (let i = 0; i < k; i++) d += ` q${f((w - 20) / k / 2)},${i % 2 ? 8 : -8} ${f((w - 20) / k)},0`; const kk = Math.round(k * (h / w)); for (let i = 0; i < kk; i++) d += ` q${i % 2 ? 8 : -8},${f((h - 20) / kk / 2)} 0,${f((h - 20) / kk)}`; for (let i = 0; i < k; i++) d += ` q${f(-(w - 20) / k / 2)},${i % 2 ? -8 : 8} ${f(-(w - 20) / k)},0`; for (let i = 0; i < kk; i++) d += ` q${i % 2 ? -8 : 8},${f(-(h - 20) / kk / 2)} 0,${f(-(h - 20) / kk)}`; return svg(w, h, `<path d="${d}Z" fill="none" stroke="${P(p, 1)}" stroke-width="4" stroke-linejoin="round"/>`); } },
  { id: 'corners', label: 'Góc hoa văn', group: 'deco', w: 400, h: 260, make: (p, s, w, h) => { const c = P(p, 1); const k = 46; const corner = (x: number, y: number, sx: number, sy: number) => `<path transform="translate(${x} ${y}) scale(${sx} ${sy})" d="M0,${k} V8 Q0,0 8,0 H${k} M10,${k * 0.7} V18 Q10,10 18,10 H${k * 0.7} M22,22 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`; return svg(w, h, corner(6, 6, 1, 1) + corner(w - 6, 6, -1, 1) + corner(6, h - 6, 1, -1) + corner(w - 6, h - 6, -1, -1)); } },
  { id: 'scribble-circle', label: 'Khoanh tròn vẽ tay', group: 'deco', w: 300, h: 160, make: (p, s, w, h) => { const r = rng(s); let d = ''; for (let i = 0; i < 2; i++) { const rx = w * (0.44 + r() * 0.04), ry = h * (0.4 + r() * 0.05); d += `<ellipse cx="${f(w / 2 + (r() - 0.5) * 8)}" cy="${f(h / 2 + (r() - 0.5) * 6)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f((r() - 0.5) * 8)} ${w / 2} ${h / 2})" fill="none" stroke="${P(p, 1)}" stroke-width="${f(3 + r() * 2)}" stroke-linecap="round"/>`; } return svg(w, h, d); } },
  { id: 'brush', label: 'Vệt cọ', group: 'deco', w: 400, h: 90, make: (p, s, w, h) => { const r = rng(s); let d = `M${f(8)},${f(h * 0.55)}`; const k = 6; for (let i = 1; i <= k; i++) d += ` Q${f((w / k) * (i - 0.5))},${f(h * (0.25 + r() * 0.2))} ${f((w / k) * i - (i === k ? 8 : 0))},${f(h * (0.4 + r() * 0.2))}`; for (let i = k; i >= 1; i--) d += ` Q${f((w / k) * (i - 0.5))},${f(h * (0.75 + r() * 0.15))} ${f((w / k) * (i - 1) + (i === 1 ? 8 : 0))},${f(h * (0.6 + r() * 0.15))}`; return svg(w, h, `<path d="${d}Z" fill="${P(p, 1)}" opacity=".9"/>`); } },
  { id: 'ticket', label: 'Vé / coupon', group: 'deco', w: 420, h: 160, make: (p, s, w, h) => svg(w, h, `<path d="M16,0 H${w - 16} A16,16 0 0 0 ${w},16 V${h / 2 - 16} A16,16 0 0 0 ${w},${h / 2 + 16} V${h - 16} A16,16 0 0 0 ${w - 16},${h} H16 A16,16 0 0 0 0,${h - 16} V${h / 2 + 16} A16,16 0 0 0 0,${h / 2 - 16} V16 A16,16 0 0 0 16,0Z" fill="${P(p, 1)}"/><path d="M${w * 0.68},14 V${h - 14}" stroke="${P(p, 0)}" stroke-width="3" stroke-dasharray="6 7"/>`) },
];

export const GEN_GROUPS: { v: GenGroup; label: string }[] = [{ v: 'bg', label: 'Nền' }, { v: 'pattern', label: 'Hoạ tiết' }, { v: 'shape3d', label: 'Khối 3D' }, { v: 'deco', label: 'Trang trí' }];

/** SVG of one generated piece at a size (patterns stay crisp because they are drawn at the real size). */
export function genSvg(id: string, palette: string[], seed: number, w?: number, h?: number): string | null {
  const g = GENERATORS.find((x) => x.id === id); if (!g) return null;
  const W = Math.max(8, Math.round(w || g.w)), H = Math.max(8, Math.round(h || g.h));
  return g.make(palette.length >= 2 ? palette : ['#FFFFFF', '#111111', '#777777', '#BBBBBB', '#000000'], seed, W, H);
}
export const svgDataUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

/** Harmonious palettes (bg, c1, c2, c3, ink) besides the brand's own. */
export const GEN_PALETTES: { name: string; p: string[] }[] = [
  { name: 'Hoàng hôn', p: ['#FFF4E8', '#FF6B4A', '#FFB547', '#7A3EF0', '#1D1238'] },
  { name: 'Đại dương', p: ['#EAF6FF', '#2F7CF6', '#25C9E8', '#0B3C8C', '#061A33'] },
  { name: 'Kẹo ngọt', p: ['#FFF0F7', '#FF5FA2', '#B57BFF', '#4DD2FF', '#2A1B3D'] },
  { name: 'Rừng', p: ['#EEF5EC', '#2E7D4F', '#9BCB63', '#F2C14E', '#10261A'] },
  { name: 'Đất nung', p: ['#FBF1E7', '#C4532B', '#E9A24B', '#5C3A2E', '#24130C'] },
  { name: 'Neon đêm', p: ['#0B0B16', '#39FF14', '#00E5FF', '#FF2E88', '#06060C'] },
  { name: 'Pastel', p: ['#FFF8F1', '#FFB4A2', '#B5E3D8', '#CDB4DB', '#3D3A4B'] },
  { name: 'Đơn sắc', p: ['#F4F4F2', '#111111', '#7A7A7A', '#C9C9C9', '#000000'] },
  { name: 'Vàng đen', p: ['#111111', '#FFC53D', '#FF8A00', '#FFFFFF', '#000000'] },
  { name: 'Xuân Tết', p: ['#FFF3E6', '#D7261E', '#F7B32B', '#2F6B3A', '#3A0D0B'] },
];
