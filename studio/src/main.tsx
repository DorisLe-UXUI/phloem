import { render } from 'preact';
import { App } from './ui/App';
import { ensureFonts } from './render/fonts';
import { assets } from './storage/assets';
import { refreshProjects, restoreSession } from './pipeline/actions';
import { set } from './store';

ensureFonts(['Inter']);
void assets.ready.then(async () => {
  await restoreSession();
  await refreshProjects();
  const params = new URLSearchParams(location.search);
  const authParam = params.get('auth');
  if (authParam === 'login' || authParam === 'register') { history.replaceState(null, '', location.pathname); set({ modal: 'auth', authTab: authParam }); }
  const t = params.get('t');
  if (t) {
    const { TEMPLATES: T, templateBrand } = await import('./model/templates');
    const { BRAND_PRESETS, DEFAULT_BRAND } = await import('./model/types');
    const { newProject } = await import('./pipeline/actions');
    const def = T.find((x) => x.kind === t);
    if (def) { history.replaceState(null, '', location.pathname); await newProject(def.kind, templateBrand(def, DEFAULT_BRAND, BRAND_PRESETS)); }
  }
});
render(<App />, document.getElementById('root')!);

// Dev hook: window.__phloemExportThumbs() renders every template (desktop + mobile crop) and posts JPGs to the
// preview server, which saves them under landing/thumbs/ for the marketing page. Not used by the app itself.
import { TEMPLATES, makeTemplate } from './model/templates';
import { BRAND_PRESETS, DEFAULT_BRAND } from './model/types';
import { renderToCanvas } from './render/renderer';
import { makeMobile } from './model/ops';
(window as unknown as { __phloemExportThumbs?: (base?: string) => Promise<string[]> }).__phloemExportThumbs = async (base = '') => {
  const out: string[] = [];
  for (const t of TEMPLATES) {
    if (!t.blocks.length) continue;
    const brand = { ...DEFAULT_BRAND, ...(BRAND_PRESETS.find((p) => p.name === t.preset)?.brand || {}), ...(t.brand || {}) };
    ensureFonts([brand.fontFamily, brand.headingFamily]);
    await document.fonts.ready;
    const { doc } = makeTemplate(t.kind, brand);
    const desk = renderToCanvas({ ...doc, height: Math.min(doc.height, 1100) }, brand, assets, 0.8);
    const m = makeMobile(doc);
    const mob = renderToCanvas({ ...m, height: Math.min(m.height, 760) }, brand, assets, 1);
    for (const [name, canvas] of [[t.kind, desk], [`${t.kind}-m`, mob]] as const) {
      await fetch(`${base}/save-thumb`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, dataUrl: canvas.toDataURL('image/jpeg', 0.86) }) });
      out.push(name);
    }
  }
  return out;
};
