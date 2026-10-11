// Loads Google Fonts on demand and bumps a store counter when they arrive (so text re-measures and the board redraws).
import { FONTS } from '../model/types';
import { set } from '../store';

const loaded = new Set<string>();

export function ensureFont(family: string) {
  const def = FONTS.find((f) => f.family === family);
  if (!def || !def.google || loaded.has(family)) return;
  loaded.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${def.google}&display=swap`;
  document.head.appendChild(link);
  const weights = (def.google.match(/wght@([\d;]+)/)?.[1] || '400').split(';');
  Promise.all(weights.map((w) => document.fonts.load(`${w} 16px "${family}"`).catch(() => []))).then(() => set((s) => ({ fontsLoaded: s.fontsLoaded + 1 })));
}

export function ensureFonts(families: string[]) { for (const f of new Set(families)) ensureFont(f); }
