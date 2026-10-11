import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, extractStyle, isPublicHost, safeGet } from '../server/src/site.mjs';
import { createServer } from 'node:http';

const HTML = `<!doctype html><html lang="vi"><head><title>Terra Gốm · Gốm thủ công</title>
<meta name="description" content="Gốm thủ công từ Bát Tràng." /><meta property="og:site_name" content="Terra" /><meta property="og:image" content="/img/og.jpg" />
<meta name="theme-color" content="#E8553D" />
<link rel="stylesheet" href="/css/main.css" /><link rel="icon" sizes="32x32" href="/favicon.png" /><link rel="apple-touch-icon" sizes="180x180" href="/apple.png" />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Inter:wght@400;700&display=swap" rel="stylesheet" />
<style>.btn{background:#E8553D;color:#fff;font-family:"Inter",sans-serif}h1{font-family:'Playfair Display',serif;color:#1C1917}.hero{background:rgb(246,162,75)}.x{color:#E8553D}.y{color:#e8553d}</style></head>
<body><header><nav><a href="/">Trang chủ</a><a href="/shop">Cửa hàng</a><a href="/about">Về Terra</a><a class="logo" href="/"><img src="/logo.svg" alt="Terra logo" /></a></nav></header>
<h1>Gốm bền ngoài, đẹp bên trong</h1><h2>Bộ sưu tập Thu 2026</h2>
<img src="/img/hero.jpg" alt="Bình gốm" width="1200" height="800" /><img src="/img/icon-16.png" width="16" height="16" /><img data-src="/img/cup.jpg" alt="Cốc men tro" />
<p>Chúng tôi làm gốm thủ công tại Bát Tràng, mỗi chiếc nung ở 1.250°C và kiểm tra tay trước khi gửi đi khắp nơi.</p>
<a class="btn primary" href="/shop">Mua ngay</a></body></html>`;

test('analyzeHtml pulls title, lang, meta, logo, icons, images, headings, nav, buttons', () => {
  const a = analyzeHtml(HTML, 'https://terra.example/');
  assert.equal(a.title, 'Terra Gốm · Gốm thủ công');
  assert.equal(a.lang, 'vi');
  assert.equal(a.siteName, 'Terra');
  assert.equal(a.themeColor, '#e8553d');
  assert.equal(a.logo, 'https://terra.example/logo.svg');
  assert.equal(a.icon, 'https://terra.example/apple.png', 'largest icon first');
  assert.equal(a.ogImage, 'https://terra.example/img/og.jpg');
  assert.equal(analyzeHtml('<html><head><title>x</title></head><body></body></html>', 'https://x.example/').ogImage, '', 'no og:image → empty, not the page URL');
  assert.equal(analyzeHtml('<img srcset="/a.jpg?width=44 44w, /a.jpg?width=600 600w" alt=""/>', 'https://x.example/').images[0].url, 'https://x.example/a.jpg?width=1400', 'largest srcset candidate, Shopify width bumped');
  assert.deepEqual(a.images.map((i) => i.url), ['https://terra.example/img/hero.jpg', 'https://terra.example/img/cup.jpg'], 'tiny icons skipped, data-src honoured');
  assert.deepEqual(a.headings, ['Gốm bền ngoài, đẹp bên trong', 'Bộ sưu tập Thu 2026']);
  assert.deepEqual(a.nav, ['Trang chủ', 'Cửa hàng', 'Về Terra']);
  assert.deepEqual(a.buttons, ['Mua ngay']);
  assert.match(a.text, /Bát Tràng/);
  assert.deepEqual(a._styles, ['https://terra.example/css/main.css', 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Inter:wght@400;700&display=swap'], 'Google Fonts CSS counts as a stylesheet too');
  assert.deepEqual(a._googleFamilies, ['Playfair Display', 'Inter']);
});

test('logo: header/home-link mark wins, client logo walls and other brands are ignored, inline header SVG is captured', () => {
  const wall = `<html><head><title>SentryX — Growth operators</title><meta property="og:site_name" content="SentryX" /></head><body>
<header><a class="brand" href="/" aria-label="SentryX home"><svg viewBox="0 0 169 32" fill="none"><path d="M1 1h10" fill="currentColor"/></svg></a><nav><a href="/work">Work</a></nav></header>
<div class="trust"><p>Operators behind</p><ul><li><img src="/img/lucys-logo.webp" alt="Lucy's" width="130" height="44" class="trust-logo lucys"></li><li><img src="/img/trust-toolmart.webp" alt="Tool Mart" width="138" height="108" class="trust-logo"></li></ul></div>
<img class="chart3d-logo" src="/img/lucys-logo.webp" alt="Lucy's logo" width="260" height="88">
<img src="/img/case.jpg" alt="Tool Mart — storefront" width="1200" height="800">
<a class="btn" href="/cdn-cgi/l/email-protection">[email&#160;protected]</a><a class="btn" href="/contact">Talk to us</a></body></html>`;
  const a = analyzeHtml(wall, 'https://www.sentryxp.com/');
  assert.equal(a.logo, '', 'client logos are not the brand logo');
  assert.match(a.logoSvg, /^<svg[^>]*xmlns=/, 'inline header SVG becomes the logo');
  assert.match(a.logoSvg, /width="169" height="32"/, 'size injected from viewBox');
  assert.doesNotMatch(a.logoSvg, /currentColor/);
  assert.deepEqual(a.images.map((i) => i.url), ['https://www.sentryxp.com/img/case.jpg'], 'logo-wall images never become content images');
  assert.deepEqual(a.buttons, ['Talk to us'], 'obfuscated e-mail buttons dropped');
  const own = analyzeHtml('<html><head><title>Acme</title></head><body><section class="partners"><img src="/p/other-logo.png" alt="Other Co" class="logo"></section><footer><img src="/acme-logo.png" alt="Acme logo"></footer></body></html>', 'https://acme.example/');
  assert.equal(own.logo, 'https://acme.example/acme-logo.png', 'a logo naming the site beats a partner logo even outside the header');
});

test('extractStyle ranks brand colours (no greys), merges case, finds fonts', () => {
  const a = analyzeHtml(HTML, 'https://terra.example/');
  const st = extractStyle(a._inlineCss + '\n.grey{color:#888}.white{background:#ffffff}.ink{color:#111}', a._googleFamilies);
  assert.equal(st.colors[0].hex, '#e8553d', 'most used saturated colour first');
  assert.ok(st.colors.some((c) => c.hex === '#f6a24b'), 'rgb() converted');
  assert.ok(!st.colors.some((c) => c.hex === '#888888' || c.hex === '#ffffff'), 'greys and white are not brand colours');
  assert.ok(st.darks.includes('#111111'));
  assert.deepEqual(st.fonts.map((f) => f.name).slice(0, 2).sort(), ['Inter', 'Playfair Display']);
});

test('isPublicHost refuses loopback, private ranges and local names', async () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'printer.local', '0.0.0.0']) assert.equal(await isPublicHost(h), false, h);
  assert.equal(await isPublicHost('8.8.8.8'), true);
});

test('safeGet refuses a redirect into a private host and caps the body', async () => {
  // a loopback server standing in for "internal"; safeGet must refuse it both directly and via redirect
  const srv = createServer((req, res) => { res.end('SECRET'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await assert.rejects(safeGet(`http://127.0.0.1:${port}/`), (e) => e.status === 403);
  await assert.rejects(safeGet(`http://localhost:${port}/`), (e) => e.status === 403);
  srv.close();
});
