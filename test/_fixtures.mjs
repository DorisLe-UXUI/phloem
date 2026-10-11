// Synthetic NNode trees for tests.
let id = 0;
export function node(partial) {
  id++;
  return {
    id: partial.id ?? `n${id}`,
    name: partial.name ?? `Node ${id}`,
    type: partial.type ?? 'RECTANGLE',
    x: partial.x ?? 0, y: partial.y ?? 0, w: partial.w ?? 100, h: partial.h ?? 100,
    visible: partial.visible ?? true,
    link: partial.link ?? null, linkSource: partial.link ? 'field' : null,
    alt: partial.alt ?? null, altSource: partial.alt ? 'field' : null,
    hasImage: partial.hasImage ?? false,
    isText: partial.isText ?? false,
    text: partial.text ?? null,
    fontSize: partial.fontSize ?? null,
    fill: partial.fill ?? null,
    children: partial.children ?? [],
  };
}

/** 600×1000 newsletter: header, hero(link), 2×2 grid(links), text with two side-by-side links, footer. */
export function newsletter() {
  id = 1000; // stable ids so plans are comparable
  return node({
    id: 'root', name: 'Newsletter', type: 'FRAME', w: 600, h: 1000, fill: '#ffffff',
    children: [
      node({ name: 'Header', y: 0, w: 600, h: 80, children: [node({ name: 'Logo', isText: true, text: 'BRAND', x: 24, y: 28, w: 100, h: 24, fontSize: 18, fill: '#111111' })] }),
      node({ id: 'hero', name: 'Hero', y: 80, w: 600, h: 300, hasImage: true, alt: 'Summer sale', link: 'https://shop.test/sale' }),
      node({ id: 'p1', name: 'Product 1', x: 24, y: 400, w: 264, h: 300, link: 'https://shop.test/p1', children: [node({ name: 'img1', x: 24, y: 400, w: 264, h: 264, hasImage: true, alt: 'Product one' })] }),
      node({ id: 'p2', name: 'Product 2', x: 312, y: 400, w: 264, h: 300, link: 'https://shop.test/p2', children: [node({ name: 'img2', x: 312, y: 400, w: 264, h: 264, hasImage: true })] }),
      node({ id: 'p3', name: 'Product 3', x: 24, y: 720, w: 264, h: 120, link: 'https://shop.test/p3' }),
      node({ id: 'p4', name: 'Product 4', x: 312, y: 720, w: 264, h: 120, link: 'https://shop.test/p4' }),
      node({ name: 'Footer', y: 900, w: 600, h: 100, children: [
        node({ id: 'unsub', name: 'Unsubscribe', isText: true, text: 'Unsubscribe', x: 200, y: 940, w: 90, h: 20, fontSize: 12, link: 'https://shop.test/unsub' }),
        node({ id: 'prefs', name: 'Prefs', isText: true, text: 'Preferences', x: 310, y: 940, w: 90, h: 20, fontSize: 12, link: 'https://shop.test/prefs' }),
      ] }),
    ],
  });
}
