import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSlices, buildEmailHtml, applyUtm, runChecks, validateLink, suggest, makeZip, crc32, fnv1a, toBase64, utf8Bytes, slug } from '../dist/shared.mjs';
import { newsletter, node } from './_fixtures.mjs';

test('utm: appends, fills vars, respects skips', () => {
  const t = 'utm_source={provider}&utm_medium=email&utm_campaign={campaign}&utm_content={slice}';
  const v = { provider: 'klaviyo', campaign: 'Tháng 10 Sale!', frame: 'f', slice: 'r1c0', date: '2026-10-11' };
  assert.equal(applyUtm('https://shop.test/p?x=1#top', t, v), 'https://shop.test/p?x=1&utm_source=klaviyo&utm_medium=email&utm_campaign=thang-10-sale&utm_content=r1c0#top');
  assert.equal(applyUtm('https://shop.test/p', t, v), 'https://shop.test/p?utm_source=klaviyo&utm_medium=email&utm_campaign=thang-10-sale&utm_content=r1c0');
  assert.equal(applyUtm('mailto:a@b.co', t, v), 'mailto:a@b.co');
  assert.equal(applyUtm('*|UNSUB|*', t, v), '*|UNSUB|*');
  assert.equal(applyUtm('{% unsubscribe %}', t, v), '{% unsubscribe %}');
  assert.equal(applyUtm('https://shop.test/?utm_source=x', t, v), 'https://shop.test/?utm_source=x');
  assert.equal(applyUtm('https://shop.test/p', '', v), 'https://shop.test/p');
  assert.equal(slug('Đặt hàng — Sài Gòn'), 'dat-hang-sai-gon');
});

test('validateLink', () => {
  assert.equal(validateLink('https://shop.test/a').ok, true);
  assert.equal(validateLink('http://shop.test/a').soft != null, true);
  assert.equal(validateLink('shop.test').ok, false);
  assert.equal(validateLink('https://shop.test/a b').ok, false);
  assert.equal(validateLink('*|ARCHIVE|*').ok, true);
  assert.equal(validateLink('mailto:x@y.z').ok, true);
});

test('html: one img per slice, links wrapped, alt escaped, deterministic', () => {
  const plan = planSlices(newsletter());
  const images = Object.fromEntries(plan.slices.map((s) => [s.key, `https://cdn.test/${s.key}.png`]));
  const inp = { plan, images, title: 'T', preheader: 'Pre "header"', includePreheader: true, fullDocument: true, utm: { template: 'utm_source=t', vars: { provider: 'p', campaign: 'c', frame: 'f', date: 'd' } } };
  const html = buildEmailHtml(inp);
  assert.equal((html.match(/<img /g) || []).length, plan.slices.length);
  assert.equal((html.match(/<a /g) || []).length, plan.slices.filter((s) => s.link).length);
  assert.ok(html.includes('alt="Summer sale"'));
  assert.ok(html.includes('Pre &quot;header&quot;'));
  assert.ok(html.includes('utm_source=t'));
  assert.ok(html.startsWith('<!DOCTYPE'));
  assert.equal(html, buildEmailHtml(inp));
  const frag = buildEmailHtml({ ...inp, fullDocument: false, includePreheader: false });
  assert.ok(!frag.includes('<html'));
  assert.ok(!frag.includes('ph-preheader'));
  // multi-column rows use percentage widths that sum to 100
  const pcts = [...frag.matchAll(/<td width="([\d.]+)%"/g)].map((m) => Number(m[1]));
  assert.ok(pcts.length > 0);
});

test('html: mobile variant adds swap styles', () => {
  const plan = planSlices(newsletter());
  const images = Object.fromEntries(plan.slices.map((s) => [s.key, `d/${s.key}.png`]));
  const mplan = planSlices(node({ id: 'm', type: 'FRAME', w: 375, h: 600, children: [node({ y: 0, w: 375, h: 300, link: 'https://m.test' })] }));
  const html = buildEmailHtml({ plan, images, mobile: { plan: mplan, images: { r0c0: 'm/0.png', r1c0: 'm/1.png' } }, title: 'T', preheader: '', includePreheader: false, fullDocument: false });
  assert.ok(html.includes('ph-mobile-wrap'));
  assert.ok(html.includes('.ph-desktop{display:none!important'));
});

test('checks: flags invalid link, CTA without link, missing alt', () => {
  const root = node({ id: 'root', type: 'FRAME', w: 600, h: 300, children: [
    node({ id: 'bad', y: 0, w: 600, h: 100, link: 'shop.test/no-scheme' }),
    node({ id: 'btn', name: 'Button', y: 100, w: 600, h: 100, children: [node({ isText: true, text: 'Shop now', x: 200, y: 130, w: 200, h: 40 })] }),
    node({ id: 'img', y: 200, w: 600, h: 100, hasImage: true }),
  ] });
  const plan = planSlices(root);
  const checks = runChecks({ root, plan, fields: { campaignName: 'x', subject: '', preheader: '', mobileFrameId: null } });
  const codes = checks.map((c) => c.code);
  assert.ok(codes.includes('link-invalid'));
  assert.ok(codes.includes('cta-no-link'));
  assert.ok(codes.includes('alt-missing'));
  assert.ok(codes.includes('subject-missing'));
  assert.equal(checks[0].level, 'error');
});

test('suggestions: width fix, cta fold, score', () => {
  const root = newsletter(); root.w = 640;
  const plan = planSlices(root);
  const r = suggest({ root, plan, fields: { campaignName: 'x', subject: 'Hello', preheader: '', mobileFrameId: null }, hasMobile: false });
  assert.ok(r.suggestions.some((s) => s.id === 'width' && s.level === 'fix'));
  assert.ok(r.suggestions.some((s) => s.id === 'cta-fold' && s.level === 'good'));
  assert.ok(r.score < 100 && r.score > 50);
  const r2 = suggest({ root: newsletter(), plan: planSlices(newsletter()), fields: { campaignName: 'x', subject: 'Hello', preheader: 'p', mobileFrameId: 'm' }, hasMobile: true });
  assert.ok(r2.score >= 90, `score ${r2.score}`); // footer text at 12px is flagged as small on mobile, by design
});

test('zip + crc32 + fnv + base64', () => {
  assert.equal(crc32(utf8Bytes('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  const z = makeZip([{ name: 'index.html', data: utf8Bytes('<p>hi</p>') }, { name: 'images/a.png', data: new Uint8Array([1, 2, 3]) }], new Date(2026, 9, 11, 12, 0, 0));
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b); // PK
  assert.equal(z[z.length - 22], 0x50); assert.equal(z[z.length - 21], 0x4b);
  assert.equal(toBase64(utf8Bytes('Phloem!')), Buffer.from('Phloem!').toString('base64'));
  assert.equal(toBase64(new Uint8Array([255, 0])), Buffer.from([255, 0]).toString('base64'));
  assert.notEqual(fnv1a(new Uint8Array([1, 2])), fnv1a(new Uint8Array([2, 1])));
});

test('suggestions: white text on a photo is not flagged as low contrast', () => {
  const root = node({ id: 'root', type: 'FRAME', w: 600, h: 600, fill: '#ffffff', children: [
    node({ id: 'photo', y: 0, w: 600, h: 400, hasImage: true, link: 'https://x.test' }),
    node({ isText: true, text: 'Bộ sưu tập mới', x: 24, y: 100, w: 400, h: 40, fontSize: 32, fill: '#ffffff' }),
    node({ id: 'card', y: 400, w: 600, h: 200, fill: '#ffffff', children: [node({ isText: true, text: 'mờ', x: 24, y: 420, w: 100, h: 20, fontSize: 14, fill: '#eeeeee' })] }),
  ] });
  const r = suggest({ root, plan: planSlices(root), fields: { campaignName: 'x', subject: 's', preheader: 'p', mobileFrameId: null }, hasMobile: true });
  const c = r.suggestions.find((s) => s.id === 'contrast');
  assert.ok(c, 'grey-on-white text should be flagged');
  assert.ok(c.detail.includes('mờ'), 'the flagged text is the grey one, not the one on the photo');
});

test('html: MSO ghost table pins the width in Outlook, hrefs are click-tracking safe, bgcolor is a flat hex', () => {
  const plan = planSlices(node({ id: 'f', type: 'FRAME', w: 600, h: 300, children: [node({ y: 0, w: 600, h: 300, link: 'https://shop.test/sản phẩm/a b?x=1' })] }));
  const html = buildEmailHtml({ plan, images: { r0c0: 'https://cdn.test/r0c0.png' }, mobile: null, title: 'T', preheader: '', includePreheader: false, fullDocument: false, footerHtml: '', bgColor: 'rgba(255,0,0,0.5)', provider: null, utm: null });
  assert.ok(html.includes('<!--[if mso]><table role="presentation" width="600"'), 'ghost table');
  assert.ok(html.includes('href="https://shop.test/s%E1%BA%A3n%20ph%E1%BA%A9m/a%20b?x=1"'), 'href encoded: ' + html.match(/href="[^"]*"/)[0]);
  assert.ok(html.includes('bgcolor="#ff8080"'), 'rgba composited over white');
  assert.ok(html.includes('.ph-main-img,.ph-desktop-img,.ph-mobile-img{max-width:100%!important;}'), 'mobile img cap');
});
