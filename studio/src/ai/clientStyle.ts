// A client's house style for the AI designer: its brand book (palette, type, voice, imagery and layout rules, do/don't,
// the style learned from its posts) plus its own recent emails (their art direction and a screenshot each), so a new
// email looks like it belongs with the rest of that client's work instead of a one-off.
import type { Project } from '../model/types';
import { FONTS } from '../model/types';
import { get } from '../store';
import { db } from '../storage/idb';
import type { AiImage } from './client';

export interface HouseStyle {
  clientId: string; name: string;
  /** Plain-language brief for the prompts. */
  text: string;
  /** Screenshots of the client's latest emails (the planner and designer see them). */
  images: AiImage[];
  /** Brand-book fonts that exist in Phloem's list (every direction uses them). */
  fonts: { heading?: string; body?: string };
  primary?: string; accent?: string;
  hasBook: boolean; pastEmails: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
const okFont = (f: string | undefined, lang: 'vi' | 'en') => { const hit = FONTS.find((x) => x.family.toLowerCase() === String(f || '').trim().toLowerCase() && (lang !== 'vi' || x.vi)); return hit?.family; };
const list = (xs: unknown, n = 6) => (Array.isArray(xs) ? xs.map(String).map((x) => x.trim()).filter(Boolean).slice(0, n) : []);
function imageOf(dataUrl: string | undefined, name: string): AiImage | null {
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  return m ? { name, mime: m[1] as AiImage['mime'], base64: m[3] } : null;
}

/** What the AI must keep for this client. null when there is no client (or it is unknown here). */
export async function houseStyleOf(clientId: string | null | undefined, lang: 'vi' | 'en' = 'vi', skipProject?: string): Promise<HouseStyle | null> {
  if (!clientId) return null;
  const s = get(); const client = s.clients.find((c) => c.id === clientId); if (!client) return null;
  const data = await import('../mkt/data');
  if (!data.cachedItems(clientId)) await data.listItems(clientId).catch(() => []);
  const { brandBookOf, styleNotesOf } = await import('../mkt/kit');
  const b = brandBookOf(clientId); const notes = styleNotesOf(clientId);
  const L: string[] = [];
  L.push(`Client: ${client.name}${client.industry ? ` · ${client.industry}` : ''}${client.website ? ` · ${client.website}` : ''}${client.market ? ` · market: ${client.market}` : ''}`);
  let primary: string | undefined, accent: string | undefined; const fonts: HouseStyle['fonts'] = {};
  if (b) {
    if (b.tagline) L.push(`Tagline: ${b.tagline}`);
    const pal = (b.palette || []).filter((c) => HEX.test(c.hex || ''));
    if (pal.length) L.push(`Brand palette (keep these roles; derive tints/shades from them, add at most one supporting neutral): ${pal.map((c) => `${c.role} "${c.name}" ${c.hex.toUpperCase()}${c.ratio ? ` ~${Math.round(c.ratio * 100)}%` : ''}`).join(', ')}`);
    primary = pal.find((c) => c.role === 'primary')?.hex.toUpperCase(); accent = pal.find((c) => c.role === 'accent')?.hex.toUpperCase();
    fonts.heading = okFont(b.fonts?.heading, lang); fonts.body = okFont(b.fonts?.body, lang);
    if (b.fonts?.heading || b.fonts?.body) L.push(`Brand type: heading ${b.fonts.heading || '–'}${fonts.heading ? '' : ' (not available: pick the closest allowed font in spirit)'}, body ${b.fonts.body || '–'}${b.fonts.body && !fonts.body ? ' (closest allowed)' : ''}${b.fonts.note ? ` · ${b.fonts.note}` : ''}`);
    const v = b.voice || { traits: [], do: [], dont: [] };
    if (list(v.traits).length) L.push(`Voice: ${list(v.traits).join(', ')}`);
    if (list(v.do).length) L.push(`Copy do: ${list(v.do, 5).join(' · ')}`);
    if (list(v.dont).length) L.push(`Copy don't: ${list(v.dont, 5).join(' · ')}`);
    if (list(b.usp).length) L.push(`USPs: ${list(b.usp, 4).join(' · ')}`);
    if (list(b.imagery).length) L.push(`Imagery style: ${list(b.imagery).join(' · ')}`);
    if (list(b.layout).length) L.push(`Layout rules: ${list(b.layout).join(' · ')}`);
    if (list(b.examples?.do).length) L.push(`Looks right: ${list(b.examples.do, 5).join(' · ')}`);
    if (list(b.examples?.dont).length) L.push(`Never: ${list(b.examples.dont, 5).join(' · ')}`);
    if (list(b.logo?.rules).length) L.push(`Logo rules: ${list(b.logo.rules, 4).join(' · ')}`);
    if (list(b.kit?.ctas).length) L.push(`House CTAs: ${list(b.kit.ctas, 5).join(' · ')}`);
    const eb = (b.emailBrand || {}) as { shape?: Record<string, unknown> };
    if (eb.shape && typeof eb.shape === 'object') L.push(`Website design DNA: ${JSON.stringify(eb.shape).slice(0, 300)}`);
  }
  if (notes) L.push(`House style learned from the client's own posts: ${notes.slice(0, 900)}`);
  // the client's recent emails: what they looked like, so this one sits with them
  const metas = s.projects.filter((p) => p.clientId === clientId && p.id !== skipProject && (p.kind ?? 'email') === 'email' && !p.template).sort((a, b2) => String(b2.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 4);
  const past: string[] = []; const images: AiImage[] = [];
  for (const m of metas) {
    const p = (await db.getProject(m.id).catch(() => null)) as (Project & { thumb?: string }) | null; if (!p) continue;
    const d = p.design?.dir as { aesthetic?: string; signature?: string; headingFont?: string; bodyFont?: string; palette?: Record<string, string> } | undefined;
    past.push(`- "${p.fields?.subject || p.name}": ${d?.aesthetic ? `${d.aesthetic}; ` : ''}type ${d?.headingFont || p.brand.headingFamily} / ${d?.bodyFont || p.brand.fontFamily}; colours primary ${p.brand.primary}, accent ${p.brand.accent}, bg ${p.brand.bg}${d?.signature ? `; hero: ${String(d.signature).slice(0, 140)}` : ''}`);
    if (images.length < 2) { const im = imageOf(m.thumb || p.thumb, `past-email-${images.length + 1}.jpg`); if (im) images.push(im); }
  }
  if (past.length) L.push(`The client's recent emails (keep the family resemblance: type pairing, colour roles, header/logo and footer treatment, button shape, photo style; do NOT repeat their hero idea):\n${past.join('\n')}${images.length ? `\n(The first ${images.length} are attached as screenshots named past-email-N.)` : ''}`);
  if (!b && !notes && !past.length) return { clientId, name: client.name, text: L.join('\n'), images: [], fonts, hasBook: false, pastEmails: 0 };
  return { clientId, name: client.name, text: L.join('\n'), images, fonts, primary, accent, hasBook: !!b, pastEmails: past.length };
}

/** The prompt block every AI step gets when a client's house style is known. */
export function houseBlock(h: HouseStyle | null | undefined): string {
  if (!h) return '';
  return `CLIENT HOUSE STYLE — this email is for "${h.name}" and must look like that client's own team made it (non-negotiable; trends and recipes bend to it, never the other way round):\n${h.text}`;
}
