// Shared types: used by the Figma sandbox (src/plugin), the UI iframe (src/ui) and tests.

export type Provider = 'mailchimp' | 'klaviyo';

/** Normalized scene node. The slicer only ever sees this shape, so it can run outside Figma. */
export interface NNode {
  id: string;
  name: string;
  type: string;
  /** Position relative to the root frame, in frame pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  /** Link attached to this node (hyperlink, prototype URL reaction, #link= layer name, or plugin field). */
  link: string | null;
  linkSource: 'hyperlink' | 'reaction' | 'name' | 'field' | null;
  /** Alt text attached to this node. */
  alt: string | null;
  altSource: 'name' | 'field' | 'layer' | null;
  /** Does this node paint an image fill? (so a missing alt matters) */
  hasImage: boolean;
  isText: boolean;
  /** Text content, used for CTA detection and alt fallbacks. */
  text: string | null;
  fontSize: number | null;
  /** First solid fill as #rrggbb, if any. */
  fill: string | null;
  children: NNode[];
}

export interface Slice {
  /** Stable-ish key: r{row}c{col}. */
  key: string;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  link: string | null;
  linkNodeId: string | null;
  alt: string;
  altNodeId: string | null;
  /** Node whose bounds best match the slice; alt/link edits from the UI are written here. */
  ownerNodeId: string | null;
  /** Names of nodes inside the slice, for the UI list. */
  label: string;
  /** Index of the kept (animated) region this slice belongs to; sibling slices share one animation clock and frame rate. */
  keep?: number;
  /** Live HTML text instead of a picture (plain copy on a solid background): real text for spam filters, screen
   *  readers, search and dark mode. Slices with `text` have no image. */
  text?: LiveText;
}

/** One paragraph of live text, positioned inside its slice (px, slice-relative). */
export interface LiveTextRun {
  text: string; x: number; y: number; w: number; h: number;
  /** CSS font-family list: the design font first, then a web-safe fallback of the same category. */
  font: string; size: number; weight: number; italic: boolean; color: string;
  align: 'left' | 'center' | 'right'; lineHeight: number; letterSpacing: number; underline: boolean;
}
export interface LiveText { bg: string; runs: LiveTextRun[] }

export interface SliceRow {
  y: number;
  h: number;
  cells: Slice[];
}

export interface SlicePlan {
  frameId: string;
  frameName: string;
  width: number;
  height: number;
  rows: SliceRow[];
  slices: Slice[];
}

export type CheckLevel = 'error' | 'warn' | 'info';

export interface Check {
  level: CheckLevel;
  code: string;
  message: string;
  nodeId?: string;
  sliceKey?: string;
}

export interface Suggestion {
  id: string;
  level: 'fix' | 'tip' | 'good';
  title: string;
  detail: string;
  nodeId?: string;
  /** Action the sandbox can perform for this suggestion. */
  action?: SuggestionAction;
}

export type SuggestionAction =
  | { kind: 'snap-width'; width: number }
  | { kind: 'round-pixels' }
  | { kind: 'insert-block'; block: BlockKind }
  | { kind: 'focus'; nodeId: string }
  | { kind: 'set-field'; field: keyof FrameFields }
  | { kind: 'create-mobile' };

export type BlockKind =
  | 'hero-card'
  | 'zigzag'
  | 'statement'
  | 'menu'
  | 'hero-product'
  | 'ticker'
  | 'offer'
  | 'reviews'
  | 'overlap'
  | 'spotlight'
  | 'steps'
  | 'collage'
  | 'glass-hero'
  | 'nav'
  | 'hero'
  | 'hero-band'
  | 'text'
  | 'cta'
  | 'products-2'
  | 'products-3'
  | 'feature-row'
  | 'stats'
  | 'quote'
  | 'hero-overlay'
  | 'split'
  | 'bento'
  | 'badges'
  | 'dark-band'
  | 'categories'
  | 'social'
  | 'cta-wide'
  | 'gallery'
  | 'hero-center'
  | 'icon-row'
  | 'checklist'
  | 'countdown'
  | 'code'
  | 'stat-tiles'
  | 'articles'
  | 'divider'
  | 'spacer'
  | 'footer';

export type TemplateKind = 'newsletter' | 'product-grid' | 'promo' | 'welcome' | 'cart' | 'launch' | 'event' | 'digest' | 'testimonial' | 'seasonal' | 'reengagement' | 'drop' | 'bento' | 'luxe' | 'travel' | 'food' | 'flash' | 'fitness' | 'kids' | 'offer' | 'agency' | 'assets' | 'portfolio' | 'appkids' | 'blank' | 'mobile-pair';

export interface SlicerOptions {
  /** Max slice height in px before a forced cut (Outlook truncates images taller than ~1728px). */
  maxSliceHeight: number;
  /** Merge adjacent link-free rows into one slice. */
  mergeRows: boolean;
  /** Minimum row height; thinner strips are merged into a neighbour. */
  minRowHeight: number;
  /** Regions that must each come out as ONE full-width slice (animated blocks exported as a single GIF, so nothing drifts out of sync). */
  keep?: { x: number; y: number; w: number; h: number }[];
}

export const DEFAULT_SLICER_OPTIONS: SlicerOptions = {
  maxSliceHeight: 1500,
  mergeRows: true,
  minRowHeight: 12,
};

export type ImageFormat = 'PNG' | 'JPG' | 'GIF';

export interface ExportedSlice {
  key: string;
  bytes: Uint8Array;
  format: ImageFormat;
  /** FNV-1a hash of bytes, used to skip re-uploads of unchanged slices. */
  hash: string;
  w: number;
  h: number;
  scale: number;
  /** Colour along the slice's bottom/right edge (#rrggbb): its table cell is painted with it, so a sub-pixel seam
   *  between slices (zoomed screens, scaled Gmail) shows the same colour instead of a white hairline. */
  bg?: string;
}

export interface FrameSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fields: FrameFields;
  drafts: Record<string, DraftRecord>;
}

export interface FrameFields {
  campaignName: string;
  subject: string;
  preheader: string;
  mobileFrameId: string | null;
}

export interface DraftFile {
  id: string | null;
  url: string;
  hash: string;
}

export interface DraftRecord {
  provider: Provider;
  profileId: string;
  campaignId: string;
  /** Klaviyo only. */
  templateId?: string;
  messageId?: string;
  webUrl?: string;
  files: Record<string, DraftFile>;
  updatedAt: string;
}

export type Auth =
  | { type: 'apikey'; apiKey: string; dc?: string }
  | {
      type: 'oauth';
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      dc?: string;
      accountName?: string;
      accountId?: string;
    };

/** One client = one connection + its defaults. */
export interface Profile {
  id: string;
  name: string;
  provider: Provider;
  auth: Auth;
  audienceId: string;
  audienceName: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  /** Mailchimp: template id + mc:edit section to drop the HTML into. Klaviyo: ignored. */
  templateId: string;
  templateSection: string;
  utmTemplate: string;
  footerHtml: string;
  imageFormat: ImageFormat;
  scale: 1 | 2;
  jpgQuality: number;
  /** Scopes/permissions discovered on last check. */
  permissions: Record<string, boolean>;
  accountLabel: string;
}

export interface Settings {
  relayUrl: string;
  relayToken: string;
  activeProfileId: string | null;
  maxSliceHeight: number;
  mergeRows: boolean;
  /** Plain copy (≤ 24px, solid background) exported as live HTML text instead of pictures. */
  liveText?: boolean;
  altFromLayerName: boolean;
  uiHeight: number;
  language: 'vi' | 'en';
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: 'http://localhost:8787',
  relayToken: '',
  activeProfileId: null,
  maxSliceHeight: 1500,
  mergeRows: true,
  liveText: true,
  altFromLayerName: true,
  uiHeight: 680,
  language: 'vi',
};

export const DEFAULT_UTM =
  'utm_source={provider}&utm_medium=email&utm_campaign={campaign}&utm_content={slice}';

export function newProfile(provider: Provider, name: string): Profile {
  return {
    id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    provider,
    auth: { type: 'apikey', apiKey: '' },
    audienceId: '',
    audienceName: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    templateId: '',
    templateSection: 'body',
    utmTemplate: DEFAULT_UTM,
    footerHtml: '',
    imageFormat: 'JPG',
    scale: 2,
    jpgQuality: 85,
    permissions: {},
    accountLabel: '',
  };
}

// ---- Messages between sandbox and UI ----

export type ToUI =
  | { type: 'init'; frames: FrameSummary[]; pageFrames: { id: string; name: string; width: number }[]; profiles: Profile[]; settings: Settings; version: string }
  | { type: 'selection'; frames: FrameSummary[]; pageFrames: { id: string; name: string; width: number }[] }
  | { type: 'plan'; frameId: string; plan: SlicePlan; checks: Check[] }
  | { type: 'export-progress'; frameId: string; done: number; total: number }
  | { type: 'export-done'; frameId: string; plan: SlicePlan; slices: ExportedSlice[]; mobile: { plan: SlicePlan; slices: ExportedSlice[] } | null }
  | { type: 'export-error'; frameId: string; message: string }
  | { type: 'profiles'; profiles: Profile[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'frame'; frame: FrameSummary }
  | { type: 'toast'; kind: 'ok' | 'err' | 'info'; text: string }
  | { type: 'thumb'; frameId: string; key: string; bytes: Uint8Array }
  | { type: 'optimize-done'; frameId: string; changes: string[]; checks: Check[] }
  | { type: 'suggestions'; frameId: string; suggestions: Suggestion[]; score: number };

export type ToPlugin =
  | { type: 'ready' }
  | { type: 'get-plan'; frameId: string }
  | { type: 'get-thumbs'; frameId: string }
  | { type: 'export'; frameIds: string[]; format: ImageFormat; scale: 1 | 2; jpgQuality: number }
  | { type: 'set-node-meta'; nodeId: string; link?: string | null; alt?: string | null }
  | { type: 'set-slice-override'; frameId: string; key: string; link?: string | null; alt?: string | null }
  | { type: 'save-profiles'; profiles: Profile[] }
  | { type: 'save-settings'; settings: Settings }
  | { type: 'save-draft'; frameId: string; profileId: string; draft: DraftRecord | null }
  | { type: 'set-frame-fields'; frameId: string; fields: Partial<FrameFields> }
  | { type: 'focus-node'; nodeId: string }
  | { type: 'insert-template'; kind: TemplateKind }
  | { type: 'insert-block'; frameId: string | null; block: BlockKind }
  | { type: 'get-suggestions'; frameId: string }
  | { type: 'apply-suggestion'; frameId: string; action: SuggestionAction }
  | { type: 'optimize-frame'; frameId: string }
  | { type: 'create-mobile-frame'; frameId: string }
  | { type: 'resize'; height: number }
  | { type: 'notify'; text: string; error?: boolean }
  | { type: 'open-url'; url: string };
