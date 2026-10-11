// Figma SceneNode -> NNode. Reads links/alt from: plugin fields, text hyperlinks, prototype URL reactions, layer names.
import type { NNode } from '../shared/types';

export const NS = 'phloem';
const DEFAULT_NAME = /^(Rectangle|Frame|Group|Vector|Ellipse|Line|Image|Polygon|Star|Component|Instance|Text|Union|Subtract|Intersect|Exclude)( \d+)?$/i;

export function readField(node: BaseNode, key: string): string | null {
  const v = node.getSharedPluginData(NS, key);
  return v ? v : null;
}

export function writeField(node: BaseNode, key: string, value: string | null) {
  node.setSharedPluginData(NS, key, value ?? '');
}

export function nameLink(name: string): string | null {
  const m = /#link=(\S+)/i.exec(name) || /\[link:\s*([^\]]+)\]/i.exec(name);
  return m ? m[1].trim() : null;
}

export function nameAlt(name: string): string | null {
  const m = /#alt=(.+?)(?=\s+#\w+=|$)/i.exec(name) || /\[alt:\s*([^\]]+)\]/i.exec(name);
  return m ? m[1].trim() : null;
}

/** Layer name with #link= / #alt= tags removed. */
export function cleanName(name: string): string {
  return name.replace(/#(link|alt)=\S+(\s+(?!#\w+=)\S+)*/gi, '').replace(/\[(link|alt):[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim() || name;
}

function textHyperlink(node: TextNode): string | null {
  try {
    const h = node.hyperlink;
    if (h && h !== figma.mixed) return h.type === 'URL' ? h.value : null;
    if (h === figma.mixed) {
      const segs = node.getStyledTextSegments(['hyperlink']);
      for (const s of segs) if (s.hyperlink && s.hyperlink.type === 'URL' && s.hyperlink.value) return s.hyperlink.value;
    }
  } catch { /* older nodes */ }
  return null;
}

function reactionLink(node: SceneNode): string | null {
  if (!('reactions' in node)) return null;
  try {
    for (const r of node.reactions as readonly Reaction[]) {
      const actions: readonly Action[] = (r as any).actions ?? (r.action ? [r.action] : []);
      for (const a of actions) if (a && a.type === 'URL' && (a as any).url) return (a as any).url as string;
    }
  } catch { /* ignore */ }
  return null;
}

function solidHex(p: Paint): string | null {
  if (p.type !== 'SOLID' || p.visible === false) return null;
  const c = p.color;
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function fillsOf(node: SceneNode): readonly Paint[] {
  if (!('fills' in node)) return [];
  const f = (node as GeometryMixin).fills;
  return f === figma.mixed ? [] : (f as readonly Paint[]);
}

function fontSizeOf(node: TextNode): number | null {
  try {
    const fs = node.fontSize;
    if (fs !== figma.mixed) return fs as number;
    const segs = node.getStyledTextSegments(['fontSize']);
    return segs.length ? Math.min(...segs.map((s) => s.fontSize)) : null;
  } catch { return null; }
}

export interface NormalizeOptions { altFromLayerName: boolean }

export function normalize(frame: FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode, opts: NormalizeOptions): NNode {
  const rootBox = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: frame.width, height: frame.height };
  const toNNode = (node: SceneNode, depth: number): NNode | null => {
    if (node.type === 'SLICE') return null;
    const box = node.absoluteBoundingBox;
    if (!box) return null;
    const fills = fillsOf(node);
    const hasImage = fills.some((p) => p.type === 'IMAGE' && p.visible !== false);
    const fill = fills.map(solidHex).find((h) => h) ?? null;
    const isText = node.type === 'TEXT';
    const text = isText ? (node as TextNode).characters : null;
    const visible = node.visible && (!('opacity' in node) || (node as BlendMixin).opacity > 0);

    let link: string | null = readField(node, 'link');
    let linkSource: NNode['linkSource'] = link ? 'field' : null;
    if (!link && isText) { link = textHyperlink(node as TextNode); if (link) linkSource = 'hyperlink'; }
    if (!link) { link = reactionLink(node); if (link) linkSource = 'reaction'; }
    if (!link) { link = nameLink(node.name); if (link) linkSource = 'name'; }

    let alt: string | null = readField(node, 'alt');
    let altSource: NNode['altSource'] = alt ? 'field' : null;
    if (!alt) { alt = nameAlt(node.name); if (alt) altSource = 'name'; }
    if (!alt && opts.altFromLayerName && hasImage && !DEFAULT_NAME.test(node.name)) { alt = cleanName(node.name); altSource = 'layer'; }

    const children: NNode[] = [];
    if ('children' in node && depth < 40) {
      for (const c of (node as ChildrenMixin).children) {
        const n = toNNode(c, depth + 1);
        if (n) children.push(n);
      }
    }
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      x: box.x - rootBox.x,
      y: box.y - rootBox.y,
      w: box.width,
      h: box.height,
      visible,
      link, linkSource, alt, altSource,
      hasImage, isText, text,
      fontSize: isText ? fontSizeOf(node as TextNode) : null,
      fill,
      children,
    };
  };

  const rootFills = fillsOf(frame as SceneNode);
  const root: NNode = {
    id: frame.id,
    name: frame.name,
    type: frame.type,
    x: 0, y: 0, w: frame.width, h: frame.height,
    visible: true,
    link: null, linkSource: null, alt: null, altSource: null,
    hasImage: rootFills.some((p) => p.type === 'IMAGE'),
    isText: false, text: null, fontSize: null,
    fill: rootFills.map(solidHex).find((h) => h) ?? null,
    children: [],
  };
  for (const c of frame.children) {
    const n = toNNode(c, 1);
    if (n) root.children.push(n);
  }
  return root;
}

export function isFrameLike(n: BaseNode | null): n is FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode {
  return !!n && (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'GROUP' || n.type === 'SECTION');
}
