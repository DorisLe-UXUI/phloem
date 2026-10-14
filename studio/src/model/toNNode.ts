// Doc -> NNode so the shared slicer / checks / suggestions run unchanged.
import type { NNode } from '../../../src/shared/types';
import type { Brand, Doc, Node } from './types';
import { resolveColor } from './types';
import { bounds } from './ops';

export function docToNNode(doc: Doc, brand: Brand): NNode {
  const conv = (n: Node): NNode => {
    const b = bounds(n);
    const base: NNode = {
      id: n.id, name: n.name, type: n.type.toUpperCase(),
      x: b.x, y: b.y, w: b.w, h: b.h,
      visible: n.visible && n.opacity > 0,
      link: n.link || null, linkSource: n.link ? 'field' : null,
      alt: n.alt || null, altSource: n.alt ? 'field' : null,
      // photos need alt text; drawn decoration (shapes, stickers, icons, converted glows) does not
      hasImage: n.type === 'image' && !!n.assetId && !n.decor && !n.vector,
      isText: n.type === 'text',
      text: n.type === 'text' ? n.text : null,
      fontSize: n.type === 'text' ? n.fontSize : null,
      fill: n.type === 'rect' ? resolveColor(n.fill, brand) : n.type === 'text' ? resolveColor(n.color, brand) : n.type === 'image' ? resolveColor(n.fill, brand) : null,
      children: n.type === 'group' ? n.children.map(conv) : [],
    };
    return base;
  };
  return {
    id: 'root', name: 'Email', type: 'FRAME', x: 0, y: 0, w: doc.width, h: doc.height, visible: true,
    link: null, linkSource: null, alt: null, altSource: null, hasImage: false, isText: false, text: null, fontSize: null,
    fill: resolveColor(doc.bg, brand), children: doc.nodes.map(conv),
  };
}
