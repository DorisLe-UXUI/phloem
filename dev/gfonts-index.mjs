// Builds studio/data/gfonts.json: every Google Font that draws Vietnamese, most popular first, with its upright weights.
// Run: node dev/gfonts-index.mjs   (re-run now and then to pick up new fonts)
import { writeFile } from 'node:fs/promises';

const r = await fetch('https://fonts.google.com/metadata/fonts');
const meta = JSON.parse((await r.text()).replace(/^\)\]\}'\n?/, ''));
const CAT = { 'Sans Serif': 'sans', Serif: 'serif', Display: 'display', Handwriting: 'script', Monospace: 'mono' };
const fonts = meta.familyMetadataList
  .filter((f) => f.subsets.includes('vietnamese') && !f.isBrandFont)
  .sort((a, b) => a.popularity - b.popularity)
  .map((f) => ({ f: f.family, c: CAT[f.category] || 'sans', w: Object.keys(f.fonts).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b) }));
await writeFile(new URL('../studio/data/gfonts.json', import.meta.url), JSON.stringify({ source: 'Google Fonts (SIL Open Font License / Apache 2.0)', count: fonts.length, fonts }));
console.log(`${fonts.length} Vietnamese Google Fonts → studio/data/gfonts.json`);
