// Image providers: Nano Banana 2 Lite is the only Google model picked, FLUX sizes per aspect, Cloudflare account lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfAccountId, fluxSize, pickLiteImageModel, sniffMime, nextUtcMidnight } from '../server/src/imagegen.mjs';

const m = (name, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods });

test('google: only a Flash-Lite Image model is picked, newest stable first', () => {
  const list = [m('imagen-4.0-generate-001', ['predict']), m('gemini-3.1-flash-image-preview'), m('gemini-2.5-flash-image'), m('gemini-3.1-flash-lite-image'), m('gemini-3.1-flash-lite-image-preview'), m('gemini-3.1-flash-lite')];
  assert.equal(pickLiteImageModel(list).name, 'models/gemini-3.1-flash-lite-image');
  assert.equal(pickLiteImageModel([m('gemini-3.1-flash-image-preview'), m('imagen-4.0-generate-001', ['predict'])]), null);
  assert.equal(pickLiteImageModel([m('gemini-3.1-flash-lite-image', ['countTokens'])]), null);
});

test('flux sizes: every aspect stays in 256–1920, multiples of 64, close to the ratio', () => {
  for (const [a, r] of [['1:1', 1], ['3:4', 0.75], ['4:3', 4 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9]]) {
    const [w, h] = fluxSize(a);
    assert.ok(w >= 256 && h >= 256 && w <= 1920 && h <= 1920 && w % 64 === 0 && h % 64 === 0, a);
    assert.ok(Math.abs(w / h - r) / r < 0.03, a);
  }
  assert.deepEqual(fluxSize('weird'), [1024, 1024]);
});

test('cloudflare account: explicit id, else the R2 backup endpoint', () => {
  const id = '0123456789abcdef0123456789abcdef';
  assert.equal(cfAccountId({ CF_ACCOUNT_ID: ' acc ' }), 'acc');
  assert.equal(cfAccountId({ BACKUP_S3_ENDPOINT: `https://${id}.r2.cloudflarestorage.com` }), id);
  assert.equal(cfAccountId({ BACKUP_S3_ENDPOINT: 'https://s3.amazonaws.com' }), '');
});

test('mime sniffing and the daily reset', () => {
  assert.equal(sniffMime('/9j/4AAQ'), 'image/jpeg');
  assert.equal(sniffMime('iVBORw0K'), 'image/png');
  assert.equal(sniffMime('UklGRh4A'), 'image/webp');
  assert.equal(new Date(nextUtcMidnight(Date.UTC(2026, 9, 15, 23, 59))).toISOString(), '2026-10-16T00:00:00.000Z');
});
