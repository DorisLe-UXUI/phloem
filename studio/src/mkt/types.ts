// Phloem MKT data model. A client is one workspace; everything else (brand, plans, reviews…) is an item filed under it.

export type Role = 'owner' | 'manager' | 'designer' | 'content' | 'ads' | 'client_viewer';
export const ROLE_LABEL: Record<Role, string> = { owner: 'Chủ workspace', manager: 'Quản lý', designer: 'Thiết kế', content: 'Nội dung', ads: 'Quảng cáo', client_viewer: 'Khách (xem + duyệt)' };
export const canWrite = (r?: Role) => !!r && r !== 'client_viewer';
export const canManage = (r?: Role) => r === 'owner' || r === 'manager';

export interface Client {
  id: string; name: string;
  /** Small data URL (≤ 160 px) so lists stay light. */
  logo?: string; industry?: string; website?: string; timezone?: string; currency?: string;
  status?: 'active' | 'paused' | 'archived'; lead?: string; color?: string; note?: string;
  /** Language of the client's public content (posts, ads, emails), e.g. 'vi', 'en'. The team UI stays Vietnamese. */
  language?: string;
  /** Main market / country the client sells in (free text, e.g. 'Việt Nam', 'Hoa Kỳ', 'Đông Nam Á'). */
  market?: string;
  createdAt: string; updatedAt: string;
  /** The caller's role in this workspace (set by the relay). */
  role?: Role; shared?: boolean;
}

export const LANGUAGES: { id: string; label: string; ai: string }[] = [
  { id: 'vi', label: 'Tiếng Việt', ai: 'Vietnamese (tiếng Việt có dấu, tự nhiên)' }, { id: 'en', label: 'English', ai: 'English' },
  { id: 'zh', label: '中文 (Trung)', ai: 'Simplified Chinese' }, { id: 'ja', label: '日本語 (Nhật)', ai: 'Japanese' }, { id: 'ko', label: '한국어 (Hàn)', ai: 'Korean' },
  { id: 'th', label: 'ไทย (Thái)', ai: 'Thai' }, { id: 'id', label: 'Bahasa Indonesia', ai: 'Indonesian' }, { id: 'ms', label: 'Bahasa Melayu', ai: 'Malay' },
  { id: 'fr', label: 'Français', ai: 'French' }, { id: 'de', label: 'Deutsch', ai: 'German' }, { id: 'es', label: 'Español', ai: 'Spanish' },
];
export const MARKETS = ['Việt Nam', 'Hoa Kỳ', 'Canada', 'Úc', 'Anh', 'Châu Âu', 'Nhật Bản', 'Hàn Quốc', 'Trung Quốc', 'Đài Loan', 'Singapore', 'Thái Lan', 'Malaysia', 'Indonesia', 'Philippines', 'Đông Nam Á', 'Toàn cầu'];
/** One line for AI prompts: which language the public copy is written in and for which market. */
export function audienceLine(c: Pick<Client, 'language' | 'market'>): string {
  const lang = LANGUAGES.find((l) => l.id === (c.language || 'vi'))?.ai || c.language || 'Vietnamese';
  return `Public copy language: ${lang}. Target market: ${c.market || 'Việt Nam'} (use that market's culture, holidays, currency, units and platforms).`;
}

export type ItemKind = 'brand' | 'plan' | 'review' | 'post' | 'campaign' | 'report' | 'note';
export interface Item<T = unknown> { kind: ItemKind; id: string; data: T; updatedAt: string }
export interface AuditRow { actor: string; action: string; detail: string; at: string }
export interface ShareLink { id: string; kind: string; itemId: string; createdAt: string; expiresAt: string }
export interface Member { userId: string; name: string; email: string; role: Role; addedAt: string }

/** One status flow for the whole app, one chip colour each. */
export type Status = 'draft' | 'pending' | 'approved' | 'scheduled' | 'live' | 'error';
export const STATUS: Record<Status, { label: string; tone: string }> = {
  draft: { label: 'Nháp', tone: 'dim' },
  pending: { label: 'Chờ duyệt', tone: 'warn' },
  approved: { label: 'Đã duyệt', tone: 'ok' },
  scheduled: { label: 'Đã lên lịch', tone: 'info' },
  live: { label: 'Đã đăng', tone: 'neon' },
  error: { label: 'Lỗi', tone: 'err' },
};
export const STATUS_ORDER: Status[] = ['draft', 'pending', 'approved', 'scheduled', 'live', 'error'];

export type ClientTab = 'overview' | 'brand' | 'plan' | 'design' | 'calendar' | 'ads' | 'email' | 'reports' | 'settings';
export const CLIENT_TABS: { id: ClientTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Tổng quan', icon: 'grid' },
  { id: 'brand', label: 'Thương hiệu', icon: 'palette' },
  { id: 'plan', label: 'Kế hoạch', icon: 'layers' },
  { id: 'design', label: 'Thiết kế', icon: 'shapes' },
  { id: 'calendar', label: 'Lịch đăng', icon: 'send' },
  { id: 'ads', label: 'Quảng cáo', icon: 'bolt' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'reports', label: 'Báo cáo', icon: 'reflow' },
  { id: 'settings', label: 'Cài đặt', icon: 'settings' },
];

export type MktView =
  | { view: 'overview' } | { view: 'clients' } | { view: 'library' }
  | { view: 'client'; id: string; tab: ClientTab }
  | { view: 'review'; token: string };

// ---------- Thương hiệu ----------
export interface Persona { name: string; age: string; job: string; goals: string; pains: string; channels: string }
export interface PaletteColor { name: string; hex: string; role: 'primary' | 'accent' | 'neutral'; ratio: number }
export interface BrandBook {
  title: string;
  status: Status;
  /** Inputs the book was written from. */
  sources: { website?: string; sheet?: string; drive?: string; files?: string[] };
  tagline: string; mission: string; vision: string; values: string[];
  personas: Persona[];
  voice: { traits: string[]; do: string[]; dont: string[] };
  messages: string[]; usp: string[];
  competitors: { name: string; note: string }[];
  logo: { main?: string; light?: string; dark?: string; rules: string[] };
  palette: PaletteColor[];
  fonts: { heading: string; body: string; note: string };
  imagery: string[]; layout: string[];
  examples: { do: string[]; dont: string[] };
  /** Brand kit tokens every module reuses. */
  kit: { hashtags: string[]; ctas: string[] };
  /** Email brand (colours, fonts, logo assets, shape, links) read from the website, applied to every new email of this client. */
  emailBrand?: Record<string, unknown> | null;
  /** House style the AI read from the client's past posts and pictures (Nhập dữ liệu → AI học phong cách). */
  styleNotes?: string;
  /** false = a website was given but could not be read (the book was written without it). */
  siteRead?: boolean;
  siteError?: string;
  version: number;
  versions?: { version: number; at: string; by: string; note: string }[];
  updatedBy?: string;
}

// ---------- Kế hoạch ----------
export type Channel = 'facebook' | 'instagram' | 'tiktok' | 'google_search' | 'youtube' | 'google_display' | 'google_business' | 'linkedin';
export const CHANNELS: { id: Channel; label: string; short: string; color: string; group: string }[] = [
  { id: 'facebook', label: 'Facebook', short: 'FB', color: '#5b8cff', group: 'Meta' },
  { id: 'instagram', label: 'Instagram', short: 'IG', color: '#ff5fa2', group: 'Meta' },
  { id: 'tiktok', label: 'TikTok', short: 'TT', color: '#25f4ee', group: 'TikTok' },
  { id: 'google_search', label: 'Google Search', short: 'GS', color: '#ffc53d', group: 'Google' },
  { id: 'youtube', label: 'YouTube', short: 'YT', color: '#ff5c5c', group: 'Google' },
  { id: 'google_display', label: 'Google Display', short: 'GD', color: '#ffa94d', group: 'Google' },
  { id: 'google_business', label: 'Google Business', short: 'GB', color: '#8ce99a', group: 'Google' },
  { id: 'linkedin', label: 'LinkedIn', short: 'IN', color: '#6fb7ff', group: 'LinkedIn' },
];
export const channelOf = (c: string) => CHANNELS.find((x) => x.id === c) || { id: c as Channel, label: c, short: c.slice(0, 2).toUpperCase(), color: '#8fa796', group: '' };
export type Format = 'image' | 'carousel' | 'reel' | 'video' | 'story' | 'article' | 'ad';
export const FORMATS: { id: Format; label: string }[] = [
  { id: 'image', label: 'Ảnh' }, { id: 'carousel', label: 'Carousel' }, { id: 'reel', label: 'Reel' }, { id: 'video', label: 'Video' },
  { id: 'story', label: 'Story' }, { id: 'article', label: 'Bài viết' }, { id: 'ad', label: 'Quảng cáo' },
];
export type Goal = 'awareness' | 'engagement' | 'leads' | 'sales';
export const GOALS: { id: Goal; label: string }[] = [{ id: 'awareness', label: 'Nhận diện' }, { id: 'engagement', label: 'Tương tác' }, { id: 'leads', label: 'Khách tiềm năng' }, { id: 'sales', label: 'Doanh số' }];

export interface PlanRow {
  id: string; date: string; time: string; channel: Channel; format: Format; pillar: string; topic: string;
  hook: string; caption: string; cta: string; hashtags: string; visual: string; owner: string; status: Status;
  /** Review comments from the client link, newest last (copied in from the review record). */
  note?: string;
  /** Phloem Design project made for this post (the cover slide of a carousel). */
  designId?: string;
  /** Carousel: every slide's design, in order (slides[0] === designId). */
  slides?: string[];
  /** Carousel outline the AI planned (one entry per slide); slides.length < slidePlan.length = some still to make. */
  slidePlan?: { role: string; headline: string; body: string; visual: string }[];
}
export interface PlanMonth { month: string; theme: string; campaigns: { name: string; goal: string; channels: string[]; budget: number; note: string }[]; kpi: Record<string, number>; budget: Record<string, number> }
export interface PlanSetup { months: number; start: string; channels: Channel[]; goals: Goal[]; budget: number; currency: string; events: string; postsPerWeek: number; brief: string }
export interface Plan {
  title: string; status: Status; setup: PlanSetup;
  strategy: string; pillars: { name: string; share: number; desc: string }[];
  months: PlanMonth[];
  rows: PlanRow[];
  kpiNames: string[];
  version: number;
  versions?: { version: number; at: string; by: string; note: string }[];
  createdAt: string;
}
export interface Review { rows: Record<string, { status: 'approved' | 'changes' | 'pending'; by: string; at: string }>; comments: { row: string | null; text: string; by: string; at: string }[]; overall: { status: string; by: string; at: string } | null }
