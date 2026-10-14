import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSlices } from '../dist/shared.mjs';
import { newsletter, node } from './_fixtures.mjs';

function coverage(plan) {
  let sum = 0;
  for (const s of plan.slices) sum += s.w * s.h;
  // pairwise overlap check
  for (let i = 0; i < plan.slices.length; i++) for (let j = i + 1; j < plan.slices.length; j++) {
    const a = plan.slices[i], b = plan.slices[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(ox <= 0 || oy <= 0, `slices ${a.key} and ${b.key} overlap`);
  }
  return sum;
}

test('newsletter: full coverage, no overlaps, each link lands on its own cell', () => {
  const plan = planSlices(newsletter());
  assert.equal(coverage(plan), 600 * 1000);
  const byLink = new Map();
  for (const s of plan.slices) if (s.link) byLink.set(s.link, (byLink.get(s.link) || 0) + 1);
  assert.deepEqual([...byLink.keys()].sort(), ['https://shop.test/p1', 'https://shop.test/p2', 'https://shop.test/p3', 'https://shop.test/p4', 'https://shop.test/prefs', 'https://shop.test/sale', 'https://shop.test/unsub'].sort());
  // hero is a single full-width slice with its alt
  const hero = plan.slices.find((s) => s.link === 'https://shop.test/sale');
  assert.equal(hero.w, 600); assert.equal(hero.h, 300); assert.equal(hero.alt, 'Summer sale');
  // grid row: 24 margin | p1 | 24 gap | p2 | 24 margin  -> 5 cells
  const gridRow = plan.rows.find((r) => r.y === 400);
  assert.equal(gridRow.cells.length, 5);
  assert.equal(gridRow.cells[1].link, 'https://shop.test/p1');
  assert.equal(gridRow.cells[3].link, 'https://shop.test/p2');
  assert.equal(gridRow.cells[2].link, null);
  // header + nothing-linked rows merged into one slice
  assert.equal(plan.rows[0].cells.length, 1);
  assert.equal(plan.rows[0].h, 80);
  // alt fallback from text for footer links
  const unsub = plan.slices.find((s) => s.link === 'https://shop.test/unsub');
  assert.equal(unsub.alt, 'Unsubscribe');
  // product with image alt gets it
  assert.equal(plan.slices.find((s) => s.link === 'https://shop.test/p1').alt, 'Product one');
});

test('nested link: child link wins inside its own area, parent elsewhere', () => {
  const root = node({ id: 'root', type: 'FRAME', w: 600, h: 400, children: [
    node({ id: 'card', x: 0, y: 0, w: 600, h: 400, link: 'https://a.test', children: [
      node({ id: 'btn', x: 200, y: 300, w: 200, h: 60, link: 'https://b.test' }),
    ] }),
  ] });
  const plan = planSlices(root);
  assert.equal(coverage(plan), 600 * 400);
  const b = plan.slices.filter((s) => s.link === 'https://b.test');
  assert.equal(b.length, 1); assert.equal(b[0].x, 200); assert.equal(b[0].w, 200);
  assert.ok(plan.slices.filter((s) => s.link === 'https://a.test').length >= 3);
});

test('tall link-free area is split under maxSliceHeight at natural edges', () => {
  const root = node({ id: 'root', type: 'FRAME', w: 600, h: 4000, children: [
    node({ y: 0, w: 600, h: 1300 }), node({ y: 1300, w: 600, h: 1300 }), node({ y: 2600, w: 600, h: 1400 }),
  ] });
  const plan = planSlices(root, { maxSliceHeight: 1500 });
  assert.equal(coverage(plan), 600 * 4000);
  assert.ok(plan.slices.every((s) => s.h <= 1500));
  assert.deepEqual(plan.slices.map((s) => s.y), [0, 1300, 2600]);
});

test('invisible nodes are ignored; fractional coords are rounded', () => {
  const root = node({ id: 'root', type: 'FRAME', w: 600, h: 200.4, children: [
    node({ x: 10.5, y: 20.2, w: 100, h: 50, link: 'https://x.test', visible: false }),
    node({ x: 10.5, y: 100.6, w: 100.2, h: 50, link: 'https://y.test' }),
  ] });
  const plan = planSlices(root);
  assert.equal(plan.slices.filter((s) => s.link).length, 1);
  assert.ok(plan.slices.every((s) => Number.isInteger(s.x) && Number.isInteger(s.y) && Number.isInteger(s.w) && Number.isInteger(s.h)));
  assert.equal(coverage(plan), 600 * 200);
});

test('deterministic: same tree, same plan', () => {
  const a = JSON.stringify(planSlices(newsletter()));
  const b = JSON.stringify(planSlices(newsletter()));
  assert.equal(a, b);
});

test('keep: an animated block comes out as ONE full-width slice (one GIF), with the dominant link, neighbours untouched', () => {
  const plan = planSlices(newsletter(), { keep: [{ x: 0, y: 80, w: 600, h: 320 }] }); // hero + 20px of the grid row
  assert.equal(coverage(plan), 600 * 1000);
  const kept = plan.slices.filter((s) => s.y >= 80 && s.y + s.h <= 400);
  assert.equal(kept.length, 1, 'hero rows collapse into one slice');
  assert.equal(kept[0].w, 600); assert.equal(kept[0].y, 80); assert.equal(kept[0].h, 320);
  assert.equal(kept[0].link, 'https://shop.test/sale');
  // the grid row still splits into its 5 cells below the kept region
  const grid = plan.rows.find((r) => r.y === 400);
  assert.equal(grid.cells.length, 5);
  // the header row above is not merged into the GIF
  assert.equal(plan.rows[0].h, 80);
});

test('slicer: a link beside a taller logo never cuts the logo (no seam through artwork)', () => {
  const node = (id, x, y, w, h, extra = {}) => ({ id, name: id, type: 'RECTANGLE', x, y, w, h, visible: true, link: null, linkSource: null, alt: null, altSource: null, hasImage: false, isText: false, text: null, fontSize: null, fill: null, children: [], ...extra });
  const root = node('root', 0, 0, 600, 400, { type: 'FRAME', children: [
    node('logo', 40, 100, 90, 90, { hasImage: true }),
    node('fb', 460, 120, 40, 40, { link: 'https://facebook.com/x' }),
    node('tt', 510, 120, 40, 40, { link: 'https://tiktok.com/@x' }),
  ] });
  const plan = planSlices(root);
  const cutsInsideLogo = plan.rows.map((r) => r.y).filter((y) => y > 101 && y < 189);
  assert.deepEqual(cutsInsideLogo, [], 'no row starts inside the logo');
  const fb = plan.slices.find((s) => s.link === 'https://facebook.com/x');
  assert.ok(fb && fb.y <= 100 && fb.y + fb.h >= 190, 'the icon row spans the logo height');
});
