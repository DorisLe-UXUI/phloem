// Phloem Studio document model. Coordinates are absolute within the artboard (groups derive bounds from children).
export type NodeType = 'rect' | 'text' | 'image' | 'group';

/** A colour is a hex string or a reference to a brand token. */
export type Color = string | { token: BrandToken };
export type BrandToken = 'primary' | 'onPrimary' | 'ink' | 'muted' | 'bg' | 'soft' | 'line';

export interface Brand {
  primary: string;
  onPrimary: string;
  ink: string;
  muted: string;
  bg: string;
  soft: string;
  line: string;
  fontFamily: string;
  headingFamily: string;
}

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  link: string | null;
  alt: string;
  /** Block kind this node was inserted as (top-level groups). */
  block?: string;
}

export interface RectNode extends BaseNode {
  type: 'rect';
  fill: Color | null;
  stroke: { color: Color; width: number } | null;
  radius: number;
}

export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: Color;
  align: 'left' | 'center' | 'right';
  lineHeight: number; // multiplier
  letterSpacing: number; // px
  autoHeight: boolean;
  /** Vertical alignment inside the box when autoHeight is off. */
  vAlign: 'top' | 'middle' | 'bottom';
}

export interface ImageNode extends BaseNode {
  type: 'image';
  assetId: string | null;
  fit: 'cover' | 'contain' | 'fill';
  radius: number;
  /** Background behind contain-fit / placeholder. */
  fill: Color | null;
  /** Colour overlay (e.g. darken photo behind text). */
  overlay: { color: string; opacity: number } | null;
}

export interface GroupNode extends BaseNode {
  type: 'group';
  children: Node[];
}

export type Node = RectNode | TextNode | ImageNode | GroupNode;

export interface EmailFields {
  campaignName: string;
  subject: string;
  preheader: string;
}

export interface Doc {
  width: number;
  height: number;
  bg: Color;
  nodes: Node[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  brand: Brand;
  fields: EmailFields;
  desktop: Doc;
  mobile: Doc | null;
  /** profileId -> draft record (see shared types) */
  drafts: Record<string, unknown>;
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  w: number;
  h: number;
  bytes: number;
}

export const DEFAULT_BRAND: Brand = {
  primary: '#0F3D2E',
  onPrimary: '#FFFFFF',
  ink: '#121512',
  muted: '#5F6761',
  bg: '#FFFFFF',
  soft: '#F3F5F3',
  line: '#E3E7E4',
  fontFamily: 'Inter',
  headingFamily: 'Inter',
};

export const BRAND_PRESETS: { name: string; brand: Partial<Brand> }[] = [
  { name: 'Forest', brand: { primary: '#0F3D2E', onPrimary: '#FFFFFF', ink: '#121512', muted: '#5F6761', bg: '#FFFFFF', soft: '#F3F5F3', line: '#E3E7E4' } },
  { name: 'Neon', brand: { primary: '#39FF14', onPrimary: '#04140A', ink: '#E6F4EA', muted: '#8FA796', bg: '#070A08', soft: '#0C120E', line: '#1A2A1E' } },
  { name: 'Coral', brand: { primary: '#E8553D', onPrimary: '#FFFFFF', ink: '#1C1917', muted: '#6B645F', bg: '#FFFBF7', soft: '#FDF1EB', line: '#F0E4DC' } },
  { name: 'Ocean', brand: { primary: '#0E4C92', onPrimary: '#FFFFFF', ink: '#0B1B2B', muted: '#5B6B7A', bg: '#FFFFFF', soft: '#EEF4FA', line: '#D9E4EF' } },
  { name: 'Mono', brand: { primary: '#111111', onPrimary: '#FFFFFF', ink: '#111111', muted: '#666666', bg: '#FFFFFF', soft: '#F4F4F4', line: '#E5E5E5' } },
  { name: 'Plum', brand: { primary: '#5B2A86', onPrimary: '#FFFFFF', ink: '#1E1225', muted: '#6F6378', bg: '#FFFFFF', soft: '#F5EFFA', line: '#E7DDF0' } },
];

export const FONTS: { family: string; label: string; google?: string }[] = [
  { family: 'Inter', label: 'Inter', google: 'Inter:wght@400;500;600;700;800' },
  { family: 'Be Vietnam Pro', label: 'Be Vietnam Pro', google: 'Be+Vietnam+Pro:wght@400;500;600;700;800' },
  { family: 'Roboto', label: 'Roboto', google: 'Roboto:wght@400;500;700;900' },
  { family: 'Montserrat', label: 'Montserrat', google: 'Montserrat:wght@400;500;600;700;800' },
  { family: 'Playfair Display', label: 'Playfair Display', google: 'Playfair+Display:wght@400;600;700;800' },
  { family: 'Lora', label: 'Lora', google: 'Lora:wght@400;500;600;700' },
  { family: 'DM Sans', label: 'DM Sans', google: 'DM+Sans:wght@400;500;600;700' },
  { family: 'Space Grotesk', label: 'Space Grotesk', google: 'Space+Grotesk:wght@400;500;600;700' },
  { family: 'Helvetica', label: 'Helvetica / Arial' },
  { family: 'Georgia', label: 'Georgia' },
  { family: 'Courier New', label: 'Courier' },
];

export function uid(prefix = 'n'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function resolveColor(c: Color | null | undefined, brand: Brand): string | null {
  if (c == null) return null;
  if (typeof c === 'string') return c;
  return brand[c.token] as string;
}
