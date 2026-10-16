// Loads Google Fonts on demand and bumps a store counter when they arrive (so text re-measures and the board redraws).
import { FONTS } from '../model/types';
import { set } from '../store';

const loaded = new Set<string>();

/** The full catalog of Google Fonts that draw Vietnamese (studio/data/gfonts.json, built by dev/gfonts-index.mjs). */
export interface GFont { f: string; c: 'sans' | 'serif' | 'display' | 'script' | 'mono'; w: number[] }
let catalog: GFont[] | null = null;
let catalogLoading: Promise<GFont[]> | null = null;
export function loadFontCatalog(): Promise<GFont[]> {
  if (catalog) return Promise.resolve(catalog);
  if (!catalogLoading) {
    catalogLoading = (async () => {
      for (const u of ['data/gfonts.json', '../studio/data/gfonts.json', 'https://dorisle-uxui.github.io/phloem/studio/data/gfonts.json']) {
        try { const r = await fetch(u); if (r.ok) { catalog = ((await r.json()) as { fonts: GFont[] }).fonts; return catalog; } } catch { /* next */ }
      }
      return (catalog = []);
    })();
  }
  return catalogLoading;
}
export const fontCatalogSync = () => catalog;

/** Google css2 family spec for a font: Phloem's curated list first, then the catalog's real weights (a weight the font
 *  lacks makes Google refuse the whole request). */
export function googleSpec(family: string): string | null {
  const def = FONTS.find((f) => f.family === family);
  if (def) return def.google || null;
  const g = catalog?.find((x) => x.f === family);
  const ws = g ? g.w.filter((w) => w >= 300 && w <= 900) : [];
  return `${family.replace(/ /g, '+')}${ws.length > 1 ? `:wght@${ws.join(';')}` : ''}`;
}

export function ensureFont(family: string) {
  if (!family || loaded.has(family) || /^(brand|heading|Helvetica|Georgia|Courier New|Arial|system-ui)$/i.test(family)) return;
  if (!FONTS.some((f) => f.family === family) && !catalog) { void loadFontCatalog().then(() => ensureFont(family)); return; }
  const spec = googleSpec(family); if (!spec) return;
  loaded.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
  const weights = (spec.match(/wght@([\d;]+)/)?.[1] || '400').split(';');
  Promise.all(weights.map((w) => document.fonts.load(`${w} 16px "${family}"`).catch(() => []))).then(() => set((s) => ({ fontsLoaded: s.fontsLoaded + 1 })));
}

/** Just enough of a font to draw its own name in a picker (Google's text= subset: a few hundred bytes). */
const previewed = new Set<string>();
export function previewFont(family: string) {
  if (previewed.has(family) || loaded.has(family) || FONTS.some((f) => f.family === family && !f.google)) return;
  previewed.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}&text=${encodeURIComponent(family + ' Aa Ạ')}&display=swap`;
  document.head.appendChild(link);
}

/** The exact family name when Phloem can load it (curated list or the Google catalog), else null. */
export function knownFont(name: string): string | null {
  const low = name.trim().toLowerCase();
  return FONTS.find((f) => f.family.toLowerCase() === low)?.family || catalog?.find((f) => f.f.toLowerCase() === low)?.f || null;
}

export function ensureFonts(families: string[]) { for (const f of new Set(families)) ensureFont(f); }
