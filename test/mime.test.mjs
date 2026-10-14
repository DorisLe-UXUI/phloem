import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMime, headerValue, address, parseRecipients, replaceMergeTags, plainText, uniqueCids } from '../dist/shared.mjs';

test('mime: multipart/related with an alternative body and inline cid images, CRLF, encoded subject', () => {
  const raw = buildMime({ html: '<img src="cid:r0c0@phloem">Xin chào', text: 'Xin chào', subject: 'Giảm 30% hôm nay', from: address('Phloem Đẹp', 'a@b.vn'), to: 'c@d.vn', parts: [{ cid: 'r0c0@phloem', filename: 'r0c0.jpg', mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3, 4]) }], boundarySeed: 'x1', draft: true, listUnsubscribe: 'mailto:a@b.vn' });
  assert.ok(raw.startsWith('From: =?UTF-8?B?'), 'encoded display name');
  assert.ok(raw.includes('\r\nSubject: =?UTF-8?B?'), 'encoded subject');
  assert.ok(raw.includes('X-Unsent: 1'));
  assert.ok(raw.includes('List-Unsubscribe: <mailto:a@b.vn>'));
  assert.ok(raw.includes('Content-Type: multipart/related; boundary="phl_rel_x1"'));
  assert.ok(raw.includes('Content-ID: <r0c0@phloem>'));
  assert.ok(raw.includes('Content-Disposition: inline; filename="r0c0.jpg"'));
  assert.ok(raw.includes('--phl_alt_x1--') && raw.trimEnd().endsWith('--phl_rel_x1--'));
  assert.ok(!/[^\r]\n/.test(raw), 'every line ends with CRLF');
  for (const line of raw.split('\r\n')) assert.ok(line.length <= 998, 'RFC 5322 line limit');
});

test('mime helpers: header encoding, recipients, merge tags, plain text', () => {
  assert.equal(headerValue('Hello'), 'Hello');
  assert.match(headerValue('Chào'), /^=\?UTF-8\?B\?/);
  assert.deepEqual(parseRecipients('An <AN@x.vn>, binh@y.com\nbinh@y.com; sai-email, chi@z.co'), ['an@x.vn', 'binh@y.com', 'chi@z.co']);
  const h = replaceMergeTags('<a href="*|UNSUB|*">u</a><a href="*|UPDATE_PROFILE|*">p</a> *|FNAME|*', 'me@x.vn');
  assert.ok(h.includes('href="mailto:me@x.vn?subject='));
  assert.ok(!h.includes('*|'));
  assert.equal(plainText('Pre', [{ alt: 'Hero', link: 'https://x.vn' }, { alt: '', link: '*|UNSUB|*' }]), 'Pre\n\nHero\n\n→ https://x.vn');
});

test('uniqueCids: each repeated cid reference gets its own part (Gmail shows a cid image only once)', async () => {
  const part = (cid) => ({ cid, filename: `${cid.split('@')[0]}.png`, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
  const html = '<img src="cid:a@phloem"><img src="cid:b@phloem"><img src="cid:a@phloem"><img src="cid:a@phloem">';
  const r = uniqueCids(html, [part('a@phloem'), part('b@phloem'), part('unused@phloem')]);
  const refs = [...r.html.matchAll(/cid:([^"]+)/g)].map((m) => m[1]);
  assert.equal(new Set(refs).size, refs.length);
  assert.deepEqual(refs, ['a@phloem', 'b@phloem', 'a-r2@phloem', 'a-r3@phloem']);
  assert.deepEqual(r.parts.map((p) => p.cid), refs);
  assert.equal(r.parts[2].filename, 'a-r2.png');
});
