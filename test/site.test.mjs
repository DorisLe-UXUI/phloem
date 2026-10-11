import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, extractStyle, isPublicHost } from '../server/src/site.mjs';

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
  assert.deepEqual(a.images.map((i) => i.url), ['https://terra.example/img/hero.jpg', 'https://terra.example/img/cup.jpg'], 'tiny icons skipped, data-src honoured');
  assert.deepEqual(a.headings, ['Gốm bền ngoài, đẹp bên trong', 'Bộ sưu tập Thu 2026']);
  assert.deepEqual(a.nav, ['Trang chủ', 'Cửa hàng', 'Về Terra']);
  assert.deepEqual(a.buttons, ['Mua ngay']);
  assert.match(a.text, /Bát Tràng/);
  assert.deepEqual(a._styles, ['https://terra.example/css/main.css', 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Inter:wght@400;700&display=swap'], 'Google Fonts CSS counts as a stylesheet too');
  assert.deepEqual(a._googleFamilies, ['Playfair Display', 'Inter']);
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
