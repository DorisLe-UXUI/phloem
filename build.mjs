// Build: dist/code.js (sandbox), dist/ui.html (UI with inlined CSS/JS), dist/shared.mjs (for tests).
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const studioOnly = args.has('--studio');
const watch = args.has('--watch');
const sharedOnly = args.has('--shared');
mkdirSync('dist', { recursive: true });

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const define = { __PHLOEM_VERSION__: JSON.stringify(pkg.version) };

const sharedCfg = {
  entryPoints: ['src/shared/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/shared.mjs',
  define,
};

const pluginCfg = {
  entryPoints: ['src/plugin/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2019',
  outfile: 'dist/code.js',
  define,
  logLevel: 'info',
};

const uiCfg = {
  entryPoints: ['src/ui/ui.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  minify: false,
  define,
  logLevel: 'info',
};

function writeUiHtml(js) {
  const css = readFileSync('src/ui/styles.css', 'utf8');
  const html = readFileSync('src/ui/index.html', 'utf8');
  const out = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
  writeFileSync('dist/ui.html', out);
  console.log(`ui.html ${(out.length / 1024).toFixed(1)} KB`);
}

async function buildUiOnce() {
  const r = await esbuild.build(uiCfg);
  writeUiHtml(r.outputFiles[0].text);
}

const studioCfg = {
  entryPoints: ['studio/src/main.tsx'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'studio/dist/studio.js',
  minify: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define,
  logLevel: 'info',
  loader: { '.css': 'css' },
};

const authCfg = { entryPoints: ['studio/src/auth/standalone.ts'], bundle: true, format: 'iife', target: 'es2020', outfile: 'studio/dist/auth.js', minify: true, logLevel: 'info' };

async function buildStudio() {
  mkdirSync('studio/dist', { recursive: true });
  await esbuild.build(studioCfg);
  await esbuild.build(authCfg);
  await esbuild.build({ entryPoints: ['studio/styles.css'], bundle: true, outfile: 'studio/dist/studio.css', logLevel: 'info' });
  await import('./studio/make-artifact.mjs');
}

if (studioOnly) {
  if (watch) {
    const c1 = await esbuild.context(studioCfg); await c1.watch();
    const c3 = await esbuild.context(authCfg); await c3.watch();
    const c2 = await esbuild.context({ entryPoints: ['studio/styles.css'], bundle: true, outfile: 'studio/dist/studio.css' }); await c2.watch();
    console.log('watching studio…');
  } else await buildStudio();
} else if (sharedOnly) {
  await esbuild.build(sharedCfg);
  console.log('dist/shared.mjs');
} else if (watch) {
  const ctx = await esbuild.context(pluginCfg);
  await ctx.watch();
  const uiCtx = await esbuild.context({
    ...uiCfg,
    plugins: [{ name: 'ui-html', setup(b) { b.onEnd((r) => { if (r.outputFiles?.[0]) writeUiHtml(r.outputFiles[0].text); }); } }],
  });
  await uiCtx.watch();
  console.log('watching…');
} else {
  await esbuild.build(pluginCfg);
  await buildUiOnce();
  await esbuild.build(sharedCfg);
  await buildStudio();
}
