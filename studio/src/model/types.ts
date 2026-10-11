// Phloem Studio document model. Coordinates are absolute within the artboard (groups derive bounds from children).
export type NodeType = 'rect' | 'text' | 'image' | 'group';

/** A colour is a hex string or a reference to a brand token. */
export type Color = string | { token: BrandToken };
export type BrandToken = 'primary' | 'accent' | 'onPrimary' | 'ink' | 'muted' | 'bg' | 'soft' | 'line';

export interface Brand {
  primary: string;
  /** Second brand colour: gradient end, highlights. */
  accent: string;
  onPrimary: string;
  ink: string;
  muted: string;
  bg: string;
  soft: string;
  line: string;
  fontFamily: string;
  headingFamily: string;
  /** Wordmark text used by nav/footer blocks when there is no logo image. */
  name: string;
  /** Asset id of the brand logo; nav/footer blocks show it instead of the wordmark. */
  logoAssetId: string | null;
  /** Brand gradient (primary → accent) on every primary-coloured band; null/undefined = flat. */
  gradient?: { angle: number } | null;
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
  /** Linear gradient on top of (or instead of) the flat fill. */
  gradient: { from: Color; to: Color; angle: number } | null;
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
  strike: boolean;
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
  /** Colour overlay (e.g. darken photo behind text). `gradient` fades from transparent at the top to the colour at the bottom. */
  overlay: { color: string; opacity: number; gradient?: boolean } | null;
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
  accent: '#39A96B',
  onPrimary: '#FFFFFF',
  ink: '#121512',
  muted: '#5F6761',
  bg: '#FFFFFF',
  soft: '#F3F5F3',
  line: '#E3E7E4',
  fontFamily: 'Inter',
  headingFamily: 'Inter',
  name: 'BRAND',
  logoAssetId: null,
};

export const BRAND_PRESETS: { name: string; brand: Partial<Brand> }[] = [
  { name: 'Forest', brand: { primary: '#0F3D2E', accent: '#39A96B', onPrimary: '#FFFFFF', ink: '#121512', muted: '#5F6761', bg: '#FFFFFF', soft: '#EEF3EF', line: '#DCE4DE' } },
  { name: 'Coral', brand: { primary: '#E8553D', accent: '#F6A24B', onPrimary: '#FFFFFF', ink: '#1C1917', muted: '#6B645F', bg: '#FFFBF7', soft: '#FBEDE6', line: '#F0DDD3' } },
  { name: 'Ocean', brand: { primary: '#0E4C92', accent: '#1FB6D6', onPrimary: '#FFFFFF', ink: '#0B1B2B', muted: '#56687A', bg: '#FFFFFF', soft: '#E9F1FA', line: '#D3E1EF' } },
  { name: 'Sunset', brand: { primary: '#F2672A', accent: '#FFC53D', onPrimary: '#1B0E07', ink: '#2A1810', muted: '#7A5F52', bg: '#FFF7EF', soft: '#FFE9D6', line: '#F5D7BF' } },
  { name: 'Plum', brand: { primary: '#5B2A86', accent: '#B36BFF', onPrimary: '#FFFFFF', ink: '#1E1225', muted: '#6A5F72', bg: '#FFFFFF', soft: '#F3ECF9', line: '#E3D6EE' } },
  { name: 'Mint', brand: { primary: '#0FA37A', accent: '#7EE2C4', onPrimary: '#05261C', ink: '#0F1F1A', muted: '#556B63', bg: '#F6FBF9', soft: '#DDF4EC', line: '#C6E8DB' } },
  { name: 'Royal', brand: { primary: '#C9A227', accent: '#14213D', onPrimary: '#1A1407', ink: '#14213D', muted: '#5C6478', bg: '#FFFFFF', soft: '#F4F0E4', line: '#E6DEC6' } },
  { name: 'Mono', brand: { primary: '#111111', accent: '#555555', onPrimary: '#FFFFFF', ink: '#111111', muted: '#666666', bg: '#FFFFFF', soft: '#F2F2F2', line: '#E2E2E2' } },
  { name: 'Linen', brand: { primary: '#8A6A3C', accent: '#C9A97A', onPrimary: '#FFFFFF', ink: '#1F1B16', muted: '#766B5E', bg: '#FAF7F2', soft: '#F1EBE2', line: '#E4DCCF' } },
  { name: 'Neon', brand: { primary: '#39FF14', accent: '#0FA37A', onPrimary: '#04140A', ink: '#E6F4EA', muted: '#9DB8A6', bg: '#070A08', soft: '#101812', line: '#1F3024' } },
  { name: 'Midnight', brand: { primary: '#7C9CFF', accent: '#C084FC', onPrimary: '#0B1020', ink: '#EEF1FF', muted: '#9AA3C7', bg: '#0B1020', soft: '#141B33', line: '#243052' } },
  { name: 'Candy', brand: { primary: '#FF4FA3', accent: '#7C5CFF', onPrimary: '#FFFFFF', ink: '#2A1B3D', muted: '#7A6B8E', bg: '#FFFFFF', soft: '#FFF0F7', line: '#F6D9E8' } },
  { name: 'Sky', brand: { primary: '#2F7CF6', accent: '#FFC53D', onPrimary: '#FFFFFF', ink: '#13203A', muted: '#60708C', bg: '#FFFFFF', soft: '#EAF2FF', line: '#D6E3FA' } },
  { name: 'Lavender', brand: { primary: '#8B5CF6', accent: '#F472B6', onPrimary: '#FFFFFF', ink: '#F3EEFF', muted: '#B9A9E0', bg: '#120B2A', soft: '#1C1240', line: '#2E2160' } },
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
