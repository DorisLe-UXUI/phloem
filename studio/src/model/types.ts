// Phloem Studio document model. Coordinates are absolute within the artboard (groups derive bounds from children).
export type NodeType = 'rect' | 'text' | 'image' | 'group';

/** A colour is a hex string or a reference to a brand token. */
/** A hex string, or a brand token (optionally with alpha 0..1 for glows and scrims that still follow the palette). */
export type Color = string | { token: BrandToken; alpha?: number };
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
  /** White/light version of the logo for dark bands (made automatically from SVG or transparent dark logos). */
  logoLightAssetId?: string | null;
  /** Design language taken from the website: overrides the vibe's defaults so the email is shaped like the brand. */
  shape?: { radius?: number; btnRadius?: number; uppercase?: boolean; headingWeight?: number; track?: number; outlineButtons?: boolean } | null;
  /** Real destinations read from the website: home page, menu and social profiles (used for logo/nav/footer links and auto-fix). */
  links?: { website?: string; nav?: { label: string; url: string }[]; socials?: { label: string; url: string }[]; products?: { name: string; url: string; image?: string }[] } | null;
  /** Brand gradient (primary → accent) on every primary-coloured band; null/undefined = flat. */
  gradient?: { angle: number } | null;
  /** Design personality for blocks built from now on: radii, shadows, pills, decorative shapes, headline scale. */
  vibe?: Vibe;
}

export type Vibe = 'clean' | 'playful' | 'luxury' | 'bold' | 'editorial';
export const VIBES: { v: Vibe; label: string; hint: string }[] = [
  { v: 'clean', label: 'Clean', hint: 'bo góc vừa, bóng nhẹ, cân bằng' },
  { v: 'playful', label: 'Playful', hint: 'bo tròn lớn, nút pill, hình trang trí, cho trẻ em / game / F&B' },
  { v: 'bold', label: 'Bold', hint: 'tiêu đề khổ lớn, nút pill phát sáng, cho agency / tech / streetwear' },
  { v: 'luxury', label: 'Luxury', hint: 'góc vuông, viền mảnh, nhiều khoảng trắng, serif' },
  { v: 'editorial', label: 'Editorial', hint: 'kẻ mảnh, bo nhỏ, báo chí / media' },
];
/** Soft drop shadow under a rect or image. */
export interface Shadow { blur: number; y: number; color: string; opacity: number; x?: number }
/** Corner radii [top-left, top-right, bottom-right, bottom-left]; wins over `radius` when set (arches, tabs, leaf shapes). */
export type Radii = [number, number, number, number];
/** Multi-stop gradient: `at` 0..1 along the gradient line (linear) or from the centre (radial). */
export interface GradStop { color: Color; at: number }

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
  /** Motion for animated (GIF) slices: how this layer enters, or loops (marquee). Static renders show the final state. */
  anim?: Anim | null;
  /** Block kind this node was inserted as (top-level groups). */
  block?: string;
}

export interface RectNode extends BaseNode {
  type: 'rect';
  fill: Color | null;
  /** Linear gradient on top of (or instead of) the flat fill. */
  /** Linear by default; `radial` fades from the centre (`from`) to the edge (`to`): soft glows, spotlights. */
  gradient: { from: Color; to: Color; angle: number; radial?: boolean; stops?: GradStop[] | null; cx?: number; cy?: number; r?: number } | null;
  stroke: { color: Color; width: number } | null;
  radius: number;
  radii?: Radii | null;
  shadow?: Shadow | null;
  rotate?: number;
  /** Gaussian blur in px: soft glows and orbs behind content. */
  blur?: number;
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
  effect?: TextEffect | null;
}

export interface ImageNode extends BaseNode {
  type: 'image';
  assetId: string | null;
  fit: 'cover' | 'contain' | 'fill';
  radius: number;
  radii?: Radii | null;
  /** Source of a vector graphic (icon, sticker, shape) so it can be recoloured and re-rasterised crisply. */
  vector?: { svg: string; color?: string | null; kind?: 'icon' | 'sticker' | 'shape' | 'graphic' } | null;
  /** Background behind contain-fit / placeholder. */
  fill: Color | null;
  /** Colour overlay (e.g. darken photo behind text). `gradient` fades from transparent at the top to the colour at the bottom. */
  overlay: { color: string; opacity: number; gradient?: boolean } | null;
  shadow?: Shadow | null;
  /** Figma-style crop: zoom (1..4) and focal point (0..1) of the photo inside its frame. */
  crop?: { zoom: number; fx: number; fy: number } | null;
  flipX?: boolean;
  flipY?: boolean;
  /** Rotation in degrees around the centre (props, stickers). */
  rotate?: number;
  /** Pseudo-3D tilt in degrees: ry turns the card around its vertical axis, rx around the horizontal one. */
  tilt?: { rx: number; ry: number } | null;
  /** Soft elliptical shadow under the image, so a cut-out product looks like it floats. */
  floatShadow?: boolean;
  /** Gaussian blur in px (depth of field, soft backgrounds behind text). */
  blur?: number;
}
/** Layer motion. delay/dur in seconds. 'marquee' scrolls text forever; 'type' reveals text letter by letter. */
export interface Anim { kind: AnimKind; delay?: number; dur?: number }
export type AnimKind = 'fade' | 'up' | 'down' | 'left' | 'right' | 'pop' | 'wipe' | 'marquee' | 'type' | 'pulse' | 'float' | 'spin' | 'shake' | 'blink';
/** Motions that repeat forever (stickers, badges, CTA). Every period divides LOOP_CYCLE so GIFs loop seamlessly. */
export const LOOP_KINDS = new Set<AnimKind>(['marquee', 'pulse', 'float', 'spin', 'shake', 'blink']);
export const LOOP_CYCLE = 2.4;
export function loopPeriod(a: Anim): number { const want = a.dur ?? (a.kind === 'float' || a.kind === 'spin' ? 2.4 : 1.2); return [0.6, 0.8, 1.2, 2.4].reduce((b, p) => (Math.abs(p - want) < Math.abs(b - want) ? p : b), 1.2); }
/** 3D-ish text treatments drawn by the renderer. */
export interface TextEffect { kind: 'extrude' | 'neon' | 'outline' | 'shadow'; color?: Color; depth?: number; angle?: number }

export interface GroupNode extends BaseNode {
  type: 'group';
  children: Node[];
  /** The block content this group was built from (makeBlock); lets the AI re-plan the email block by block. */
  content?: Record<string, unknown> | null;
  /** 'html' = a section of a free-form design (AI designer / HTML import): the block passes leave it as composed. */
  src?: 'html' | null;
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
  /** false = the user typed a height; otherwise the artboard hugs its content on every edit. */
  autoHeight?: boolean;
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
  /** Free-form AI design source: the HTML the layers were converted from, and a hash of the converted desktop doc
   *  (unchanged doc → "AI tự chỉnh" can revise the HTML and convert again without losing hand edits). */
  design?: { html: string; hash: string; name?: string; at: string } | null;
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  w: number;
  h: number;
  bytes: number;
  /** Where the image came from: a website (host + page), an upload, a paste, the AI, the catalog. Drives library grouping. */
  src?: AssetSrc;
  /** Project the image belongs to (set when added inside a project or when an AI variant is applied). */
  project?: string | null;
  /** ISO time it was added. */
  at?: string;
}
export interface AssetSrc { kind: 'web' | 'upload' | 'paste' | 'ai' | 'catalog' | 'logo' | 'graphic' | 'stock'; host?: string; url?: string; page?: string; /** Licence / credit line for stock photos (Openverse). */ credit?: string }

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

export type FontCat = 'sans' | 'display' | 'serif' | 'rounded' | 'script' | 'mono' | 'system';
/** Google Fonts the Studio can load. `vi` = has Vietnamese glyphs (diacritics render correctly). */
export const FONTS: { family: string; label: string; google?: string; cat: FontCat; vi: boolean }[] = [
  // sans
  { family: 'Inter', label: 'Inter', google: 'Inter:wght@400;500;600;700;800;900', cat: 'sans', vi: true },
  { family: 'Be Vietnam Pro', label: 'Be Vietnam Pro', google: 'Be+Vietnam+Pro:wght@400;500;600;700;800;900', cat: 'sans', vi: true },
  { family: 'Montserrat', label: 'Montserrat', google: 'Montserrat:wght@400;500;600;700;800;900', cat: 'sans', vi: true },
  { family: 'Manrope', label: 'Manrope', google: 'Manrope:wght@400;500;600;700;800', cat: 'sans', vi: true },
  { family: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', google: 'Plus+Jakarta+Sans:wght@400;500;600;700;800', cat: 'sans', vi: true },
  { family: 'Sora', label: 'Sora', google: 'Sora:wght@400;500;600;700;800', cat: 'sans', vi: true },
  { family: 'Lexend', label: 'Lexend', google: 'Lexend:wght@400;500;600;700;800', cat: 'sans', vi: true },
  { family: 'Raleway', label: 'Raleway', google: 'Raleway:wght@400;500;600;700;800;900', cat: 'sans', vi: true },
  { family: 'Josefin Sans', label: 'Josefin Sans', google: 'Josefin+Sans:wght@400;500;600;700', cat: 'sans', vi: true },
  { family: 'Work Sans', label: 'Work Sans', google: 'Work+Sans:wght@400;500;600;700;800', cat: 'sans', vi: true },
  { family: 'Mulish', label: 'Mulish', google: 'Mulish:wght@400;500;600;700;800;900', cat: 'sans', vi: true },
  { family: 'Roboto', label: 'Roboto', google: 'Roboto:wght@400;500;700;900', cat: 'sans', vi: true },
  { family: 'DM Sans', label: 'DM Sans', google: 'DM+Sans:wght@400;500;600;700;800', cat: 'sans', vi: false },
  { family: 'Poppins', label: 'Poppins', google: 'Poppins:wght@400;500;600;700;800', cat: 'sans', vi: false },
  { family: 'Outfit', label: 'Outfit', google: 'Outfit:wght@400;500;600;700;800', cat: 'sans', vi: false },
  // display / headline
  { family: 'Space Grotesk', label: 'Space Grotesk', google: 'Space+Grotesk:wght@400;500;600;700', cat: 'display', vi: true },
  { family: 'Unbounded', label: 'Unbounded', google: 'Unbounded:wght@400;500;600;700;800;900', cat: 'display', vi: true },
  { family: 'Oswald', label: 'Oswald', google: 'Oswald:wght@400;500;600;700', cat: 'display', vi: true },
  { family: 'Anton', label: 'Anton', google: 'Anton', cat: 'display', vi: true },
  { family: 'Archivo Black', label: 'Archivo Black', google: 'Archivo+Black', cat: 'display', vi: true },
  { family: 'Bungee', label: 'Bungee', google: 'Bungee', cat: 'display', vi: true },
  { family: 'Chakra Petch', label: 'Chakra Petch', google: 'Chakra+Petch:wght@400;500;600;700', cat: 'display', vi: true },
  { family: 'Exo 2', label: 'Exo 2', google: 'Exo+2:wght@400;500;600;700;800;900', cat: 'display', vi: true },
  { family: 'Syne', label: 'Syne', google: 'Syne:wght@400;500;600;700;800', cat: 'display', vi: false },
  { family: 'Bebas Neue', label: 'Bebas Neue', google: 'Bebas+Neue', cat: 'display', vi: false },
  // serif
  { family: 'Playfair Display', label: 'Playfair Display', google: 'Playfair+Display:wght@400;500;600;700;800;900', cat: 'serif', vi: true },
  { family: 'Lora', label: 'Lora', google: 'Lora:wght@400;500;600;700', cat: 'serif', vi: true },
  { family: 'Merriweather', label: 'Merriweather', google: 'Merriweather:wght@400;700;900', cat: 'serif', vi: true },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', google: 'Cormorant+Garamond:wght@400;500;600;700', cat: 'serif', vi: true },
  { family: 'Fraunces', label: 'Fraunces', google: 'Fraunces:wght@400;500;600;700;800;900', cat: 'serif', vi: true },
  { family: 'Roboto Slab', label: 'Roboto Slab', google: 'Roboto+Slab:wght@400;500;600;700;800', cat: 'serif', vi: true },
  { family: 'Noto Serif', label: 'Noto Serif', google: 'Noto+Serif:wght@400;500;600;700;800', cat: 'serif', vi: true },
  { family: 'DM Serif Display', label: 'DM Serif Display', google: 'DM+Serif+Display', cat: 'serif', vi: false },
  // rounded / playful
  { family: 'Nunito', label: 'Nunito', google: 'Nunito:wght@400;500;600;700;800;900', cat: 'rounded', vi: true },
  { family: 'Quicksand', label: 'Quicksand', google: 'Quicksand:wght@400;500;600;700', cat: 'rounded', vi: true },
  { family: 'Baloo 2', label: 'Baloo 2', google: 'Baloo+2:wght@400;500;600;700;800', cat: 'rounded', vi: true },
  { family: 'Fredoka', label: 'Fredoka', google: 'Fredoka:wght@400;500;600;700', cat: 'rounded', vi: false },
  { family: 'Varela Round', label: 'Varela Round', google: 'Varela+Round', cat: 'rounded', vi: false },
  // script / handwritten
  { family: 'Pacifico', label: 'Pacifico', google: 'Pacifico', cat: 'script', vi: true },
  { family: 'Dancing Script', label: 'Dancing Script', google: 'Dancing+Script:wght@400;500;600;700', cat: 'script', vi: true },
  { family: 'Lobster', label: 'Lobster', google: 'Lobster', cat: 'script', vi: true },
  { family: 'Caveat', label: 'Caveat', google: 'Caveat:wght@400;500;600;700', cat: 'script', vi: false },
  // mono
  { family: 'JetBrains Mono', label: 'JetBrains Mono', google: 'JetBrains+Mono:wght@400;500;600;700;800', cat: 'mono', vi: true },
  { family: 'Space Mono', label: 'Space Mono', google: 'Space+Mono:wght@400;700', cat: 'mono', vi: false },
  // system fallbacks (no download)
  { family: 'Helvetica', label: 'Helvetica / Arial', cat: 'system', vi: true },
  { family: 'Georgia', label: 'Georgia', cat: 'system', vi: true },
  { family: 'Courier New', label: 'Courier', cat: 'system', vi: true },
];
export const FONT_CAT_LABEL: Record<FontCat, string> = { sans: 'Sans', display: 'Display', serif: 'Serif', rounded: 'Bo tròn', script: 'Viết tay', mono: 'Mono', system: 'Hệ thống' };


export function uid(prefix = 'n'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Relative luminance 0..1 of a #rrggbb colour (sRGB). */
export function luminance(hex: string | null | undefined): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return 1;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const isDarkColor = (hex: string | null | undefined) => luminance(hex) < 0.35;
export function resolveColor(c: Color | null | undefined, brand: Brand): string | null {
  if (c == null) return null;
  if (typeof c === 'string') return c;
  const hex = brand[c.token] as string;
  if (c.alpha === undefined || c.alpha >= 1) return hex;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, c.alpha)})`;
}
