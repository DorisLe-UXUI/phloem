// Colours of a brand book page, derived from the brand's own palette so every book looks like that brand:
// primary / accent / ink (darkest neutral) / paper (lightest neutral), readable text on each, soft tints, contrast grades.
import type { BrandBook } from './types';

const HEX = /^#?([0-9a-f]{6})$/i;
export function rgb(hex: string): [number, number, number] { const m = HEX.exec(hex.trim()); const v = m ? m[1] : '888888'; return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; }
const toHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export function lum(hex: string): number { const [r, g, b] = rgb(hex).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrast(a: string, b: string): number { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
export function mix(a: string, b: string, t: number): string { const A = rgb(a), B = rgb(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); }
export function grade(ratio: number): 'AAA' | 'AA' | 'AA lớn' | '–' { return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA lớn' : '–'; }
const sat = (hex: string) => { const [r, g, b] = rgb(hex).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

export interface BookTheme { primary: string; accent: string; ink: string; paper: string; onPrimary: string; onAccent: string; tint: string; tintAccent: string; muted: string; line: string; dark: boolean }

export function bookTheme(book: BrandBook): BookTheme {
  const cols = book.palette.map((c) => ({ ...c, hex: c.hex.toUpperCase() }));
  const byRole = (r: string) => cols.find((c) => c.role === r)?.hex;
  const eb = (book.emailBrand || {}) as Record<string, string>;
  // the primary must carry colour: a near-white or near-black "primary" falls back to the most saturated colour
  let primary = byRole('primary') || eb.primary || '';
  if (!primary || sat(primary) < 0.15 || lum(primary) > 0.9) primary = [...cols].sort((a, b) => sat(b.hex) - sat(a.hex))[0]?.hex || primary || '#1F6FEB';
  let accent = cols.find((c) => c.role === 'accent' && c.hex !== primary && sat(c.hex) > 0.2)?.hex || cols.filter((c) => c.hex !== primary && sat(c.hex) > 0.25).sort((a, b) => b.ratio - a.ratio)[0]?.hex || eb.accent || mix(primary, '#FFFFFF', 0.35);
  if (accent === primary) accent = mix(primary, '#FFFFFF', 0.35);
  const byLum = [...cols].sort((a, b) => lum(a.hex) - lum(b.hex));
  const ink = byLum[0] && lum(byLum[0].hex) < 0.06 ? byLum[0].hex : '#16181B';
  const light = byLum[byLum.length - 1];
  const paper = light && lum(light.hex) > 0.86 && light.hex !== '#FFFFFF' ? light.hex : '#FBFAF7';
  const on = (bg: string) => (contrast('#FFFFFF', bg) >= Math.max(3, contrast(ink, bg)) ? '#FFFFFF' : ink);
  return {
    primary, accent, ink, paper, onPrimary: on(primary), onAccent: on(accent),
    tint: mix(primary, paper, 0.9), tintAccent: mix(accent, paper, 0.86), muted: mix(ink, paper, 0.42), line: mix(ink, paper, 0.86), dark: lum(primary) < 0.2,
  };
}

export const rgbText = (hex: string) => rgb(hex).join(', ');
