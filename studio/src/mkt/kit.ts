// Brand kit → the email Brand: a client's approved (or latest) brand book drives every email made in its workspace.
import type { Brand } from '../model/types';
import { cachedItems } from './data';
import type { BrandBook } from './types';

export function brandBookOf(clientId: string | null | undefined): BrandBook | null {
  if (!clientId) return null;
  const it = cachedItems(clientId)?.find((i) => i.kind === 'brand' && i.id === 'main');
  return (it?.data as BrandBook) || null;
}

/** Overrides for a new email of this client (empty when it has no brand book yet). */
export function clientEmailBrand(clientId: string | null | undefined): Partial<Brand> {
  const b = brandBookOf(clientId);
  if (!b) return {};
  const out: Partial<Brand> = { ...((b.emailBrand as Partial<Brand>) || {}) };
  const primary = b.palette.find((c) => c.role === 'primary'), accent = b.palette.find((c) => c.role === 'accent');
  if (primary?.hex) out.primary = primary.hex;
  if (accent?.hex) out.accent = accent.hex;
  return out;
}

/** House style the AI read from past posts: on the brand book, or a note when there is no book yet. */
export function styleNotesOf(clientId: string | null | undefined): string {
  if (!clientId) return '';
  const b = brandBookOf(clientId); if (b?.styleNotes) return b.styleNotes;
  const n = cachedItems(clientId)?.find((i) => i.kind === 'note' && i.id === 'style')?.data as { styleNotes?: string } | undefined;
  return n?.styleNotes || '';
}
